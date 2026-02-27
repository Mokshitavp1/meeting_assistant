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
import * as meetingService from '../services/meeting.service';
import { sendTaskAssignmentEmail } from '../services/email.service';
import { createTaskCalendarEvent } from '../services/calender.service';
import { setJSON, getJSON } from '../config/redis';

/**
 * Meeting Controller
 * Handles meeting management, scheduling, and AI processing
 */

/**
 * Validation Schemas
 */

const createMeetingSchema = z.object({
    title: z.string().min(2, 'Title must be at least 2 characters').max(200),
    description: z.string().max(2000).optional(),
    workspaceId: z.string().optional(),
    scheduledStartTime: z.string().datetime(),
    scheduledEndTime: z.string().datetime().optional(),
    participantIds: z.array(z.string()).optional().default([]),
});

const updateMeetingSchema = z.object({
    title: z.string().min(2).max(200).optional(),
    description: z.string().max(2000).optional(),
    scheduledStartTime: z.string().datetime().optional(),
    scheduledEndTime: z.string().datetime().optional(),
    status: z.enum(['scheduled', 'in_progress', 'completed', 'cancelled']).optional(),
});

const listMeetingsSchema = z.object({
    workspaceId: z.string().optional(),
    status: z.enum(['scheduled', 'in_progress', 'completed', 'cancelled']).optional(),
    startDate: z.string().datetime().optional(),
    endDate: z.string().datetime().optional(),
    page: z.string().optional().default('1'),
    limit: z.string().optional().default('20'),
});

function getParamId(value: string | string[] | undefined): string {
    if (!value) {
        throw new BadRequestError('Meeting id is required');
    }

    if (Array.isArray(value)) {
        if (!value[0]) {
            throw new BadRequestError('Meeting id is required');
        }
        return value[0];
    }

    return value;
}

/**
 * List Meetings - Get meetings with filters
 * GET /api/v1/meetings
 */
export const listMeetings = asyncHandler(
    async (req: Request, res: Response, next: NextFunction): Promise<void> => {
        if (!req.user) {
            throw new AuthorizationError('Authentication required');
        }

        // Validate query parameters
        const validatedQuery = listMeetingsSchema.parse(req.query);

        const { workspaceId, status, startDate, endDate, page, limit } = validatedQuery;

        const pageNum = parseInt(page);
        const limitNum = parseInt(limit);
        const skip = (pageNum - 1) * limitNum;

        // Build filter conditions
        const where: any = {
            OR: [
                { createdById: req.user.id },
                { participants: { some: { userId: req.user.id } } },
            ],
        };

        if (workspaceId) {
            // Verify workspace access
            await workspaceService.verifyWorkspaceAccess(workspaceId, req.user.id);
            where.workspaceId = workspaceId;
        }

        if (status) {
            where.status = status;
        }

        if (startDate || endDate) {
            where.scheduledStartTime = {};
            if (startDate) {
                where.scheduledStartTime.gte = new Date(startDate);
            }
            if (endDate) {
                where.scheduledStartTime.lte = new Date(endDate);
            }
        }

        // Get meetings with pagination
        const [meetings, total] = await Promise.all([
            prisma.meeting.findMany({
                where,
                include: {
                    createdBy: {
                        select: {
                            id: true,
                            name: true,
                            email: true,
                        },
                    },
                    participants: {
                        select: {
                            id: true,
                            role: true,
                            attended: true,
                            user: {
                                select: {
                                    id: true,
                                    name: true,
                                    email: true,
                                },
                            },
                        },
                    },
                    workspace: {
                        select: {
                            id: true,
                            name: true,
                        },
                    },
                    _count: {
                        select: {
                            participants: true,
                            tasks: true,
                        },
                    },
                },
                orderBy: {
                    scheduledStartTime: 'desc',
                },
                skip,
                take: limitNum,
            }),
            prisma.meeting.count({ where }),
        ]);

        res.status(200).json({
            success: true,
            data: {
                meetings,
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

/**
 * Create Meeting - Schedule new meeting
 * POST /api/v1/meetings
 */
export const createMeeting = asyncHandler(
    async (req: Request, res: Response, next: NextFunction): Promise<void> => {
        if (!req.user) {
            throw new AuthorizationError('Authentication required');
        }

        // Validate input
        const validatedData = createMeetingSchema.parse(req.body);

        const { title, description, workspaceId, scheduledStartTime, scheduledEndTime, participantIds } = validatedData;

        // Create meeting using service
        const meeting = await meetingService.createMeeting({
            title,
            description,
            workspaceId,
            scheduledStartTime: new Date(scheduledStartTime),
            scheduledEndTime: scheduledEndTime ? new Date(scheduledEndTime) : undefined,
            createdById: req.user.id,
            participantIds,
        });

        // Notify participants (excluding the creator) about the new meeting
        if (participantIds.length > 0) {
            const NOTIFICATION_TTL = 60 * 60 * 24 * 30;
            const scheduledAt = new Date(scheduledStartTime).toLocaleDateString(undefined, {
                weekday: 'long', month: 'long', day: 'numeric', year: 'numeric',
            });
            const scheduledTime = new Date(scheduledStartTime).toLocaleTimeString([], {
                hour: '2-digit', minute: '2-digit',
            });

            await Promise.allSettled(
                participantIds
                    .filter((pid) => pid !== req.user!.id)
                    .map(async (userId) => {
                        const notifKey = `notifications:user:${userId}`;
                        const existing = (await getJSON<any[]>(notifKey)) || [];
                        const notification = {
                            id: `notif_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
                            type: 'meeting-invite',
                            title: 'You\'ve been invited to a meeting',
                            message: `"${title}" has been scheduled for ${scheduledAt} at ${scheduledTime}.`,
                            meetingId: meeting.id,
                            meetingTitle: title,
                            createdAt: new Date().toISOString(),
                            read: false,
                        };
                        const updated = [notification, ...existing].slice(0, 200);
                        await setJSON(notifKey, updated, NOTIFICATION_TTL);
                    })
            );
        }

        res.status(201).json({
            success: true,
            message: 'Meeting created successfully',
            data: {
                meeting,
            },
        });
    }
);

/**
 * Get Meeting By ID - Get meeting details with participants and minutes
 * GET /api/v1/meetings/:id
 */
export const getMeetingById = asyncHandler(
    async (req: Request, res: Response, next: NextFunction): Promise<void> => {
        if (!req.user) {
            throw new AuthorizationError('Authentication required');
        }

        const id = getParamId(req.params.id);

        // Get meeting with all details using service
        const meeting = await meetingService.getMeetingWithDetails(id, req.user.id);

        res.status(200).json({
            success: true,
            data: {
                meeting,
            },
        });
    }
);

/**
 * Update Meeting - Update meeting details
 * PUT /api/v1/meetings/:id
 */
export const updateMeeting = asyncHandler(
    async (req: Request, res: Response, next: NextFunction): Promise<void> => {
        if (!req.user) {
            throw new AuthorizationError('Authentication required');
        }

        const id = getParamId(req.params.id);

        // Validate input
        const validatedData = updateMeetingSchema.parse(req.body);

        // Prepare update data
        const updateData: any = {};

        if (validatedData.title) updateData.title = validatedData.title;
        if (validatedData.description !== undefined) updateData.description = validatedData.description;
        if (validatedData.status) updateData.status = validatedData.status;
        if (validatedData.scheduledStartTime) {
            updateData.scheduledStartTime = new Date(validatedData.scheduledStartTime);
        }
        if (validatedData.scheduledEndTime) {
            updateData.scheduledEndTime = new Date(validatedData.scheduledEndTime);
        }

        // Update meeting using service
        const updatedMeeting = await meetingService.updateMeeting(id, updateData, req.user.id);

        res.status(200).json({
            success: true,
            message: 'Meeting updated successfully',
            data: {
                meeting: updatedMeeting,
            },
        });
    }
);

/**
 * Delete Meeting - Delete meeting
 * DELETE /api/v1/meetings/:id
 */
export const deleteMeeting = asyncHandler(
    async (req: Request, res: Response, next: NextFunction): Promise<void> => {
        if (!req.user) {
            throw new AuthorizationError('Authentication required');
        }

        const id = getParamId(req.params.id);

        // Delete meeting using service (handles file cleanup and permissions)
        await meetingService.deleteMeeting(id, req.user.id);

        res.status(200).json({
            success: true,
            message: 'Meeting deleted successfully',
        });
    }
);

/**
 * Start Meeting - Mark meeting as in progress
 * POST /api/v1/meetings/:id/start
 */
export const startMeeting = asyncHandler(
    async (req: Request, res: Response, next: NextFunction): Promise<void> => {
        if (!req.user) {
            throw new AuthorizationError('Authentication required');
        }

        const id = getParamId(req.params.id);

        // Update meeting status to in_progress using service
        const updatedMeeting = await meetingService.updateMeetingStatus(
            id,
            'in_progress',
            req.user.id
        );

        res.status(200).json({
            success: true,
            message: 'Meeting started successfully',
            data: {
                meeting: updatedMeeting,
            },
        });
    }
);

/**
 * End Meeting - Mark meeting as completed
 * POST /api/v1/meetings/:id/end
 */
export const endMeeting = asyncHandler(
    async (req: Request, res: Response, next: NextFunction): Promise<void> => {
        if (!req.user) {
            throw new AuthorizationError('Authentication required');
        }

        const id = getParamId(req.params.id);

        // Update meeting status to completed using service
        const updatedMeeting = await meetingService.updateMeetingStatus(
            id,
            'completed',
            req.user.id
        );

        // If the meeting already has a recording, trigger AI processing now
        if (updatedMeeting.recordingPath || updatedMeeting.recordingUrl) {
            try {
                await meetingService.triggerAIProcessing(id, req.user.id);
            } catch (err) {
                // Non-fatal — processing will be retried via /process endpoint
                console.warn('[endMeeting] Could not trigger AI processing:', (err as Error).message);
            }
        }

        res.status(200).json({
            success: true,
            message: 'Meeting ended successfully',
            data: {
                meeting: updatedMeeting,
                duration: updatedMeeting.duration ? `${updatedMeeting.duration} minutes` : undefined,
            },
        });
    }
);

/**
 * Upload Recording - Upload meeting recording file
 * POST /api/v1/meetings/:id/recording
 */
export const uploadRecording = asyncHandler(
    async (req: Request, res: Response, next: NextFunction): Promise<void> => {
        if (!req.user) {
            throw new AuthorizationError('Authentication required');
        }

        const id = getParamId(req.params.id);

        if (!req.file) {
            throw new BadRequestError('No recording file uploaded');
        }

        // Upload recording using service (handles S3 upload and cleanup)
        const result = await meetingService.uploadRecording(
            {
                meetingId: id,
                filePath: req.file.path,
                filename: req.file.filename,
                mimetype: req.file.mimetype,
                size: req.file.size,
            },
            req.user.id
        );

        // Auto-trigger AI processing after upload
        try {
            await meetingService.triggerAIProcessing(id, req.user.id);
        } catch (err) {
            // Non-fatal — client can call /process manually
            console.warn('[uploadRecording] Could not auto-trigger AI processing:', (err as Error).message);
        }

        res.status(200).json({
            success: true,
            message: 'Recording uploaded successfully. AI processing has started.',
            data: result,
        });
    }
);

/**
 * Get Transcript - Get meeting transcript
 * GET /api/v1/meetings/:id/transcript
 */
export const getTranscript = asyncHandler(
    async (req: Request, res: Response, next: NextFunction): Promise<void> => {
        if (!req.user) {
            throw new AuthorizationError('Authentication required');
        }

        const id = getParamId(req.params.id);

        // Verify access
        await meetingService.getMeetingWithDetails(id, req.user.id);

        const meeting = await prisma.meeting.findUnique({
            where: { id },
            select: {
                id: true,
                title: true,
                transcriptUrl: true,
                transcriptPath: true,
            },
        });

        if (!meeting) {
            throw new NotFoundError('Meeting');
        }

        if (!meeting.transcriptUrl && !meeting.transcriptPath) {
            throw new NotFoundError('Transcript', 'Transcript not available for this meeting');
        }

        res.status(200).json({
            success: true,
            data: {
                meetingId: meeting.id,
                title: meeting.title,
                transcriptUrl: meeting.transcriptUrl,
            },
        });
    }
);

/**
 * Process Meeting - Trigger AI processing
 * POST /api/v1/meetings/:id/process
 */
export const processMeeting = asyncHandler(
    async (req: Request, res: Response, next: NextFunction): Promise<void> => {
        if (!req.user) {
            throw new AuthorizationError('Authentication required');
        }

        const id = getParamId(req.params.id);

        // Trigger AI processing using service
        await meetingService.triggerAIProcessing(id, req.user.id);

        res.status(202).json({
            success: true,
            message: 'Meeting processing initiated. This may take a few minutes.',
            data: {
                meetingId: id,
                status: 'processing',
                estimatedTime: '2-5 minutes',
            },
        });
    }
);

const UNCONFIRMED_PREFIX = '[UNCONFIRMED_AI_TASK]';

/**
 * Review Meeting - Get AI-extracted tasks and MoM for admin review
 * GET /api/v1/meetings/:id/review
 */
export const reviewMeeting = asyncHandler(
    async (req: Request, res: Response, next: NextFunction): Promise<void> => {
        if (!req.user) {
            throw new AuthorizationError('Authentication required');
        }

        const id = getParamId(req.params.id);

        const meeting = await prisma.meeting.findUnique({
            where: { id },
            select: {
                id: true,
                title: true,
                status: true,
                minutesOfMeeting: true,
                summary: true,
                createdById: true,
                workspaceId: true,
                participants: {
                    select: {
                        userId: true,
                        role: true,
                        user: {
                            select: {
                                id: true,
                                name: true,
                                email: true,
                            },
                        },
                    },
                },
                tasks: {
                    where: { isConfirmed: false },
                    select: {
                        id: true,
                        title: true,
                        description: true,
                        priority: true,
                        dueDate: true,
                        isConfirmed: true,
                        assignedToId: true,
                        assignedTo: {
                            select: {
                                id: true,
                                name: true,
                                email: true,
                            },
                        },
                    },
                    orderBy: { createdAt: 'asc' },
                },
            },
        });

        if (!meeting) {
            throw new NotFoundError('Meeting');
        }

        // Check access: creator, admin, or organizer participant
        const isCreator = meeting.createdById === req.user.id;
        const isAdmin = req.user.role === 'admin';
        const isOrganizer = meeting.participants.some(
            (p) => p.userId === req.user!.id && p.role === 'organizer'
        );

        if (!isCreator && !isAdmin && !isOrganizer) {
            if (meeting.workspaceId) {
                const role = await workspaceService.getUserRole(meeting.workspaceId, req.user.id);
                if (role !== 'admin') {
                    throw new AuthorizationError('Only meeting organizers or workspace admins can review meeting tasks');
                }
            } else {
                throw new AuthorizationError('Only the meeting creator can review this meeting');
            }
        }

        // Strip the unconfirmed prefix from descriptions for display
        const tasks = meeting.tasks.map((task) => ({
            ...task,
            description: task.description
                ? task.description.replace(UNCONFIRMED_PREFIX, '').trim()
                : '',
        }));

        res.status(200).json({
            success: true,
            data: {
                meetingId: meeting.id,
                title: meeting.title,
                status: meeting.status,
                minutesOfMeeting: meeting.minutesOfMeeting || '',
                summary: meeting.summary || '',
                participants: meeting.participants.map((p) => p.user),
                unconfirmedTasks: tasks,
                pendingCount: tasks.length,
            },
        });
    }
);

/**
 * Add Participant - Add a user to an existing meeting by email
 * POST /api/v1/meetings/:id/participants
 */
export const addParticipant = asyncHandler(
    async (req: Request, res: Response, next: NextFunction): Promise<void> => {
        if (!req.user) {
            throw new AuthorizationError('Authentication required');
        }

        const id = getParamId(req.params.id);
        const { email } = z.object({ email: z.string().email() }).parse(req.body);

        const meeting = await prisma.meeting.findUnique({
            where: { id },
            select: { id: true, title: true, createdById: true, workspaceId: true, scheduledStartTime: true },
        });

        if (!meeting) {
            throw new NotFoundError('Meeting');
        }

        if (meeting.createdById !== req.user.id && req.user.role !== 'admin') {
            throw new AuthorizationError('Only the meeting organizer can add participants');
        }

        const userToAdd = await prisma.user.findUnique({
            where: { email },
            select: { id: true, name: true, email: true },
        });

        if (!userToAdd) {
            throw new NotFoundError('User', `No user found with email: ${email}`);
        }

        // Check if already a participant
        const existing = await prisma.meetingParticipant.findFirst({
            where: { meetingId: id, userId: userToAdd.id },
        });

        if (existing) {
            res.status(200).json({
                success: true,
                message: 'User is already a participant',
                data: { participant: existing },
            });
            return;
        }

        const participant = await prisma.meetingParticipant.create({
            data: {
                meetingId: id,
                userId: userToAdd.id,
                role: 'participant',
            },
            include: {
                user: { select: { id: true, name: true, email: true } },
            },
        });

        // Notify the added user via in-app notification
        try {
            const notifKey = `notifications:user:${userToAdd.id}`;
            const existing = (await getJSON<any[]>(notifKey)) || [];
            const notification = {
                id: `notif_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
                type: 'meeting-invite',
                title: 'Added to Meeting',
                message: `You have been added to "${meeting.title}" scheduled on ${new Date(meeting.scheduledStartTime).toLocaleDateString()}.`,
                meetingId: id,
                meetingTitle: meeting.title,
                createdAt: new Date().toISOString(),
                read: false,
            };
            const updated = [notification, ...existing].slice(0, 200);
            await setJSON(notifKey, updated, 60 * 60 * 24 * 30);
        } catch (err) {
            console.warn('[addParticipant] Notification failed:', err);
        }

        res.status(201).json({
            success: true,
            message: `${userToAdd.name || userToAdd.email} added to the meeting`,
            data: { participant },
        });
    }
);

/**
 * Remove Participant - Remove a participant from a meeting
 * DELETE /api/v1/meetings/:id/participants/:participantId
 */
export const removeParticipant = asyncHandler(
    async (req: Request, res: Response, next: NextFunction): Promise<void> => {
        if (!req.user) {
            throw new AuthorizationError('Authentication required');
        }

        const id = getParamId(req.params.id);
        const participantId = getParamId(req.params.participantId);

        const meeting = await prisma.meeting.findUnique({
            where: { id },
            select: { id: true, createdById: true },
        });

        if (!meeting) {
            throw new NotFoundError('Meeting');
        }

        if (meeting.createdById !== req.user.id && req.user.role !== 'admin') {
            throw new AuthorizationError('Only the meeting organizer can remove participants');
        }

        const participant = await prisma.meetingParticipant.findUnique({
            where: { id: participantId },
            select: { id: true, role: true, userId: true },
        });

        if (!participant) {
            throw new NotFoundError('Participant');
        }

        if (participant.role === 'organizer') {
            throw new BadRequestError('Cannot remove the meeting organizer');
        }

        await prisma.meetingParticipant.delete({ where: { id: participantId } });

        res.status(200).json({
            success: true,
            message: 'Participant removed',
        });
    }
);

const confirmTaskSchema = z.object({
    id: z.string(),
    title: z.string().min(2).max(200),
    description: z.string().max(4000).optional().default(''),
    assignedToId: z.string().nullable().optional(),
    priority: z.enum(['low', 'medium', 'high']).optional().default('medium'),
    dueDate: z.string().datetime().nullable().optional(),
});

const confirmMeetingSchema = z.object({
    tasks: z.array(confirmTaskSchema),
    minutesOfMeeting: z.string().optional(),
    deleteTaskIds: z.array(z.string()).optional().default([]),
});

/**
 * Confirm Meeting Tasks - Admin confirms/edits extracted tasks and MoM
 * POST /api/v1/meetings/:id/confirm
 */
export const confirmMeetingTasks = asyncHandler(
    async (req: Request, res: Response, next: NextFunction): Promise<void> => {
        if (!req.user) {
            throw new AuthorizationError('Authentication required');
        }

        const id = getParamId(req.params.id);
        const { tasks, minutesOfMeeting, deleteTaskIds } = confirmMeetingSchema.parse(req.body);

        const meeting = await prisma.meeting.findUnique({
            where: { id },
            select: {
                id: true,
                title: true,
                createdById: true,
                workspaceId: true,
                participants: {
                    select: { userId: true, role: true },
                },
            },
        });

        if (!meeting) {
            throw new NotFoundError('Meeting');
        }

        // Check access
        const isCreator = meeting.createdById === req.user.id;
        const isAdmin = req.user.role === 'admin';
        const isOrganizer = meeting.participants.some(
            (p) => p.userId === req.user!.id && p.role === 'organizer'
        );

        if (!isCreator && !isAdmin && !isOrganizer) {
            if (meeting.workspaceId) {
                const role = await workspaceService.getUserRole(meeting.workspaceId, req.user.id);
                if (role !== 'admin') {
                    throw new AuthorizationError('Only meeting organizers or workspace admins can confirm tasks');
                }
            } else {
                throw new AuthorizationError('Only the meeting creator can confirm tasks');
            }
        }

        // Delete removed tasks
        if (deleteTaskIds.length > 0) {
            await prisma.task.deleteMany({
                where: {
                    id: { in: deleteTaskIds },
                    meetingId: id,
                    isConfirmed: false,
                },
            });
        }

        // Update/confirm each task in a transaction
        const confirmedTasks = await prisma.$transaction(
            tasks.map((task) =>
                prisma.task.update({
                    where: { id: task.id },
                    data: {
                        title: task.title,
                        description: task.description,
                        assignedToId: task.assignedToId !== undefined ? task.assignedToId : undefined,
                        priority: task.priority,
                        dueDate: task.dueDate ? new Date(task.dueDate) : task.dueDate === null ? null : undefined,
                        isConfirmed: true,
                        status: 'pending',
                    },
                    include: {
                        assignedTo: {
                            select: { id: true, name: true, email: true },
                        },
                    },
                })
            )
        );

        // Update meeting MoM if provided
        if (minutesOfMeeting !== undefined) {
            await prisma.meeting.update({
                where: { id },
                data: { minutesOfMeeting },
            });
        }

        // Post-confirmation: calendar events + emails (best-effort, non-blocking)
        const meetingTitle = meeting.title;
        const backendUrl = process.env.FRONTEND_URL || 'http://localhost:5173';

        for (const task of confirmedTasks) {
            const assignee = task.assignedTo;
            if (!assignee) continue;

            // Send task assignment email
            try {
                await sendTaskAssignmentEmail({
                    to: assignee.email,
                    assigneeName: assignee.name || assignee.email,
                    taskTitle: task.title,
                    dueDate: task.dueDate?.toISOString() ?? null,
                    meetingTitle,
                    taskLink: `${backendUrl}/tasks/${task.id}`,
                });
            } catch (emailErr) {
                console.error(`[ConfirmTasks] Email failed for task=${task.id}:`, emailErr);
            }

            // Add to Google Calendar if user has connected it
            if (task.dueDate) {
                try {
                    const calEvent = await createTaskCalendarEvent({
                        userId: assignee.id,
                        taskId: task.id,
                        title: task.title,
                        description: task.description || undefined,
                        dueDate: task.dueDate.toISOString(),
                    });

                    // Store the calendar event ID on the task
                    await prisma.task.update({
                        where: { id: task.id },
                        data: { calendarEventId: calEvent.eventId },
                    });
                } catch (calErr) {
                    // Calendar not configured is expected — log and skip
                    console.info(`[ConfirmTasks] Calendar skip task=${task.id}: ${(calErr as Error).message}`);
                }
            }

            // Create in-app notification in Redis
            try {
                const notifKey = `notifications:user:${assignee.id}`;
                const existing = (await getJSON<any[]>(notifKey)) || [];
                const notification = {
                    id: `notif_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
                    type: 'task-assignment',
                    title: 'New Task Assigned',
                    message: `You have been assigned: "${task.title}"${task.dueDate ? ` — due ${new Date(task.dueDate).toLocaleDateString()}` : ''}`,
                    taskId: task.id,
                    meetingTitle,
                    createdAt: new Date().toISOString(),
                    read: false,
                };
                const updated = [notification, ...existing].slice(0, 200);
                await setJSON(notifKey, updated, 60 * 60 * 24 * 30);
            } catch (notifErr) {
                console.error(`[ConfirmTasks] In-app notification failed user=${assignee.id}:`, notifErr);
            }
        }

        res.status(200).json({
            success: true,
            message: `${confirmedTasks.length} task(s) confirmed. Notifications and emails sent.`,
            data: {
                confirmedCount: confirmedTasks.length,
                tasks: confirmedTasks,
            },
        });
    }
);
