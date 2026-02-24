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

        res.status(200).json({
            success: true,
            message: 'Recording uploaded successfully',
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
