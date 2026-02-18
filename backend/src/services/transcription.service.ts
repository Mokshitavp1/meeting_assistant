import OpenAI from 'openai';
import fs from 'fs';
import fsp from 'fs/promises';
import path from 'path';
import os from 'os';
import { exec } from 'child_process';
import { promisify } from 'util';
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import { prisma } from '../config/database';
import {
    ExternalServiceError,
    NotFoundError,
    BadRequestError,
} from '../middleware/error.middleware';

const execAsync = promisify(exec);

// ─────────────────────────────────────────────────────────────────────────────
// Constants
// ─────────────────────────────────────────────────────────────────────────────

/** OpenAI hard limit is 25 MB; use 24 MB to be safe */
const WHISPER_MAX_BYTES = 24 * 1024 * 1024;

/** Duration of each ffmpeg chunk when splitting a large file */
const CHUNK_DURATION_SECONDS = 600; // 10 minutes

const SUPPORTED_FORMATS = new Set([
    '.mp3', '.mp4', '.mpeg', '.mpga', '.m4a',
    '.wav', '.webm', '.ogg', '.flac',
]);

/** AssemblyAI polling: up to 10 min in 5-second intervals */
const ASSEMBLYAI_MAX_POLLS = 120;
const ASSEMBLYAI_POLL_INTERVAL_MS = 5_000;

// ─────────────────────────────────────────────────────────────────────────────
// Public types
// ─────────────────────────────────────────────────────────────────────────────

export type TranscriptionProvider = 'whisper' | 'assemblyai';

export interface TranscriptionOptions {
    meetingId: string;
    /** ISO-639-1 language code, e.g. 'en'. Whisper auto-detects if omitted. */
    language?: string;
    /** Enable speaker diarization. Automatically routes to AssemblyAI. */
    enableDiarization?: boolean;
    /** Override the provider. Defaults to 'whisper'. */
    provider?: TranscriptionProvider;
    /** Optional context hint to improve Whisper accuracy (e.g. domain jargon). */
    prompt?: string;
}

export interface TranscriptWord {
    word: string;
    start: number;       // seconds
    end: number;         // seconds
    confidence?: number; // 0–1
    speaker?: string;    // e.g. "SPEAKER_0"
}

export interface TranscriptSegment {
    id: number;
    start: number;
    end: number;
    text: string;
    speaker?: string;
    confidence?: number;
    words?: TranscriptWord[];
}

export interface StructuredTranscript {
    meetingId: string;
    duration: number;          // seconds
    language: string;
    fullText: string;
    segments: TranscriptSegment[];
    words: TranscriptWord[];
    speakers: string[];        // unique labels, e.g. ["SPEAKER_A", "SPEAKER_B"]
    provider: TranscriptionProvider;
    transcriptUrl?: string;    // S3 URL if stored
    createdAt: Date;
}

// ─────────────────────────────────────────────────────────────────────────────
// Internal Whisper types
// ─────────────────────────────────────────────────────────────────────────────

interface WhisperWord {
    word: string;
    start: number;
    end: number;
    probability: number;
}

interface WhisperSegment {
    id: number;
    start: number;
    end: number;
    text: string;
    avg_logprob?: number;
    no_speech_prob?: number;
    words?: WhisperWord[];
}

interface WhisperVerboseResponse {
    task: string;
    language: string;
    duration: number;
    text: string;
    segments: WhisperSegment[];
}

// ─────────────────────────────────────────────────────────────────────────────
// OpenAI client (lazy – only fails at runtime if key is missing)
// ─────────────────────────────────────────────────────────────────────────────

let _openai: OpenAI | null = null;

function getOpenAIClient(): OpenAI {
    if (!_openai) {
        const apiKey = process.env.OPENAI_API_KEY;
        if (!apiKey) {
            throw new ExternalServiceError('OPENAI_API_KEY is not configured.');
        }
        _openai = new OpenAI({ apiKey });
    }
    return _openai;
}

// ─────────────────────────────────────────────────────────────────────────────
// File utilities
// ─────────────────────────────────────────────────────────────────────────────

function validateAudioFormat(filePath: string): void {
    const ext = path.extname(filePath).toLowerCase();
    if (!SUPPORTED_FORMATS.has(ext)) {
        throw new BadRequestError(
            `Unsupported audio format "${ext}". Supported: ${[...SUPPORTED_FORMATS].join(', ')}`
        );
    }
}

async function assertFileExists(filePath: string): Promise<void> {
    try {
        await fsp.access(filePath, fs.constants.R_OK);
    } catch {
        throw new NotFoundError(`Audio file at path: ${filePath}`);
    }
}

async function getFileSize(filePath: string): Promise<number> {
    const stat = await fsp.stat(filePath);
    return stat.size;
}

// ─────────────────────────────────────────────────────────────────────────────
// ffmpeg helpers
// ─────────────────────────────────────────────────────────────────────────────

async function isFfmpegAvailable(): Promise<boolean> {
    try {
        await execAsync('ffmpeg -version');
        return true;
    } catch {
        return false;
    }
}

/**
 * Returns the total audio duration in seconds via ffprobe.
 * Returns 0 if ffprobe is unavailable or the file is unreadable.
 */
async function getAudioDuration(filePath: string): Promise<number> {
    try {
        const { stdout } = await execAsync(
            `ffprobe -v quiet -print_format json -show_streams "${filePath}"`
        );
        const info = JSON.parse(stdout) as { streams: Array<{ codec_type: string; duration?: string }> };
        const audio = info.streams.find((s) => s.codec_type === 'audio');
        return parseFloat(audio?.duration ?? '0');
    } catch {
        return 0;
    }
}

/**
 * Splits `filePath` into sequential chunks of at most `chunkDurationSeconds`
 * each, written to a temp directory. Returns the array of chunk file paths.
 *
 * The caller is responsible for deleting chunks via `cleanupChunks()`.
 */
async function chunkAudioFile(
    filePath: string,
    chunkDurationSeconds: number = CHUNK_DURATION_SECONDS
): Promise<string[]> {
    if (!(await isFfmpegAvailable())) {
        throw new ExternalServiceError(
            'ffmpeg is required to process audio files larger than 24 MB. ' +
            'Install ffmpeg and ensure it is available in PATH.'
        );
    }

    const totalDuration = await getAudioDuration(filePath);
    if (totalDuration === 0) {
        throw new BadRequestError(
            'Could not determine audio duration. The file may be corrupted or use an unrecognised codec.'
        );
    }

    const tmpDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'whisper-chunk-'));
    const ext = path.extname(filePath).toLowerCase();
    const chunkPaths: string[] = [];

    let startTime = 0;
    let index = 0;

    while (startTime < totalDuration) {
        const chunkPath = path.join(tmpDir, `chunk-${index}${ext}`);
        // -c copy avoids re-encoding so it's fast; keyframe boundaries may cause
        // slight overlap at cut points, which Whisper handles gracefully.
        await execAsync(
            `ffmpeg -y -i "${filePath}" -ss ${startTime} -t ${chunkDurationSeconds} -c copy "${chunkPath}"`
        );
        chunkPaths.push(chunkPath);
        startTime += chunkDurationSeconds;
        index++;
    }

    return chunkPaths;
}

async function cleanupChunks(chunkPaths: string[]): Promise<void> {
    for (const p of chunkPaths) {
        try { await fsp.unlink(p); } catch { /* best-effort */ }
    }
    if (chunkPaths.length > 0) {
        try { await fsp.rmdir(path.dirname(chunkPaths[0])); } catch { /* best-effort */ }
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// Whisper transcription
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Calls the Whisper API for a single file that is already within limits.
 * Applies `timeOffset` to all timestamps so chunks can be merged correctly.
 */
async function callWhisperAPI(
    filePath: string,
    opts: { language?: string; prompt?: string; timeOffset?: number }
): Promise<WhisperVerboseResponse> {
    const { language, prompt, timeOffset = 0 } = opts;

    let response: WhisperVerboseResponse;
    try {
        const raw = await getOpenAIClient().audio.transcriptions.create({
            file: fs.createReadStream(filePath),
            model: 'whisper-1',
            response_format: 'verbose_json',
            timestamp_granularities: ['segment', 'word'],
            ...(language && { language }),
            ...(prompt && { prompt }),
        });
        // The verbose_json shape is not fully reflected in the SDK's type yet
        response = raw as unknown as WhisperVerboseResponse;
    } catch (err: any) {
        const status: number = err?.status ?? 0;
        if (status === 429) {
            throw new ExternalServiceError('OpenAI Whisper rate limit exceeded. Please retry later.');
        }
        if (status === 413) {
            throw new BadRequestError('Audio chunk is still too large for the Whisper API (max 25 MB).');
        }
        if (status === 400) {
            throw new BadRequestError(`Whisper rejected the request: ${err?.message ?? 'invalid request'}`);
        }
        throw new ExternalServiceError(`Whisper API error: ${err?.message ?? 'unknown'}`);
    }

    // Shift timestamps for non-zero offsets (chunked files)
    if (timeOffset > 0) {
        response.segments = response.segments.map((seg) => ({
            ...seg,
            start: seg.start + timeOffset,
            end: seg.end + timeOffset,
            words: seg.words?.map((w) => ({
                ...w,
                start: w.start + timeOffset,
                end: w.end + timeOffset,
            })),
        }));
    }

    return response;
}

/**
 * Full Whisper pipeline. Chunks the file with ffmpeg if it exceeds 24 MB,
 * then merges results into a single flat list of segments and words.
 */
async function transcribeWithWhisper(
    filePath: string,
    opts: Pick<TranscriptionOptions, 'language' | 'prompt'>
): Promise<{
    segments: TranscriptSegment[];
    words: TranscriptWord[];
    language: string;
    duration: number;
    fullText: string;
}> {
    const fileSize = await getFileSize(filePath);
    const rawSegments: WhisperSegment[] = [];
    let language = opts.language ?? 'en';
    let duration = 0;
    let fullText = '';
    let chunkPaths: string[] = [];

    try {
        if (fileSize <= WHISPER_MAX_BYTES) {
            const result = await callWhisperAPI(filePath, opts);
            rawSegments.push(...result.segments);
            language = result.language;
            duration = result.duration;
            fullText = result.text;
        } else {
            console.log(
                `[Transcription] File is ${(fileSize / 1024 / 1024).toFixed(1)} MB — splitting into chunks.`
            );
            chunkPaths = await chunkAudioFile(filePath);

            let idOffset = 0;
            let timeOffset = 0;

            for (const chunkPath of chunkPaths) {
                const result = await callWhisperAPI(chunkPath, { ...opts, timeOffset });

                rawSegments.push(
                    ...result.segments.map((s) => ({ ...s, id: s.id + idOffset }))
                );
                fullText += (fullText ? ' ' : '') + result.text.trim();
                duration += result.duration;
                timeOffset += result.duration;
                idOffset += result.segments.length;

                // Trust the language detected from the first chunk
                if (timeOffset === result.duration) language = result.language;
            }
        }
    } finally {
        await cleanupChunks(chunkPaths);
    }

    // Map to structured types
    const segments: TranscriptSegment[] = rawSegments.map((s) => ({
        id: s.id,
        start: s.start,
        end: s.end,
        text: s.text.trim(),
        confidence: s.avg_logprob !== undefined ? Math.exp(s.avg_logprob) : undefined,
        words: s.words?.map((w) => ({
            word: w.word,
            start: w.start,
            end: w.end,
            confidence: w.probability,
        })),
    }));

    const words: TranscriptWord[] = segments.flatMap((s) => s.words ?? []);

    return { segments, words, language, duration, fullText };
}

// ─────────────────────────────────────────────────────────────────────────────
// AssemblyAI transcription (speaker diarization)
// ─────────────────────────────────────────────────────────────────────────────

async function pollAssemblyAI(id: string, apiKey: string): Promise<any> {
    for (let i = 0; i < ASSEMBLYAI_MAX_POLLS; i++) {
        await new Promise((r) => setTimeout(r, ASSEMBLYAI_POLL_INTERVAL_MS));

        const res = await fetch(`https://api.assemblyai.com/v2/transcript/${id}`, {
            headers: { authorization: apiKey },
        });

        if (!res.ok) {
            throw new ExternalServiceError(`AssemblyAI polling failed (${res.status}): ${res.statusText}`);
        }

        const data = (await res.json()) as { status: string; error?: string };

        if (data.status === 'completed') return data;
        if (data.status === 'error') {
            throw new ExternalServiceError(`AssemblyAI processing error: ${data.error ?? 'unknown'}`);
        }
        // status is 'queued' or 'processing' — continue polling
    }
    throw new ExternalServiceError(
        `AssemblyAI transcription timed out after ${(ASSEMBLYAI_MAX_POLLS * ASSEMBLYAI_POLL_INTERVAL_MS) / 60_000} minutes.`
    );
}

/**
 * Transcribes audio using AssemblyAI. Requires a publicly reachable URL
 * (e.g. an S3 pre-signed URL or the meeting's recordingUrl).
 * Supports speaker diarization natively.
 */
async function transcribeWithAssemblyAI(
    audioUrl: string,
    opts: Pick<TranscriptionOptions, 'language' | 'enableDiarization'>
): Promise<{
    segments: TranscriptSegment[];
    words: TranscriptWord[];
    language: string;
    duration: number;
    fullText: string;
    speakers: string[];
}> {
    const apiKey = process.env.ASSEMBLYAI_API_KEY;
    if (!apiKey) {
        throw new ExternalServiceError(
            'ASSEMBLYAI_API_KEY is not configured. Set it in your environment to enable speaker diarization.'
        );
    }

    // ── 1. Submit job ─────────────────────────────────────────────────────────
    const submitRes = await fetch('https://api.assemblyai.com/v2/transcript', {
        method: 'POST',
        headers: { authorization: apiKey, 'content-type': 'application/json' },
        body: JSON.stringify({
            audio_url: audioUrl,
            speaker_labels: opts.enableDiarization ?? true,
            language_code: opts.language ?? undefined,
            punctuate: true,
            format_text: true,
        }),
    });

    if (!submitRes.ok) {
        const body = (await submitRes.json().catch(() => ({}))) as { error?: string };
        throw new ExternalServiceError(
            `AssemblyAI job submission failed (${submitRes.status}): ${body.error ?? submitRes.statusText}`
        );
    }

    const { id } = (await submitRes.json()) as { id: string };

    // ── 2. Poll until complete ────────────────────────────────────────────────
    const result = await pollAssemblyAI(id, apiKey);

    // ── 3. Map utterances (speaker-aware segments) ────────────────────────────
    const speakerSet = new Set<string>();

    // AssemblyAI returns `utterances` when speaker_labels is true;
    // falls back to paragraphs otherwise.
    const rawSegments: any[] = result.utterances ?? result.paragraphs?.paragraphs ?? [];

    const segments: TranscriptSegment[] = rawSegments.map((utt: any, idx: number) => {
        const speaker = utt.speaker != null ? `SPEAKER_${utt.speaker}` : undefined;
        if (speaker) speakerSet.add(speaker);

        return {
            id: idx,
            start: utt.start / 1_000,   // ms ➜ seconds
            end: utt.end / 1_000,
            text: utt.text,
            speaker,
            confidence: utt.confidence,
            words: utt.words?.map((w: any) => ({
                word: w.text,
                start: w.start / 1_000,
                end: w.end / 1_000,
                confidence: w.confidence,
                speaker: w.speaker != null ? `SPEAKER_${w.speaker}` : undefined,
            })),
        };
    });

    // ── 4. Flat word list ─────────────────────────────────────────────────────
    const words: TranscriptWord[] = (result.words ?? []).map((w: any) => ({
        word: w.text,
        start: w.start / 1_000,
        end: w.end / 1_000,
        confidence: w.confidence,
        speaker: w.speaker != null ? `SPEAKER_${w.speaker}` : undefined,
    }));

    return {
        segments,
        words,
        language: result.language_code ?? opts.language ?? 'en',
        duration: result.audio_duration ?? 0,
        fullText: result.text ?? '',
        speakers: [...speakerSet].sort(),
    };
}

// ─────────────────────────────────────────────────────────────────────────────
// S3 storage
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Uploads the transcript JSON to S3 (if configured) and updates the meeting
 * row with the resulting URL. Returns the URL on success, undefined otherwise.
 */
async function persistTranscript(
    meetingId: string,
    transcript: StructuredTranscript
): Promise<string | undefined> {
    const bucket = process.env.AWS_S3_BUCKET;
    const accessKeyId = process.env.AWS_ACCESS_KEY_ID;

    if (bucket && accessKeyId) {
        try {
            const s3 = new S3Client({
                region: process.env.AWS_REGION ?? 'us-east-1',
                credentials: {
                    accessKeyId,
                    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY ?? '',
                },
            });

            const key = `transcripts/${meetingId}/transcript-${Date.now()}.json`;
            await s3.send(
                new PutObjectCommand({
                    Bucket: bucket,
                    Key: key,
                    Body: JSON.stringify(transcript, null, 2),
                    ContentType: 'application/json',
                })
            );

            const transcriptUrl = `https://${bucket}.s3.${process.env.AWS_REGION ?? 'us-east-1'}.amazonaws.com/${key}`;

            await prisma.meeting.update({
                where: { id: meetingId },
                data: { transcriptUrl },
            });

            return transcriptUrl;
        } catch (err) {
            console.error('[Transcription] S3 upload failed, skipping remote storage:', err);
        }
    }

    // Fallback: store the plain text inline so getTranscript() always has something
    const inlineUrl = `data:text/plain,${encodeURIComponent(transcript.fullText)}`;
    await prisma.meeting.update({
        where: { id: meetingId },
        data: { transcriptUrl: inlineUrl },
    });

    return undefined;
}

// ─────────────────────────────────────────────────────────────────────────────
// Public API
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Transcribe audio from a local file path or a public URL.
 *
 * Provider selection rules:
 *  - `enableDiarization: true` → AssemblyAI (requires `ASSEMBLYAI_API_KEY`)
 *  - `provider: 'assemblyai'`  → AssemblyAI
 *  - everything else           → OpenAI Whisper (requires `OPENAI_API_KEY`)
 *
 * Large files (> 24 MB) are split with ffmpeg before being sent to Whisper.
 * AssemblyAI accepts a URL directly, so chunking is not needed for that path.
 *
 * @param input  Local file path (Whisper) or public HTTPS URL (AssemblyAI)
 * @param options Transcription options including meetingId (required)
 */
export async function transcribeAudio(
    input: string,
    options: TranscriptionOptions
): Promise<StructuredTranscript> {
    const {
        meetingId,
        language,
        enableDiarization = false,
        provider = 'whisper',
        prompt,
    } = options;

    // Verify the meeting exists before doing any expensive work
    const meeting = await prisma.meeting.findUnique({ where: { id: meetingId } });
    if (!meeting) throw new NotFoundError('Meeting');

    const isUrl = /^https?:\/\//i.test(input);
    const useAssemblyAI = enableDiarization || provider === 'assemblyai';

    let segments: TranscriptSegment[];
    let words: TranscriptWord[];
    let detectedLanguage: string;
    let duration: number;
    let fullText: string;
    let speakers: string[];
    let usedProvider: TranscriptionProvider;

    // ── Whisper path ──────────────────────────────────────────────────────────
    if (!useAssemblyAI) {
        if (isUrl) {
            throw new BadRequestError(
                'OpenAI Whisper requires a local file path. ' +
                'Pass provider: "assemblyai" to transcribe from a URL.'
            );
        }

        validateAudioFormat(input);
        await assertFileExists(input);

        const result = await transcribeWithWhisper(input, { language, prompt });
        ({ segments, words, language: detectedLanguage, duration, fullText } = result);
        speakers = [];
        usedProvider = 'whisper';

        // ── AssemblyAI path ───────────────────────────────────────────────────────
    } else {
        // AssemblyAI needs a reachable URL; use the meeting's cloud URL if a
        // local path was provided.
        let audioUrl = input;
        if (!isUrl) {
            if (!meeting.recordingUrl) {
                throw new BadRequestError(
                    'Speaker diarization requires a public audio URL. ' +
                    'Upload the recording to cloud storage first, or provide a URL directly.'
                );
            }
            audioUrl = meeting.recordingUrl;
        }

        const result = await transcribeWithAssemblyAI(audioUrl, { language, enableDiarization });
        ({ segments, words, language: detectedLanguage, duration, fullText, speakers } = result);
        usedProvider = 'assemblyai';
    }

    // ── Build and persist structured transcript ───────────────────────────────
    const transcript: StructuredTranscript = {
        meetingId,
        duration,
        language: detectedLanguage,
        fullText,
        segments,
        words,
        speakers,
        provider: usedProvider,
        createdAt: new Date(),
    };

    const transcriptUrl = await persistTranscript(meetingId, transcript);
    if (transcriptUrl) transcript.transcriptUrl = transcriptUrl;

    return transcript;
}

/**
 * Retrieve the stored transcript for a meeting.
 *
 * - If an S3 URL is stored, fetches and parses the full JSON.
 * - If the fallback `data:text/plain` URL is stored, reconstructs a minimal
 *   transcript object so callers always receive the same shape.
 * - Returns `null` if no transcript exists yet.
 */
export async function getTranscript(meetingId: string): Promise<StructuredTranscript | null> {
    const meeting = await prisma.meeting.findUnique({
        where: { id: meetingId },
        select: { transcriptUrl: true },
    });

    if (!meeting?.transcriptUrl) return null;

    // Inline plain-text fallback
    if (meeting.transcriptUrl.startsWith('data:text/plain,')) {
        const fullText = decodeURIComponent(
            meeting.transcriptUrl.replace('data:text/plain,', '')
        );
        return {
            meetingId,
            duration: 0,
            language: 'en',
            fullText,
            segments: [{ id: 0, start: 0, end: 0, text: fullText }],
            words: [],
            speakers: [],
            provider: 'whisper',
            createdAt: new Date(),
        };
    }

    // Fetch full JSON from S3
    try {
        const res = await fetch(meeting.transcriptUrl);
        if (!res.ok) {
            throw new ExternalServiceError(
                `Failed to fetch transcript from storage (${res.status}): ${res.statusText}`
            );
        }
        return (await res.json()) as StructuredTranscript;
    } catch (err: any) {
        if (err instanceof ExternalServiceError) throw err;
        throw new ExternalServiceError(`Could not retrieve transcript: ${err?.message ?? 'unknown'}`);
    }
}
