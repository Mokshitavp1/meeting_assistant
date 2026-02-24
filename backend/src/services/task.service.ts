import { z } from 'zod';
import { prisma } from '../config/database';
import {
    AuthorizationError,
    BadRequestError,
    NotFoundError,
} from '../middleware/error.middleware';
import * as workspaceService from './workspace.service';

type TaskStatus = 'pending' | 'in_progress' | 'completed' | 'cancelled';

export interface TaskFilters {
    assigneeId?: string;
    status?: TaskStatus;
    deadline?: string;
    workspaceId?: string;
    meetingId?: string;
    page?: number;
    limit?: number;
}

export interface CreateTaskInput {
    title: string;
    description?: string;
    meetingId?: string;
    assignedToId?: string;
    priority?: 'low' | 'medium' | 'high';
    dueDate?: string;
    status?: TaskStatus;
    source?: 'manual' | 'ai';
}

export interface AIExtractedTaskInput {
    title: string;
    description?: string;
    meetingId?: string;
    assignedToId?: string;
    priority?: 'low' | 'medium' | 'high';
    dueDate?: string;
    confidence?: number;
}

export interface BulkDeleteResult {
    deletedIds: string[];
    failed: Array<{ id: string; reason: string }>;
}

export interface TaskComment {
    id: string;
    taskId: string;
    userId: string;
    userName: string;
    content: string;
    createdAt: string;
}

export interface EmailService {
    sendTaskAssigned(payload: {
        taskId: string;
        taskTitle: string;
        assigneeEmail: string;
        assigneeName?: string | null;
        dueDate?: string | null;
    }): Promise<void>;
    sendTaskConfirmed(payload: {
        taskId: string;
        taskTitle: string;
        assigneeEmail?: string | null;
        dueDate?: string | null;
    }): Promise<void>;
}

export interface CalendarService {
    createTaskEvent(payload: {
        taskId: string;
        title: string;
        description?: string | null;
        assigneeEmail?: string | null;
        dueDate?: string | null;
    }): Promise<{ eventId: string } | null>;
    deleteTaskEvent(eventId: string): Promise<void>;
}

interface TaskIntegrations {
    email: EmailService;
    calendar: CalendarService;
}

const createTaskSchema = z.object({
    title: z.string().trim().min(2).max(200),
    description: z.string().trim().max(4000).optional(),
    meetingId: z.string().optional(),
    assignedToId: z.string().optional(),
    priority: z.enum(['low', 'medium', 'high']).optional().default('medium'),
    dueDate: z.string().datetime().optional(),
    status: z
        .enum(['pending', 'in_progress', 'completed', 'cancelled'])
        .optional()
        .default('pending'),
    source: z.enum(['manual', 'ai']).optional().default('manual'),
});

const aiTaskSchema = z.object({
    title: z.string().trim().min(2).max(200),
    description: z.string().trim().max(4000).optional(),
    meetingId: z.string().optional(),
    assignedToId: z.string().optional(),
    priority: z.enum(['low', 'medium', 'high']).optional().default('medium'),
    dueDate: z.string().datetime().optional(),
    confidence: z.number().min(0).max(1).optional(),
});

const taskCommentsStore = new Map<string, TaskComment[]>();
const taskCalendarEventMap = new Map<string, string>();

let integrations: TaskIntegrations = {
    email: {
        async sendTaskAssigned(payload) {
            console.log('[EmailService] sendTaskAssigned', payload);
        },
        async sendTaskConfirmed(payload) {
            console.log('[EmailService] sendTaskConfirmed', payload);
        },
    },
    calendar: {
        async createTaskEvent(payload) {
            console.log('[CalendarService] createTaskEvent', payload);
            return null;
        },
        async deleteTaskEvent(eventId: string) {
            console.log('[CalendarService] deleteTaskEvent', { eventId });
        },
    },
};

export function configureTaskIntegrations(newIntegrations: Partial<TaskIntegrations>): void {
    integrations = {
        email: newIntegrations.email || integrations.email,
        calendar: newIntegrations.calendar || integrations.calendar,
    };
}

function normalizeDateToISO(value?: string | null): string | null {
    if (!value) {
        return null;
    }

    const date = new Date(value);
    if (Number.isNaN(date.getTime())) {
        return null;
    }

    return date.toISOString();
}

function statusTransitionAllowed(currentStatus: TaskStatus, nextStatus: TaskStatus): boolean {
    const transitions: Record<TaskStatus, TaskStatus[]> = {
        pending: ['in_progress', 'cancelled'],
        in_progress: ['completed', 'cancelled'],
        completed: [],
        cancelled: [],
    };

    return transitions[currentStatus].includes(nextStatus);
}

async function assertMeetingAccess(
    requesterId: string,
    requesterRole: string | undefined,
    meetingId?: string
): Promise<void> {
    if (!meetingId) {
        return;
    }

    const meeting = await prisma.meeting.findUnique({
        where: { id: meetingId },
        select: {
            id: true,
            workspaceId: true,
            createdById: true,
        },
    });

    if (!meeting) {
        throw new NotFoundError('Meeting');
    }

    if (requesterRole === 'admin') {
        return;
    }

    if (meeting.workspaceId) {
        await workspaceService.verifyWorkspaceAccess(meeting.workspaceId, requesterId);
        return;
    }

    if (meeting.createdById !== requesterId) {
        throw new AuthorizationError('You do not have access to this meeting');
    }
}

async function assertTaskAccess(taskId: string, requesterId: string, requesterRole?: string) {
    const task = await prisma.task.findUnique({
        where: { id: taskId },
        include: {
            meeting: {
                select: {
                    id: true,
                    workspaceId: true,
                },
            },
            assignedTo: {
                select: {
                    id: true,
                    email: true,
                    name: true,
                },
            },
        },
    });

    if (!task) {
        throw new NotFoundError('Task');
    }

    if (requesterRole === 'admin') {
        return task;
    }

    if (task.meeting?.workspaceId) {
        const workspaceRole = await workspaceService.getUserRole(task.meeting.workspaceId, requesterId);
        if (workspaceRole === 'admin') {
            return task;
        }
    }

    if (task.assignedToId !== requesterId) {
        throw new AuthorizationError('You can only access your assigned tasks');
    }

    return task;
}

async function handleTaskAssignmentNotifications(taskId: string): Promise<void> {
    const task = await prisma.task.findUnique({
        where: { id: taskId },
        include: {
            assignedTo: {
                select: {
                    email: true,
                    name: true,
                },
            },
        },
    });

    if (!task?.assignedTo?.email) {
        return;
    }

    await integrations.email.sendTaskAssigned({
        taskId: task.id,
        taskTitle: task.title,
        assigneeEmail: task.assignedTo.email,
        assigneeName: task.assignedTo.name,
        dueDate: task.dueDate ? task.dueDate.toISOString() : null,
    });
}

export async function createTask(
    input: CreateTaskInput,
    requesterId: string,
    requesterRole?: string
) {
    const parsed = createTaskSchema.parse(input);

    await assertMeetingAccess(requesterId, requesterRole, parsed.meetingId);

    if (parsed.assignedToId && requesterRole !== 'admin' && parsed.assignedToId !== requesterId) {
        throw new AuthorizationError('Members can only assign tasks to themselves');
    }

    const task = await prisma.task.create({
        data: {
            title: parsed.title,
            description: parsed.description,
            meetingId: parsed.meetingId,
            assignedToId: parsed.assignedToId,
            priority: parsed.priority,
            status: parsed.status,
            dueDate: parsed.dueDate ? new Date(parsed.dueDate) : null,
            completedAt: parsed.status === 'completed' ? new Date() : null,
        },
        include: {
            assignedTo: {
                select: {
                    id: true,
                    name: true,
                    email: true,
                },
            },
            meeting: {
                select: {
                    id: true,
                    title: true,
                    workspaceId: true,
                },
            },
        },
    });

    if (task.assignedToId) {
        await handleTaskAssignmentNotifications(task.id);
    }

    return task;
}

export async function createAIExtractedTasks(
    tasks: AIExtractedTaskInput[],
    requesterId: string,
    requesterRole?: string
) {
    if (!tasks.length) {
        throw new BadRequestError('At least one AI-extracted task is required');
    }

    const parsedTasks = tasks.map((task) => aiTaskSchema.parse(task));

    for (const task of parsedTasks) {
        await assertMeetingAccess(requesterId, requesterRole, task.meetingId);
    }

    return prisma.$transaction(
        parsedTasks.map((task) =>
            prisma.task.create({
                data: {
                    title: task.title,
                    description: task.description,
                    meetingId: task.meetingId,
                    assignedToId: task.assignedToId,
                    priority: task.priority,
                    status: 'pending',
                    dueDate: task.dueDate ? new Date(task.dueDate) : null,
                },
                include: {
                    assignedTo: {
                        select: {
                            id: true,
                            name: true,
                            email: true,
                        },
                    },
                    meeting: {
                        select: {
                            id: true,
                            title: true,
                            workspaceId: true,
                        },
                    },
                },
            })
        )
    );
}

export async function assignTask(
    taskId: string,
    assignedToId: string,
    requesterId: string,
    requesterRole?: string
) {
    const task = await assertTaskAccess(taskId, requesterId, requesterRole);

    if (requesterRole !== 'admin' && assignedToId !== requesterId) {
        throw new AuthorizationError('Members can only assign tasks to themselves');
    }

    const updatedTask = await prisma.task.update({
        where: { id: task.id },
        data: { assignedToId },
        include: {
            assignedTo: {
                select: {
                    id: true,
                    name: true,
                    email: true,
                },
            },
        },
    });

    await handleTaskAssignmentNotifications(updatedTask.id);

    return updatedTask;
}

export async function updateTaskStatus(
    taskId: string,
    status: TaskStatus,
    requesterId: string,
    requesterRole?: string
) {
    const task = await assertTaskAccess(taskId, requesterId, requesterRole);
    const currentStatus = task.status as TaskStatus;

    if (currentStatus === status) {
        throw new BadRequestError(`Task is already in ${status} status`);
    }

    if (!statusTransitionAllowed(currentStatus, status)) {
        throw new BadRequestError(
            `Invalid status transition from ${currentStatus} to ${status}`
        );
    }

    return prisma.task.update({
        where: { id: task.id },
        data: {
            status,
            completedAt: status === 'completed' ? new Date() : null,
        },
    });
}

export async function confirmAIExtractedTask(
    taskId: string,
    requesterId: string,
    requesterRole?: string
) {
    const task = await assertTaskAccess(taskId, requesterId, requesterRole);

    const updatedTask = await prisma.task.update({
        where: { id: task.id },
        data: {
            status: 'in_progress',
        },
        include: {
            assignedTo: {
                select: {
                    email: true,
                    name: true,
                },
            },
        },
    });

    await integrations.email.sendTaskConfirmed({
        taskId: updatedTask.id,
        taskTitle: updatedTask.title,
        assigneeEmail: updatedTask.assignedTo?.email,
        dueDate: updatedTask.dueDate ? updatedTask.dueDate.toISOString() : null,
    });

    const event = await integrations.calendar.createTaskEvent({
        taskId: updatedTask.id,
        title: updatedTask.title,
        description: updatedTask.description,
        assigneeEmail: updatedTask.assignedTo?.email,
        dueDate: updatedTask.dueDate ? updatedTask.dueDate.toISOString() : null,
    });

    if (event?.eventId) {
        taskCalendarEventMap.set(updatedTask.id, event.eventId);
    }

    return updatedTask;
}

export async function deleteTask(taskId: string, requesterId: string, requesterRole?: string) {
    const task = await assertTaskAccess(taskId, requesterId, requesterRole);

    const eventId = taskCalendarEventMap.get(task.id);
    if (eventId) {
        await integrations.calendar.deleteTaskEvent(eventId);
        taskCalendarEventMap.delete(task.id);
    }

    await prisma.task.delete({ where: { id: task.id } });
    taskCommentsStore.delete(task.id);

    return { deleted: true, id: task.id };
}

export async function getTasks(filters: TaskFilters, requesterId: string, requesterRole?: string) {
    const page = Math.max(filters.page || 1, 1);
    const limit = Math.min(Math.max(filters.limit || 20, 1), 100);
    const skip = (page - 1) * limit;

    const where: any = {};

    if (filters.status) {
        where.status = filters.status;
    }

    if (filters.assigneeId) {
        where.assignedToId = filters.assigneeId;
    }

    if (filters.deadline) {
        const start = new Date(filters.deadline);
        if (Number.isNaN(start.getTime())) {
            throw new BadRequestError('Invalid deadline filter date');
        }
        const end = new Date(start);
        end.setUTCDate(end.getUTCDate() + 1);
        where.dueDate = {
            gte: start,
            lt: end,
        };
    }

    if (filters.workspaceId) {
        await workspaceService.verifyWorkspaceAccess(filters.workspaceId, requesterId);
        where.meeting = {
            workspaceId: filters.workspaceId,
        };
    }

    if (filters.meetingId) {
        where.meetingId = filters.meetingId;
    }

    if (requesterRole !== 'admin') {
        where.assignedToId = requesterId;
    }

    const [tasks, total] = await Promise.all([
        prisma.task.findMany({
            where,
            include: {
                assignedTo: {
                    select: {
                        id: true,
                        name: true,
                        email: true,
                    },
                },
                meeting: {
                    select: {
                        id: true,
                        title: true,
                        workspaceId: true,
                    },
                },
            },
            orderBy: [{ dueDate: 'asc' }, { createdAt: 'desc' }],
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

export async function bulkConfirmAIExtractedTasks(
    taskIds: string[],
    requesterId: string,
    requesterRole?: string
) {
    if (!taskIds.length) {
        throw new BadRequestError('At least one task id is required');
    }

    const results = [];

    for (const taskId of taskIds) {
        const result = await confirmAIExtractedTask(taskId, requesterId, requesterRole);
        results.push(result);
    }

    return results;
}

export async function bulkDeleteTasks(
    taskIds: string[],
    requesterId: string,
    requesterRole?: string
): Promise<BulkDeleteResult> {
    if (!taskIds.length) {
        throw new BadRequestError('At least one task id is required');
    }

    const deletedIds: string[] = [];
    const failed: Array<{ id: string; reason: string }> = [];

    for (const taskId of taskIds) {
        try {
            await deleteTask(taskId, requesterId, requesterRole);
            deletedIds.push(taskId);
        } catch (error) {
            failed.push({
                id: taskId,
                reason: error instanceof Error ? error.message : 'Unknown error',
            });
        }
    }

    return { deletedIds, failed };
}

export async function addComment(
    taskId: string,
    content: string,
    requester: { id: string; name?: string; email: string; role?: string }
): Promise<TaskComment> {
    await assertTaskAccess(taskId, requester.id, requester.role);

    const normalizedContent = content.trim();
    if (!normalizedContent) {
        throw new BadRequestError('Comment content cannot be empty');
    }

    const comment: TaskComment = {
        id: `comment_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
        taskId,
        userId: requester.id,
        userName: requester.name || requester.email,
        content: normalizedContent,
        createdAt: new Date().toISOString(),
    };

    const comments = taskCommentsStore.get(taskId) || [];
    comments.push(comment);
    taskCommentsStore.set(taskId, comments);

    return comment;
}

export async function getTaskComments(
    taskId: string,
    requesterId: string,
    requesterRole?: string
): Promise<TaskComment[]> {
    await assertTaskAccess(taskId, requesterId, requesterRole);
    return taskCommentsStore.get(taskId) || [];
}

export async function syncTaskCalendarEvent(taskId: string): Promise<void> {
    const task = await prisma.task.findUnique({
        where: { id: taskId },
        include: {
            assignedTo: {
                select: {
                    email: true,
                },
            },
        },
    });

    if (!task) {
        throw new NotFoundError('Task');
    }

    const dueDate = normalizeDateToISO(task.dueDate ? task.dueDate.toISOString() : null);
    if (!dueDate) {
        return;
    }

    const existingEventId = taskCalendarEventMap.get(task.id);
    if (existingEventId) {
        await integrations.calendar.deleteTaskEvent(existingEventId);
        taskCalendarEventMap.delete(task.id);
    }

    const event = await integrations.calendar.createTaskEvent({
        taskId: task.id,
        title: task.title,
        description: task.description,
        assigneeEmail: task.assignedTo?.email,
        dueDate,
    });

    if (event?.eventId) {
        taskCalendarEventMap.set(task.id, event.eventId);
    }
}

