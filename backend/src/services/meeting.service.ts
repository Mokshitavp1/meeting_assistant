import { prisma } from '../config/database';
import { S3Client, PutObjectCommand, DeleteObjectCommand, GetObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import fs from 'fs/promises';
import path from 'path';
import {
    NotFoundError,
    AuthorizationError,
    BadRequestError,
} from '../middleware/error.middleware';
import * as workspaceService from './workspace.service';
import { queueTranscriptionJob } from '../jobs/transcription.job';

/**
 * Meeting Service
 * Handles business logic for meeting management, file storage, and AI processing
 */

/**
 * Type Definitions
 */

interface CreateMeetingData {
    title: string;
    description?: string;
    workspaceId?: string;
    scheduledStartTime: Date;
    scheduledEndTime?: Date;
    createdById: string;
    participantIds?: string[];
}

interface UpdateMeetingData {
    title?: string;
    description?: string;
    scheduledStartTime?: Date;
    scheduledEndTime?: Date;
    status?: 'scheduled' | 'in_progress' | 'completed' | 'cancelled';
}

interface MeetingWithDetails {
    id: string;
    title: string;
    description?: string | null;
    workspaceId?: string | null;
    scheduledStartTime: Date;
    scheduledEndTime?: Date | null;
    actualStartTime?: Date | null;
    actualEndTime?: Date | null;
    duration?: number | null;
    status: string;
    recordingUrl?: string | null;
    transcriptUrl?: string | null;
    summary?: string | null;
    minutesOfMeeting?: string | null;
    createdById: string;
    createdAt: Date;
    updatedAt: Date;
    participants: any[];
    tasks: any[];
    workspace?: any;
    createdBy: any;
}

interface UploadRecordingData {
    meetingId: string;
    filePath: string;
    filename: string;
    mimetype: string;
    size: number;
}

interface AIProcessingJob {
    meetingId: string;
    recordingPath: string;
    recordingUrl: string;
}

/**
 * S3 Client Configuration
 */

const s3Client = new S3Client({
    region: process.env.AWS_REGION || 'us-east-1',
    credentials: {
        accessKeyId: process.env.AWS_ACCESS_KEY_ID || '',
        secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY || '',
    },
});

const S3_BUCKET = process.env.AWS_S3_BUCKET || 'meeting-recordings';
const UPLOAD_EXPIRATION = 3600; // 1 hour for signed URLs

/**
 * Job Queue (Placeholder - can be replaced with BullMQ or similar)
 */

class JobQueue {
    async add(jobName: string, data: any): Promise<void> {
        console.log(`[JobQueue] Adding job: ${jobName}`, data);
        // TODO: Implement actual job queue (e.g., BullMQ, Agenda, etc.)
        // For now, this is a placeholder that logs the job
        // In production, this would add jobs to Redis-backed queue
    }
}

const processingQueue = new JobQueue();

/**
 * Helper Functions
 */

/**
 * Upload file to S3
 */
async function uploadToS3(
    filePath: string,
    key: string,
    mimetype: string
): Promise<string> {
    try {
        // Read file from local path
        const fileContent = await fs.readFile(filePath);

        // Upload to S3
        const command = new PutObjectCommand({
            Bucket: S3_BUCKET,
            Key: key,
            Body: fileContent,
            ContentType: mimetype,
        });

        await s3Client.send(command);

        // Generate public URL (or signed URL if bucket is private)
        const url = `https://${S3_BUCKET}.s3.${process.env.AWS_REGION || 'us-east-1'}.amazonaws.com/${key}`;

        return url;
    } catch (error) {
        console.error('Error uploading to S3:', error);
        throw new Error('Failed to upload file to cloud storage');
    }
}

/**
 * Delete file from S3
 */
async function deleteFromS3(key: string): Promise<void> {
    try {
        const command = new DeleteObjectCommand({
            Bucket: S3_BUCKET,
            Key: key,
        });

        await s3Client.send(command);
    } catch (error) {
        console.error('Error deleting from S3:', error);
        // Don't throw - file deletion is best-effort
    }
}

/**
 * Generate S3 key for recording
 */
function generateS3Key(meetingId: string, filename: string): string {
    const timestamp = Date.now();
    const ext = path.extname(filename);
    return `recordings/${meetingId}/${timestamp}${ext}`;
}

/**
 * Get signed URL for private S3 object
 */
async function getSignedS3Url(key: string, expiresIn: number = UPLOAD_EXPIRATION): Promise<string> {
    try {
        const command = new GetObjectCommand({
            Bucket: S3_BUCKET,
            Key: key,
        });

        const url = await getSignedUrl(s3Client, command, { expiresIn });
        return url;
    } catch (error) {
        console.error('Error generating signed URL:', error);
        throw new Error('Failed to generate download URL');
    }
}

/**
 * Verify user has access to meeting
 */
async function verifyMeetingAccess(meetingId: string, userId: string): Promise<void> {
    const meeting = await prisma.meeting.findUnique({
        where: { id: meetingId },
        select: { workspaceId: true, createdById: true },
    });

    if (!meeting) {
        throw new NotFoundError('Meeting');
    }

    // If meeting is in a workspace, check workspace membership
    if (meeting.workspaceId) {
        const isMember = await workspaceService.isWorkspaceMember(meeting.workspaceId, userId);
        if (!isMember) {
            throw new AuthorizationError('You do not have access to this meeting');
        }
    } else {
        // Personal meeting - only creator and participants can access
        const isCreatorOrParticipant = await prisma.meeting.findFirst({
            where: {
                id: meetingId,
                OR: [
                    { createdById: userId },
                    { participants: { some: { userId } } },
                ],
            },
        });

        if (!isCreatorOrParticipant) {
            throw new AuthorizationError('You do not have access to this meeting');
        }
    }
}

/**
 * Service Functions
 */

/**
 * Create meeting with participants
 */
export async function createMeeting(data: CreateMeetingData): Promise<any> {
    const {
        title,
        description,
        workspaceId,
        scheduledStartTime,
        scheduledEndTime,
        createdById,
        participantIds = [],
    } = data;

    // If workspace specified, verify membership
    if (workspaceId) {
        await workspaceService.verifyWorkspaceAccess(workspaceId, createdById);
    }

    // Create meeting with participants
    const meeting = await prisma.meeting.create({
        data: {
            title,
            description,
            workspaceId,
            scheduledStartTime,
            scheduledEndTime,
            status: 'scheduled',
            createdById,
            participants: {
                create: [
                    // Creator as organizer
                    {
                        userId: createdById,
                        role: 'organizer',
                    },
                    // Additional participants
                    ...participantIds
                        .filter((id) => id !== createdById)
                        .map((userId) => ({
                            userId,
                            role: 'participant',
                        })),
                ],
            },
        },
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
        },
    });

    return meeting;
}

/**
 * Get meeting by ID with all related data
 */
export async function getMeetingWithDetails(
    meetingId: string,
    userId: string
): Promise<MeetingWithDetails> {
    // Verify access
    await verifyMeetingAccess(meetingId, userId);

    const meeting = await prisma.meeting.findUnique({
        where: { id: meetingId },
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
                    joinedAt: true,
                    leftAt: true,
                    user: {
                        select: {
                            id: true,
                            name: true,
                            email: true,
                        },
                    },
                },
                orderBy: {
                    role: 'desc', // Organizers first
                },
            },
            workspace: {
                select: {
                    id: true,
                    name: true,
                    description: true,
                },
            },
            tasks: {
                where: {
                    isConfirmed: true,
                },
                select: {
                    id: true,
                    title: true,
                    description: true,
                    status: true,
                    priority: true,
                    dueDate: true,
                    assignedTo: {
                        select: {
                            id: true,
                            name: true,
                            email: true,
                        },
                    },
                    createdAt: true,
                },
                orderBy: {
                    createdAt: 'asc',
                },
            },
        },
    });

    if (!meeting) {
        throw new NotFoundError('Meeting');
    }

    return meeting as MeetingWithDetails;
}

/**
 * Update meeting status with validation
 */
export async function updateMeetingStatus(
    meetingId: string,
    newStatus: 'scheduled' | 'in_progress' | 'completed' | 'cancelled',
    userId: string
): Promise<any> {
    // Verify access
    await verifyMeetingAccess(meetingId, userId);

    const meeting = await (prisma.meeting as any).findUnique({
        where: { id: meetingId },
    });

    if (!meeting) {
        throw new NotFoundError('Meeting');
    }

    // Validate status transitions
    const currentStatus = meeting.status;

    if (currentStatus === 'completed' && newStatus !== 'completed') {
        throw new BadRequestError('Cannot change status of a completed meeting');
    }

    if (currentStatus === 'cancelled' && newStatus !== 'cancelled') {
        throw new BadRequestError('Cannot change status of a cancelled meeting');
    }

    if (newStatus === 'in_progress' && currentStatus === 'in_progress') {
        throw new BadRequestError('Meeting is already in progress');
    }

    if (newStatus === 'completed' && currentStatus === 'completed') {
        throw new BadRequestError('Meeting is already completed');
    }

    // Prepare update data
    const updateData: any = { status: newStatus };

    if (newStatus === 'in_progress' && !meeting.actualStartTime) {
        updateData.actualStartTime = new Date();
    }

    if (newStatus === 'completed') {
        const actualStartTime = meeting.actualStartTime || meeting.scheduledStartTime;
        const actualEndTime = new Date();
        const duration = Math.round(
            (actualEndTime.getTime() - actualStartTime.getTime()) / (1000 * 60)
        );

        updateData.actualEndTime = actualEndTime;
        updateData.duration = duration;
    }

    // Update meeting
    const updatedMeeting = await prisma.meeting.update({
        where: { id: meetingId },
        data: updateData,
        include: {
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
        },
    });

    return updatedMeeting;
}

/**
 * Upload recording to S3 and update meeting
 */
export async function uploadRecording(
    data: UploadRecordingData,
    userId: string
): Promise<{ recordingUrl: string; filename: string; size: number }> {
    const { meetingId, filePath, filename, mimetype, size } = data;

    // Verify access
    await verifyMeetingAccess(meetingId, userId);

    const meeting = await prisma.meeting.findUnique({
        where: { id: meetingId },
    });

    if (!meeting) {
        throw new NotFoundError('Meeting');
    }

    const awsKeyId = process.env.AWS_ACCESS_KEY_ID || '';
    const hasAwsCredentials = !!(
        awsKeyId &&
        (awsKeyId.startsWith('AKIA') || awsKeyId.startsWith('ASIA')) &&
        process.env.AWS_SECRET_ACCESS_KEY &&
        !process.env.AWS_SECRET_ACCESS_KEY.includes('your-') &&
        process.env.AWS_S3_BUCKET &&
        !process.env.AWS_S3_BUCKET.includes('your-')
    );

    let recordingUrl: string;

    if (hasAwsCredentials) {
        // Delete old recording from S3 if exists
        if (meeting.recordingPath && meeting.recordingPath.includes('.amazonaws.com/')) {
            const oldKey = meeting.recordingPath.replace(`https://${S3_BUCKET}.s3.${process.env.AWS_REGION || 'us-east-1'}.amazonaws.com/`, '');
            await deleteFromS3(oldKey);
        }

        // Generate S3 key and upload
        const s3Key = generateS3Key(meetingId, filename);
        recordingUrl = await uploadToS3(filePath, s3Key, mimetype);

        // Delete local file after successful S3 upload
        try {
            await fs.unlink(filePath);
        } catch (error) {
            console.error('Error deleting local file:', error);
        }
    } else {
        // No S3 credentials — serve local file directly
        // Normalize path separators (Windows uses backslashes)
        const normalizedPath = filePath.replace(/\\/g, '/');
        const relativePath = normalizedPath.startsWith('./')
            ? normalizedPath.slice(1) // './uploads/recordings/x' → '/uploads/recordings/x'
            : normalizedPath.startsWith('uploads/')
                ? '/' + normalizedPath // 'uploads/recordings/x' → '/uploads/recordings/x'
                : normalizedPath;
        const baseUrl = process.env.BACKEND_URL || `http://localhost:${process.env.PORT || 4000}`;
        recordingUrl = `${baseUrl}${relativePath}`;
        console.log(`[uploadRecording] No AWS credentials — using local URL: ${recordingUrl}`);
    }

    // Update meeting with recording URL
    await prisma.meeting.update({
        where: { id: meetingId },
        data: {
            recordingPath: recordingUrl,
            recordingUrl: recordingUrl,
        },
    });

    return {
        recordingUrl,
        filename,
        size,
    };
}

/**
 * Delete meeting and associated files
 */
export async function deleteMeeting(meetingId: string, userId: string): Promise<void> {
    const meeting = await prisma.meeting.findUnique({
        where: { id: meetingId },
    });

    if (!meeting) {
        throw new NotFoundError('Meeting');
    }

    // Only creator can delete
    if (meeting.createdById !== userId) {
        throw new AuthorizationError('Only the meeting creator can delete the meeting');
    }

    // Delete recording from S3 if exists
    if (meeting.recordingPath) {
        const s3Key = meeting.recordingPath.replace(`https://${S3_BUCKET}.s3.${process.env.AWS_REGION || 'us-east-1'}.amazonaws.com/`, '');
        await deleteFromS3(s3Key);
    }

    // Delete transcript from S3 if exists
    if (meeting.transcriptPath) {
        const s3Key = meeting.transcriptPath.replace(`https://${S3_BUCKET}.s3.${process.env.AWS_REGION || 'us-east-1'}.amazonaws.com/`, '');
        await deleteFromS3(s3Key);
    }

    // Delete meeting (cascade will delete participants and tasks)
    await prisma.meeting.delete({
        where: { id: meetingId },
    });
}

/**
 * Trigger AI processing workflow for meeting
 */
export async function triggerAIProcessing(meetingId: string, userId: string): Promise<void> {
    // Verify access
    await verifyMeetingAccess(meetingId, userId);

    const meeting = await prisma.meeting.findUnique({
        where: { id: meetingId },
    });

    if (!meeting) {
        throw new NotFoundError('Meeting');
    }

    if (!meeting.recordingPath && !meeting.recordingUrl) {
        throw new BadRequestError('No recording found. Upload a recording first.');
    }

    // Idempotency guard: use aiExtractionStatus, not task count.
    // This correctly handles the edge case where a user deletes all confirmed
    // tasks and tries to re-trigger — the status persists regardless of tasks.
    if (meeting.aiExtractionStatus !== 'pending') {
        console.log(`[AI Processing] Meeting ${meetingId} already has aiExtractionStatus='${meeting.aiExtractionStatus}' — skipping duplicate trigger.`);
        return;
    }

    // Mark as processing immediately to prevent concurrent duplicate triggers
    await (prisma.meeting as any).update({
        where: { id: meetingId },
        data: { aiExtractionStatus: 'processing' },
    });

    const audioPath = meeting.recordingPath || meeting.recordingUrl || '';
    const assemblyAIKey = process.env.ASSEMBLYAI_API_KEY?.trim();

    if (!assemblyAIKey || assemblyAIKey === 'your_key_here' || assemblyAIKey.includes('your-')) {
        // Reset status so the user can retry immediately after fixing .env
        await (prisma.meeting as any).update({
            where: { id: meetingId },
            data: { aiExtractionStatus: 'pending' },
        });
        throw new Error(
            'ASSEMBLYAI_API_KEY is missing. Add it to .env to process meetings.'
        );
    }

    // Real path: queue transcription → AI extraction pipeline
    await queueTranscriptionJob({ meetingId, audioFilePath: audioPath });
    console.log(`[AI Processing] Queued transcription job for meeting ${meetingId}`);
}

/**
 * Process meeting with AI (called by background job)
 * This is a placeholder - actual implementation would use OpenAI Whisper, GPT, etc.
 */
export async function processMeetingWithAI(jobData: AIProcessingJob): Promise<void> {
    const { meetingId, recordingPath, recordingUrl } = jobData;

    try {
        console.log(`[AI Processing] Starting processing for meeting ${meetingId}`);

        // TODO: Step 1 - Transcribe audio using OpenAI Whisper or similar
        // const transcription = await transcribeAudio(recordingUrl);

        // TODO: Step 2 - Extract action items/tasks using GPT
        // const tasks = await extractTasks(transcription);

        // TODO: Step 3 - Generate meeting summary and minutes
        // const summary = await generateSummary(transcription);
        // const minutes = await generateMinutes(transcription);

        // Placeholder data
        const transcription = 'Transcription will be generated here...';
        const summary = 'AI-generated summary will appear here...';
        const minutes = 'AI-generated minutes of meeting will appear here...';

        // Update meeting with AI-generated content
        await prisma.meeting.update({
            where: { id: meetingId },
            data: {
                transcriptUrl: 'transcript-url-placeholder',
                summary,
                minutesOfMeeting: minutes,
            },
        });

        // TODO: Create tasks from extracted action items
        // for (const task of tasks) {
        //     await prisma.task.create({
        //         data: {
        //             title: task.title,
        //             description: task.description,
        //             meetingId,
        //             priority: task.priority,
        //             dueDate: task.dueDate,
        //         },
        //     });
        // }

        console.log(`[AI Processing] Completed for meeting ${meetingId}`);
    } catch (error) {
        console.error(`[AI Processing] Error processing meeting ${meetingId}:`, error);
        throw error;
    }
}

/**
 * Update meeting details
 */
export async function updateMeeting(
    meetingId: string,
    data: UpdateMeetingData,
    userId: string
): Promise<any> {
    // Verify access
    await verifyMeetingAccess(meetingId, userId);

    // Check if user is creator or organizer
    const meeting = await prisma.meeting.findUnique({
        where: { id: meetingId },
        include: {
            participants: {
                where: { userId },
            },
        },
    });

    if (!meeting) {
        throw new NotFoundError('Meeting');
    }

    const isCreator = meeting.createdById === userId;
    const isOrganizer = meeting.participants.some((p) => p.role === 'organizer');

    if (!isCreator && !isOrganizer) {
        throw new AuthorizationError('Only meeting creator or organizers can update the meeting');
    }

    // Update meeting
    const updatedMeeting = await prisma.meeting.update({
        where: { id: meetingId },
        data,
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

    return updatedMeeting;
}

/**
 * Add participant to meeting
 */
export async function addParticipant(
    meetingId: string,
    participantUserId: string,
    role: 'organizer' | 'participant' = 'participant',
    requesterId: string
): Promise<any> {
    // Verify requester has access
    await verifyMeetingAccess(meetingId, requesterId);

    // Check if requester is creator or organizer
    const meeting = await prisma.meeting.findUnique({
        where: { id: meetingId },
        include: {
            participants: {
                where: { userId: requesterId },
            },
        },
    });

    if (!meeting) {
        throw new NotFoundError('Meeting');
    }

    const isCreator = meeting.createdById === requesterId;
    const isOrganizer = meeting.participants.some((p) => p.role === 'organizer');

    if (!isCreator && !isOrganizer) {
        throw new AuthorizationError('Only meeting creator or organizers can add participants');
    }

    // Check if participant already exists
    const existingParticipant = await prisma.meetingParticipant.findUnique({
        where: {
            meetingId_userId: {
                meetingId,
                userId: participantUserId,
            },
        },
    });

    if (existingParticipant) {
        throw new BadRequestError('User is already a participant in this meeting');
    }

    // Add participant
    const participant = await prisma.meetingParticipant.create({
        data: {
            meetingId,
            userId: participantUserId,
            role,
        },
        include: {
            user: {
                select: {
                    id: true,
                    name: true,
                    email: true,
                },
            },
        },
    });

    return participant;
}

/**
 * Remove participant from meeting
 */
export async function removeParticipant(
    meetingId: string,
    participantId: string,
    requesterId: string
): Promise<void> {
    // Verify requester has access
    await verifyMeetingAccess(meetingId, requesterId);

    const meeting = await prisma.meeting.findUnique({
        where: { id: meetingId },
        include: {
            participants: true,
        },
    });

    if (!meeting) {
        throw new NotFoundError('Meeting');
    }

    const isCreator = meeting.createdById === requesterId;
    const requesterParticipant = meeting.participants.find((p) => p.userId === requesterId);
    const isOrganizer = requesterParticipant?.role === 'organizer';

    if (!isCreator && !isOrganizer) {
        throw new AuthorizationError('Only meeting creator or organizers can remove participants');
    }

    // Cannot remove the creator
    const participant = await prisma.meetingParticipant.findUnique({
        where: { id: participantId },
    });

    if (!participant) {
        throw new NotFoundError('Participant');
    }

    if (participant.userId === meeting.createdById) {
        throw new BadRequestError('Cannot remove the meeting creator');
    }

    // Delete participant
    await prisma.meetingParticipant.delete({
        where: { id: participantId },
    });
}
