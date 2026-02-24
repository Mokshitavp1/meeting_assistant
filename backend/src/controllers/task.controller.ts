import { Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { prisma } from '../config/database';
import {
    asyncHandler,
    AuthorizationError,
    BadRequestError,
    NotFoundError,
} from '../middleware/error.middleware';
import type { AuthUser } from '../middleware/auth.middleware';
import * as workspaceService from '../services/workspace.service';

type AuthenticatedRequest = Request & { user?: AuthUser };

type TaskStatus = 'pending' | 'in_progress' | 'completed';

const listTasksSchema = z.object({
    assignee: z.string().optional(),
    status: z.enum(['pending', 'in_progress', 'completed', 'cancelled']).optional(),
    deadline: z.string().datetime().optional(),
    workspace: z.string().optional(),
    page: z.string().optional().default('1'),
    limit: z.string().optional().default('20'),
});

const createTaskSchema = z.object({
    title: z.string().trim().min(2).max(200),
    description: z.string().trim().max(4000).optional(),
    meetingId: z.string().optional(),
    assignedToId: z.string().optional(),
    priority: z.enum(['low', 'medium', 'high']).optional().default('medium'),
    dueDate: z.string().datetime().optional(),
    status: z.enum(['pending', 'in_progress', 'completed', 'cancelled']).optional().default('pending'),
});

const updateTaskSchema = z.object({
    title: z.string().trim().min(2).max(200).optional(),
    description: z.string().trim().max(4000).optional(),
    assignedToId: z.string().nullable().optional(),
    priority: z.enum(['low', 'medium', 'high']).optional(),
    dueDate: z.string().datetime().nullable().optional(),
    status: z.enum(['pending', 'in_progress', 'completed', 'cancelled']).optional(),
});

const updateTaskStatusSchema = z.object({
    status: z.enum(['pending', 'in_progress', 'completed']),
});

const bulkConfirmTasksSchema = z.object({
    tasks: z
        .array(
            z.object({
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
            })
        )
        .min(1)
        .max(200),
});

const addCommentSchema = z.object({
    content: z.string().trim().min(1).max(2000),
});

async function getTaskWithAccess(taskId: string, userId: string, userRole?: string) {
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
                    name: true,
                    email: true,
                },
            },
        },
    });

    if (!task) {
        throw new NotFoundError('Task');
    }

    if (userRole === 'admin') {
        return task;
    }

    if (task.meeting?.workspaceId) {
        const role = await workspaceService.getUserRole(task.meeting.workspaceId, userId);

        if (role === 'admin') {
            return task;
        }

        if (task.assignedToId !== userId) {
            throw new AuthorizationError('Members can only access their assigned tasks');
        }

        return task;
    }

    if (task.assignedToId !== userId) {
        throw new AuthorizationError('You do not have access to this task');
    }

    return task;
}

async function validateWorkspaceAccessForMeeting(meetingId: string, userId: string, userRole?: string) {
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

    if (userRole === 'admin') {
        return;
    }

    if (meeting.workspaceId) {
        await workspaceService.verifyWorkspaceAccess(meeting.workspaceId, userId);
        return;
    }

    if (meeting.createdById !== userId) {
        throw new AuthorizationError('You do not have permission to create tasks for this meeting');
    }
}

function isValidStatusTransition(currentStatus: TaskStatus, nextStatus: TaskStatus): boolean {
    const allowedTransitions: Record<TaskStatus, TaskStatus[]> = {
        pending: ['in_progress'],
        in_progress: ['completed'],
        completed: [],
    };

    return allowedTransitions[currentStatus].includes(nextStatus);
}

function getParamId(value: string | string[] | undefined): string {
    if (!value) {
        throw new BadRequestError('Task id is required');
    }

    if (Array.isArray(value)) {
        if (!value[0]) {
            throw new BadRequestError('Task id is required');
        }
        return value[0];
    }

    return value;
}

export const listTasks = asyncHandler(
    async (req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> => {
        if (!req.user) {
            throw new AuthorizationError('Authentication required');
        }

        const validatedQuery = listTasksSchema.parse(req.query);
        const { assignee, status, deadline, workspace, page, limit } = validatedQuery;

        const pageNum = Math.max(parseInt(page, 10) || 1, 1);
        const limitNum = Math.min(Math.max(parseInt(limit, 10) || 20, 1), 100);
        const skip = (pageNum - 1) * limitNum;

        const where: any = {};

        if (status) {
            where.status = status;
        }

        if (deadline) {
            const start = new Date(deadline);
            const end = new Date(deadline);
            end.setUTCDate(end.getUTCDate() + 1);
            where.dueDate = {
                gte: start,
                lt: end,
            };
        }

        if (workspace) {
            await workspaceService.verifyWorkspaceAccess(workspace, req.user.id);
            where.meeting = {
                workspaceId: workspace,
            };
        }

        if (req.user.role !== 'admin') {
            where.assignedToId = req.user.id;
        } else if (assignee) {
            where.assignedToId = assignee;
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
                take: limitNum,
            }),
            prisma.task.count({ where }),
        ]);

        res.status(200).json({
            success: true,
            data: {
                tasks,
                pagination: {
                    page: pageNum,
                    limit: limitNum,
                    total,
                    pages: Math.ceil(total / limitNum),
                },
            },
        });
    }
);

export const createTask = asyncHandler(
    async (req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> => {
        if (!req.user) {
            throw new AuthorizationError('Authentication required');
        }

        const validatedData = createTaskSchema.parse(req.body);

        if (validatedData.meetingId) {
            await validateWorkspaceAccessForMeeting(
                validatedData.meetingId,
                req.user.id,
                req.user.role
            );
        }

        if (validatedData.assignedToId && req.user.role !== 'admin') {
            // Non-admins can only assign tasks to themselves.
            if (validatedData.assignedToId !== req.user.id) {
                throw new AuthorizationError('Members can only assign tasks to themselves');
            }
        }

        const task = await prisma.task.create({
            data: {
                title: validatedData.title,
                description: validatedData.description,
                meetingId: validatedData.meetingId,
                assignedToId: validatedData.assignedToId,
                priority: validatedData.priority,
                status: validatedData.status,
                dueDate: validatedData.dueDate ? new Date(validatedData.dueDate) : null,
                completedAt:
                    validatedData.status === 'completed' ? new Date() : null,
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

        res.status(201).json({
            success: true,
            message: 'Task created successfully',
            data: { task },
        });
    }
);

export const getTaskById = asyncHandler(
    async (req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> => {
        if (!req.user) {
            throw new AuthorizationError('Authentication required');
        }

        const taskId = getParamId(req.params.id);
        const task = await getTaskWithAccess(taskId, req.user.id, req.user.role);
        const comments = await prisma.taskComment.findMany({
            where: { taskId: task.id },
            orderBy: { createdAt: 'asc' },
        });

        res.status(200).json({
            success: true,
            data: {
                task: {
                    ...task,
                    comments,
                },
            },
        });
    }
);

export const updateTask = asyncHandler(
    async (req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> => {
        if (!req.user) {
            throw new AuthorizationError('Authentication required');
        }

        const taskId = getParamId(req.params.id);
        const existingTask = await getTaskWithAccess(taskId, req.user.id, req.user.role);
        const validatedData = updateTaskSchema.parse(req.body);

        const completedAtUpdate =
            validatedData.status === undefined
                ? undefined
                : validatedData.status === 'completed'
                    ? new Date()
                    : null;

        if (
            validatedData.assignedToId !== undefined &&
            req.user.role !== 'admin' &&
            validatedData.assignedToId !== req.user.id
        ) {
            throw new AuthorizationError('Members can only assign tasks to themselves');
        }

        const updatedTask = await prisma.task.update({
            where: { id: existingTask.id },
            data: {
                title: validatedData.title,
                description: validatedData.description,
                assignedToId: validatedData.assignedToId,
                priority: validatedData.priority,
                status: validatedData.status,
                dueDate:
                    validatedData.dueDate === undefined
                        ? undefined
                        : validatedData.dueDate === null
                            ? null
                            : new Date(validatedData.dueDate),
                completedAt: completedAtUpdate,
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

        res.status(200).json({
            success: true,
            message: 'Task updated successfully',
            data: { task: updatedTask },
        });
    }
);

export const deleteTask = asyncHandler(
    async (req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> => {
        if (!req.user) {
            throw new AuthorizationError('Authentication required');
        }

        const taskId = getParamId(req.params.id);
        const task = await getTaskWithAccess(taskId, req.user.id, req.user.role);

        if (req.user.role !== 'admin' && task.assignedToId !== req.user.id) {
            throw new AuthorizationError('Members can only delete their own assigned tasks');
        }

        await prisma.task.delete({ where: { id: task.id } });

        res.status(200).json({
            success: true,
            message: 'Task deleted successfully',
        });
    }
);

export const updateTaskStatus = asyncHandler(
    async (req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> => {
        if (!req.user) {
            throw new AuthorizationError('Authentication required');
        }

        const taskId = getParamId(req.params.id);
        const task = await getTaskWithAccess(taskId, req.user.id, req.user.role);
        const { status } = updateTaskStatusSchema.parse(req.body);

        const currentStatus = task.status as TaskStatus;

        if (currentStatus === status) {
            throw new BadRequestError(`Task is already in ${status} status`);
        }

        if (!isValidStatusTransition(currentStatus, status)) {
            throw new BadRequestError(
                `Invalid status transition from ${currentStatus} to ${status}`
            );
        }

        const updatedTask = await prisma.task.update({
            where: { id: task.id },
            data: {
                status,
                completedAt: status === 'completed' ? new Date() : null,
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

        res.status(200).json({
            success: true,
            message: 'Task status updated successfully',
            data: { task: updatedTask },
        });
    }
);

export const bulkConfirmTasks = asyncHandler(
    async (req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> => {
        if (!req.user) {
            throw new AuthorizationError('Authentication required');
        }

        const { tasks } = bulkConfirmTasksSchema.parse(req.body);

        if (req.user.role !== 'admin') {
            for (const task of tasks) {
                if (task.assignedToId && task.assignedToId !== req.user.id) {
                    throw new AuthorizationError('Members can only confirm tasks assigned to themselves');
                }

                if (task.meetingId) {
                    await validateWorkspaceAccessForMeeting(task.meetingId, req.user.id, req.user.role);
                }
            }
        }

        const createdTasks = await prisma.$transaction(
            tasks.map((task) =>
                prisma.task.create({
                    data: {
                        title: task.title,
                        description: task.description,
                        meetingId: task.meetingId,
                        assignedToId: task.assignedToId,
                        priority: task.priority,
                        status: task.status,
                        dueDate: task.dueDate ? new Date(task.dueDate) : null,
                        completedAt: task.status === 'completed' ? new Date() : null,
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

        res.status(201).json({
            success: true,
            message: 'Tasks confirmed successfully',
            data: {
                count: createdTasks.length,
                tasks: createdTasks,
            },
        });
    }
);

export const addComment = asyncHandler(
    async (req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> => {
        if (!req.user) {
            throw new AuthorizationError('Authentication required');
        }

        const taskId = getParamId(req.params.id);
        const task = await getTaskWithAccess(taskId, req.user.id, req.user.role);
        const { content } = addCommentSchema.parse(req.body);

        const comment = await prisma.taskComment.create({
            data: {
                taskId: task.id,
                userId: req.user.id,
                userName: req.user.name || req.user.email,
                content,
            },
        });

        res.status(201).json({
            success: true,
            message: 'Comment added successfully',
            data: { comment },
        });
    }
);

export const getComments = asyncHandler(
    async (req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> => {
        if (!req.user) {
            throw new AuthorizationError('Authentication required');
        }

        const taskId = getParamId(req.params.id);
        const task = await getTaskWithAccess(taskId, req.user.id, req.user.role);
        const comments = await prisma.taskComment.findMany({
            where: { taskId: task.id },
            orderBy: { createdAt: 'asc' },
        });

        res.status(200).json({
            success: true,
            data: {
                comments,
                count: comments.length,
            },
        });
    }
);

