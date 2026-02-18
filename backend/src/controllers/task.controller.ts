import { Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import {
    asyncHandler,
    NotFoundError,
    AuthorizationError,
    BadRequestError,
} from '../middleware/error.middleware';
import { prisma } from '../config/database';
import * as workspaceService from '../services/workspace.service';

/**
 * Task Controller
 * Handles task management, status transitions, bulk confirmation, and comments.
 */

// ─────────────────────────────────────────────────────────────────────────────
// Validation schemas
// ─────────────────────────────────────────────────────────────────────────────

const listTasksSchema = z.object({
    workspaceId: z.string().optional(),
    meetingId: z.string().optional(),
    assigneeId: z.string().optional(),
    status: z.enum(['pending', 'in_progress', 'completed', 'cancelled']).optional(),
    priority: z.enum(['low', 'medium', 'high']).optional(),
    isAiGenerated: z.enum(['true', 'false']).optional(),
    /** ISO date — return tasks due on or before this date */
    dueBefore: z.string().datetime().optional(),
    page: z.string().optional().default('1'),
    limit: z.string().optional().default('20'),
});

const createTaskSchema = z.object({
    title: z.string().min(1).max(300),
    description: z.string().max(5000).optional(),
    assigneeId: z.string().optional(),
    meetingId: z.string().optional(),
    priority: z.enum(['low', 'medium', 'high']).optional().default('medium'),
    dueDate: z.string().datetime().optional(),
});

const updateTaskSchema = z.object({
    title: z.string().min(1).max(300).optional(),
    description: z.string().max(5000).optional(),
    assigneeId: z.string().nullable().optional(),
    priority: z.enum(['low', 'medium', 'high']).optional(),
    dueDate: z.string().datetime().nullable().optional(),
});

const updateStatusSchema = z.object({
    status: z.enum(['pending', 'in_progress', 'completed', 'cancelled']),
});

const bulkConfirmSchema = z.object({
    taskIds: z.array(z.string()).min(1).max(100),
});

const addCommentSchema = z.object({
    content: z.string().min(1).max(5000),
});

const getCommentsSchema = z.object({
    page: z.string().optional().default('1'),
    limit: z.string().optional().default('50'),
});

// ─────────────────────────────────────────────────────────────────────────────
// Shared task select — keeps query shape consistent across endpoints
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
            id: true, title: true,
            workspace: { select: { id: true, name: true } },
        },
    },
    _count: { select: { comments: true } },
} as const;

// ─────────────────────────────────────────────────────────────────────────────
// Authorization helpers
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Loads a task and determines the caller's relationship to it.
 *
 * Returns:
 *   - `task`       — the loaded task (with meeting/workspace)
 *   - `isAssignee` — true if the caller is assigned to the task
 *   - `isAdmin`    — true if the caller is a workspace admin for the meeting's workspace
 *   - `isMember`   — true if the caller is at least a workspace member
 */
async function loadTaskWithAccess(
    taskId: string,
    userId: string
): Promise<{
    task: any;
    isAssignee: boolean;
    isAdmin: boolean;
    isMember: boolean;
}> {
    const task = await prisma.task.findUnique({
        where: { id: taskId },
        include: {
            meeting: {
                select: {
                    id: true,
                    workspaceId: true,
                    createdById: true,
                    participants: { where: { userId }, select: { role: true } },
                },
            },
            assignedTo: { select: { id: true } },
        },
    });

    if (!task) throw new NotFoundError('Task');

    const isAssignee = task.assignedTo?.id === userId;
    const workspaceId = task.meeting?.workspaceId ?? null;

    let isAdmin = false;
    let isMember = false;

    if (workspaceId) {
        isAdmin = await workspaceService.isWorkspaceAdmin(workspaceId, userId);
        isMember = isAdmin || await workspaceService.isWorkspaceMember(workspaceId, userId);
    } else {
        // Personal task (no meeting/workspace) — only the assignee has access
        isMember = isAssignee;
        isAdmin = false;
    }

    return { task, isAssignee, isAdmin, isMember };
}

/**
 * Validates allowed status transitions.
 *
 * Allowed paths:
 *   pending      → in_progress | cancelled
 *   in_progress  → completed   | pending | cancelled
 *   completed    → (immutable)
 *   cancelled    → pending (reopen)
 */
function assertValidStatusTransition(current: string, next: string): void {
    if (current === next) return;

    const allowed: Record<string, string[]> = {
        pending: ['in_progress', 'cancelled'],
        in_progress: ['completed', 'pending', 'cancelled'],
        completed: [],
        cancelled: ['pending'],
    };

    if (!(allowed[current] ?? []).includes(next)) {
        throw new BadRequestError(
            `Cannot transition task from "${current}" to "${next}".`
        );
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// Endpoints
// ─────────────────────────────────────────────────────────────────────────────

/**
 * List Tasks
 * GET /api/v1/tasks
 *
 * - Workspace admins see ALL tasks in a workspace.
 * - Members see only their own assigned tasks in that workspace.
 * - Without workspaceId, returns the caller's personally assigned tasks.
 */
export const listTasks = asyncHandler(
    async (req: Request, res: Response, _next: NextFunction): Promise<void> => {
        if (!req.user) throw new AuthorizationError('Authentication required');

        const q = listTasksSchema.parse(req.query);
        const page = parseInt(q.page, 10);
        const limit = parseInt(q.limit, 10);
        const skip = (page - 1) * limit;

        // Build the base where clause
        const where: any = {};

        // ── Workspace / scope ──────────────────────────────────────────────
        if (q.workspaceId) {
            await workspaceService.verifyWorkspaceAccess(q.workspaceId, req.user.id);

            const isAdmin = await workspaceService.isWorkspaceAdmin(q.workspaceId, req.user.id);

            where.meeting = { workspaceId: q.workspaceId };

            // Members can only see tasks assigned to themselves
            if (!isAdmin) {
                where.assignedToId = req.user.id;
            } else if (q.assigneeId) {
                // Admins may filter by a specific assignee
                where.assignedToId = q.assigneeId;
            }
        } else {
            // No workspace filter — return personal tasks only
            where.assignedToId = req.user.id;
        }

        // ── Optional filters ───────────────────────────────────────────────
        if (q.meetingId) where.meetingId = q.meetingId;
        if (q.status) where.status = q.status;
        if (q.priority) where.priority = q.priority;
        if (q.isAiGenerated !== undefined) {
            where.isAiGenerated = q.isAiGenerated === 'true';
        }
        if (q.dueBefore) {
            where.dueDate = { lte: new Date(q.dueBefore) };
        }

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

        res.status(200).json({
            success: true,
            data: {
                tasks,
                pagination: {
                    page,
                    limit,
                    total,
                    pages: Math.ceil(total / limit),
                },
            },
        });
    }
);

/**
 * Create Task
 * POST /api/v1/tasks
 */
export const createTask = asyncHandler(
    async (req: Request, res: Response, _next: NextFunction): Promise<void> => {
        if (!req.user) throw new AuthorizationError('Authentication required');

        const data = createTaskSchema.parse(req.body);

        // If attached to a meeting, verify the caller is a participant or workspace member
        if (data.meetingId) {
            const meeting = await prisma.meeting.findUnique({
                where: { id: data.meetingId },
                select: { workspaceId: true, createdById: true },
            });
            if (!meeting) throw new NotFoundError('Meeting');

            if (meeting.workspaceId) {
                await workspaceService.verifyWorkspaceAccess(meeting.workspaceId, req.user.id);
            } else {
                // Personal meeting — only the creator may attach tasks
                if (meeting.createdById !== req.user.id) {
                    throw new AuthorizationError(
                        'Only the meeting creator can add tasks to a personal meeting.'
                    );
                }
            }
        }

        const task = await prisma.task.create({
            data: {
                title: data.title,
                description: data.description,
                meetingId: data.meetingId ?? null,
                assignedToId: data.assigneeId ?? null,
                priority: data.priority,
                dueDate: data.dueDate ? new Date(data.dueDate) : null,
                isAiGenerated: false,
            },
            select: TASK_SELECT,
        });

        res.status(201).json({
            success: true,
            message: 'Task created successfully',
            data: { task },
        });
    }
);

/**
 * Get Task By ID
 * GET /api/v1/tasks/:id
 */
export const getTaskById = asyncHandler(
    async (req: Request, res: Response, _next: NextFunction): Promise<void> => {
        if (!req.user) throw new AuthorizationError('Authentication required');

        const { id } = req.params;
        const { isMember, isAssignee } = await loadTaskWithAccess(id, req.user.id);

        if (!isMember && !isAssignee) {
            throw new AuthorizationError('You do not have access to this task.');
        }

        const task = await prisma.task.findUnique({
            where: { id },
            select: {
                ...TASK_SELECT,
                // Return the 10 most-recent comments inline for the detail view
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

        res.status(200).json({
            success: true,
            data: { task },
        });
    }
);

/**
 * Update Task
 * PUT /api/v1/tasks/:id
 *
 * Allowed by: the assignee, or any workspace admin.
 */
export const updateTask = asyncHandler(
    async (req: Request, res: Response, _next: NextFunction): Promise<void> => {
        if (!req.user) throw new AuthorizationError('Authentication required');

        const { id } = req.params;
        const { isAssignee, isAdmin } = await loadTaskWithAccess(id, req.user.id);

        if (!isAssignee && !isAdmin) {
            throw new AuthorizationError('Only the task assignee or a workspace admin can update this task.');
        }

        const data = updateTaskSchema.parse(req.body);

        const updateData: any = {};
        if (data.title !== undefined) updateData.title = data.title;
        if (data.description !== undefined) updateData.description = data.description;
        if (data.priority !== undefined) updateData.priority = data.priority;
        if ('assigneeId' in data) {
            updateData.assignedToId = data.assigneeId ?? null;
        }
        if ('dueDate' in data) {
            updateData.dueDate = data.dueDate ? new Date(data.dueDate) : null;
        }

        const task = await prisma.task.update({
            where: { id },
            data: updateData,
            select: TASK_SELECT,
        });

        res.status(200).json({
            success: true,
            message: 'Task updated successfully',
            data: { task },
        });
    }
);

/**
 * Delete Task
 * DELETE /api/v1/tasks/:id
 *
 * Allowed by: workspace admins only.
 * Assignees can complete/cancel but not delete.
 */
export const deleteTask = asyncHandler(
    async (req: Request, res: Response, _next: NextFunction): Promise<void> => {
        if (!req.user) throw new AuthorizationError('Authentication required');

        const { id } = req.params;
        const { isAdmin, isAssignee } = await loadTaskWithAccess(id, req.user.id);

        // Allow assignee to delete their own personal tasks (no workspace)
        const task = await prisma.task.findUnique({
            where: { id },
            select: { meeting: { select: { workspaceId: true } } },
        });
        const isPersonalTask = !task?.meeting?.workspaceId;

        if (!isAdmin && !(isPersonalTask && isAssignee)) {
            throw new AuthorizationError(
                'Only a workspace admin can delete workspace tasks.'
            );
        }

        await prisma.task.delete({ where: { id } });

        res.status(200).json({
            success: true,
            message: 'Task deleted successfully',
        });
    }
);

/**
 * Update Task Status
 * PATCH /api/v1/tasks/:id/status
 *
 * Validates the transition graph before applying.
 * Sets completedAt when transitioning to "completed".
 */
export const updateTaskStatus = asyncHandler(
    async (req: Request, res: Response, _next: NextFunction): Promise<void> => {
        if (!req.user) throw new AuthorizationError('Authentication required');

        const { id } = req.params;
        const { status: newStatus } = updateStatusSchema.parse(req.body);
        const { task, isAssignee, isAdmin } = await loadTaskWithAccess(id, req.user.id);

        if (!isAssignee && !isAdmin) {
            throw new AuthorizationError(
                'Only the task assignee or a workspace admin can update the task status.'
            );
        }

        assertValidStatusTransition(task.status, newStatus);

        const updateData: any = { status: newStatus };
        if (newStatus === 'completed') updateData.completedAt = new Date();
        if (newStatus !== 'completed') updateData.completedAt = null;

        const updated = await prisma.task.update({
            where: { id },
            data: updateData,
            select: TASK_SELECT,
        });

        res.status(200).json({
            success: true,
            message: `Task status updated to "${newStatus}"`,
            data: { task: updated },
        });
    }
);

/**
 * Bulk Confirm Tasks
 * POST /api/v1/tasks/bulk-confirm
 *
 * Confirms AI-extracted tasks in bulk.
 * All tasks must belong to workspaces where the caller is an admin,
 * or be from meetings where the caller is the organizer.
 *
 * Sets confirmedAt and clears the isAiGenerated flag so they graduate
 * to regular tasks.
 */
export const bulkConfirmTasks = asyncHandler(
    async (req: Request, res: Response, _next: NextFunction): Promise<void> => {
        if (!req.user) throw new AuthorizationError('Authentication required');

        const { taskIds } = bulkConfirmSchema.parse(req.body);

        // Load all tasks to verify that the caller has admin rights over each
        const tasks = await prisma.task.findMany({
            where: { id: { in: taskIds } },
            select: {
                id: true,
                isAiGenerated: true,
                confirmedAt: true,
                meeting: {
                    select: {
                        workspaceId: true,
                        createdById: true,
                        participants: {
                            where: { userId: req.user.id },
                            select: { role: true },
                        },
                    },
                },
            },
        });

        // Report any IDs that don't exist
        const foundIds = new Set(tasks.map((t) => t.id));
        const missingIds = taskIds.filter((id) => !foundIds.has(id));
        if (missingIds.length > 0) {
            throw new NotFoundError(`Tasks with IDs: ${missingIds.join(', ')}`);
        }

        // Authorise each task individually
        const unauthorised: string[] = [];
        const alreadyConfirmed: string[] = [];

        for (const task of tasks) {
            if (task.confirmedAt) {
                alreadyConfirmed.push(task.id);
                continue;
            }

            const workspaceId = task.meeting?.workspaceId;
            let canConfirm = false;

            if (workspaceId) {
                canConfirm = await workspaceService.isWorkspaceAdmin(workspaceId, req.user.id);
            } else {
                // Personal task — only assignee/meeting creator can confirm
                canConfirm = task.meeting?.createdById === req.user.id;
            }

            // Also allow the meeting organizer to confirm
            if (!canConfirm) {
                const participantRole = task.meeting?.participants?.[0]?.role;
                if (participantRole === 'organizer') canConfirm = true;
            }

            if (!canConfirm) unauthorised.push(task.id);
        }

        if (unauthorised.length > 0) {
            throw new AuthorizationError(
                `You do not have permission to confirm tasks: ${unauthorised.join(', ')}`
            );
        }

        // Confirm the eligible tasks
        const toConfirmIds = tasks
            .filter((t) => !t.confirmedAt)
            .map((t) => t.id);

        if (toConfirmIds.length === 0) {
            res.status(200).json({
                success: true,
                message: 'All selected tasks were already confirmed.',
                data: { confirmed: 0, alreadyConfirmed: alreadyConfirmed.length },
            });
            return;
        }

        await prisma.task.updateMany({
            where: { id: { in: toConfirmIds } },
            data: { confirmedAt: new Date(), isAiGenerated: false },
        });

        res.status(200).json({
            success: true,
            message: `${toConfirmIds.length} task(s) confirmed successfully.`,
            data: {
                confirmed: toConfirmIds.length,
                alreadyConfirmed: alreadyConfirmed.length,
                confirmedIds: toConfirmIds,
            },
        });
    }
);

/**
 * Add Comment
 * POST /api/v1/tasks/:id/comments
 *
 * Allowed by: the assignee, any participant of the linked meeting,
 * or any member of the linked workspace.
 */
export const addComment = asyncHandler(
    async (req: Request, res: Response, _next: NextFunction): Promise<void> => {
        if (!req.user) throw new AuthorizationError('Authentication required');

        const { id } = req.params;
        const { content } = addCommentSchema.parse(req.body);
        const { isMember, isAssignee } = await loadTaskWithAccess(id, req.user.id);

        if (!isMember && !isAssignee) {
            throw new AuthorizationError('You do not have access to comment on this task.');
        }

        const comment = await prisma.taskComment.create({
            data: {
                content,
                taskId: id,
                userId: req.user.id,
            },
            select: {
                id: true,
                content: true,
                createdAt: true,
                updatedAt: true,
                user: { select: { id: true, name: true, email: true } },
            },
        });

        res.status(201).json({
            success: true,
            message: 'Comment added successfully',
            data: { comment },
        });
    }
);

/**
 * Get Comments
 * GET /api/v1/tasks/:id/comments
 *
 * Paginated; newest first.
 */
export const getComments = asyncHandler(
    async (req: Request, res: Response, _next: NextFunction): Promise<void> => {
        if (!req.user) throw new AuthorizationError('Authentication required');

        const { id } = req.params;
        const { isMember, isAssignee } = await loadTaskWithAccess(id, req.user.id);

        if (!isMember && !isAssignee) {
            throw new AuthorizationError('You do not have access to this task.');
        }

        const q = getCommentsSchema.parse(req.query);
        const page = parseInt(q.page, 10);
        const limit = parseInt(q.limit, 10);
        const skip = (page - 1) * limit;

        const [comments, total] = await Promise.all([
            prisma.taskComment.findMany({
                where: { taskId: id },
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
            prisma.taskComment.count({ where: { taskId: id } }),
        ]);

        res.status(200).json({
            success: true,
            data: {
                comments,
                pagination: {
                    page,
                    limit,
                    total,
                    pages: Math.ceil(total / limit),
                },
            },
        });
    }
);
