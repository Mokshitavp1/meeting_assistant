import path from 'path';
import fs from 'fs/promises';
import { Queue, Worker, QueueEvents, JobsOptions, Job } from 'bullmq';
import { redisClient } from '../config/redis';
import { BadRequestError, ExternalServiceError } from '../middleware/error.middleware';
import {
    sendRenderedEmail,
    type EmailTemplateType,
} from '../services/email.service';

export interface EmailSendingJobData {
    to: string;
    subject: string;
    template: EmailTemplateType;
    data: Record<string, string | number | boolean | null | undefined>;
}

export interface EmailSendingJobResult {
    to: string;
    subject: string;
    template: EmailTemplateType;
    deliveredAt: string;
}

const EMAIL_SENDING_QUEUE_NAME = 'email-sending-queue';

const DEFAULT_EMAIL_JOB_OPTIONS: JobsOptions = {
    attempts: 5,
    backoff: {
        type: 'exponential',
        delay: 5000,
    },
    removeOnComplete: 200,
    removeOnFail: 500,
};

const templateFileMap: Record<EmailTemplateType, string> = {
    'task-assignment': 'task-assignment.html',
    'task-reminder-24h': 'task-reminder-24h.html',
    'task-reminder-1h': 'task-reminder-1h.html',
    'task-overdue': 'task-overdue.html',
    'task-completion': 'task-completion.html',
    welcome: 'welcome.html',
    'password-reset': 'password-reset.html',
};

const templateCache = new Map<EmailTemplateType, string>();

let emailSendingQueue: Queue<EmailSendingJobData, EmailSendingJobResult> | null = null;
let emailSendingWorker: Worker<EmailSendingJobData, EmailSendingJobResult> | null = null;
let emailSendingQueueEvents: QueueEvents | null = null;

function getTemplatesDirectory(): string {
    return path.join(__dirname, '..', 'templates');
}

function validatePayload(payload: EmailSendingJobData): void {
    if (!payload.to?.trim()) {
        throw new BadRequestError('Email recipient (to) is required');
    }

    if (!payload.subject?.trim()) {
        throw new BadRequestError('Email subject is required');
    }

    if (!payload.template) {
        throw new BadRequestError('Email template is required');
    }

    if (!payload.data || typeof payload.data !== 'object') {
        throw new BadRequestError('Email template data is required');
    }
}

async function loadTemplate(template: EmailTemplateType): Promise<string> {
    const cached = templateCache.get(template);
    if (cached) {
        return cached;
    }

    const templateFile = templateFileMap[template];
    const fullPath = path.join(getTemplatesDirectory(), templateFile);

    try {
        const content = await fs.readFile(fullPath, 'utf8');
        templateCache.set(template, content);
        return content;
    } catch {
        throw new ExternalServiceError('Email Templates', `Template not found: ${templateFile}`);
    }
}

function renderTemplate(
    templateContent: string,
    data: Record<string, string | number | boolean | null | undefined>
): string {
    return templateContent.replace(/{{\s*([a-zA-Z0-9_\.]+)\s*}}/g, (_full, key) => {
        const value = data[key];
        return value === null || value === undefined ? '' : String(value);
    });
}

async function processEmailSendingJob(
    job: Job<EmailSendingJobData, EmailSendingJobResult>
): Promise<EmailSendingJobResult> {
    validatePayload(job.data);

    const { to, subject, template, data } = job.data;

    console.log(
        `[EmailSendingJob] Started job=${job.id} to=${to} template=${template} attempt=${job.attemptsMade + 1}`
    );

    await job.updateProgress(15);

    const templateContent = await loadTemplate(template);
    const html = renderTemplate(templateContent, data);

    await job.updateProgress(55);

    await sendRenderedEmail({
        to,
        subject,
        html,
    });

    await job.updateProgress(100);

    const deliveredAt = new Date().toISOString();
    console.log(
        `[EmailSendingJob] Delivered job=${job.id} to=${to} template=${template} deliveredAt=${deliveredAt}`
    );

    return {
        to,
        subject,
        template,
        deliveredAt,
    };
}

export async function initializeEmailSendingQueue(): Promise<void> {
    if (!emailSendingQueue) {
        emailSendingQueue = new Queue<EmailSendingJobData, EmailSendingJobResult>(
            EMAIL_SENDING_QUEUE_NAME,
            {
                connection: redisClient,
                defaultJobOptions: DEFAULT_EMAIL_JOB_OPTIONS,
            }
        );
    }

    if (!emailSendingQueueEvents) {
        emailSendingQueueEvents = new QueueEvents(EMAIL_SENDING_QUEUE_NAME, {
            connection: redisClient,
        });
    }

    if (!emailSendingWorker) {
        emailSendingWorker = new Worker<EmailSendingJobData, EmailSendingJobResult>(
            EMAIL_SENDING_QUEUE_NAME,
            async (job) => processEmailSendingJob(job),
            {
                connection: redisClient,
                concurrency: 5,
            }
        );

        emailSendingWorker.on('active', (job) => {
            console.log(
                `[EmailSendingJob] Active job=${job?.id} to=${job?.data?.to || 'unknown'}`
            );
        });

        emailSendingWorker.on('completed', (job) => {
            console.log(
                `[EmailSendingJob] Success job=${job?.id} to=${job?.data?.to || 'unknown'}`
            );
        });

        emailSendingWorker.on('failed', (job, error) => {
            const attemptsMade = (job?.attemptsMade || 0) + 1;
            const maxAttempts = job?.opts.attempts || 5;

            console.error(
                `[EmailSendingJob] Failed job=${job?.id} to=${job?.data?.to || 'unknown'} attempts=${attemptsMade}/${maxAttempts} error=${error?.message || 'Unknown error'}`
            );
        });
    }
}

export async function queueEmailSendingJob(
    payload: EmailSendingJobData,
    options?: JobsOptions
): Promise<string> {
    validatePayload(payload);

    if (!emailSendingQueue) {
        await initializeEmailSendingQueue();
    }

    if (!emailSendingQueue) {
        throw new ExternalServiceError('Email Queue', 'Email sending queue is not initialized');
    }

    const job = await emailSendingQueue.add('send-email', payload, {
        ...DEFAULT_EMAIL_JOB_OPTIONS,
        ...options,
        attempts: 5,
        backoff: {
            type: 'exponential',
            delay: 5000,
        },
    });

    const jobId = String(job.id);
    console.log(
        `[EmailSendingJob] Queued job=${jobId} to=${payload.to} template=${payload.template}`
    );
    return jobId;
}

export async function shutdownEmailSendingQueue(): Promise<void> {
    await emailSendingWorker?.close();
    await emailSendingQueueEvents?.close();
    await emailSendingQueue?.close();

    emailSendingWorker = null;
    emailSendingQueueEvents = null;
    emailSendingQueue = null;
}
