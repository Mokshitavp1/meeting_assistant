import { Queue, Worker, QueueEvents, JobsOptions, Job } from 'bullmq';
import { prisma } from '../config/database';
import { redisClient } from '../config/redis';
import { NotFoundError, BadRequestError } from '../middleware/error.middleware';
import { transcribeAudio } from '../services/transcription.service';

export interface TranscriptionJobData {
    meetingId: string;
    audioFilePath: string;
}

export interface AIExtractionJobData {
    meetingId: string;
    transcript: string;
}

export interface TranscriptionJobResult {
    meetingId: string;
    transcriptLength: number;
    aiJobId: string;
}

const TRANSCRIPTION_QUEUE_NAME = 'transcription-queue';
const AI_EXTRACTION_QUEUE_NAME = 'ai-task-extraction-queue';

const DEFAULT_TRANSCRIPTION_JOB_OPTIONS: JobsOptions = {
    attempts: 3,
    backoff: {
        type: 'exponential',
        delay: 5000,
    },
    removeOnComplete: 100,
    removeOnFail: 300,
};

const DEFAULT_AI_EXTRACTION_JOB_OPTIONS: JobsOptions = {
    attempts: 3,
    backoff: {
        type: 'exponential',
        delay: 5000,
    },
    removeOnComplete: 200,
    removeOnFail: 500,
};

let transcriptionQueue: Queue<TranscriptionJobData, TranscriptionJobResult> | null = null;
let transcriptionWorker: Worker<TranscriptionJobData, TranscriptionJobResult> | null = null;
let transcriptionQueueEvents: QueueEvents | null = null;
let aiExtractionQueue: Queue<AIExtractionJobData> | null = null;

function validateJobData(payload: TranscriptionJobData): void {
    if (!payload.meetingId?.trim()) {
        throw new BadRequestError('meetingId is required for transcription job');
    }

    if (!payload.audioFilePath?.trim()) {
        throw new BadRequestError('audioFilePath is required for transcription job');
    }
}

async function processTranscriptionJob(
    job: Job<TranscriptionJobData, TranscriptionJobResult>
): Promise<TranscriptionJobResult> {
    const { meetingId, audioFilePath } = job.data;

    validateJobData(job.data);

    console.log(
        `[TranscriptionJob] Started job=${job.id} meeting=${meetingId} attempt=${job.attemptsMade + 1}`
    );

    await job.updateProgress(5);

    const meeting = await prisma.meeting.findUnique({
        where: { id: meetingId },
        select: {
            id: true,
            participants: {
                select: {
                    user: { select: { id: true, name: true, email: true } },
                },
            },
        },
    });

    if (!meeting) {
        throw new NotFoundError('Meeting');
    }

    await job.updateProgress(20);

    const transcriptionResult = await transcribeAudio(audioFilePath);
    const rawTranscriptText = transcriptionResult.fullTranscript?.trim();

    if (!rawTranscriptText) {
        throw new Error('Transcription service returned empty transcript');
    }

    // Build a speaker-labeled transcript from utterances when available.
    // AssemblyAI returns Speaker A, Speaker B, etc. We include the participant
    // list as a header so the AI can map anonymous speakers to real names.
    const participantNames = meeting.participants
        .map((p) => p.user.name || p.user.email)
        .filter(Boolean);

    let enrichedTranscript: string;
    if (transcriptionResult.utterances && transcriptionResult.utterances.length > 0) {
        const speakerLines = transcriptionResult.utterances
            .map((u) => `${u.speaker}: ${u.text}`)
            .join('\n');

        const participantSection = participantNames.length
            ? `Meeting participants (map speakers to these names using context clues):\n${participantNames.map((n) => `- ${n}`).join('\n')}\n\n`
            : '';

        enrichedTranscript = `${participantSection}Transcript:\n${speakerLines}`;
    } else {
        // Fallback: plain text with participant header
        const participantSection = participantNames.length
            ? `Meeting participants:\n${participantNames.map((n) => `- ${n}`).join('\n')}\n\n`
            : '';
        enrichedTranscript = `${participantSection}Transcript:\n${rawTranscriptText}`;
    }

    await job.updateProgress(60);

    await prisma.meeting.update({
        where: { id: meetingId },
        data: {
            transcriptPath: audioFilePath,
            transcriptUrl: `internal://transcripts/${meetingId}`,
            minutesOfMeeting: rawTranscriptText,
        },
    });

    await job.updateProgress(80);

    if (!aiExtractionQueue) {
        aiExtractionQueue = new Queue<AIExtractionJobData>(AI_EXTRACTION_QUEUE_NAME, {
            connection: redisClient,
            defaultJobOptions: DEFAULT_AI_EXTRACTION_JOB_OPTIONS,
        });
    }

    const aiJob = await aiExtractionQueue.add(
        'extract-tasks-from-transcript',
        {
            meetingId,
            transcript: enrichedTranscript,
        }
    );

    const aiJobId = String(aiJob.id);

    await job.updateProgress(100);

    console.log(
        `[TranscriptionJob] Completed job=${job.id} meeting=${meetingId} aiJob=${aiJobId}`
    );

    return {
        meetingId,
        transcriptLength: rawTranscriptText.length,
        aiJobId,
    };
}

export async function initializeTranscriptionQueue(): Promise<void> {
    if (!transcriptionQueue) {
        transcriptionQueue = new Queue<TranscriptionJobData, TranscriptionJobResult>(
            TRANSCRIPTION_QUEUE_NAME,
            {
                connection: redisClient,
                defaultJobOptions: DEFAULT_TRANSCRIPTION_JOB_OPTIONS,
            }
        );
    }

    if (!aiExtractionQueue) {
        aiExtractionQueue = new Queue<AIExtractionJobData>(AI_EXTRACTION_QUEUE_NAME, {
            connection: redisClient,
            defaultJobOptions: DEFAULT_AI_EXTRACTION_JOB_OPTIONS,
        });
    }

    if (!transcriptionQueueEvents) {
        transcriptionQueueEvents = new QueueEvents(TRANSCRIPTION_QUEUE_NAME, {
            connection: redisClient,
        });
    }

    if (!transcriptionWorker) {
        transcriptionWorker = new Worker<TranscriptionJobData, TranscriptionJobResult>(
            TRANSCRIPTION_QUEUE_NAME,
            async (job) => processTranscriptionJob(job),
            {
                connection: redisClient,
                concurrency: 2,
            }
        );

        transcriptionWorker.on('active', (job) => {
            console.log(
                `[TranscriptionJob] Active job=${job?.id} meeting=${job?.data?.meetingId || 'unknown'}`
            );
        });

        transcriptionWorker.on('progress', (job, progress) => {
            console.log(
                `[TranscriptionJob] Progress job=${job?.id} meeting=${job?.data?.meetingId || 'unknown'} progress=${progress}`
            );
        });

        transcriptionWorker.on('completed', (job) => {
            console.log(
                `[TranscriptionJob] Success job=${job?.id} meeting=${job?.data?.meetingId || 'unknown'}`
            );
        });

        transcriptionWorker.on('failed', (job, error) => {
            const attemptsMade = job?.attemptsMade || 0;
            const maxAttempts = job?.opts.attempts || 3;

            console.error(
                `[TranscriptionJob] Failed job=${job?.id} meeting=${job?.data?.meetingId || 'unknown'} attempts=${attemptsMade}/${maxAttempts} error=${error?.message || 'Unknown error'}`
            );

            if (attemptsMade >= maxAttempts) {
                console.error(
                    `[TranscriptionJob] Exhausted retries for job=${job?.id} meeting=${job?.data?.meetingId || 'unknown'}`
                );
            }
        });
    }
}

export async function queueTranscriptionJob(
    payload: TranscriptionJobData,
    options?: JobsOptions
): Promise<string> {
    validateJobData(payload);

    if (!transcriptionQueue) {
        await initializeTranscriptionQueue();
    }

    if (!transcriptionQueue) {
        throw new Error('Transcription queue failed to initialize');
    }

    const job = await transcriptionQueue.add('transcribe-audio', payload, {
        ...DEFAULT_TRANSCRIPTION_JOB_OPTIONS,
        ...options,
        attempts: 3,
    });

    const jobId = String(job.id);
    console.log(
        `[TranscriptionJob] Queued job=${jobId} meeting=${payload.meetingId} audio=${payload.audioFilePath}`
    );
    return jobId;
}

export async function shutdownTranscriptionQueue(): Promise<void> {
    await transcriptionWorker?.close();
    await transcriptionQueueEvents?.close();
    await transcriptionQueue?.close();
    await aiExtractionQueue?.close();

    transcriptionWorker = null;
    transcriptionQueueEvents = null;
    transcriptionQueue = null;
    aiExtractionQueue = null;
}
