import path from 'path';
import fs from 'fs/promises';
import nodemailer, { Transporter } from 'nodemailer';
import sgMail from '@sendgrid/mail';
import { Queue, Worker, QueueEvents, JobsOptions } from 'bullmq';
import { redisClient, setJSON, getJSON } from '../config/redis';
import { ExternalServiceError, BadRequestError } from '../middleware/error.middleware';

export type EmailProvider = 'sendgrid' | 'aws-ses' | 'nodemailer';
export type EmailTemplateType =
    | 'task-assignment'
    | 'task-reminder-24h'
    | 'task-reminder-1h'
    | 'task-overdue'
    | 'task-completion'
    | 'welcome'
    | 'password-reset';

export type EmailDeliveryStatus = 'queued' | 'processing' | 'sent' | 'failed';

export interface EmailJobPayload {
    to: string;
    subject: string;
    template: EmailTemplateType;
    data: Record<string, string | number | boolean | null | undefined>;
    from?: string;
    metadata?: Record<string, string>;
}

export interface EmailStatusRecord {
    jobId: string;
    status: EmailDeliveryStatus;
    provider: EmailProvider;
    to: string;
    subject: string;
    template: EmailTemplateType;
    attempts: number;
    error?: string;
    sentAt?: string;
    updatedAt: string;
}

export interface RenderedEmailPayload {
    to: string;
    subject: string;
    html: string;
    from?: string;
}

interface ProviderConfig {
    provider: EmailProvider;
    fromEmail: string;
    fromName?: string;
}

const EMAIL_QUEUE_NAME = 'email-delivery-queue';
const STATUS_KEY_PREFIX = 'email:status:';
const STATUS_TTL_SECONDS = 60 * 60 * 24 * 14;

const DEFAULT_JOB_OPTIONS: JobsOptions = {
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
    'welcome': 'welcome.html',
    'password-reset': 'password-reset.html',
};

const templateCache = new Map<EmailTemplateType, string>();

let transporter: Transporter | null = null;
let providerConfig: ProviderConfig | null = null;
let emailQueue: Queue<EmailJobPayload> | null = null;
let emailWorker: Worker<EmailJobPayload> | null = null;
let emailQueueEvents: QueueEvents | null = null;

function getTemplatesDirectory(): string {
    return path.join(__dirname, '..', 'templates');
}

function resolveProviderFromEnv(): EmailProvider {
    const value = (process.env.EMAIL_PROVIDER || 'nodemailer').toLowerCase();

    if (value === 'sendgrid') {
        return 'sendgrid';
    }

    if (value === 'aws-ses' || value === 'ses' || value === 'aws_ses') {
        return 'aws-ses';
    }

    return 'nodemailer';
}

function getFromAddress(config: ProviderConfig): string {
    if (config.fromName) {
        return `${config.fromName} <${config.fromEmail}>`;
    }
    return config.fromEmail;
}

function ensureProviderConfigured(): ProviderConfig {
    if (!providerConfig) {
        throw new ExternalServiceError('Email', 'Email provider is not configured');
    }
    return providerConfig;
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
    } catch (error) {
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

function buildInitialStatus(jobId: string, payload: EmailJobPayload): EmailStatusRecord {
    const config = ensureProviderConfigured();
    return {
        jobId,
        status: 'queued',
        provider: config.provider,
        to: payload.to,
        subject: payload.subject,
        template: payload.template,
        attempts: 0,
        updatedAt: new Date().toISOString(),
    };
}

async function persistStatus(record: EmailStatusRecord): Promise<void> {
    await setJSON(`${STATUS_KEY_PREFIX}${record.jobId}`, record, STATUS_TTL_SECONDS);
}

async function sendViaConfiguredProvider(payload: EmailJobPayload): Promise<void> {
    const config = ensureProviderConfigured();
    const templateContent = await loadTemplate(payload.template);
    const html = renderTemplate(templateContent, payload.data);
    const from = payload.from || getFromAddress(config);

    if (config.provider === 'sendgrid') {
        await sgMail.send({
            to: payload.to,
            from,
            subject: payload.subject,
            html,
        });
        return;
    }

    if (!transporter) {
        throw new ExternalServiceError('Email', 'Nodemailer transporter is not configured');
    }

    await transporter.sendMail({
        to: payload.to,
        from,
        subject: payload.subject,
        html,
    });
}

async function processEmailJob(jobId: string, payload: EmailJobPayload, attempt: number): Promise<void> {
    const processingStatus = buildInitialStatus(jobId, payload);
    processingStatus.status = 'processing';
    processingStatus.attempts = attempt;
    processingStatus.updatedAt = new Date().toISOString();
    await persistStatus(processingStatus);

    try {
        await sendViaConfiguredProvider(payload);
        const sentStatus: EmailStatusRecord = {
            ...processingStatus,
            status: 'sent',
            sentAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
        };
        await persistStatus(sentStatus);
    } catch (error) {
        const failedStatus: EmailStatusRecord = {
            ...processingStatus,
            status: 'failed',
            error: error instanceof Error ? error.message : 'Unknown email send error',
            updatedAt: new Date().toISOString(),
        };
        await persistStatus(failedStatus);
        throw error;
    }
}

function createNodemailerTransportForProvider(provider: EmailProvider): Transporter {
    if (provider === 'aws-ses') {
        const host = process.env.SES_SMTP_HOST;
        const port = parseInt(process.env.SES_SMTP_PORT || '587', 10);
        const user = process.env.SES_SMTP_USER;
        const pass = process.env.SES_SMTP_PASS;

        if (!host || !user || !pass) {
            throw new ExternalServiceError(
                'AWS SES',
                'SES SMTP credentials are not fully configured'
            );
        }

        return nodemailer.createTransport({
            host,
            port,
            secure: port === 465,
            auth: { user, pass },
        });
    }

    const host = process.env.SMTP_HOST;
    const port = parseInt(process.env.SMTP_PORT || '587', 10);
    const user = process.env.SMTP_USER;
    const pass = process.env.SMTP_PASS;

    if (!host || !user || !pass) {
        throw new ExternalServiceError(
            'Nodemailer',
            'SMTP credentials are not fully configured'
        );
    }

    return nodemailer.createTransport({
        host,
        port,
        secure: port === 465,
        auth: { user, pass },
    });
}

export async function configureEmailProvider(): Promise<void> {
    const provider = resolveProviderFromEnv();
    const fromEmail = process.env.EMAIL_FROM || 'no-reply@meeting-assistant.local';
    const fromName = process.env.EMAIL_FROM_NAME || 'Meeting Assistant';

    providerConfig = {
        provider,
        fromEmail,
        fromName,
    };

    if (provider === 'sendgrid') {
        const sendgridApiKey = process.env.SENDGRID_API_KEY;
        if (!sendgridApiKey) {
            throw new ExternalServiceError('SendGrid', 'SENDGRID_API_KEY is not configured');
        }

        sgMail.setApiKey(sendgridApiKey);
        transporter = null;
        return;
    }

    transporter = createNodemailerTransportForProvider(provider);
    await transporter.verify();
}

export async function initializeEmailQueue(): Promise<void> {
    if (!providerConfig) {
        await configureEmailProvider();
    }

    if (!emailQueue) {
        emailQueue = new Queue<EmailJobPayload>(EMAIL_QUEUE_NAME, {
            connection: redisClient,
            defaultJobOptions: DEFAULT_JOB_OPTIONS,
        });
    }

    if (!emailQueueEvents) {
        emailQueueEvents = new QueueEvents(EMAIL_QUEUE_NAME, {
            connection: redisClient,
        });
    }

    if (!emailWorker) {
        emailWorker = new Worker<EmailJobPayload>(
            EMAIL_QUEUE_NAME,
            async (job) => {
                await processEmailJob(job.id || String(job.name), job.data, job.attemptsMade + 1);
            },
            {
                connection: redisClient,
                concurrency: 5,
            }
        );

        emailWorker.on('failed', async (job, error) => {
            if (!job?.id) {
                return;
            }
            const current = await getEmailDeliveryStatus(job.id);
            if (!current) {
                return;
            }

            const exhaustedAttempts = (job.attemptsMade || 0) >= ((job.opts.attempts || 1) - 1);
            if (exhaustedAttempts) {
                const failed: EmailStatusRecord = {
                    ...current,
                    status: 'failed',
                    attempts: (job.attemptsMade || 0) + 1,
                    error: error?.message || 'Email failed after retries',
                    updatedAt: new Date().toISOString(),
                };
                await persistStatus(failed);
            }
        });
    }
}

export async function shutdownEmailQueue(): Promise<void> {
    await emailWorker?.close();
    await emailQueueEvents?.close();
    await emailQueue?.close();

    emailWorker = null;
    emailQueueEvents = null;
    emailQueue = null;
}

export async function queueTemplatedEmail(payload: EmailJobPayload): Promise<string> {
    if (!emailQueue) {
        await initializeEmailQueue();
    }

    if (!emailQueue) {
        throw new ExternalServiceError('Email Queue', 'Email queue is not initialized');
    }

    const job = await emailQueue.add('send-email', payload);
    const jobId = String(job.id);
    await persistStatus(buildInitialStatus(jobId, payload));
    return jobId;
}

export async function getEmailDeliveryStatus(jobId: string): Promise<EmailStatusRecord | null> {
    if (!jobId.trim()) {
        throw new BadRequestError('jobId is required');
    }

    return getJSON<EmailStatusRecord>(`${STATUS_KEY_PREFIX}${jobId}`);
}

export async function sendTaskAssignmentEmail(data: {
    to: string;
    assigneeName: string;
    taskTitle: string;
    dueDate?: string | null;
    meetingTitle?: string;
    taskLink?: string;
}): Promise<string> {
    return queueTemplatedEmail({
        to: data.to,
        subject: `Task Assigned: ${data.taskTitle}`,
        template: 'task-assignment',
        data: {
            assigneeName: data.assigneeName,
            taskTitle: data.taskTitle,
            dueDate: data.dueDate || 'Not specified',
            meetingTitle: data.meetingTitle || 'N/A',
            taskLink: data.taskLink || '#',
        },
    });
}

export async function sendTaskReminderEmail(data: {
    to: string;
    assigneeName: string;
    taskTitle: string;
    dueDate: string;
    reminderType: '24h' | '1h';
    taskLink?: string;
}): Promise<string> {
    const template: EmailTemplateType =
        data.reminderType === '24h' ? 'task-reminder-24h' : 'task-reminder-1h';

    return queueTemplatedEmail({
        to: data.to,
        subject: `Task Reminder (${data.reminderType}): ${data.taskTitle}`,
        template,
        data: {
            assigneeName: data.assigneeName,
            taskTitle: data.taskTitle,
            dueDate: data.dueDate,
            taskLink: data.taskLink || '#',
        },
    });
}

export async function sendTaskOverdueEmail(data: {
    to: string;
    assigneeName: string;
    taskTitle: string;
    dueDate: string;
    taskLink?: string;
}): Promise<string> {
    return queueTemplatedEmail({
        to: data.to,
        subject: `Task Overdue: ${data.taskTitle}`,
        template: 'task-overdue',
        data: {
            assigneeName: data.assigneeName,
            taskTitle: data.taskTitle,
            dueDate: data.dueDate,
            taskLink: data.taskLink || '#',
        },
    });
}

export async function sendTaskCompletionEmail(data: {
    to: string;
    recipientName: string;
    taskTitle: string;
    completedAt?: string;
}): Promise<string> {
    return queueTemplatedEmail({
        to: data.to,
        subject: `Task Completed: ${data.taskTitle}`,
        template: 'task-completion',
        data: {
            recipientName: data.recipientName,
            taskTitle: data.taskTitle,
            completedAt: data.completedAt || new Date().toISOString(),
        },
    });
}

export async function sendWelcomeEmail(data: {
    to: string;
    name: string;
    loginUrl?: string;
}): Promise<string> {
    return queueTemplatedEmail({
        to: data.to,
        subject: 'Welcome to Meeting Assistant',
        template: 'welcome',
        data: {
            name: data.name,
            loginUrl: data.loginUrl || '#',
        },
    });
}

export async function sendPasswordResetEmail(data: {
    to: string;
    name: string;
    resetUrl: string;
    expiresInMinutes?: number;
}): Promise<string> {
    return queueTemplatedEmail({
        to: data.to,
        subject: 'Reset Your Password',
        template: 'password-reset',
        data: {
            name: data.name,
            resetUrl: data.resetUrl,
            expiresInMinutes: data.expiresInMinutes || 60,
        },
    });
}

export async function sendRenderedEmail(payload: RenderedEmailPayload): Promise<void> {
    if (!providerConfig) {
        await configureEmailProvider();
    }

    const config = ensureProviderConfigured();
    const from = payload.from || getFromAddress(config);

    if (config.provider === 'sendgrid') {
        await sgMail.send({
            to: payload.to,
            from,
            subject: payload.subject,
            html: payload.html,
        });
        return;
    }

    if (!transporter) {
        throw new ExternalServiceError('Email', 'Nodemailer transporter is not configured');
    }

    await transporter.sendMail({
        to: payload.to,
        from,
        subject: payload.subject,
        html: payload.html,
    });
}

