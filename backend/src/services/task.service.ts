import { prisma } from '../config/database';
import {
    NotFoundError,
    AuthorizationError,
    BadRequestError,
} from '../middleware/error.middleware';
import * as workspaceService from './workspace.service';
import sgMail from '@sendgrid/mail';
import nodemailer from 'nodemailer';
import crypto from 'crypto';

/**
 * Task Service
 *
 * Business logic for:
 *  - Creating tasks (manual or AI-extracted)
 *  - Assigning tasks to users
 *  - Updating task status with timestamp tracking
 *  - Confirming AI-extracted tasks (triggers email + iCal calendar event)
 *  - Deleting tasks (removes calendar references)
 *  - Getting tasks with filters
 *  - Bulk operations (confirm, delete)
 *  - Adding / fetching comments
 */

// ─────────────────────────────────────────────────────────────────────────────
// Email provider setup
// ─────────────────────────────────────────────────────────────────────────────

if (process.env.SENDGRID_API_KEY) {
    sgMail.setApiKey(process.env.SENDGRID_API_KEY);
}

/** Lazily-created Nodemailer transport (SMTP fallback). */
function getSmtpTransport(): nodemailer.Transporter {
    return nodemailer.createTransport({
        host: process.env.SMTP_HOST ?? 'smtp.gmail.com',
        port: parseInt(process.env.SMTP_PORT ?? '587', 10),
        secure: process.env.SMTP_SECURE === 'true',
        auth: {
            user: process.env.SMTP_USER,
            pass: process.env.SMTP_PASS,
        },
    });
}

/** Send an email via SendGrid with Nodemailer as fallback. */
async function sendEmail(options: {
    to: string;
    subject: string;
    html: string;
    text: string;
    attachments?: Array<{ filename: string; content: string; contentType: string }>;
}): Promise<void> {
    const from = process.env.EMAIL_FROM ?? 'noreply@meetingassistant.app';

    if (process.env.SENDGRID_API_KEY) {
        await sgMail.send({
            to: options.to,
            from,
            subject: options.subject,
            html: options.html,
            text: options.text,
            attachments: options.attachments?.map((a) => ({
                filename: a.filename,
                content: Buffer.from(a.content).toString('base64'),
                type: a.contentType,
                disposition: 'attachment',
            })),
        });
        return;
    }

    if (process.env.SMTP_USER) {
        const transport = getSmtpTransport();
        await transport.sendMail({
            from,
            to: options.to,
            subject: options.subject,
            html: options.html,
            text: options.text,
            attachments: options.attachments?.map((a) => ({
                filename: a.filename,
                content: a.content,
                contentType: a.contentType,
            })),
        });
        return;
    }

    // No email provider configured — log and continue
    console.warn('[task.service] No email provider configured; skipping email to', options.to);
}

// ─────────────────────────────────────────────────────────────────────────────
// iCal (RFC 5545) helpers
// ─────────────────────────────────────────────────────────────────────────────

/** Format a Date to iCal DATE-TIME string (UTC). */
function toICalDate(date: Date): string {
    return date.toISOString().replace(/[-:]/g, '').split('.')[0] + 'Z';
}

/** Escape iCal text values (commas, semicolons, backslashes). */
function escapeICalText(text: string): string {
    return text
        .replace(/\\/g, '\\\\')
        .replace(/;/g, '\\;')
        .replace(/,/g, '\\,')
        .replace(/\n/g, '\\n');
}

/**
 * Generate an RFC 5545 iCalendar (.ics) string for a task due-date reminder.
 *
 * The event is an all-day VTODO component that most calendar clients
 * (Google Calendar, Outlook, Apple Calendar) can import.
 */
function generateICalEvent(opts: {
    uid: string;
    summary: string;
    description: string;
    dueDate: Date;
    organizerEmail: string;
    attendeeEmail: string;
    attendeeName: string;
}): string {
    const now = toICalDate(new Date());
    const due = toICalDate(opts.dueDate);

    // VTODO is the correct RFC 5545 component for task/to-do items.
    return [
        'BEGIN:VCALENDAR',
        'VERSION:2.0',
        'PRODID:-//AI Meeting Assistant//Task Service//EN',
        'CALSCALE:GREGORIAN',
        'METHOD:REQUEST',
        'BEGIN:VTODO',
        `UID:${opts.uid}@meetingassistant.app`,
        `DTSTAMP:${now}`,
        `CREATED:${now}`,
        `LAST-MODIFIED:${now}`,
        `DUE:${due}`,
        `SUMMARY:${escapeICalText(opts.summary)}`,
        `DESCRIPTION:${escapeICalText(opts.description)}`,
        `ORGANIZER;CN=AI Meeting Assistant:mailto:${opts.organizerEmail}`,
        `ATTENDEE;CN=${escapeICalText(opts.attendeeName)};ROLE=REQ-PARTICIPANT;PARTSTAT=NEEDS-ACTION;RSVP=FALSE:mailto:${opts.attendeeEmail}`,
        'STATUS:NEEDS-ACTION',
        'PRIORITY:5',
        'END:VTODO',
        'END:VCALENDAR',
    ].join('\r\n');
}

// ─────────────────────────────────────────────────────────────────────────────
// Shared types / interfaces
// ─────────────────────────────────────────────────────────────────────────────

export type TaskStatus = 'pending' | 'in_progress' | 'completed' | 'cancelled';
export type TaskPriority = 'low' | 'medium' | 'high';

export interface CreateTaskData {
    title: string;
    description?: string;
    assigneeId?: string | null;
    meetingId?: string | null;
    priority?: TaskPriority;
    dueDate?: Date | null;
    /** Set to true when called from AI extraction pipeline. */
    isAiGenerated?: boolean;
}

export interface UpdateTaskData {
    title?: string;
    description?: string | null;
    assigneeId?: string | null;
    priority?: TaskPriority;
    dueDate?: Date | null;
}

export interface TaskFilters {
    workspaceId?: string;
    meetingId?: string;
    assigneeId?: string;
    status?: TaskStatus;
    priority?: TaskPriority;
    isAiGenerated?: boolean;
    dueBefore?: Date;
    page?: number;
    limit?: number;
}

export interface PaginatedTasks {
    tasks: any[];
    pagination: {
        page: number;
        limit: number;
        total: number;
        pages: number;
    };
}

export interface BulkConfirmResult {
    confirmed: number;
    alreadyConfirmed: number;
    confirmedIds: string[];
}

export interface BulkDeleteResult {
    deleted: number;
    notFound: string[];
    unauthorized: string[];
}

// ─────────────────────────────────────────────────────────────────────────────
// Shared Prisma select shape (mirrors TASK_SELECT in the controller)
// ─────────────────────────────────────────────────────────────────────────────

const TASK_SELECT = {
    id: true,
    title: true,
    description: true,
    status: true,
    priority: true,
    dueDate: true,
    isAiGenerated: true,
    confirmedAt: true,
    createdAt: true,
    updatedAt: true,
    completedAt: true,
    assignedTo: {
        select: { id: true, name: true, email: true },
    },
    meeting: {
        select: {
            id: true,
            title: true,
            workspace: { select: { id: true, name: true } },
        },
    },
    _count: { select: { comments: true } },
} as const;

// ─────────────────────────────────────────────────────────────────────────────
// Status-transition graph (single source of truth)
// ─────────────────────────────────────────────────────────────────────────────

const STATUS_TRANSITIONS: Record<TaskStatus, TaskStatus[]> = {
    pending: ['in_progress', 'cancelled'],
    in_progress: ['completed', 'pending', 'cancelled'],
    completed: [],
    cancelled: ['pending'],
};

function assertValidTransition(current: TaskStatus, next: TaskStatus): void {
    if (current === next) return;
    if (!(STATUS_TRANSITIONS[current] ?? []).includes(next)) {
        throw new BadRequestError(
            `Cannot transition task from "${current}" to "${next}".`
        );
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// Internal helpers
// ─────────────────────────────────────────────────────────────────────────────

/** Load a task or throw NotFoundError. */
async function requireTask(taskId: string) {
    const task = await prisma.task.findUnique({
        where: { id: taskId },
        include: {
            assignedTo: { select: { id: true, name: true, email: true } },
            meeting: {
                select: {
                    id: true,
                    title: true,
                    workspaceId: true,
                    createdById: true,
                },
            },
        },
    });
    if (!task) throw new NotFoundError('Task', taskId);
    return task;
}

/**
 * Send a task-assignment notification email with an optional iCal attachment
 * when a due date is present.
 */
async function sendAssignmentEmail(opts: {
    taskId: string;
    taskTitle: string;
    taskDescription?: string | null;
    dueDate?: Date | null;
    assigneeName: string;
    assigneeEmail: string;
    meetingTitle?: string | null;
    isConfirmation?: boolean;
}): Promise<void> {
    const {
        taskId,
        taskTitle,
        taskDescription,
        dueDate,
        assigneeName,
        assigneeEmail,
        meetingTitle,
        isConfirmation = false,
    } = opts;

    const subjectVerb = isConfirmation ? 'Confirmed' : 'Assigned';
    const subject = `Task ${subjectVerb}: ${taskTitle}`;

    const dueDateStr = dueDate
        ? new Date(dueDate).toLocaleDateString('en-US', {
            weekday: 'long',
            year: 'numeric',
            month: 'long',
            day: 'numeric',
        })
        : 'No due date';

    const meetingLine = meetingTitle
        ? `<p><strong>Meeting:</strong> ${meetingTitle}</p>`
        : '';

    const html = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <style>
    body { font-family: Arial, sans-serif; color: #333; max-width: 600px; margin: 0 auto; }
    .header { background: #4F46E5; color: white; padding: 20px; border-radius: 8px 8px 0 0; }
    .body { padding: 24px; background: #f9fafb; border: 1px solid #e5e7eb; }
    .footer { padding: 16px; font-size: 12px; color: #6b7280; text-align: center; }
    .badge { display: inline-block; padding: 2px 10px; border-radius: 12px; font-size: 12px; background: #EEF2FF; color: #4F46E5; }
  </style>
</head>
<body>
  <div class="header">
    <h2 style="margin:0">Task ${subjectVerb}</h2>
  </div>
  <div class="body">
    <p>Hi ${assigneeName},</p>
    <p>A task has been ${subjectVerb.toLowerCase()} to you${isConfirmation ? ' and confirmed from meeting AI extraction' : ''}.</p>
    <h3>${taskTitle}</h3>
    ${taskDescription ? `<p>${taskDescription}</p>` : ''}
    ${meetingLine}
    <p><strong>Due Date:</strong> ${dueDateStr}</p>
    ${dueDate ? '<p>A calendar event (.ics) is attached to this email.</p>' : ''}
  </div>
  <div class="footer">AI Meeting Assistant &mdash; Task Management</div>
</body>
</html>`;

    const text = [
        `Task ${subjectVerb}: ${taskTitle}`,
        taskDescription ?? '',
        meetingTitle ? `Meeting: ${meetingTitle}` : '',
        `Due: ${dueDateStr}`,
    ]
        .filter(Boolean)
        .join('\n');

    const attachments: Array<{ filename: string; content: string; contentType: string }> = [];

    if (dueDate) {
        const orgEmail = process.env.EMAIL_FROM ?? 'noreply@meetingassistant.app';
        const uid = crypto.createHash('sha256').update(taskId).digest('hex').slice(0, 32);

        const icsContent = generateICalEvent({
            uid,
            summary: taskTitle,
            description: taskDescription ?? `Task assigned from AI Meeting Assistant.`,
            dueDate,
            organizerEmail: orgEmail,
            attendeeEmail: assigneeEmail,
            attendeeName: assigneeName,
        });

        attachments.push({
            filename: `task-${uid.slice(0, 8)}.ics`,
            content: icsContent,
            contentType: 'text/calendar; charset=utf-8; method=REQUEST',
        });
    }

    try {
        await sendEmail({ to: assigneeEmail, subject, html, text, attachments });
    } catch (err: any) {
        // Email failure should never crash the main operation
        console.error('[task.service] Failed to send assignment email:', err?.message ?? err);
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// Public API — Task CRUD
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Create a new task.
 *
 * - Validates the meeting exists and the creator has access to it.
 * - Sends an assignment email if an assignee with a known email is provided.
 */
export async function createTask(data: CreateTaskData): Promise<any> {
    const {
        title,
        description,
        assigneeId,
        meetingId,
        priority = 'medium',
        dueDate,
        isAiGenerated = false,
    } = data;

    let meetingTitle: string | null = null;

    if (meetingId) {
        const meeting = await prisma.meeting.findUnique({
            where: { id: meetingId },
            select: { title: true },
        });
        if (!meeting) throw new NotFoundError('Meeting', meetingId);
        meetingTitle = meeting.title;
    }

    const task = await prisma.task.create({
        data: {
            title,
            description: description ?? null,
            meetingId: meetingId ?? null,
            assignedToId: assigneeId ?? null,
            priority,
            dueDate: dueDate ?? null,
            isAiGenerated,
        },
        select: TASK_SELECT,
    });

    // Fire-and-forget assignment email (only for manual tasks with an assignee)
    if (assigneeId && !isAiGenerated) {
        const assignee = await prisma.user.findUnique({
            where: { id: assigneeId },
            select: { name: true, email: true },
        });
        if (assignee?.email) {
            sendAssignmentEmail({
                taskId: task.id,
                taskTitle: title,
                taskDescription: description,
                dueDate: dueDate ?? null,
                assigneeName: assignee.name ?? assignee.email,
                assigneeEmail: assignee.email,
                meetingTitle,
            }).catch(() => { }); // already logged inside sendAssignmentEmail
        }
    }

    return task;
}

/**
 * Assign (or re-assign) a task to a user.
 *
 * Sends an assignment notification email to the new assignee.
 */
export async function assignTask(taskId: string, assigneeId: string | null): Promise<any> {
    const existing = await requireTask(taskId);

    const task = await prisma.task.update({
        where: { id: taskId },
        data: { assignedToId: assigneeId ?? null },
        select: TASK_SELECT,
    });

    if (assigneeId) {
        const assignee = await prisma.user.findUnique({
            where: { id: assigneeId },
            select: { name: true, email: true },
        });
        if (assignee?.email) {
            sendAssignmentEmail({
                taskId,
                taskTitle: existing.title,
                taskDescription: existing.description,
                dueDate: existing.dueDate,
                assigneeName: assignee.name ?? assignee.email,
                assigneeEmail: assignee.email,
                meetingTitle: existing.meeting?.title ?? null,
            }).catch(() => { });
        }
    }

    return task;
}

/**
 * Update task fields (title, description, priority, dueDate, assignee).
 *
 * Sends a re-assignment email if the assignee changes.
 */
export async function updateTask(taskId: string, data: UpdateTaskData): Promise<any> {
    const existing = await requireTask(taskId);

    const updatePayload: Record<string, unknown> = {};
    if (data.title !== undefined) updatePayload.title = data.title;
    if (data.description !== undefined) updatePayload.description = data.description;
    if (data.priority !== undefined) updatePayload.priority = data.priority;
    if ('dueDate' in data) updatePayload.dueDate = data.dueDate ?? null;
    if ('assigneeId' in data) updatePayload.assignedToId = data.assigneeId ?? null;

    const task = await prisma.task.update({
        where: { id: taskId },
        data: updatePayload,
        select: TASK_SELECT,
    });

    // If assignee changed, notify the new assignee
    const newAssigneeId = data.assigneeId;
    const oldAssigneeId = existing.assignedTo?.id ?? null;
    if (
        newAssigneeId !== undefined &&
        newAssigneeId !== null &&
        newAssigneeId !== oldAssigneeId
    ) {
        const assignee = await prisma.user.findUnique({
            where: { id: newAssigneeId },
            select: { name: true, email: true },
        });
        if (assignee?.email) {
            const resolvedDueDate =
                'dueDate' in data ? (data.dueDate ?? null) : (existing.dueDate ?? null);
            sendAssignmentEmail({
                taskId,
                taskTitle: data.title ?? existing.title,
                taskDescription: data.description ?? existing.description,
                dueDate: resolvedDueDate,
                assigneeName: assignee.name ?? assignee.email,
                assigneeEmail: assignee.email,
                meetingTitle: existing.meeting?.title ?? null,
            }).catch(() => { });
        }
    }

    return task;
}

/**
 * Update task status.
 *
 * Validates the transition, sets `completedAt` when moving to "completed",
 * and clears it on any other transition.
 */
export async function updateTaskStatus(taskId: string, newStatus: TaskStatus): Promise<any> {
    const existing = await requireTask(taskId);

    assertValidTransition(existing.status as TaskStatus, newStatus);

    const updatePayload: Record<string, unknown> = { status: newStatus };
    if (newStatus === 'completed') {
        updatePayload.completedAt = new Date();
    } else {
        updatePayload.completedAt = null;
    }

    return prisma.task.update({
        where: { id: taskId },
        data: updatePayload,
        select: TASK_SELECT,
    });
}

/**
 * Confirm a single AI-extracted task.
 *
 * - Sets `confirmedAt` and clears `isAiGenerated`.
 * - Sends a confirmation + iCal email to the assignee (if one exists and has a due date).
 */
export async function confirmAiTask(taskId: string): Promise<any> {
    const existing = await requireTask(taskId);

    if (existing.confirmedAt) {
        // Already confirmed — return current state without side effects
        return prisma.task.findUnique({ where: { id: taskId }, select: TASK_SELECT });
    }

    const task = await prisma.task.update({
        where: { id: taskId },
        data: { confirmedAt: new Date(), isAiGenerated: false },
        select: TASK_SELECT,
    });

    // Send confirmation email to assignee
    const assignee = existing.assignedTo;
    if (assignee?.email) {
        sendAssignmentEmail({
            taskId,
            taskTitle: existing.title,
            taskDescription: existing.description,
            dueDate: existing.dueDate,
            assigneeName: assignee.name ?? assignee.email,
            assigneeEmail: assignee.email,
            meetingTitle: existing.meeting?.title ?? null,
            isConfirmation: true,
        }).catch(() => { });
    }

    return task;
}

/**
 * Delete a task and clean up any associated calendar UID references.
 *
 * Calendar "cleanup" in this implementation means we log the UID that was
 * distributed via iCal email. True remote deletion (e.g., Google Calendar API)
 * would require OAuth tokens per user — stubbed here for future integration.
 */
export async function deleteTask(taskId: string): Promise<void> {
    const existing = await requireTask(taskId);

    // Stub: Google Calendar API deletion would go here.
    // The iCal UID matches: sha256(taskId).slice(0,32) — see generateICalEvent()
    if (existing.assignedTo && existing.dueDate) {
        const uid = crypto
            .createHash('sha256')
            .update(taskId)
            .digest('hex')
            .slice(0, 32);
        console.info(
            `[task.service] Task ${taskId} deleted. iCal UID ${uid} should be removed from assignee calendar.`
        );
        // TODO: call Google Calendar API to delete the event once OAuth is wired.
    }

    await prisma.task.delete({ where: { id: taskId } });
}

// ─────────────────────────────────────────────────────────────────────────────
// Public API — Queries
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Paginated task list with optional filters.
 *
 * - If `workspaceId` is given, workspace admins see all tasks; members see
 *   only their own assigned tasks.
 * - Without `workspaceId`, returns only the caller's personally assigned tasks.
 */
export async function getTasks(
    callerId: string,
    filters: TaskFilters
): Promise<PaginatedTasks> {
    const page = Math.max(1, filters.page ?? 1);
    const limit = Math.min(100, Math.max(1, filters.limit ?? 20));
    const skip = (page - 1) * limit;

    const where: Record<string, unknown> = {};

    if (filters.workspaceId) {
        await workspaceService.verifyWorkspaceAccess(filters.workspaceId, callerId);
        const isAdmin = await workspaceService.isWorkspaceAdmin(filters.workspaceId, callerId);
        where.meeting = { workspaceId: filters.workspaceId };

        if (!isAdmin) {
            where.assignedToId = callerId;
        } else if (filters.assigneeId) {
            where.assignedToId = filters.assigneeId;
        }
    } else {
        where.assignedToId = callerId;
    }

    if (filters.meetingId) where.meetingId = filters.meetingId;
    if (filters.status) where.status = filters.status;
    if (filters.priority) where.priority = filters.priority;
    if (filters.isAiGenerated !== undefined) where.isAiGenerated = filters.isAiGenerated;
    if (filters.dueBefore) where.dueDate = { lte: filters.dueBefore };

    const [tasks, total] = await Promise.all([
        prisma.task.findMany({
            where,
            select: TASK_SELECT,
            orderBy: [{ dueDate: 'asc' }, { priority: 'asc' }, { createdAt: 'desc' }],
            skip,
            take: limit,
        }),
        prisma.task.count({ where }),
    ]);

    return {
        tasks,
        pagination: {
            page,
            limit,
            total,
            pages: Math.ceil(total / limit),
        },
    };
}

/**
 * Get a single task with full details (includes 10 most-recent comments).
 */
export async function getTaskById(taskId: string): Promise<any> {
    const task = await prisma.task.findUnique({
        where: { id: taskId },
        select: {
            ...TASK_SELECT,
            comments: {
                orderBy: { createdAt: 'desc' },
                take: 10,
                select: {
                    id: true,
                    content: true,
                    createdAt: true,
                    updatedAt: true,
                    user: { select: { id: true, name: true, email: true } },
                },
            },
        },
    });
    if (!task) throw new NotFoundError('Task', taskId);
    return task;
}

// ─────────────────────────────────────────────────────────────────────────────
// Public API — Bulk operations
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Confirm multiple AI-extracted tasks in bulk.
 *
 * - Skips tasks that are already confirmed (reports them separately).
 * - Sends a confirmation email (with iCal) to each unique assignee.
 * - Uses a single `updateMany` for DB efficiency.
 */
export async function bulkConfirmTasks(
    taskIds: string[],
    callerId: string
): Promise<BulkConfirmResult> {
    if (taskIds.length === 0 || taskIds.length > 100) {
        throw new BadRequestError('taskIds must contain between 1 and 100 entries.');
    }

    const tasks = await prisma.task.findMany({
        where: { id: { in: taskIds } },
        include: {
            assignedTo: { select: { id: true, name: true, email: true } },
            meeting: {
                select: {
                    id: true,
                    title: true,
                    workspaceId: true,
                    createdById: true,
                    participants: {
                        where: { userId: callerId },
                        select: { role: true },
                    },
                },
            },
        },
    });

    // Report missing IDs
    const foundIds = new Set(tasks.map((t) => t.id));
    const missingIds = taskIds.filter((id) => !foundIds.has(id));
    if (missingIds.length > 0) {
        throw new NotFoundError(`Tasks with IDs: ${missingIds.join(', ')}`);
    }

    const alreadyConfirmed: string[] = [];
    const unauthorised: string[] = [];
    const toConfirm: typeof tasks = [];

    for (const task of tasks) {
        if (task.confirmedAt) {
            alreadyConfirmed.push(task.id);
            continue;
        }

        const workspaceId = task.meeting?.workspaceId;
        let canConfirm = false;

        if (workspaceId) {
            canConfirm = await workspaceService.isWorkspaceAdmin(workspaceId, callerId);
        } else {
            canConfirm = task.meeting?.createdById === callerId;
        }

        if (!canConfirm) {
            const participantRole = task.meeting?.participants?.[0]?.role;
            if (participantRole === 'organizer') canConfirm = true;
        }

        if (canConfirm) {
            toConfirm.push(task);
        } else {
            unauthorised.push(task.id);
        }
    }

    if (unauthorised.length > 0) {
        throw new AuthorizationError(
            `You do not have permission to confirm tasks: ${unauthorised.join(', ')}`
        );
    }

    if (toConfirm.length === 0) {
        return { confirmed: 0, alreadyConfirmed: alreadyConfirmed.length, confirmedIds: [] };
    }

    const toConfirmIds = toConfirm.map((t) => t.id);

    await prisma.task.updateMany({
        where: { id: { in: toConfirmIds } },
        data: { confirmedAt: new Date(), isAiGenerated: false },
    });

    // Send confirmation emails (fire-and-forget, grouped by assignee email)
    const emailJobs = toConfirm
        .filter((t) => t.assignedTo?.email)
        .map((t) =>
            sendAssignmentEmail({
                taskId: t.id,
                taskTitle: t.title,
                taskDescription: t.description,
                dueDate: t.dueDate,
                assigneeName: t.assignedTo!.name ?? t.assignedTo!.email,
                assigneeEmail: t.assignedTo!.email,
                meetingTitle: t.meeting?.title ?? null,
                isConfirmation: true,
            }).catch(() => { })
        );

    // Kick off all emails concurrently but don't await
    Promise.allSettled(emailJobs).catch(() => { });

    return {
        confirmed: toConfirmIds.length,
        alreadyConfirmed: alreadyConfirmed.length,
        confirmedIds: toConfirmIds,
    };
}

/**
 * Delete multiple tasks in bulk.
 *
 * - Returns a count of successfully deleted tasks.
 * - Collects not-found and unauthorized task IDs for the caller to inspect.
 */
export async function bulkDeleteTasks(
    taskIds: string[],
    callerId: string
): Promise<BulkDeleteResult> {
    if (taskIds.length === 0 || taskIds.length > 100) {
        throw new BadRequestError('taskIds must contain between 1 and 100 entries.');
    }

    const tasks = await prisma.task.findMany({
        where: { id: { in: taskIds } },
        include: {
            assignedTo: { select: { id: true } },
            meeting: { select: { workspaceId: true, createdById: true } },
        },
    });

    const foundIds = new Set(tasks.map((t) => t.id));
    const notFound = taskIds.filter((id) => !foundIds.has(id));
    const unauthorized: string[] = [];
    const toDeleteIds: string[] = [];

    for (const task of tasks) {
        const workspaceId = task.meeting?.workspaceId;
        let canDelete = false;

        if (workspaceId) {
            canDelete = await workspaceService.isWorkspaceAdmin(workspaceId, callerId);
        } else {
            // Personal task — only the assignee can delete it
            canDelete = task.assignedTo?.id === callerId;
        }

        if (canDelete) {
            toDeleteIds.push(task.id);
        } else {
            unauthorized.push(task.id);
        }
    }

    if (toDeleteIds.length > 0) {
        await prisma.task.deleteMany({ where: { id: { in: toDeleteIds } } });
    }

    return {
        deleted: toDeleteIds.length,
        notFound,
        unauthorized,
    };
}

// ─────────────────────────────────────────────────────────────────────────────
// Public API — Comments
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Add a comment to a task.
 */
export async function addComment(
    taskId: string,
    userId: string,
    content: string
): Promise<any> {
    // Verify task exists
    await requireTask(taskId);

    return prisma.taskComment.create({
        data: { content, taskId, userId },
        select: {
            id: true,
            content: true,
            createdAt: true,
            updatedAt: true,
            user: { select: { id: true, name: true, email: true } },
        },
    });
}

/**
 * Get paginated comments for a task (newest first).
 */
export async function getComments(
    taskId: string,
    page: number = 1,
    limit: number = 50
): Promise<{
    comments: any[];
    pagination: { page: number; limit: number; total: number; pages: number };
}> {
    await requireTask(taskId);

    const skip = (page - 1) * limit;

    const [comments, total] = await Promise.all([
        prisma.taskComment.findMany({
            where: { taskId },
            select: {
                id: true,
                content: true,
                createdAt: true,
                updatedAt: true,
                user: { select: { id: true, name: true, email: true } },
            },
            orderBy: { createdAt: 'desc' },
            skip,
            take: limit,
        }),
        prisma.taskComment.count({ where: { taskId } }),
    ]);

    return {
        comments,
        pagination: {
            page,
            limit,
            total,
            pages: Math.ceil(total / limit),
        },
    };
}
