import OpenAI from 'openai';
import { z } from 'zod';
import { prisma } from '../config/database';
import {
    ExternalServiceError,
    BadRequestError,
    NotFoundError,
} from '../middleware/error.middleware';
import type { StructuredTranscript } from './transcription.service';

// ─────────────────────────────────────────────────────────────────────────────
// Constants
// ─────────────────────────────────────────────────────────────────────────────

/** Maximum number of GPT retries on malformed output */
const MAX_RETRIES = 2;

/** Default minimum confidence score to include a task */
const DEFAULT_MIN_CONFIDENCE = 0.4;

/** Hard cap on tasks per extraction to prevent runaway costs */
const DEFAULT_MAX_TASKS = 50;

// ─────────────────────────────────────────────────────────────────────────────
// Public types
// ─────────────────────────────────────────────────────────────────────────────

export interface Participant {
    userId: string;
    name: string | null;
    email: string;
}

export interface ExtractedTask {
    title: string;
    description?: string;
    assigneeId: string | null;
    /** Raw name string returned by the AI, kept even if it didn't match a participant */
    assigneeName: string | null;
    dueDate: Date | null;
    priority: 'low' | 'medium' | 'high';
    confidence: number;
    status: 'pending';
}

export interface ExtractionResult {
    tasks: ExtractedTask[];
    /** One-line meeting summary produced by the AI in the same request */
    summary: string;
    /** Total raw task count before confidence filtering */
    totalExtracted: number;
    /** How many tasks were dropped due to low confidence */
    skippedLowConfidence: number;
}

export interface ExtractionOptions {
    meetingId: string;
    /** Tasks below this confidence score are dropped. Default: 0.4 */
    minConfidence?: number;
    /** Cap on how many tasks can be returned. Default: 50 */
    maxTasks?: number;
    /** Whether to persist the extracted tasks to the database. Default: true */
    saveToDB?: boolean;
    /**
     * Reference date used to resolve relative deadlines like "next Friday".
     * Defaults to the current date if omitted.
     */
    meetingDate?: Date;
}

// ─────────────────────────────────────────────────────────────────────────────
// Zod schemas
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Schema for a single task as returned by the AI.
 * Fields are kept permissive here — we tighten them during post-processing.
 */
const RawTaskSchema = z.object({
    title: z.string().min(1, 'title cannot be empty'),
    description: z.string().optional().default(''),
    assignee: z.union([z.string(), z.null()]).optional().default(null),
    deadline: z.union([z.string(), z.null()]).optional().default(null),
    priority: z
        .enum(['low', 'medium', 'high'])
        .catch('medium'),   // gracefully map unknown values to medium
    confidence: z
        .number()
        .min(0)
        .max(1)
        .catch(0.5),        // default if missing or out of range
});

const AIResponseSchema = z.object({
    tasks: z.array(RawTaskSchema).default([]),
    summary: z.string().optional().default(''),
});

type RawTask = z.infer<typeof RawTaskSchema>;
type AIResponse = z.infer<typeof AIResponseSchema>;

// ─────────────────────────────────────────────────────────────────────────────
// OpenAI client — lazy singleton
// ─────────────────────────────────────────────────────────────────────────────

let _openai: OpenAI | null = null;

function getOpenAIClient(): OpenAI {
    if (!_openai) {
        const apiKey = process.env.OPENAI_API_KEY;
        if (!apiKey) {
            throw new ExternalServiceError('OpenAI', 'OPENAI_API_KEY is not configured.');
        }
        _openai = new OpenAI({ apiKey });
    }
    return _openai;
}

// ─────────────────────────────────────────────────────────────────────────────
// Prompt construction
// ─────────────────────────────────────────────────────────────────────────────

function buildParticipantBlock(participants: Participant[]): string {
    if (participants.length === 0) return '(no participants listed)';
    return participants
        .map((p) => `- ${p.name ?? 'Unknown'} <${p.email}>`)
        .join('\n');
}

/**
 * System-level instructions. Returned separately so the retry path can
 * keep the same system prompt while appending correction messages to the
 * conversation.
 */
function getSystemPrompt(): string {
    return `You are a precise meeting action-item extractor.
Your sole job is to read a meeting transcript and return a single JSON object containing all concrete tasks and a brief summary.

## Extraction rules

1. Extract ONLY explicit commitments — things a person said they would do, or was clearly asked to do.
2. Do NOT invent or infer tasks not stated in the transcript.
3. Set "assignee" to the exact name from the participants list below. If the person is not listed, use the name as spoken. Set to null if nobody was assigned.
4. Parse all deadlines to ISO 8601 date (YYYY-MM-DD). Resolve relative expressions ("next Friday", "end of week", "by Monday") relative to the meeting date that will be provided. Set to null if no deadline was mentioned.
5. Priority assignment:
   - "high"   → urgent / critical / ASAP / by EOD / by tomorrow
   - "low"    → whenever / eventually / low priority / nice to have
   - "medium" → everything else
6. Confidence score (0.0 – 1.0):
   - 0.9 – 1.0: Explicit commitment, clear owner, clear deadline
   - 0.7 – 0.89: Clear task, clear owner, no deadline
   - 0.5 – 0.69: Clear task, owner uncertain or inferred from context
   - 0.3 – 0.49: Implied task or soft commitment
   - < 0.3: Speculative — omit unless the task is clearly important

## Output format

Return ONLY a valid JSON object. No markdown, no code fences, no explanation.

{
  "tasks": [
    {
      "title": "<short imperative phrase, e.g. 'Send Q3 report to stakeholders'>",
      "description": "<any extra context or sub-steps, empty string if none>",
      "assignee": "<name from participants list, spoken name, or null>",
      "deadline": "<YYYY-MM-DD or null>",
      "priority": "low|medium|high",
      "confidence": <0.0 – 1.0>
    }
  ],
  "summary": "<1-2 sentences: key decisions and outcomes of the meeting>"
}`;
}

function buildUserPrompt(
    transcriptText: string,
    participants: Participant[],
    meetingDate?: Date
): string {
    const dateStr = (meetingDate ?? new Date()).toISOString().split('T')[0];

    return `Meeting date: ${dateStr}

## Participants
${buildParticipantBlock(participants)}

## Transcript
${transcriptText}

Extract all action items from this transcript.`;
}

// ─────────────────────────────────────────────────────────────────────────────
// Response parsing
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Parses a raw string from GPT into a validated AIResponse.
 * On schema mismatch, attempts item-by-item salvage before throwing.
 */
function parseAIResponse(raw: string): AIResponse {
    // ── 1. JSON parse ─────────────────────────────────────────────────────────
    let parsed: unknown;
    try {
        parsed = JSON.parse(raw);
    } catch {
        // Strip accidental markdown code fences and retry
        const fenceMatch = raw.match(/```(?:json)?\s*([\s\S]+?)\s*```/);
        if (fenceMatch) {
            try {
                parsed = JSON.parse(fenceMatch[1]);
            } catch {
                throw new BadRequestError(
                    'AI returned malformed JSON inside a code fence.',
                    { preview: raw.slice(0, 300) }
                );
            }
        } else {
            throw new BadRequestError(
                'AI returned non-JSON output.',
                { preview: raw.slice(0, 300) }
            );
        }
    }

    // ── 2. Zod validation ─────────────────────────────────────────────────────
    const result = AIResponseSchema.safeParse(parsed);
    if (result.success) return result.data;

    // ── 3. Partial salvage: validate task items individually ──────────────────
    const rawObj = parsed as Record<string, unknown>;
    if (Array.isArray(rawObj?.tasks)) {
        const salvaged: RawTask[] = [];
        for (const item of rawObj.tasks) {
            const itemResult = RawTaskSchema.safeParse(item);
            if (itemResult.success) salvaged.push(itemResult.data);
        }
        if (salvaged.length > 0) {
            console.warn(
                `[AI Extraction] Partial salvage: kept ${salvaged.length}/${rawObj.tasks.length} tasks after schema mismatch.`
            );
            return {
                tasks: salvaged,
                summary: typeof rawObj.summary === 'string' ? rawObj.summary : '',
            };
        }
    }

    throw new BadRequestError(
        'AI response did not match the expected schema.',
        result.error.flatten()
    );
}

// ─────────────────────────────────────────────────────────────────────────────
// GPT call with retry
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Calls GPT with the extraction prompt. On a parse failure, appends a
 * correction turn to the conversation and retries up to MAX_RETRIES times.
 */
async function callGPTWithRetry(
    systemPrompt: string,
    userPrompt: string
): Promise<AIResponse> {
    const model = process.env.OPENAI_EXTRACTION_MODEL ?? 'gpt-4o';

    const messages: OpenAI.Chat.ChatCompletionMessageParam[] = [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt },
    ];

    let lastError: Error = new Error('No attempts made');

    for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
        let raw: string;

        try {
            const response = await getOpenAIClient().chat.completions.create({
                model,
                messages,
                response_format: { type: 'json_object' },
                temperature: 0.2,       // low temperature for deterministic structure
                max_tokens: 4096,
            });

            raw = response.choices[0]?.message?.content ?? '';
            if (!raw.trim()) {
                throw new ExternalServiceError('OpenAI', 'GPT returned an empty response.');
            }
        } catch (err: any) {
            // Non-retryable: rate limit or auth failure
            if (err?.status === 429) {
                throw new ExternalServiceError('OpenAI', 'Rate limit exceeded. Please retry later.');
            }
            if (err?.status === 401) {
                throw new ExternalServiceError('OpenAI', 'Invalid API key.');
            }
            if (err instanceof ExternalServiceError) throw err;

            lastError = err;
            break;
        }

        // Try to parse
        try {
            return parseAIResponse(raw);
        } catch (parseErr: any) {
            lastError = parseErr;

            if (attempt < MAX_RETRIES - 1) {
                // Append a correction turn so GPT can self-correct with full context
                messages.push(
                    { role: 'assistant', content: raw },
                    {
                        role: 'user',
                        content:
                            'Your response could not be parsed as valid JSON matching the required schema. ' +
                            'Return ONLY the JSON object — no markdown, no explanation, no code fences.',
                    }
                );
                console.warn(`[AI Extraction] Parse failure on attempt ${attempt + 1}, retrying…`);
            }
        }
    }

    throw lastError;
}

// ─────────────────────────────────────────────────────────────────────────────
// Date parsing
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Converts the AI's deadline string into a Date.
 *
 * Handles:
 *   - ISO dates: "2025-08-15"
 *   - ISO datetimes: "2025-08-15T09:00:00Z"
 *   - Anything JS Date can parse: "August 15", "15 Aug 2025"
 *
 * Returns null for null input or unparseable strings.
 */
function parseDeadline(raw: string | null | undefined): Date | null {
    if (!raw) return null;

    const trimmed = raw.trim();

    // Strict ISO date (most common from GPT)
    if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) {
        const d = new Date(`${trimmed}T00:00:00.000Z`);
        if (!isNaN(d.getTime())) return d;
    }

    // ISO datetime or any other JS-parseable format
    const d = new Date(trimmed);
    if (!isNaN(d.getTime())) return d;

    console.warn(`[AI Extraction] Could not parse deadline: "${trimmed}"`);
    return null;
}

// ─────────────────────────────────────────────────────────────────────────────
// Assignee matching
// ─────────────────────────────────────────────────────────────────────────────

function normalizeForMatch(s: string): string {
    return s.toLowerCase().replace(/[^a-z0-9\s]/g, '').trim();
}

/**
 * Fuzzy-matches `rawName` (from AI output) against `participants`.
 *
 * Matching strategy (highest score wins):
 *   1. Exact normalised match against display name or email prefix
 *   2. Token overlap: all tokens in `rawName` found in participant name (or vice-versa)
 *   3. Email prefix containment
 *
 * Returns null if no match reaches the 0.5 threshold.
 */
function matchAssignee(
    rawName: string | null | undefined,
    participants: Participant[]
): { userId: string; name: string | null } | null {
    if (!rawName || participants.length === 0) return null;

    const normalizedQuery = normalizeForMatch(rawName);
    const queryTokens = normalizedQuery.split(/\s+/).filter(Boolean);

    let bestMatch: { participant: Participant; score: number } | null = null;

    for (const p of participants) {
        const displayName = normalizeForMatch(p.name ?? '');
        const emailPrefix = normalizeForMatch(p.email.split('@')[0]);
        const nameTokens = displayName.split(/\s+/).filter(Boolean);

        // 1. Exact match on display name or email prefix
        if (displayName === normalizedQuery || emailPrefix === normalizedQuery) {
            return { userId: p.userId, name: p.name };
        }

        // 2. Token overlap score
        const overlapping = queryTokens.filter((t) => nameTokens.includes(t)).length;
        if (overlapping > 0) {
            const score = overlapping / Math.max(queryTokens.length, nameTokens.length);
            if (!bestMatch || score > bestMatch.score) {
                bestMatch = { participant: p, score };
            }
        }

        // 3. Email prefix containment (e.g. "alice" matches "alice.smith@co.com")
        if (
            emailPrefix.includes(normalizedQuery) ||
            normalizedQuery.includes(emailPrefix)
        ) {
            const score = 0.6;
            if (!bestMatch || score > bestMatch.score) {
                bestMatch = { participant: p, score };
            }
        }
    }

    if (bestMatch && bestMatch.score >= 0.5) {
        return { userId: bestMatch.participant.userId, name: bestMatch.participant.name };
    }

    return null;
}

// ─────────────────────────────────────────────────────────────────────────────
// Database persistence
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Writes extracted tasks to the database and links them to the meeting.
 * Skips tasks whose titles are already saved for this meeting (idempotent).
 */
export async function persistTasks(
    tasks: ExtractedTask[],
    meetingId: string
): Promise<void> {
    if (tasks.length === 0) return;

    // Fetch existing task titles for this meeting to avoid duplicates
    const existing = await prisma.task.findMany({
        where: { meetingId },
        select: { title: true },
    });
    const existingTitles = new Set(existing.map((t) => t.title.toLowerCase()));

    const toCreate = tasks.filter(
        (t) => !existingTitles.has(t.title.toLowerCase())
    );

    if (toCreate.length === 0) return;

    await prisma.task.createMany({
        data: toCreate.map((t) => ({
            title: t.title,
            description: t.description ?? null,
            meetingId,
            assignedToId: t.assigneeId,
            status: 'pending',
            priority: t.priority,
            dueDate: t.dueDate,
            isAiGenerated: true,
        })),
    });
}

// ─────────────────────────────────────────────────────────────────────────────
// Public API
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Extract structured tasks from a transcript.
 *
 * Callers must already have the participant list; use `extractAndSaveTasks`
 * for the version that loads participants from the database automatically.
 *
 * @param transcript  Full-text string or a `StructuredTranscript` object
 * @param participants Meeting participants used for assignee matching
 * @param options     Extraction settings (thresholds, persistence flag, etc.)
 */
export async function extractTasksFromTranscript(
    transcript: string | StructuredTranscript,
    participants: Participant[],
    options: ExtractionOptions
): Promise<ExtractionResult> {
    const {
        meetingId,
        minConfidence = DEFAULT_MIN_CONFIDENCE,
        maxTasks = DEFAULT_MAX_TASKS,
        saveToDB = true,
        meetingDate,
    } = options;

    // Normalise transcript input
    const transcriptText =
        typeof transcript === 'string' ? transcript : transcript.fullText;

    if (!transcriptText.trim()) {
        throw new BadRequestError('Transcript text is empty — nothing to extract from.');
    }

    // ── Build prompts and call GPT ─────────────────────────────────────────
    const systemPrompt = getSystemPrompt();
    const userPrompt = buildUserPrompt(transcriptText, participants, meetingDate);
    const aiResponse = await callGPTWithRetry(systemPrompt, userPrompt);

    // ── Process raw task list ──────────────────────────────────────────────
    const cappedRaw = aiResponse.tasks.slice(0, maxTasks);
    const skippedByCap = aiResponse.tasks.length - cappedRaw.length;

    const extracted: ExtractedTask[] = [];
    let skippedLowConfidence = skippedByCap;

    for (const raw of cappedRaw) {
        if (raw.confidence < minConfidence) {
            skippedLowConfidence++;
            continue;
        }

        const matched = matchAssignee(raw.assignee, participants);
        const dueDate = parseDeadline(raw.deadline);

        extracted.push({
            title: raw.title.trim(),
            description: raw.description?.trim() || undefined,
            assigneeId: matched?.userId ?? null,
            assigneeName: matched?.name ?? raw.assignee ?? null,
            dueDate,
            priority: raw.priority,
            confidence: raw.confidence,
            status: 'pending',
        });
    }

    // ── Persist ────────────────────────────────────────────────────────────
    if (saveToDB && extracted.length > 0) {
        await persistTasks(extracted, meetingId);
    }

    return {
        tasks: extracted,
        summary: aiResponse.summary ?? '',
        totalExtracted: aiResponse.tasks.length,
        skippedLowConfidence,
    };
}

/**
 * Convenience wrapper that loads meeting participants from the database
 * before delegating to `extractTasksFromTranscript`.
 *
 * Also persists the AI-generated summary back to the meeting row.
 *
 * @param transcript  Full-text string or a `StructuredTranscript` object
 * @param options     Extraction options (meetingId is required)
 */
export async function extractAndSaveTasks(
    transcript: string | StructuredTranscript,
    options: ExtractionOptions
): Promise<ExtractionResult> {
    const { meetingId } = options;

    // Verify meeting exists
    const meeting = await prisma.meeting.findUnique({
        where: { id: meetingId },
        select: { id: true, scheduledStartTime: true },
    });
    if (!meeting) throw new NotFoundError('Meeting');

    // Resolve meetingDate from DB if not provided
    const meetingDate = options.meetingDate ?? meeting.scheduledStartTime;

    // Load participants
    const rows = await prisma.meetingParticipant.findMany({
        where: { meetingId },
        include: {
            user: { select: { id: true, name: true, email: true } },
        },
    });

    const participants: Participant[] = rows.map((r) => ({
        userId: r.user.id,
        name: r.user.name,
        email: r.user.email,
    }));

    const result = await extractTasksFromTranscript(transcript, participants, {
        ...options,
        meetingDate,
    });

    // Persist the summary generated alongside task extraction
    if (result.summary) {
        await prisma.meeting.update({
            where: { id: meetingId },
            data: { summary: result.summary },
        });
    }

    return result;
}
