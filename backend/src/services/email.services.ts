import path from 'path';
import fs from 'fs';
import crypto from 'crypto';
import sgMail from '@sendgrid/mail';
import nodemailer, { Transporter } from 'nodemailer';
import { Queue, Worker, QueueEvents, Job } from 'bullmq';
import { prisma } from '../config/database';
import { RedisClient } from '../config/redis';

/**
 * Email Service
 *
 * Provides:
 *  - Multi-provider sending: SendGrid, AWS SES (via SMTP), or Nodemailer SMTP
 *  - HTML template loading with {{mustache}}-style variable injection
 *  - BullMQ-backed email queue with configurable concurrency
 *  - Per-job retry with exponential back-off
 *  - Delivery status tracking in Redis (lightweight) + optional DB persistence
 *
 * Template directory: src/templates/
 * Templates use {{varName}} placeholders. Block helpers:
 *   {{#key}}...{{/key}}   — render block only when `key` is truthy
 *   {{^key}}...{{/key}}   — render block only when `key` is falsy
 */

// ─────────────────────────────────────────────────────────────────────────────
// Constants & configuration
// ─────────────────────────────────────────────────────────────────────────────

const TEMPLATES_DIR = path.resolve(__dirname, '../templates');
const QUEUE_NAME = 'email';

/** How long to keep delivery status records in Redis (seconds). */
const STATUS_TTL_SEC = 60 * 60 * 24 * 7; // 7 days

const MAX_ATTEMPTS = parseInt(process.env.QUEUE_MAX_ATTEMPTS ?? '3', 10);
const RETRY_DELAY_MS = parseInt(process.env.QUEUE_RETRY_DELAY ?? '5000', 10);
const CONCURRENCY = parseInt(process.env.QUEUE_CONCURRENCY ?? '5', 10);

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

export type EmailProvider = 'sendgrid' | 'ses' | 'smtp';

export type EmailTemplate =
    | 'task-assigned'
    | 'task-reminder'
    | 'task-overdue'
    | 'task-completed'
    | 'welcome'
    | 'password-reset';

export type DeliveryStatus = 'queued' | 'processing' | 'sent' | 'failed';

export interface EmailAttachment {
    filename: string;
    content: string;          // raw string (ics, txt) or base64-encoded
    contentType: string;
    encoding?: 'base64' | 'utf8';
}

export interface SendEmailOptions {
    to: string | string[];
    subject: string;
    template: EmailTemplate;
    templateData: Record<string, unknown>;
    attachments?: EmailAttachment[];
    /** Optional idempotency key — prevents duplicate sends within STATUS_TTL_SEC. */
    idempotencyKey?: string;
    /** Override the default FROM address. */
    from?: string;
    replyTo?: string;
}

export interface EmailJobPayload extends SendEmailOptions {
    jobId: string;
    queuedAt: string;
}

export interface DeliveryRecord {
    jobId: string;
    to: string | string[];
    subject: string;
    template: EmailTemplate;
    status: DeliveryStatus;
    provider: EmailProvider;
    queuedAt: string;
    sentAt?: string;
    failedAt?: string;
    errorMessage?: string;
    attempts: number;
}

// ─────────────────────────────────────────────────────────────────────────────
// Template engine  (minimal mustache-like renderer — no dependencies)
// ─────────────────────────────────────────────────────────────────────────────

/** In-process template cache. */
const templateCache = new Map<EmailTemplate, string>();

/** Load a template from disk (with caching). */
function loadTemplate(name: EmailTemplate): string {
    if (templateCache.has(name)) return templateCache.get(name)!;

    const filePath = path.join(TEMPLATES_DIR, `${name}.html`);
    if (!fs.existsSync(filePath)) {
        throw new Error(`Email template not found: ${name} (${filePath})`);
    }
    const content = fs.readFileSync(filePath, 'utf8');
    templateCache.set(name, content);
    return content;
}

/** Clear the template cache (useful in tests or after a hot-reload). */
export function clearTemplateCache(): void {
    templateCache.clear();
}

/**
 * Render a template string with variable substitution and block helpers.
 *
 *   {{key}}              — HTML-escaped value
 *   {{#key}}...{{/key}}  — included only when data[key] is truthy
 *   {{^key}}...{{/key}}  — included only when data[key] is falsy
 */
function renderTemplate(
    template: string,
    data: Record<string, unknown>
): string {
    // Inject implicit global (current year)
    const ctx: Record<string, unknown> = {
        year: new Date().getFullYear(),
        ...data,
    };

    let out = template;

    // Section helpers: {{#key}}...{{/key}}
    out = out.replace(
        /\{\{#(\w+)\}\}([\s\S]*?)\{\{\/\1\}\}/g,
        (_m, key: string, inner: string) =>
            ctx[key] ? renderTokens(inner, ctx) : ''
    );

    // Inverted sections: {{^key}}...{{/key}}
    out = out.replace(
        /\{\{\^(\w+)\}\}([\s\S]*?)\{\{\/\1\}\}/g,
        (_m, key: string, inner: string) =>
            !ctx[key] ? renderTokens(inner, ctx) : ''
    );

    return renderTokens(out, ctx);
}

/** Replace `{{key}}` tokens with HTML-escaped scalar values. */
function renderTokens(template: string, ctx: Record<string, unknown>): string {
    return template.replace(/\{\{(\w+)\}\}/g, (_m, key: string) => {
        const val = ctx[key];
        return val == null ? '' : escapeHtml(String(val));
    });
}

function escapeHtml(str: string): string {
    return str
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

/** Strip HTML tags to produce a plain-text fallback. */
function htmlToText(html: string): string {
    return html
        .replace(/<style[\s\S]*?<\/style>/gi, '')
        .replace(/<[^>]+>/g, ' ')
        .replace(/\s{2,}/g, ' ')
        .trim();
}

// ─────────────────────────────────────────────────────────────────────────────
// Provider setup
// ─────────────────────────────────────────────────────────────────────────────

/** Detect the active email provider from environment. */
function detectProvider(): EmailProvider {
    const explicit = (process.env.EMAIL_PROVIDER ?? '').toLowerCase();
    if (explicit === 'ses') return 'ses';
    if (explicit === 'smtp') return 'smtp';
    if (explicit === 'sendgrid' || process.env.SENDGRID_API_KEY) return 'sendgrid';
    if (process.env.SMTP_USER) return 'smtp';
    return 'smtp';
}

let _smtpTransport: Transporter | null = null;

function getSmtpTransport(): Transporter {
    if (_smtpTransport) return _smtpTransport;

    const isSes = detectProvider() === 'ses';

    _smtpTransport = nodemailer.createTransport(
        isSes
            ? {
                // AWS SES SMTP relay
                host:
                    process.env.SMTP_HOST ??
                    `email-smtp.${process.env.AWS_REGION ?? 'us-east-1'}.amazonaws.com`,
                port: parseInt(process.env.SMTP_PORT ?? '465', 10),
                secure: true,
                auth: {
                    user: process.env.AWS_SES_SMTP_USER ?? process.env.SMTP_USER,
                    pass: process.env.AWS_SES_SMTP_PASS ?? process.env.SMTP_PASSWORD,
                },
            }
            : {
                host: process.env.SMTP_HOST ?? 'smtp.gmail.com',
                port: parseInt(process.env.SMTP_PORT ?? '587', 10),
                secure: process.env.SMTP_SECURE === 'true',
                auth: {
                    user: process.env.SMTP_USER,
                    pass: process.env.SMTP_PASSWORD,
                },
            }
    );
    return _smtpTransport;
}

// ─────────────────────────────────────────────────────────────────────────────
// Core provider-level send (no queue, no retry)
// ─────────────────────────────────────────────────────────────────────────────

interface RawSendOptions {
    to: string | string[];
    from: string;
    replyTo?: string;
    subject: string;
    html: string;
    text: string;
    attachments?: EmailAttachment[];
}

async function sendViaProvider(opts: RawSendOptions): Promise<void> {
    const provider = detectProvider();

    if (provider === 'sendgrid') {
        if (!process.env.SENDGRID_API_KEY) {
            throw new Error('EMAIL_PROVIDER is sendgrid but SENDGRID_API_KEY is not set');
        }
        sgMail.setApiKey(process.env.SENDGRID_API_KEY);

        await sgMail.send({
            to: opts.to,
            from: opts.from,
            replyTo: opts.replyTo,
            subject: opts.subject,
            html: opts.html,
            text: opts.text,
            attachments: opts.attachments?.map((a) => ({
                filename: a.filename,
                content:
                    a.encoding === 'base64'
                        ? a.content
                        : Buffer.from(a.content).toString('base64'),
                type: a.contentType,
                disposition: 'attachment',
            })),
        });
        return;
    }

    // SES or SMTP — both use Nodemailer
    const transport = getSmtpTransport();
    await transport.sendMail({
        to: Array.isArray(opts.to) ? opts.to.join(', ') : opts.to,
        from: opts.from,
        replyTo: opts.replyTo,
        subject: opts.subject,
        html: opts.html,
        text: opts.text,
        attachments: opts.attachments?.map((a) => ({
            filename: a.filename,
            content: a.content,
            contentType: a.contentType,
            encoding: a.encoding,
        })),
    });
}

// ─────────────────────────────────────────────────────────────────────────────
// Delivery status tracking  (Redis — lightweight, 7-day TTL)
// ─────────────────────────────────────────────────────────────────────────────

function deliveryKey(jobId: string): string {
    return `email:delivery:${jobId}`;
}

async function writeDeliveryStatus(record: DeliveryRecord): Promise<void> {
    try {
        const redis = RedisClient.getInstance();
        await redis.set(
            deliveryKey(record.jobId),
            JSON.stringify(record),
            'EX',
            STATUS_TTL_SEC
        );
    } catch (err) {
        // Status tracking must never interrupt the send path
        console.error('[email.service] Failed to write delivery status:', err);
    }
}

/**
 * Retrieve the delivery status for a job.
 * Returns `null` if the record has expired or was never written.
 */
export async function getDeliveryStatus(jobId: string): Promise<DeliveryRecord | null> {
    try {
        const redis = RedisClient.getInstance();
        const raw = await redis.get(deliveryKey(jobId));
        return raw ? (JSON.parse(raw) as DeliveryRecord) : null;
    } catch {
        return null;
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// BullMQ queue + worker
// ─────────────────────────────────────────────────────────────────────────────

let _emailQueue: Queue<EmailJobPayload> | null = null;
let _emailWorker: Worker<EmailJobPayload> | null = null;
let _queueEvents: QueueEvents | null = null;

function getEmailQueue(): Queue<EmailJobPayload> {
    if (_emailQueue) return _emailQueue;

    const connection = RedisClient.getInstance();

    _emailQueue = new Queue<EmailJobPayload>(QUEUE_NAME, {
        connection,
        defaultJobOptions: {
            attempts: MAX_ATTEMPTS,
            backoff: {
                type: 'exponential',
                delay: RETRY_DELAY_MS,
            },
            removeOnComplete: { count: 1000 },
            removeOnFail: { count: 500 },
        },
    });

    return _emailQueue;
}

/**
 * Start the BullMQ email worker.
 *
 * Call once at application startup. The worker dequeues `EmailJobPayload`
 * jobs, renders the template, and sends via the configured provider.
 *
 * Returns the Worker instance so callers can attach additional event listeners.
 */
export function startEmailWorker(): Worker<EmailJobPayload> {
    if (_emailWorker) return _emailWorker;

    const connection = RedisClient.getInstance();

    _emailWorker = new Worker<EmailJobPayload>(
        QUEUE_NAME,
        async (job: Job<EmailJobPayload>) => {
            const payload = job.data;
            const provider = detectProvider();

            await writeDeliveryStatus({
                jobId: payload.jobId,
                to: payload.to,
                subject: payload.subject,
                template: payload.template,
                status: 'processing',
                provider,
                queuedAt: payload.queuedAt,
                attempts: job.attemptsMade + 1,
            });

            const html = renderTemplate(loadTemplate(payload.template), payload.templateData);
            const text = htmlToText(html);

            await sendViaProvider({
                to: payload.to,
                from: payload.from ?? buildFromAddress(),
                replyTo: payload.replyTo,
                subject: payload.subject,
                html,
                text,
                attachments: payload.attachments,
            });

            await writeDeliveryStatus({
                jobId: payload.jobId,
                to: payload.to,
                subject: payload.subject,
                template: payload.template,
                status: 'sent',
                provider,
                queuedAt: payload.queuedAt,
                sentAt: new Date().toISOString(),
                attempts: job.attemptsMade + 1,
            });
        },
        { connection, concurrency: CONCURRENCY }
    );

    _emailWorker.on('failed', async (job, err) => {
        if (!job) return;
        const payload = job.data;
        const isFinalAttempt = job.attemptsMade >= MAX_ATTEMPTS;

        console.error(
            `[email.service] Job ${payload.jobId} failed` +
            ` (attempt ${job.attemptsMade}/${MAX_ATTEMPTS}): ${err.message}`
        );

        if (isFinalAttempt) {
            await writeDeliveryStatus({
                jobId: payload.jobId,
                to: payload.to,
                subject: payload.subject,
                template: payload.template,
                status: 'failed',
                provider: detectProvider(),
                queuedAt: payload.queuedAt,
                failedAt: new Date().toISOString(),
                errorMessage: err.message,
                attempts: job.attemptsMade,
            });
        }
    });

    _emailWorker.on('error', (err) => {
        console.error('[email.service] Worker error:', err);
    });

    console.info('[email.service] Email worker started');
    return _emailWorker;
}

/**
 * Access the QueueEvents instance for external monitoring or testing.
 */
export function getQueueEvents(): QueueEvents {
    if (_queueEvents) return _queueEvents;
    const connection = RedisClient.getInstance();
    _queueEvents = new QueueEvents(QUEUE_NAME, { connection });
    return _queueEvents;
}

/**
 * Gracefully shut down the worker and queue connections.
 * Call during application shutdown / SIGTERM handling.
 */
export async function shutdownEmailService(): Promise<void> {
    await _emailWorker?.close();
    await _emailQueue?.close();
    await _queueEvents?.close();
    console.info('[email.service] Email service shut down');
}

// ─────────────────────────────────────────────────────────────────────────────
// Public enqueue function
// ─────────────────────────────────────────────────────────────────────────────

function buildFromAddress(): string {
    const email = process.env.EMAIL_FROM ?? 'noreply@meetingassistant.app';
    const name = process.env.EMAIL_FROM_NAME ?? 'AI Meeting Assistant';
    return `"${name}" <${email}>`;
}

/**
 * Enqueue an email for async delivery via BullMQ.
 *
 * Returns a `jobId` for status polling via `getDeliveryStatus()`.
 *
 * If `idempotencyKey` is provided and an email was already queued with
 * the same key within the last 7 days, no new job is created and the
 * original jobId is returned.
 */
export async function queueEmail(opts: SendEmailOptions): Promise<string> {
    // Deduplication via Redis idempotency key
    if (opts.idempotencyKey) {
        const dedupKey = `email:idem:${opts.idempotencyKey}`;
        const redis = RedisClient.getInstance();
        const existing = await redis.get(dedupKey);
        if (existing) return existing;
    }

    const jobId = crypto.randomUUID();
    const payload: EmailJobPayload = {
        ...opts,
        jobId,
        queuedAt: new Date().toISOString(),
    };

    await writeDeliveryStatus({
        jobId,
        to: opts.to,
        subject: opts.subject,
        template: opts.template,
        status: 'queued',
        provider: detectProvider(),
        queuedAt: payload.queuedAt,
        attempts: 0,
    });

    await getEmailQueue().add(`send:${opts.template}`, payload, { jobId });

    if (opts.idempotencyKey) {
        const dedupKey = `email:idem:${opts.idempotencyKey}`;
        const redis = RedisClient.getInstance();
        await redis.set(dedupKey, jobId, 'EX', STATUS_TTL_SEC);
    }

    return jobId;
}

/**
 * Send an email immediately, bypassing the queue.
 *
 * Use only for time-critical messages (e.g., password reset).
 * Throws on send failure — callers must handle errors.
 */
export async function sendEmailNow(opts: SendEmailOptions): Promise<string> {
    const jobId = crypto.randomUUID();
    const provider = detectProvider();
    const now = new Date().toISOString();

    await writeDeliveryStatus({
        jobId,
        to: opts.to,
        subject: opts.subject,
        template: opts.template,
        status: 'processing',
        provider,
        queuedAt: now,
        attempts: 1,
    });

    const html = renderTemplate(loadTemplate(opts.template), opts.templateData);
    const text = htmlToText(html);

    await sendViaProvider({
        to: opts.to,
        from: opts.from ?? buildFromAddress(),
        replyTo: opts.replyTo,
        subject: opts.subject,
        html,
        text,
        attachments: opts.attachments,
    });

    await writeDeliveryStatus({
        jobId,
        to: opts.to,
        subject: opts.subject,
        template: opts.template,
        status: 'sent',
        provider,
        queuedAt: now,
        sentAt: new Date().toISOString(),
        attempts: 1,
    });

    return jobId;
}

// ─────────────────────────────────────────────────────────────────────────────
// Typed helpers — one function per email type
// ─────────────────────────────────────────────────────────────────────────────

// ── Task assigned ────────────────────────────────────────────────────────────

export interface TaskAssignedData {
    to: string;
    assigneeName: string;
    taskId: string;
    taskTitle: string;
    taskDescription?: string | null;
    priority: 'low' | 'medium' | 'high';
    dueDate?: Date | null;
    meetingTitle?: string | null;
    assignedBy?: string | null;
    taskUrl?: string | null;
    attachments?: EmailAttachment[];
}

export async function sendTaskAssignedEmail(data: TaskAssignedData): Promise<string> {
    return queueEmail({
        to: data.to,
        subject: `Task Assigned: ${data.taskTitle}`,
        template: 'task-assigned',
        templateData: {
            assigneeName: data.assigneeName,
            taskTitle: data.taskTitle,
            taskDescription: data.taskDescription ?? '',
            priority: data.priority,
            dueDateFormatted: formatDate(data.dueDate),
            dueDate: data.dueDate ? '1' : '',  // truthy flag for {{#dueDate}} block
            meetingTitle: data.meetingTitle ?? '',
            assignedBy: data.assignedBy ?? '',
            taskUrl: data.taskUrl ?? '',
        },
        attachments: data.attachments,
        idempotencyKey: `task-assigned:${data.taskId}:${data.to}`,
    });
}

// ── Task reminder ────────────────────────────────────────────────────────────

export interface TaskReminderData {
    to: string;
    assigneeName: string;
    taskId: string;
    taskTitle: string;
    taskDescription?: string | null;
    priority: 'low' | 'medium' | 'high';
    status: string;
    dueDate: Date;
    /** Human-readable string like "24 hours" or "1 hour". */
    timeUntilDue: string;
    meetingTitle?: string | null;
    taskUrl?: string | null;
    /** Used as part of idempotency key so each window sends at most once. */
    reminderWindow: '24h' | '1h';
}

export async function sendTaskReminderEmail(data: TaskReminderData): Promise<string> {
    return queueEmail({
        to: data.to,
        subject: `Reminder: "${data.taskTitle}" is due in ${data.timeUntilDue}`,
        template: 'task-reminder',
        templateData: {
            assigneeName: data.assigneeName,
            taskTitle: data.taskTitle,
            taskDescription: data.taskDescription ?? '',
            priority: data.priority,
            status: data.status,
            dueDateFormatted: formatDate(data.dueDate),
            timeUntilDue: data.timeUntilDue,
            meetingTitle: data.meetingTitle ?? '',
            taskUrl: data.taskUrl ?? '',
        },
        idempotencyKey: `task-reminder:${data.taskId}:${data.to}:${data.reminderWindow}`,
    });
}

// ── Task overdue ─────────────────────────────────────────────────────────────

export interface TaskOverdueData {
    to: string;
    assigneeName: string;
    taskId: string;
    taskTitle: string;
    taskDescription?: string | null;
    priority: 'low' | 'medium' | 'high';
    dueDate: Date;
    /** Human-readable e.g. "2 days". */
    overdueBy: string;
    meetingTitle?: string | null;
    taskUrl?: string | null;
}

export async function sendTaskOverdueEmail(data: TaskOverdueData): Promise<string> {
    return queueEmail({
        to: data.to,
        subject: `Overdue: "${data.taskTitle}" was due ${data.overdueBy} ago`,
        template: 'task-overdue',
        templateData: {
            assigneeName: data.assigneeName,
            taskTitle: data.taskTitle,
            taskDescription: data.taskDescription ?? '',
            priority: data.priority,
            dueDateFormatted: formatDate(data.dueDate),
            overdueBy: data.overdueBy,
            meetingTitle: data.meetingTitle ?? '',
            taskUrl: data.taskUrl ?? '',
        },
        // One overdue alert per calendar day per task per recipient
        idempotencyKey: `task-overdue:${data.taskId}:${data.to}:${todayKey()}`,
    });
}

// ── Task completed ───────────────────────────────────────────────────────────

export interface TaskCompletedData {
    to: string;
    notifyName: string;
    taskId: string;
    taskTitle: string;
    taskDescription?: string | null;
    assigneeName?: string | null;
    completedAt: Date;
    meetingTitle?: string | null;
    taskUrl?: string | null;
    completedByName?: string | null;
}

export async function sendTaskCompletedEmail(data: TaskCompletedData): Promise<string> {
    return queueEmail({
        to: data.to,
        subject: `Task Completed: ${data.taskTitle}`,
        template: 'task-completed',
        templateData: {
            notifyName: data.notifyName,
            taskTitle: data.taskTitle,
            taskDescription: data.taskDescription ?? '',
            assigneeName: data.assigneeName ?? '',
            completedByName: data.completedByName ?? '',
            completedAtFormatted: formatDateTime(data.completedAt),
            meetingTitle: data.meetingTitle ?? '',
            taskUrl: data.taskUrl ?? '',
        },
        idempotencyKey: `task-completed:${data.taskId}:${data.to}`,
    });
}

// ── Welcome email ────────────────────────────────────────────────────────────

export interface WelcomeEmailData {
    to: string;
    userName: string;
    loginUrl?: string;
}

export async function sendWelcomeEmail(data: WelcomeEmailData): Promise<string> {
    const loginUrl =
        data.loginUrl ??
        `${process.env.FRONTEND_URL ?? 'http://localhost:5173'}/login`;

    return queueEmail({
        to: data.to,
        subject: 'Welcome to AI Meeting Assistant',
        template: 'welcome',
        templateData: {
            userName: data.userName,
            userEmail: data.to,
            loginUrl,
        },
        idempotencyKey: `welcome:${data.to}`,
    });
}

// ── Password reset ───────────────────────────────────────────────────────────

export interface PasswordResetEmailData {
    to: string;
    userName: string;
    resetToken: string;
    /** Minutes until the token expires (default: PASSWORD_RESET_EXPIRATION env or 60). */
    expiresInMinutes?: number;
}

export async function sendPasswordResetEmail(data: PasswordResetEmailData): Promise<string> {
    const frontendUrl = process.env.FRONTEND_URL ?? 'http://localhost:5173';
    const expiresIn =
        data.expiresInMinutes ??
        parseInt(process.env.PASSWORD_RESET_EXPIRATION ?? '60', 10);
    const resetUrl = `${frontendUrl}/reset-password?token=${data.resetToken}`;

    // Password reset is time-critical — bypass the queue for immediate delivery
    return sendEmailNow({
        to: data.to,
        subject: 'Reset Your AI Meeting Assistant Password',
        template: 'password-reset',
        templateData: {
            userName: data.userName,
            userEmail: data.to,
            resetUrl,
            expiresIn:
                expiresIn >= 60
                    ? `${expiresIn / 60} hour${expiresIn / 60 !== 1 ? 's' : ''}`
                    : `${expiresIn} minutes`,
        },
    });
}

// ─────────────────────────────────────────────────────────────────────────────
// Scheduled reminder dispatcher
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Scan the database for tasks with approaching or past deadlines and
 * enqueue the appropriate reminder / overdue emails.
 *
 * Designed to be called by a cron job every 30 minutes.
 * Idempotency keys prevent duplicate sends within each reminder window.
 */
export async function dispatchDueReminders(): Promise<{
    queued24h: number;
    queued1h: number;
    overdueQueued: number;
}> {
    if (process.env.ENABLE_EMAIL_NOTIFICATIONS === 'false') {
        return { queued24h: 0, queued1h: 0, overdueQueued: 0 };
    }

    const now = new Date();
    const in24h = new Date(now.getTime() + 24 * 60 * 60 * 1000);
    const in1h = new Date(now.getTime() + 60 * 60 * 1000);

    const taskUrl = (id: string) =>
        `${process.env.FRONTEND_URL ?? 'http://localhost:5173'}/tasks/${id}`;

    // ── 24-hour window (but NOT inside the 1-hour window) ───────────────────
    const tasks24h = await prisma.task.findMany({
        where: {
            status: { in: ['pending', 'in_progress'] },
            dueDate: { gte: in1h, lte: in24h },
            assignedTo: { isNot: null },
        },
        include: {
            assignedTo: { select: { name: true, email: true } },
            meeting: { select: { title: true } },
        },
    });

    let queued24h = 0;
    for (const task of tasks24h) {
        if (!task.assignedTo?.email) continue;
        await sendTaskReminderEmail({
            to: task.assignedTo.email,
            assigneeName: task.assignedTo.name ?? task.assignedTo.email,
            taskId: task.id,
            taskTitle: task.title,
            taskDescription: task.description,
            priority: task.priority as 'low' | 'medium' | 'high',
            status: task.status,
            dueDate: task.dueDate!,
            timeUntilDue: '24 hours',
            meetingTitle: task.meeting?.title ?? null,
            taskUrl: taskUrl(task.id),
            reminderWindow: '24h',
        });
        queued24h++;
    }

    // ── 1-hour window ────────────────────────────────────────────────────────
    const tasks1h = await prisma.task.findMany({
        where: {
            status: { in: ['pending', 'in_progress'] },
            dueDate: { gte: now, lte: in1h },
            assignedTo: { isNot: null },
        },
        include: {
            assignedTo: { select: { name: true, email: true } },
            meeting: { select: { title: true } },
        },
    });

    let queued1h = 0;
    for (const task of tasks1h) {
        if (!task.assignedTo?.email) continue;
        await sendTaskReminderEmail({
            to: task.assignedTo.email,
            assigneeName: task.assignedTo.name ?? task.assignedTo.email,
            taskId: task.id,
            taskTitle: task.title,
            taskDescription: task.description,
            priority: task.priority as 'low' | 'medium' | 'high',
            status: task.status,
            dueDate: task.dueDate!,
            timeUntilDue: '1 hour',
            meetingTitle: task.meeting?.title ?? null,
            taskUrl: taskUrl(task.id),
            reminderWindow: '1h',
        });
        queued1h++;
    }

    // ── Overdue ──────────────────────────────────────────────────────────────
    const overdueTasks = await prisma.task.findMany({
        where: {
            status: { in: ['pending', 'in_progress'] },
            dueDate: { lt: now },
            assignedTo: { isNot: null },
        },
        include: {
            assignedTo: { select: { name: true, email: true } },
            meeting: { select: { title: true } },
        },
    });

    let overdueQueued = 0;
    for (const task of overdueTasks) {
        if (!task.assignedTo?.email) continue;
        const overdueMs = now.getTime() - task.dueDate!.getTime();
        await sendTaskOverdueEmail({
            to: task.assignedTo.email,
            assigneeName: task.assignedTo.name ?? task.assignedTo.email,
            taskId: task.id,
            taskTitle: task.title,
            taskDescription: task.description,
            priority: task.priority as 'low' | 'medium' | 'high',
            dueDate: task.dueDate!,
            overdueBy: formatDuration(overdueMs),
            meetingTitle: task.meeting?.title ?? null,
            taskUrl: taskUrl(task.id),
        });
        overdueQueued++;
    }

    return { queued24h, queued1h, overdueQueued };
}

// ─────────────────────────────────────────────────────────────────────────────
// Internal formatting helpers
// ─────────────────────────────────────────────────────────────────────────────

function formatDate(date?: Date | null): string {
    if (!date) return 'No due date';
    return new Date(date).toLocaleDateString('en-US', {
        weekday: 'long',
        year: 'numeric',
        month: 'long',
        day: 'numeric',
    });
}

function formatDateTime(date: Date): string {
    return new Date(date).toLocaleString('en-US', {
        weekday: 'short',
        year: 'numeric',
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
        timeZoneName: 'short',
    });
}

function formatDuration(ms: number): string {
    const totalMinutes = Math.floor(ms / 60_000);
    if (totalMinutes < 60) return `${totalMinutes} minute${totalMinutes !== 1 ? 's' : ''}`;
    const hours = Math.floor(totalMinutes / 60);
    if (hours < 24) return `${hours} hour${hours !== 1 ? 's' : ''}`;
    const days = Math.floor(hours / 24);
    return `${days} day${days !== 1 ? 's' : ''}`;
}

/** Returns an ISO date key like "2026-02-18" for daily idempotency bucketing. */
function todayKey(): string {
    return new Date().toISOString().slice(0, 10);
}
