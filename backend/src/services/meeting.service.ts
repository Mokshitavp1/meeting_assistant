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
import { queueTaskExtractionJob } from '../jobs/task-extraction.job';

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

    const meeting = await prisma.meeting.findUnique({
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

    const audioPath = meeting.recordingPath || meeting.recordingUrl || '';

    // Check if real AI credentials exist for transcription
    const hasAssemblyAI = !!(
        process.env.ASSEMBLYAI_API_KEY &&
        !process.env.ASSEMBLYAI_API_KEY.includes('your-') &&
        process.env.ASSEMBLYAI_API_KEY.length > 10
    );

    if (hasAssemblyAI) {
        // Real path: queue transcription → AI extraction pipeline
        await queueTranscriptionJob({ meetingId, audioFilePath: audioPath });
        console.log(`[AI Processing] Queued transcription job for meeting ${meetingId}`);
    } else {
        // Dev fallback: skip transcription, generate synthetic MoM + task stubs
        console.log(`[AI Processing] No AssemblyAI key — running dev fallback for meeting ${meetingId}`);
        await runDevFallbackProcessing(meetingId);
    }
}

/**
 * Dev-mode fallback: generate placeholder MoM and extract tasks via OpenAI/Anthropic
 * (or produce sample stubs if those keys are also absent).
 */
async function runDevFallbackProcessing(meetingId: string): Promise<void> {
    const meeting = await prisma.meeting.findUnique({
        where: { id: meetingId },
        select: {
            id: true, title: true,
            participants: {
                select: {
                    userId: true,
                    user: { select: { id: true, name: true, email: true } },
                },
            },
        },
    });
    if (!meeting) return;

    const now = new Date().toISOString();
    const participants = meeting.participants;
    const participantNames = participants.map((p) => p.user.name || p.user.email).join(', ');

    // Use actual participant names in the synthetic transcript
    const nameAt = (index: number) =>
        participants[index]?.user.name ||
        participants[index]?.user.email ||
        ['Facilitator', 'Member A', 'Member B'][index] ||
        `Participant ${index + 1}`;

    const p0 = nameAt(0);
    const p1 = nameAt(1);
    const p2 = nameAt(2);

    const syntheticTranscript = [
        `[Meeting: ${meeting.title} | ${now}]`,
        `Participants: ${participantNames || 'Unknown'}`,
        '',
        `${p0}: Let's discuss the project timeline and assign responsibilities.`,
        `${p1}: I will handle the backend API integration by end of next week.`,
        `${p0}: Great. I'll prepare the design mockups by Wednesday.`,
        `${p2}: I can review the designs on Thursday and provide feedback.`,
        `${p0}: Perfect. ${p1}, please also write unit tests for the new endpoints.`,
        `${p1}: Sure, I'll have those done by Friday.`,
        `${p0}: Let's set up a follow-up meeting next Monday to review progress.`,
    ].join('\n');

    const minutesOfMeeting = [
        `# Minutes of Meeting — ${meeting.title}`,
        `**Date:** ${new Date().toLocaleDateString()}`,
        `**Participants:** ${participantNames || 'Unknown'}`,
        '',
        '## Discussion',
        '- Reviewed project timeline and assigned responsibilities.',
        '- Agreed on design and backend deliverables.',
        '- Scheduled a follow-up review meeting.',
        '',
        '## Action Items',
        `- Backend API integration (${p1}) — due end of next week`,
        `- Design mockups (${p0}) — due Wednesday`,
        `- Design review and feedback (${p2}) — due Thursday`,
        `- Unit tests for new endpoints (${p1}) — due Friday`,
        `- Follow-up meeting (${p0}) — next Monday`,
    ].join('\n');

    // Update meeting with synthetic minutes
    await prisma.meeting.update({
        where: { id: meetingId },
        data: {
            transcriptUrl: `internal://dev-fallback/${meetingId}`,
            minutesOfMeeting,
            summary: 'AI generated minutes (dev fallback — no AssemblyAI key configured).',
        },
    });

    // Check if OpenAI/Anthropic is available for real task extraction
    const hasOpenAI = !!(
        process.env.OPENAI_API_KEY &&
        !process.env.OPENAI_API_KEY.includes('your-') &&
        process.env.OPENAI_API_KEY.startsWith('sk-')
    );
    const hasAnthropic = !!(
        process.env.ANTHROPIC_API_KEY &&
        !process.env.ANTHROPIC_API_KEY.includes('your-') &&
        process.env.ANTHROPIC_API_KEY.startsWith('sk-ant-')
    );

    if (hasOpenAI || hasAnthropic) {
        // Use real AI to extract tasks from the synthetic transcript
        await queueTaskExtractionJob({ meetingId, transcript: syntheticTranscript });
    } else {
        // Full dev fallback: create sample tasks directly in DB
        console.log(`[AI Processing] No AI keys — creating sample tasks for meeting ${meetingId}`);
        const UNCONFIRMED = '[UNCONFIRMED_AI_TASK]';

        // Map first few participants to tasks
        const sampleTasks = [
            {
                title: 'Complete backend API integration',
                description: `${UNCONFIRMED} Implement and test the backend API endpoints as discussed.`,
                assignedToId: participants[1]?.userId || participants[0]?.userId || null,
                dueDate: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
                priority: 'high' as const,
            },
            {
                title: 'Prepare design mockups',
                description: `${UNCONFIRMED} Create UI/UX design mockups for review.`,
                assignedToId: participants[0]?.userId || null,
                dueDate: new Date(Date.now() + 3 * 24 * 60 * 60 * 1000),
                priority: 'medium' as const,
            },
            {
                title: 'Write unit tests for new endpoints',
                description: `${UNCONFIRMED} Cover all new API endpoints with unit tests.`,
                assignedToId: participants[1]?.userId || null,
                dueDate: new Date(Date.now() + 5 * 24 * 60 * 60 * 1000),
                priority: 'medium' as const,
            },
        ];

        await prisma.$transaction(
            sampleTasks.map((task) =>
                prisma.task.create({
                    data: {
                        meetingId,
                        title: task.title,
                        description: task.description,
                        assignedToId: task.assignedToId,
                        dueDate: task.dueDate,
                        status: 'pending',
                        priority: task.priority,
                        isConfirmed: false,
                    },
                })
            )
        );
        console.log(`[AI Processing] Created ${sampleTasks.length} sample tasks for meeting ${meetingId}`);
    }
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
