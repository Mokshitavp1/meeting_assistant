import { z } from 'zod';
import { BadRequestError, ExternalServiceError } from '../middleware/error.middleware';

export type AIProvider = 'openai' | 'anthropic';
export type MoMOutputFormat = 'markdown' | 'html';

export interface MeetingParticipant {
    id?: string;
    name: string;
    email?: string;
}

export interface GenerateMoMInput {
    transcript: string;
    attendees?: MeetingParticipant[];
    provider: AIProvider;
    model?: string;
    temperature?: number;
    format?: MoMOutputFormat;
}

export interface StructuredMoM {
    summary: string;
    keyDiscussionPoints: string[];
    decisionsMade: string[];
    actionItems: string[];
    attendees: string[];
}

export interface GeneratedMoMResult {
    data: StructuredMoM;
    formatted: string;
    format: MoMOutputFormat;
}

const requestSchema = z.object({
    transcript: z.string().trim().min(1, 'Transcript is required'),
    attendees: z
        .array(
            z.object({
                id: z.string().optional(),
                name: z.string().trim().min(1),
                email: z.string().email().optional(),
            })
        )
        .optional()
        .default([]),
    provider: z.enum(['openai', 'anthropic']),
    model: z.string().trim().optional(),
    temperature: z.number().min(0).max(1).optional(),
    format: z.enum(['markdown', 'html']).optional().default('markdown'),
});

const aiMoMSchema = z.object({
    summary: z.string().trim().min(1),
    keyDiscussionPoints: z.array(z.string().trim()).default([]),
    decisionsMade: z.array(z.string().trim()).default([]),
    actionItems: z.array(z.string().trim()).default([]),
    attendees: z.array(z.string().trim()).default([]),
});

const OPENAI_DEFAULT_MODEL = 'gpt-4o-mini';
const ANTHROPIC_DEFAULT_MODEL = 'claude-3-5-sonnet-latest';

const SYSTEM_PROMPT = [
    'You are an expert meeting assistant that generates structured Minutes of Meeting (MoM).',
    'Return valid JSON only, with no markdown code fences and no extra text.',
    'Use this exact shape:',
    '{',
    '  "summary": "string",',
    '  "keyDiscussionPoints": ["string"],',
    '  "decisionsMade": ["string"],',
    '  "actionItems": ["string"],',
    '  "attendees": ["string"]',
    '}',
    'Keep points concise and factual based only on transcript content.',
    'IMPORTANT: Each action item MUST include the assignee\'s name in the format: "Task description (AssigneeName) — due date or timeline".',
    'If the transcript mentions who is responsible for a task, always include that person\'s name in the action item.',
    'Use the exact names from the provided attendee list when possible.',
].join('\n');

export function buildMoMPrompt(
    transcript: string,
    attendees: MeetingParticipant[] = []
): string {
    const attendeeSection = attendees.length
        ? attendees.map((attendee) => `- ${attendee.name}`).join('\n')
        : '- (not provided)';

    return [
        'Generate structured Minutes of Meeting from this transcript.',
        'Include summary, key discussion points, decisions made, action items, and attendees.',
        '',
        'SPEAKER RESOLUTION: The transcript may use labels like "Speaker A", "Speaker B" etc.',
        '  - Map each speaker label to a real participant name using any context clues in the conversation.',
        '  - If a participant is addressed by name in the conversation, use that to anchor the mapping.',
        '  - Use the provided attendees list below as the pool of real names.',
        '',
        'CRITICAL for action items: Every action item MUST include the real assignee name.',
        'Format: "Task description (RealPersonName) — due date or timeline"',
        'Never use "Speaker A" or generic labels in the final output — always resolve to real names.',
        '',
        'Provided attendees:',
        attendeeSection,
        '',
        'Transcript:',
        transcript,
    ].join('\n');
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

    throw new BadRequestError('AI response did not contain valid JSON MoM data');
}

function normalizeMoMData(payload: unknown, providedAttendees: MeetingParticipant[]): StructuredMoM {
    const parsed = aiMoMSchema.parse(payload);
    const providedNames = providedAttendees.map((item) => item.name).filter(Boolean);
    const combinedAttendees = parsed.attendees.length ? parsed.attendees : providedNames;

    return {
        summary: parsed.summary,
        keyDiscussionPoints: parsed.keyDiscussionPoints,
        decisionsMade: parsed.decisionsMade,
        actionItems: parsed.actionItems,
        attendees: combinedAttendees,
    };
}

function escapeHtml(value: string): string {
    return value
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

function renderBulletListMarkdown(items: string[]): string {
    if (!items.length) {
        return '- None';
    }
    return items.map((item) => `- ${item}`).join('\n');
}

function renderBulletListHtml(items: string[]): string {
    if (!items.length) {
        return '<ul><li>None</li></ul>';
    }

    return `<ul>${items.map((item) => `<li>${escapeHtml(item)}</li>`).join('')}</ul>`;
}

export function formatMoM(data: StructuredMoM, format: MoMOutputFormat): string {
    if (format === 'html') {
        return [
            '<section>',
            '<h2>Meeting Summary</h2>',
            `<p>${escapeHtml(data.summary)}</p>`,
            '<h3>Key Discussion Points</h3>',
            renderBulletListHtml(data.keyDiscussionPoints),
            '<h3>Decisions Made</h3>',
            renderBulletListHtml(data.decisionsMade),
            '<h3>Action Items</h3>',
            renderBulletListHtml(data.actionItems),
            '<h3>Attendees</h3>',
            renderBulletListHtml(data.attendees),
            '</section>',
        ].join('\n');
    }

    return [
        '## Meeting Summary',
        data.summary,
        '',
        '### Key Discussion Points',
        renderBulletListMarkdown(data.keyDiscussionPoints),
        '',
        '### Decisions Made',
        renderBulletListMarkdown(data.decisionsMade),
        '',
        '### Action Items',
        renderBulletListMarkdown(data.actionItems),
        '',
        '### Attendees',
        renderBulletListMarkdown(data.attendees),
    ].join('\n');
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
        throw new BadRequestError('OpenAI returned an empty response for MoM generation');
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
            max_tokens: 2500,
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
        throw new BadRequestError('Anthropic returned an empty response for MoM generation');
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

export async function generateMinutesOfMeeting(input: GenerateMoMInput): Promise<GeneratedMoMResult> {
    const validated = requestSchema.parse(input);

    const prompt = buildMoMPrompt(validated.transcript, validated.attendees);
    const rawResponse = await callAIProvider(
        validated.provider,
        prompt,
        validated.model,
        validated.temperature ?? 0.2
    );

    const parsedPayload = extractJsonPayload(rawResponse);
    const structuredData = normalizeMoMData(parsedPayload, validated.attendees);
    const formatted = formatMoM(structuredData, validated.format);

    return {
        data: structuredData,
        formatted,
        format: validated.format,
    };
}

