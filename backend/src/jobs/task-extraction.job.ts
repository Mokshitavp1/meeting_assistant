import { Queue, Worker, QueueEvents, JobsOptions, Job } from 'bullmq';
import { prisma } from '../config/database';
import { redisClient, setJSON, getJSON } from '../config/redis';
import { BadRequestError, NotFoundError } from '../middleware/error.middleware';
import { extractTasksFromTranscript, type MeetingParticipant } from '../services/ai-extraction.service';
import { generateMinutesOfMeeting } from '../services/mom-generation.service';
import { sendTaskAssignmentEmail } from '../services/email.service';

export interface TaskExtractionJobData {
    meetingId: string;
    transcript: string;
}

export interface MoMGenerationJobData {
    meetingId: string;
    transcript: string;
}

export interface TaskExtractionJobResult {
    meetingId: string;
    createdTaskCount: number;
    momJobId: string;
}

const TASK_EXTRACTION_QUEUE_NAME = 'ai-task-extraction-queue';
const MOM_GENERATION_QUEUE_NAME = 'mom-generation-queue';

const DEFAULT_TASK_EXTRACTION_JOB_OPTIONS: JobsOptions = {
    attempts: 3,
    backoff: {
        type: 'exponential',
        delay: 5000,
    },
    removeOnComplete: 200,
    removeOnFail: 500,
};

const DEFAULT_MOM_GENERATION_JOB_OPTIONS: JobsOptions = {
    attempts: 3,
    backoff: {
        type: 'exponential',
        delay: 5000,
    },
    removeOnComplete: 200,
    removeOnFail: 500,
};

const UNCONFIRMED_TASK_PREFIX = '[UNCONFIRMED_AI_TASK]';

let taskExtractionQueue: Queue<TaskExtractionJobData, TaskExtractionJobResult> | null = null;
let taskExtractionWorker: Worker<TaskExtractionJobData, TaskExtractionJobResult> | null = null;
let taskExtractionQueueEvents: QueueEvents | null = null;
let momGenerationQueue: Queue<MoMGenerationJobData> | null = null;
let momGenerationWorker: Worker<MoMGenerationJobData> | null = null;

function validatePayload(payload: TaskExtractionJobData): void {
    if (!payload.meetingId?.trim()) {
        throw new BadRequestError('meetingId is required for task extraction job');
    }

    if (!payload.transcript?.trim()) {
        throw new BadRequestError('transcript is required for task extraction job');
    }
}

function normalizeName(value: string | null | undefined): string {
    return (value || '')
        .toLowerCase()
        .replace(/[^a-z0-9\s]/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
}

function mapConfidenceToPriority(confidence: number): 'low' | 'medium' | 'high' {
    if (confidence >= 0.75) {
        return 'high';
    }
    if (confidence >= 0.45) {
        return 'medium';
    }
    return 'low';
}

function parseDueDate(deadline: string | null): Date | null {
    if (!deadline) {
        return null;
    }

    const parsed = new Date(deadline);
    if (Number.isNaN(parsed.getTime())) {
        return null;
    }

    return parsed;
}

async function getAdminUsers(meetingId: string): Promise<Array<{ id: string; email: string }>> {
    const meeting = await prisma.meeting.findUnique({
        where: { id: meetingId },
        select: {
            workspaceId: true,
            title: true,
        },
    });

    if (!meeting) {
        throw new NotFoundError('Meeting');
    }

    if (meeting.workspaceId) {
        const workspaceAdmins = await prisma.workspaceMember.findMany({
            where: {
                workspaceId: meeting.workspaceId,
                role: 'admin',
            },
            select: {
                user: {
                    select: {
                        id: true,
                        email: true,
                    },
                },
            },
        });

        return workspaceAdmins
            .map((item) => ({ id: item.user.id, email: item.user.email }))
            .filter((u) => Boolean(u.email));
    }

    const globalAdmins = await prisma.user.findMany({
        where: {
            role: 'admin',
            isActive: true,
        },
        select: {
            id: true,
            email: true,
        },
    });

    return globalAdmins.filter((u) => Boolean(u.email));
}

async function notifyAdminsTasksReadyForReview(meetingId: string, taskCount: number): Promise<void> {
    const meeting = await prisma.meeting.findUnique({
        where: { id: meetingId },
        select: {
            title: true,
        },
    });

    const meetingTitle = meeting?.title || `Meeting ${meetingId}`;
    const adminUsers = await getAdminUsers(meetingId);

    if (!adminUsers.length) {
        console.warn(
            `[TaskExtractionJob] No admin recipients found for meeting=${meetingId}`
        );
        return;
    }

    const NOTIFICATION_KEY_PREFIX = 'notifications:user:';
    const NOTIFICATION_TTL_SECONDS = 60 * 60 * 24 * 30;

    const results = await Promise.allSettled(
        adminUsers.map(async (admin) => {
            // Email notification
            await sendTaskAssignmentEmail({
                to: admin.email,
                assigneeName: 'Admin',
                taskTitle: `${taskCount} extracted task(s) ready for review`,
                dueDate: 'Review pending',
                meetingTitle,
                taskLink: '#',
            });

            // In-app notification
            const key = `${NOTIFICATION_KEY_PREFIX}${admin.id}`;
            const existing = (await getJSON<any[]>(key)) || [];
            const notification = {
                id: `notif_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
                type: 'meeting-review-ready',
                title: 'Meeting Tasks Ready for Review',
                message: `"${meetingTitle}" has ${taskCount} AI-extracted task(s) awaiting your review and confirmation.`,
                meetingId,
                meetingTitle,
                createdAt: new Date().toISOString(),
                read: false,
            };
            const updated = [notification, ...existing].slice(0, 200);
            await setJSON(key, updated, NOTIFICATION_TTL_SECONDS);
        })
    );

    const failedCount = results.filter((result) => result.status === 'rejected').length;
    if (failedCount > 0) {
        console.warn(
            `[TaskExtractionJob] Admin notification partial failure meeting=${meetingId} failed=${failedCount}`
        );
    }
}

async function processTaskExtractionJob(
    job: Job<TaskExtractionJobData, TaskExtractionJobResult>
): Promise<TaskExtractionJobResult> {
    validatePayload(job.data);

    const { meetingId, transcript } = job.data;

    console.log(
        `[TaskExtractionJob] Started job=${job.id} meeting=${meetingId} attempt=${job.attemptsMade + 1}`
    );

    await job.updateProgress(5);

    const meeting = await prisma.meeting.findUnique({
        where: { id: meetingId },
        select: {
            id: true,
            participants: {
                select: {
                    userId: true,
                    user: {
                        select: {
                            id: true,
                            name: true,
                            email: true,
                        },
                    },
                },
            },
        },
    });

    if (!meeting) {
        throw new NotFoundError('Meeting');
    }

    const participants: MeetingParticipant[] = meeting.participants.map((participant) => ({
        id: participant.user.id,
        name: participant.user.name || participant.user.email,
        email: participant.user.email,
    }));

    const participantAssigneeMap = new Map<string, string>();
    for (const participant of meeting.participants) {
        const displayName = participant.user.name || participant.user.email;
        const normalized = normalizeName(displayName);
        if (normalized) {
            participantAssigneeMap.set(normalized, participant.userId);
            // Also index individual tokens (first name, last name) so partial matches work
            for (const token of normalized.split(' ').filter((t) => t.length > 1)) {
                if (!participantAssigneeMap.has(token)) {
                    participantAssigneeMap.set(token, participant.userId);
                }
            }
        }
    }

    await job.updateProgress(20);

    const provider = (process.env.AI_PROVIDER || 'openai').toLowerCase() === 'anthropic'
        ? 'anthropic'
        : 'openai';

    const extractedTasks = await extractTasksFromTranscript({
        transcript,
        participants,
        provider,
    });

    await job.updateProgress(55);

    const createdTasks = await prisma.$transaction(
        extractedTasks.map((task) => {
            const normalizedAssignee = normalizeName(task.assigneeName);
            const assignedToId = normalizedAssignee
                ? participantAssigneeMap.get(normalizedAssignee) || null
                : null;

            return prisma.task.create({
                data: {
                    meetingId,
                    title: task.title,
                    description: `${UNCONFIRMED_TASK_PREFIX} ${task.description || ''}`.trim(),
                    assignedToId,
                    dueDate: parseDueDate(task.deadline),
                    status: 'pending',
                    priority: mapConfidenceToPriority(task.confidence),
                    isConfirmed: false,
                },
            });
        })
    );

    await job.updateProgress(75);

    if (!momGenerationQueue) {
        momGenerationQueue = new Queue<MoMGenerationJobData>(MOM_GENERATION_QUEUE_NAME, {
            connection: redisClient,
            defaultJobOptions: DEFAULT_MOM_GENERATION_JOB_OPTIONS,
        });
    }

    const momJob = await momGenerationQueue.add('generate-mom', {
        meetingId,
        transcript,
    });

    const momJobId = String(momJob.id);

    await job.updateProgress(90);

    await notifyAdminsTasksReadyForReview(meetingId, createdTasks.length);

    await job.updateProgress(100);

    console.log(
        `[TaskExtractionJob] Completed job=${job.id} meeting=${meetingId} createdTasks=${createdTasks.length} momJob=${momJobId}`
    );

    return {
        meetingId,
        createdTaskCount: createdTasks.length,
        momJobId,
    };
}

export async function initializeTaskExtractionQueue(): Promise<void> {
    if (!taskExtractionQueue) {
        taskExtractionQueue = new Queue<TaskExtractionJobData, TaskExtractionJobResult>(
            TASK_EXTRACTION_QUEUE_NAME,
            {
                connection: redisClient,
                defaultJobOptions: DEFAULT_TASK_EXTRACTION_JOB_OPTIONS,
            }
        );
    }

    if (!momGenerationQueue) {
        momGenerationQueue = new Queue<MoMGenerationJobData>(MOM_GENERATION_QUEUE_NAME, {
            connection: redisClient,
            defaultJobOptions: DEFAULT_MOM_GENERATION_JOB_OPTIONS,
        });
    }

    if (!taskExtractionQueueEvents) {
        taskExtractionQueueEvents = new QueueEvents(TASK_EXTRACTION_QUEUE_NAME, {
            connection: redisClient,
        });
    }

    if (!taskExtractionWorker) {
        taskExtractionWorker = new Worker<TaskExtractionJobData, TaskExtractionJobResult>(
            TASK_EXTRACTION_QUEUE_NAME,
            async (job) => processTaskExtractionJob(job),
            {
                connection: redisClient,
                concurrency: 2,
            }
        );

        taskExtractionWorker.on('active', (job) => {
            console.log(
                `[TaskExtractionJob] Active job=${job?.id} meeting=${job?.data?.meetingId || 'unknown'}`
            );
        });

        taskExtractionWorker.on('progress', (job, progress) => {
            console.log(
                `[TaskExtractionJob] Progress job=${job?.id} meeting=${job?.data?.meetingId || 'unknown'} progress=${progress}`
            );
        });

        taskExtractionWorker.on('completed', (job) => {
            console.log(
                `[TaskExtractionJob] Success job=${job?.id} meeting=${job?.data?.meetingId || 'unknown'}`
            );
        });

        taskExtractionWorker.on('failed', (job, error) => {
            const attemptsMade = job?.attemptsMade || 0;
            const maxAttempts = job?.opts.attempts || 3;

            console.error(
                `[TaskExtractionJob] Failed job=${job?.id} meeting=${job?.data?.meetingId || 'unknown'} attempts=${attemptsMade}/${maxAttempts} error=${error?.message || 'Unknown error'}`
            );

            if (attemptsMade >= maxAttempts) {
                console.error(
                    `[TaskExtractionJob] Exhausted retries for job=${job?.id} meeting=${job?.data?.meetingId || 'unknown'}`
                );
            }
        });
    }

    if (!momGenerationWorker) {
        momGenerationWorker = new Worker<MoMGenerationJobData>(
            MOM_GENERATION_QUEUE_NAME,
            async (job) => {
                const { meetingId, transcript } = job.data;
                console.log(`[MoMGenerationJob] Started job=${job.id} meeting=${meetingId}`);

                const meeting = await prisma.meeting.findUnique({
                    where: { id: meetingId },
                    select: {
                        id: true,
                        participants: {
                            select: {
                                user: { select: { id: true, name: true, email: true } },
                            },
                        },
                    },
                });

                if (!meeting) {
                    throw new NotFoundError('Meeting');
                }

                const attendees = meeting.participants.map((p) => ({
                    id: p.user.id,
                    name: p.user.name || p.user.email,
                    email: p.user.email,
                }));

                const provider = (process.env.AI_PROVIDER || 'openai').toLowerCase() === 'anthropic'
                    ? 'anthropic' as const
                    : 'openai' as const;

                const result = await generateMinutesOfMeeting({
                    transcript,
                    attendees,
                    provider,
                });

                await prisma.meeting.update({
                    where: { id: meetingId },
                    data: { minutesOfMeeting: result.formatted },
                });

                console.log(`[MoMGenerationJob] Completed job=${job.id} meeting=${meetingId}`);
            },
            {
                connection: redisClient,
                concurrency: 2,
            }
        );

        momGenerationWorker.on('failed', (job, error) => {
            console.error(
                `[MoMGenerationJob] Failed job=${job?.id} meeting=${job?.data?.meetingId || 'unknown'} error=${error?.message || 'Unknown error'}`
            );
        });
    }
}

export async function queueTaskExtractionJob(
    payload: TaskExtractionJobData,
    options?: JobsOptions
): Promise<string> {
    validatePayload(payload);

    if (!taskExtractionQueue) {
        await initializeTaskExtractionQueue();
    }

    if (!taskExtractionQueue) {
        throw new Error('Task extraction queue failed to initialize');
    }

    const job = await taskExtractionQueue.add('extract-tasks-from-transcript', payload, {
        ...DEFAULT_TASK_EXTRACTION_JOB_OPTIONS,
        ...options,
        attempts: 3,
    });

    const jobId = String(job.id);
    console.log(`[TaskExtractionJob] Queued job=${jobId} meeting=${payload.meetingId}`);
    return jobId;
}

export async function shutdownTaskExtractionQueue(): Promise<void> {
    await taskExtractionWorker?.close();
    await momGenerationWorker?.close();
    await taskExtractionQueueEvents?.close();
    await taskExtractionQueue?.close();
    await momGenerationQueue?.close();

    taskExtractionWorker = null;
    momGenerationWorker = null;
    taskExtractionQueueEvents = null;
    taskExtractionQueue = null;
    momGenerationQueue = null;
}
