import { Queue, Worker, QueueEvents, JobsOptions, Job } from 'bullmq';
import { prisma } from '../config/database';
import { redisClient, exists, setJSON } from '../config/redis';
import { sendTaskReminderEmail, sendTaskOverdueEmail } from '../services/email.service';

type ReminderType = '24h' | '1h' | 'overdue';

export interface ReminderSweepJobData {
    triggeredAt?: string;
}

export interface ReminderSweepJobResult {
    processedAt: string;
    sent24h: number;
    sent1h: number;
    sentOverdue: number;
}

interface InAppNotification {
    id: string;
    userId: string;
    type: 'task-reminder' | 'task-overdue';
    title: string;
    message: string;
    taskId: string;
    createdAt: string;
    read: boolean;
}

const REMINDER_QUEUE_NAME = 'task-reminder-queue';
const REMINDER_SWEEP_JOB_NAME = 'run-reminder-sweep';
const REMINDER_SWEEP_CRON = '*/15 * * * *';

const REMINDER_MARKER_PREFIX = 'reminder:sent:';
const NOTIFICATION_KEY_PREFIX = 'notifications:user:';
const MARKER_TTL_SECONDS = 60 * 60 * 24 * 45;
const NOTIFICATION_TTL_SECONDS = 60 * 60 * 24 * 30;
const MAX_NOTIFICATIONS_PER_USER = 200;

const DEFAULT_REMINDER_JOB_OPTIONS: JobsOptions = {
    attempts: 3,
    backoff: {
        type: 'exponential',
        delay: 5000,
    },
    removeOnComplete: 100,
    removeOnFail: 200,
};

let reminderQueue: Queue<ReminderSweepJobData, ReminderSweepJobResult> | null = null;
let reminderWorker: Worker<ReminderSweepJobData, ReminderSweepJobResult> | null = null;
let reminderQueueEvents: QueueEvents | null = null;

function addMinutes(date: Date, minutes: number): Date {
    return new Date(date.getTime() + minutes * 60 * 1000);
}

function addHours(date: Date, hours: number): Date {
    return new Date(date.getTime() + hours * 60 * 60 * 1000);
}

function formatDateKey(date: Date): string {
    return date.toISOString().slice(0, 10);
}

function buildReminderMarkerKey(taskId: string, reminderType: ReminderType, markerScope: string): string {
    return `${REMINDER_MARKER_PREFIX}${taskId}:${reminderType}:${markerScope}`;
}

async function wasReminderSent(taskId: string, reminderType: ReminderType, markerScope: string): Promise<boolean> {
    const markerKey = buildReminderMarkerKey(taskId, reminderType, markerScope);
    return (await exists(markerKey)) === 1;
}

async function markReminderSent(taskId: string, reminderType: ReminderType, markerScope: string): Promise<void> {
    const markerKey = buildReminderMarkerKey(taskId, reminderType, markerScope);
    await setJSON(
        markerKey,
        {
            taskId,
            reminderType,
            markerScope,
            sentAt: new Date().toISOString(),
        },
        MARKER_TTL_SECONDS
    );
}

async function createInAppNotification(input: {
    userId: string;
    taskId: string;
    type: 'task-reminder' | 'task-overdue';
    title: string;
    message: string;
}): Promise<void> {
    const notification: InAppNotification = {
        id: `notif_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`,
        userId: input.userId,
        type: input.type,
        title: input.title,
        message: input.message,
        taskId: input.taskId,
        createdAt: new Date().toISOString(),
        read: false,
    };

    const key = `${NOTIFICATION_KEY_PREFIX}${input.userId}`;
    await redisClient.lpush(key, JSON.stringify(notification));
    await redisClient.ltrim(key, 0, MAX_NOTIFICATIONS_PER_USER - 1);
    await redisClient.expire(key, NOTIFICATION_TTL_SECONDS);
}

async function sendDeadlineReminderForTask(
    task: {
        id: string;
        title: string;
        dueDate: Date;
        assignedToId: string;
        assignedTo: { email: string; name: string | null };
    },
    reminderType: '24h' | '1h'
): Promise<boolean> {
    const markerScope = task.dueDate.toISOString();
    const alreadySent = await wasReminderSent(task.id, reminderType, markerScope);

    if (alreadySent) {
        return false;
    }

    await sendTaskReminderEmail({
        to: task.assignedTo.email,
        assigneeName: task.assignedTo.name || task.assignedTo.email,
        taskTitle: task.title,
        dueDate: task.dueDate.toISOString(),
        reminderType,
        taskLink: '#',
    });

    await createInAppNotification({
        userId: task.assignedToId,
        taskId: task.id,
        type: 'task-reminder',
        title: reminderType === '24h' ? 'Task due in 24 hours' : 'Task due in 1 hour',
        message: `${task.title} is due at ${task.dueDate.toISOString()}.`,
    });

    await markReminderSent(task.id, reminderType, markerScope);
    return true;
}

async function sendOverdueReminderForTask(task: {
    id: string;
    title: string;
    dueDate: Date;
    assignedToId: string;
    assignedTo: { email: string; name: string | null };
}): Promise<boolean> {
    const markerScope = formatDateKey(new Date());
    const alreadySent = await wasReminderSent(task.id, 'overdue', markerScope);

    if (alreadySent) {
        return false;
    }

    await sendTaskOverdueEmail({
        to: task.assignedTo.email,
        assigneeName: task.assignedTo.name || task.assignedTo.email,
        taskTitle: task.title,
        dueDate: task.dueDate.toISOString(),
        taskLink: '#',
    });

    await createInAppNotification({
        userId: task.assignedToId,
        taskId: task.id,
        type: 'task-overdue',
        title: 'Task overdue',
        message: `${task.title} is overdue since ${task.dueDate.toISOString()}.`,
    });

    await markReminderSent(task.id, 'overdue', markerScope);
    return true;
}

async function processReminderSweep(
    job: Job<ReminderSweepJobData, ReminderSweepJobResult>
): Promise<ReminderSweepJobResult> {
    const now = new Date();
    const windowEnd = addMinutes(now, 15);
    const in24hStart = addHours(now, 24);
    const in24hEnd = addMinutes(in24hStart, 15);
    const in1hStart = addHours(now, 1);
    const in1hEnd = addMinutes(in1hStart, 15);

    console.log(`[ReminderJob] Sweep started job=${job.id} at=${now.toISOString()}`);
    await job.updateProgress(10);

    const [tasksDueIn24h, tasksDueIn1h, overdueTasks] = await Promise.all([
        prisma.task.findMany({
            where: {
                dueDate: {
                    gte: in24hStart,
                    lt: in24hEnd,
                },
                status: {
                    in: ['pending', 'in_progress'],
                },
                assignedToId: {
                    not: null,
                },
            },
            select: {
                id: true,
                title: true,
                dueDate: true,
                assignedToId: true,
                assignedTo: {
                    select: {
                        email: true,
                        name: true,
                    },
                },
            },
        }),
        prisma.task.findMany({
            where: {
                dueDate: {
                    gte: in1hStart,
                    lt: in1hEnd,
                },
                status: {
                    in: ['pending', 'in_progress'],
                },
                assignedToId: {
                    not: null,
                },
            },
            select: {
                id: true,
                title: true,
                dueDate: true,
                assignedToId: true,
                assignedTo: {
                    select: {
                        email: true,
                        name: true,
                    },
                },
            },
        }),
        prisma.task.findMany({
            where: {
                dueDate: {
                    lt: now,
                },
                status: {
                    in: ['pending', 'in_progress'],
                },
                assignedToId: {
                    not: null,
                },
            },
            select: {
                id: true,
                title: true,
                dueDate: true,
                assignedToId: true,
                assignedTo: {
                    select: {
                        email: true,
                        name: true,
                    },
                },
            },
        }),
    ]);

    await job.updateProgress(45);

    let sent24h = 0;
    let sent1h = 0;
    let sentOverdue = 0;

    for (const task of tasksDueIn24h) {
        if (!task.dueDate || !task.assignedToId || !task.assignedTo?.email) {
            continue;
        }

        const sent = await sendDeadlineReminderForTask(
            {
                id: task.id,
                title: task.title,
                dueDate: task.dueDate,
                assignedToId: task.assignedToId,
                assignedTo: {
                    email: task.assignedTo.email,
                    name: task.assignedTo.name,
                },
            },
            '24h'
        );

        if (sent) {
            sent24h += 1;
        }
    }

    await job.updateProgress(65);

    for (const task of tasksDueIn1h) {
        if (!task.dueDate || !task.assignedToId || !task.assignedTo?.email) {
            continue;
        }

        const sent = await sendDeadlineReminderForTask(
            {
                id: task.id,
                title: task.title,
                dueDate: task.dueDate,
                assignedToId: task.assignedToId,
                assignedTo: {
                    email: task.assignedTo.email,
                    name: task.assignedTo.name,
                },
            },
            '1h'
        );

        if (sent) {
            sent1h += 1;
        }
    }

    await job.updateProgress(80);

    for (const task of overdueTasks) {
        if (!task.dueDate || !task.assignedToId || !task.assignedTo?.email) {
            continue;
        }

        const sent = await sendOverdueReminderForTask({
            id: task.id,
            title: task.title,
            dueDate: task.dueDate,
            assignedToId: task.assignedToId,
            assignedTo: {
                email: task.assignedTo.email,
                name: task.assignedTo.name,
            },
        });

        if (sent) {
            sentOverdue += 1;
        }
    }

    await job.updateProgress(100);

    const result: ReminderSweepJobResult = {
        processedAt: new Date().toISOString(),
        sent24h,
        sent1h,
        sentOverdue,
    };

    console.log(
        `[ReminderJob] Sweep completed job=${job.id} sent24h=${sent24h} sent1h=${sent1h} sentOverdue=${sentOverdue} windowEnd=${windowEnd.toISOString()}`
    );

    return result;
}

export async function initializeReminderQueue(): Promise<void> {
    if (!reminderQueue) {
        reminderQueue = new Queue<ReminderSweepJobData, ReminderSweepJobResult>(
            REMINDER_QUEUE_NAME,
            {
                connection: redisClient,
                defaultJobOptions: DEFAULT_REMINDER_JOB_OPTIONS,
            }
        );
    }

    if (!reminderQueueEvents) {
        reminderQueueEvents = new QueueEvents(REMINDER_QUEUE_NAME, {
            connection: redisClient,
        });
    }

    if (!reminderWorker) {
        reminderWorker = new Worker<ReminderSweepJobData, ReminderSweepJobResult>(
            REMINDER_QUEUE_NAME,
            async (job) => processReminderSweep(job),
            {
                connection: redisClient,
                concurrency: 1,
            }
        );

        reminderWorker.on('active', (job) => {
            console.log(`[ReminderJob] Active job=${job?.id}`);
        });

        reminderWorker.on('completed', (job, result) => {
            console.log(
                `[ReminderJob] Success job=${job?.id} sent24h=${result.sent24h} sent1h=${result.sent1h} sentOverdue=${result.sentOverdue}`
            );
        });

        reminderWorker.on('failed', (job, error) => {
            console.error(
                `[ReminderJob] Failed job=${job?.id} attempts=${(job?.attemptsMade || 0) + 1}/${job?.opts.attempts || 3} error=${error?.message || 'Unknown error'}`
            );
        });
    }

    const repeatableJobs = await reminderQueue.getRepeatableJobs();
    const alreadyScheduled = repeatableJobs.some(
        (item) => item.name === REMINDER_SWEEP_JOB_NAME && item.pattern === REMINDER_SWEEP_CRON
    );

    if (!alreadyScheduled) {
        await reminderQueue.add(
            REMINDER_SWEEP_JOB_NAME,
            { triggeredAt: new Date().toISOString() },
            {
                ...DEFAULT_REMINDER_JOB_OPTIONS,
                repeat: {
                    pattern: REMINDER_SWEEP_CRON,
                },
                jobId: REMINDER_SWEEP_JOB_NAME,
            }
        );

        console.log(`[ReminderJob] Scheduled cron pattern=${REMINDER_SWEEP_CRON}`);
    }
}

export async function queueReminderSweepNow(): Promise<string> {
    if (!reminderQueue) {
        await initializeReminderQueue();
    }

    if (!reminderQueue) {
        throw new Error('Reminder queue failed to initialize');
    }

    const job = await reminderQueue.add(REMINDER_SWEEP_JOB_NAME, {
        triggeredAt: new Date().toISOString(),
    });

    const jobId = String(job.id);
    console.log(`[ReminderJob] Queued immediate sweep job=${jobId}`);
    return jobId;
}

export async function shutdownReminderQueue(): Promise<void> {
    await reminderWorker?.close();
    await reminderQueueEvents?.close();
    await reminderQueue?.close();

    reminderWorker = null;
    reminderQueueEvents = null;
    reminderQueue = null;
}
