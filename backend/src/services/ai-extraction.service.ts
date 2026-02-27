import { z } from 'zod';
import { BadRequestError, ExternalServiceError } from '../middleware/error.middleware';

export type AIProvider = 'openai' | 'anthropic';

export interface MeetingParticipant {
    id?: string;
    name: string;
    email?: string;
}

export interface ExtractTasksInput {
    transcript: string;
    participants: MeetingParticipant[];
    provider: AIProvider;
    model?: string;
    temperature?: number;
    maxTasks?: number;
}

export interface ExtractedTask {
    title: string;
    assigneeName: string | null;
    deadline: string | null;
    description: string;
    confidence: number;
}

const extractionRequestSchema = z.object({
    transcript: z.string().trim().min(1, 'Transcript is required'),
    participants: z.array(
        z.object({
            id: z.string().optional(),
            name: z.string().trim().min(1),
            email: z.string().email().optional(),
        })
    ),
    provider: z.enum(['openai', 'anthropic']),
    model: z.string().trim().optional(),
    temperature: z.number().min(0).max(1).optional(),
    maxTasks: z.number().int().positive().max(100).optional(),
});

const aiResponseTaskSchema = z.object({
    title: z.string().trim().min(1),
    assigneeName: z.string().trim().optional().nullable(),
    deadline: z.string().trim().optional().nullable(),
    description: z.string().trim().optional().default(''),
    confidence: z.number().min(0).max(1).optional().default(0.5),
});

const aiResponseEnvelopeSchema = z.object({
    tasks: z.array(aiResponseTaskSchema),
});

const normalizedTaskSchema = z.object({
    title: z.string().trim().min(1),
    assigneeName: z.string().trim().nullable(),
    deadline: z.string().datetime().nullable(),
    description: z.string().trim(),
    confidence: z.number().min(0).max(1),
});

const OPENAI_DEFAULT_MODEL = 'gpt-4o-mini';
const ANTHROPIC_DEFAULT_MODEL = 'claude-3-5-sonnet-latest';

const SYSTEM_PROMPT = [
    'You are an expert meeting assistant that extracts action items from transcripts.',
    'Return valid JSON only, with no markdown or extra text.',
    'The JSON must follow this exact shape:',
    '{',
    '  "tasks": [',
    '    {',
    '      "title": "string",',
    '      "assigneeName": "string | null",',
    '      "deadline": "ISO-8601 date-time string | null",',
    '      "description": "string",',
    '      "confidence": "number between 0 and 1"',
    '    }',
    '  ]',
    '}',
    'Only include tasks that are explicitly or strongly implied in the transcript.',
    'If assignee is unknown, use null.',
    'If deadline is unknown, use null.',
    'Confidence must be a numeric score from 0 to 1.',
].join('\n');

export function buildTaskExtractionPrompt(
    transcript: string,
    participants: MeetingParticipant[],
    maxTasks: number = 25
): string {
    const participantList = participants.length
        ? participants.map((participant) => `- ${participant.name}`).join('\n')
        : '- (none provided)';

    return [
        'Extract action items from this meeting transcript.',
        `Return at most ${maxTasks} tasks.`,
        'IMPORTANT: For every task, identify who was assigned or volunteered to do it in the transcript.',
        'The "assigneeName" field MUST be the real name of the person responsible from the Participants list below.',
        'If the transcript uses labels like "Speaker A", "Speaker B" etc., map them to participant names:',
        '  - Use any context clues (greetings, references by name, role mentions) to resolve the mapping.',
        '  - If a participant name is mentioned directly in the text, prioritise that over speaker labels.',
        'Only set "assigneeName" to null if truly no person is mentioned for that task.',
        '',
        'Participants:',
        participantList,
        '',
        'Transcript:',
        transcript,
    ].join('\n');
}

function normalizeText(value: string): string {
    return value
        .toLowerCase()
        .replace(/[^a-z0-9\s]/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
}

function matchAssigneeName(
    assigneeName: string | null | undefined,
    participants: MeetingParticipant[]
): string | null {
    if (!assigneeName || !participants.length) {
        return null;
    }

    const normalizedAssignee = normalizeText(assigneeName);

    if (!normalizedAssignee) {
        return null;
    }

    const exactMatch = participants.find(
        (participant) => normalizeText(participant.name) === normalizedAssignee
    );

    if (exactMatch) {
        return exactMatch.name;
    }

    const partialMatches = participants.filter((participant) => {
        const normalizedParticipant = normalizeText(participant.name);
        return (
            normalizedParticipant.includes(normalizedAssignee) ||
            normalizedAssignee.includes(normalizedParticipant)
        );
    });

    if (partialMatches.length === 1) {
        return partialMatches[0].name;
    }

    return null;
}

function parseDeadlineToISO(deadline: string | null | undefined): string | null {
    if (!deadline) {
        return null;
    }

    const normalizedDeadline = deadline.trim();
    if (!normalizedDeadline) {
        return null;
    }

    const parsedDate = new Date(normalizedDeadline);
    if (Number.isNaN(parsedDate.getTime())) {
        return null;
    }

    return parsedDate.toISOString();
}

function extractJsonPayload(rawContent: string): unknown {
    const trimmed = rawContent.trim();

    try {
        return JSON.parse(trimmed);
    } catch {
        // Continue with best-effort extraction.
    }

    const fencedMatch = trimmed.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
    if (fencedMatch?.[1]) {
        try {
            return JSON.parse(fencedMatch[1].trim());
        } catch {
            // Continue with brace extraction.
        }
    }

    const firstBrace = trimmed.indexOf('{');
    const lastBrace = trimmed.lastIndexOf('}');

    if (firstBrace >= 0 && lastBrace > firstBrace) {
        const candidate = trimmed.slice(firstBrace, lastBrace + 1);
        try {
            return JSON.parse(candidate);
        } catch {
            // Fall through to error.
        }
    }

    throw new BadRequestError('AI response did not contain valid JSON task data');
}

function normalizeAIResponse(
    payload: unknown,
    participants: MeetingParticipant[]
): ExtractedTask[] {
    const envelopeCandidate = Array.isArray(payload) ? { tasks: payload } : payload;
    const parsedEnvelope = aiResponseEnvelopeSchema.parse(envelopeCandidate);

    const normalizedTasks = parsedEnvelope.tasks.map((task) => ({
        title: task.title,
        assigneeName: matchAssigneeName(task.assigneeName, participants),
        deadline: parseDeadlineToISO(task.deadline),
        description: task.description,
        confidence: task.confidence,
    }));

    return normalizedTasks
        .map((task) => normalizedTaskSchema.parse(task))
        .map((task) => ({
            title: task.title,
            assigneeName: task.assigneeName,
            deadline: task.deadline,
            description: task.description,
            confidence: task.confidence,
        }));
}

async function callOpenAI(prompt: string, model: string, temperature: number): Promise<string> {
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
        throw new ExternalServiceError('OpenAI', 'OPENAI_API_KEY is not configured');
    }

    const response = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: {
            Authorization: `Bearer ${apiKey}`,
            'Content-Type': 'application/json',
        },
        body: JSON.stringify({
            model,
            temperature,
            response_format: { type: 'json_object' },
            messages: [
                { role: 'system', content: SYSTEM_PROMPT },
                { role: 'user', content: prompt },
            ],
        }),
    });

    if (!response.ok) {
        const details = await response.text();
        throw new ExternalServiceError('OpenAI', `OpenAI API error: ${response.status} ${details}`);
    }

    const data = (await response.json()) as {
        choices?: Array<{
            message?: {
                content?: string;
            };
        }>;
    };
    const content = data?.choices?.[0]?.message?.content;

    if (typeof content !== 'string' || !content.trim()) {
        throw new BadRequestError('OpenAI returned an empty response for task extraction');
    }

    return content;
}

async function callAnthropic(prompt: string, model: string, temperature: number): Promise<string> {
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) {
        throw new ExternalServiceError('Anthropic', 'ANTHROPIC_API_KEY is not configured');
    }

    const response = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
            'x-api-key': apiKey,
            'anthropic-version': '2023-06-01',
            'content-type': 'application/json',
        },
        body: JSON.stringify({
            model,
            max_tokens: 2000,
            temperature,
            system: SYSTEM_PROMPT,
            messages: [{ role: 'user', content: prompt }],
        }),
    });

    if (!response.ok) {
        const details = await response.text();
        throw new ExternalServiceError('Anthropic', `Anthropic API error: ${response.status} ${details}`);
    }

    const data = (await response.json()) as {
        content?: Array<{
            type?: string;
            text?: string;
        }>;
    };

    const textBlocks: string[] = Array.isArray(data?.content)
        ? data.content
            .filter((block) => block?.type === 'text' && typeof block?.text === 'string')
            .map((block) => block.text as string)
        : [];

    const content = textBlocks.join('\n').trim();

    if (!content) {
        throw new BadRequestError('Anthropic returned an empty response for task extraction');
    }

    return content;
}

async function callAIProvider(
    provider: AIProvider,
    prompt: string,
    model?: string,
    temperature: number = 0.2
): Promise<string> {
    if (provider === 'openai') {
        return callOpenAI(prompt, model || OPENAI_DEFAULT_MODEL, temperature);
    }

    return callAnthropic(prompt, model || ANTHROPIC_DEFAULT_MODEL, temperature);
}

export async function extractTasksFromTranscript(input: ExtractTasksInput): Promise<ExtractedTask[]> {
    const validatedInput = extractionRequestSchema.parse(input);

    const prompt = buildTaskExtractionPrompt(
        validatedInput.transcript,
        validatedInput.participants,
        validatedInput.maxTasks
    );

    const rawAIResponse = await callAIProvider(
        validatedInput.provider,
        prompt,
        validatedInput.model,
        validatedInput.temperature ?? 0.2
    );

    const jsonPayload = extractJsonPayload(rawAIResponse);
    return normalizeAIResponse(jsonPayload, validatedInput.participants);
}

