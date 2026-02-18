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

const MAX_RETRIES = 2;

// ─────────────────────────────────────────────────────────────────────────────
// Public types
// ─────────────────────────────────────────────────────────────────────────────

export type MoMFormat = 'html' | 'markdown';

export interface MoMOptions {
    meetingId: string;
    /** Output format for the `formatted` field. Default: 'markdown' */
    format?: MoMFormat;
    /** Persist the formatted output to `meeting.minutesOfMeeting`. Default: true */
    persist?: boolean;
}

export interface MoMAttendee {
    name: string;
    email: string;
    role: 'organizer' | 'participant' | string;
    attended: boolean;
}

export interface DiscussionPoint {
    topic: string;
    details: string[];
}

export interface MoMDecision {
    decision: string;
    rationale?: string;
    madeBy?: string | null;
}

export interface MoMActionItem {
    title: string;
    assignee: string | null;
    /** ISO date string YYYY-MM-DD, or null */
    deadline: string | null;
    priority: 'low' | 'medium' | 'high';
}

export interface MoMData {
    meetingId: string;
    meetingTitle: string;
    meetingDate: Date;
    /** Duration in minutes */
    duration?: number;
    attendees: MoMAttendee[];
    summary: string;
    discussionPoints: DiscussionPoint[];
    decisions: MoMDecision[];
    actionItems: MoMActionItem[];
    nextMeetingDate?: string | null;
    /** Ready-to-render HTML or Markdown string */
    formatted: string;
    format: MoMFormat;
    generatedAt: Date;
}

// ─────────────────────────────────────────────────────────────────────────────
// Zod schemas — validate raw AI output
// ─────────────────────────────────────────────────────────────────────────────

const DiscussionPointSchema = z.object({
    topic: z.string().min(1),
    details: z.array(z.string()).default([]),
});

const DecisionSchema = z.object({
    decision: z.string().min(1),
    rationale: z.string().optional().default(''),
    madeBy: z.union([z.string(), z.null()]).optional().default(null),
});

const ActionItemSchema = z.object({
    title: z.string().min(1),
    assignee: z.union([z.string(), z.null()]).optional().default(null),
    deadline: z.union([z.string(), z.null()]).optional().default(null),
    priority: z.enum(['low', 'medium', 'high']).catch('medium'),
});

const RawMoMSchema = z.object({
    summary: z.string().min(1),
    discussionPoints: z.array(DiscussionPointSchema).default([]),
    decisions: z.array(DecisionSchema).default([]),
    actionItems: z.array(ActionItemSchema).default([]),
    nextMeetingDate: z.union([z.string(), z.null()]).optional().default(null),
});

type RawMoM = z.infer<typeof RawMoMSchema>;

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

function getSystemPrompt(): string {
    return `You are a professional meeting secretary. Your job is to read a meeting transcript and produce structured Meeting Minutes (MoM) as a single JSON object.

## Rules

1. Write in a formal, professional tone. Use third-person where appropriate.
2. The "summary" must be a coherent narrative paragraph (3–6 sentences) that captures the purpose, main themes, and outcome of the meeting.
3. "discussionPoints" — identify distinct topics discussed. Each topic must have a short title and an array of concise bullet details. Order them chronologically from the transcript.
4. "decisions" — list every concrete decision or agreement reached. Include the rationale if stated. Set "madeBy" to the person who made or proposed the decision, or null if unclear.
5. "actionItems" — every explicit commitment or task assigned. Parse deadlines to YYYY-MM-DD. Set priority using urgency language (high/medium/low). Null assignee if unspecified.
6. "nextMeetingDate" — extract if explicitly mentioned, as a readable string (e.g. "Thursday 22 August 2025 at 10:00 AM"). Set to null if not mentioned.
7. Return ONLY the JSON object. No markdown, no code fences, no commentary.

## Required output format

{
  "summary": "<3–6 sentence narrative paragraph>",
  "discussionPoints": [
    { "topic": "<topic title>", "details": ["<bullet>", "<bullet>"] }
  ],
  "decisions": [
    { "decision": "<what was decided>", "rationale": "<why, or empty string>", "madeBy": "<name or null>" }
  ],
  "actionItems": [
    { "title": "<imperative task>", "assignee": "<name or null>", "deadline": "<YYYY-MM-DD or null>", "priority": "low|medium|high" }
  ],
  "nextMeetingDate": "<readable date string or null>"
}`;
}

function buildUserPrompt(
    transcriptText: string,
    attendeeBlock: string,
    meetingTitle: string,
    meetingDate: Date
): string {
    const dateStr = meetingDate.toLocaleDateString('en-GB', {
        weekday: 'long',
        year: 'numeric',
        month: 'long',
        day: 'numeric',
    });

    return `Meeting: ${meetingTitle}
Date: ${dateStr}

## Attendees
${attendeeBlock}

## Transcript
${transcriptText}

Generate the Meeting Minutes JSON for this meeting.`;
}

// ─────────────────────────────────────────────────────────────────────────────
// GPT response parsing
// ─────────────────────────────────────────────────────────────────────────────

function parseGPTResponse(raw: string): RawMoM {
    let parsed: unknown;

    // 1 — direct parse
    try {
        parsed = JSON.parse(raw);
    } catch {
        // strip markdown code fences and retry
        const fenceMatch = raw.match(/```(?:json)?\s*([\s\S]+?)\s*```/);
        if (fenceMatch) {
            try {
                parsed = JSON.parse(fenceMatch[1]);
            } catch {
                throw new BadRequestError(
                    'GPT returned malformed JSON inside a code fence.',
                    { preview: raw.slice(0, 300) }
                );
            }
        } else {
            throw new BadRequestError(
                'GPT returned non-JSON output.',
                { preview: raw.slice(0, 300) }
            );
        }
    }

    // 2 — Zod validation
    const result = RawMoMSchema.safeParse(parsed);
    if (result.success) return result.data;

    // 3 — partial salvage: try to build the best possible output from what we have
    const obj = parsed as Record<string, unknown>;
    const salvaged: Partial<RawMoM> = {
        summary: typeof obj.summary === 'string' && obj.summary ? obj.summary : 'Summary not available.',
        discussionPoints: [],
        decisions: [],
        actionItems: [],
        nextMeetingDate: null,
    };

    if (Array.isArray(obj.discussionPoints)) {
        for (const dp of obj.discussionPoints) {
            const r = DiscussionPointSchema.safeParse(dp);
            if (r.success) salvaged.discussionPoints!.push(r.data);
        }
    }
    if (Array.isArray(obj.decisions)) {
        for (const d of obj.decisions) {
            const r = DecisionSchema.safeParse(d);
            if (r.success) salvaged.decisions!.push(r.data);
        }
    }
    if (Array.isArray(obj.actionItems)) {
        for (const a of obj.actionItems) {
            const r = ActionItemSchema.safeParse(a);
            if (r.success) salvaged.actionItems!.push(r.data);
        }
    }

    const hadSomething =
        salvaged.discussionPoints!.length > 0 ||
        salvaged.decisions!.length > 0 ||
        salvaged.actionItems!.length > 0;

    if (hadSomething || salvaged.summary !== 'Summary not available.') {
        console.warn('[MoM Generation] Partial salvage used — some sections may be incomplete.');
        return salvaged as RawMoM;
    }

    throw new BadRequestError(
        'GPT response did not match the Meeting Minutes schema.',
        result.error.flatten()
    );
}

// ─────────────────────────────────────────────────────────────────────────────
// GPT call with conversation-style retry
// ─────────────────────────────────────────────────────────────────────────────

async function callGPTWithRetry(systemPrompt: string, userPrompt: string): Promise<RawMoM> {
    const model = process.env.OPENAI_MOM_MODEL ?? 'gpt-4o';

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
                temperature: 0.3,
                max_tokens: 4096,
            });

            raw = response.choices[0]?.message?.content ?? '';
            if (!raw.trim()) {
                throw new ExternalServiceError('OpenAI', 'GPT returned an empty response.');
            }
        } catch (err: any) {
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

        try {
            return parseGPTResponse(raw);
        } catch (parseErr: any) {
            lastError = parseErr;

            if (attempt < MAX_RETRIES - 1) {
                messages.push(
                    { role: 'assistant', content: raw },
                    {
                        role: 'user',
                        content:
                            'Your response could not be parsed as valid JSON matching the schema. ' +
                            'Respond with ONLY the JSON object — no markdown, no code fences, no explanation.',
                    }
                );
                console.warn(`[MoM Generation] Parse failure on attempt ${attempt + 1}, retrying…`);
            }
        }
    }

    throw lastError;
}

// ─────────────────────────────────────────────────────────────────────────────
// Formatters
// ─────────────────────────────────────────────────────────────────────────────

function escapeHtml(str: string): string {
    return str
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

function priorityBadgeHtml(priority: string): string {
    const colours: Record<string, string> = {
        high: '#c62828',
        medium: '#e65100',
        low: '#2e7d32',
    };
    const colour = colours[priority] ?? '#555';
    return `<span style="color:${colour};font-weight:600;">${escapeHtml(priority)}</span>`;
}

/**
 * Renders MoM data as a self-contained HTML document.
 * No external fonts, scripts, or CDN dependencies.
 */
function formatAsHTML(data: MoMData): string {
    const dateStr = data.meetingDate.toLocaleDateString('en-GB', {
        weekday: 'long', year: 'numeric', month: 'long', day: 'numeric',
    });

    /* ── Attendees ──────────────────────────────────────────────── */
    const attendeeRows = data.attendees
        .map((a) => `
          <tr>
            <td>${escapeHtml(a.name)}</td>
            <td>${escapeHtml(a.email)}</td>
            <td>${escapeHtml(a.role)}</td>
            <td>${a.attended ? '✓' : '–'}</td>
          </tr>`)
        .join('');

    /* ── Discussion points ──────────────────────────────────────── */
    const discussionHtml = data.discussionPoints.length === 0
        ? '<p><em>No discussion points recorded.</em></p>'
        : data.discussionPoints
            .map((dp, i) => `
          <h3>${i + 1}. ${escapeHtml(dp.topic)}</h3>
          <ul>${dp.details.map((d) => `<li>${escapeHtml(d)}</li>`).join('')}</ul>`)
            .join('');

    /* ── Decisions ──────────────────────────────────────────────── */
    const decisionsHtml = data.decisions.length === 0
        ? '<p><em>No formal decisions recorded.</em></p>'
        : `<ul>${data.decisions
            .map((d) => {
                const by = d.madeBy ? ` <span class="meta">— ${escapeHtml(d.madeBy)}</span>` : '';
                const rationale = d.rationale
                    ? `<br><span class="rationale">${escapeHtml(d.rationale)}</span>`
                    : '';
                return `<li><strong>${escapeHtml(d.decision)}</strong>${by}${rationale}</li>`;
            })
            .join('')}</ul>`;

    /* ── Action items ───────────────────────────────────────────── */
    const actionRows = data.actionItems.length === 0
        ? '<tr><td colspan="4"><em>No action items.</em></td></tr>'
        : data.actionItems
            .map((a) => `
          <tr>
            <td>${escapeHtml(a.title)}</td>
            <td>${escapeHtml(a.assignee ?? '—')}</td>
            <td>${escapeHtml(a.deadline ?? '—')}</td>
            <td>${priorityBadgeHtml(a.priority)}</td>
          </tr>`)
            .join('');

    /* ── Next meeting ───────────────────────────────────────────── */
    const nextMeetingHtml = data.nextMeetingDate
        ? `<section>
        <h2>Next Meeting</h2>
        <p>${escapeHtml(data.nextMeetingDate)}</p>
       </section>`
        : '';

    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Meeting Minutes — ${escapeHtml(data.meetingTitle)}</title>
  <style>
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
      font-size: 15px; line-height: 1.6; color: #1a1a1a;
      max-width: 860px; margin: 40px auto; padding: 0 24px 60px;
    }
    header { border-bottom: 3px solid #1565c0; padding-bottom: 16px; margin-bottom: 32px; }
    header h1 { font-size: 1.8rem; color: #1565c0; }
    header .meta { color: #555; font-size: 0.9rem; margin-top: 6px; }
    section { margin-top: 36px; }
    h2 {
      font-size: 1.15rem; font-weight: 700; color: #1565c0;
      border-bottom: 1px solid #c5cae9; padding-bottom: 6px; margin-bottom: 14px;
    }
    h3 { font-size: 1rem; font-weight: 600; color: #333; margin: 18px 0 6px; }
    p { margin-bottom: 10px; }
    ul { padding-left: 22px; margin-bottom: 12px; }
    li { margin-bottom: 4px; }
    .rationale { color: #666; font-size: 0.9em; }
    .meta { color: #888; font-size: 0.88em; font-style: italic; }
    table { width: 100%; border-collapse: collapse; margin-top: 8px; font-size: 0.93rem; }
    th {
      background: #e8eaf6; color: #1a237e; font-weight: 600;
      text-align: left; padding: 9px 12px; border: 1px solid #c5cae9;
    }
    td { padding: 8px 12px; border: 1px solid #e0e0e0; vertical-align: top; }
    tr:nth-child(even) td { background: #fafafa; }
    footer { margin-top: 48px; font-size: 0.8rem; color: #aaa; border-top: 1px solid #eee; padding-top: 12px; }
  </style>
</head>
<body>

<header>
  <h1>Meeting Minutes</h1>
  <div class="meta">
    <strong>${escapeHtml(data.meetingTitle)}</strong> &nbsp;·&nbsp;
    ${escapeHtml(dateStr)}
    ${data.duration != null ? ` &nbsp;·&nbsp; ${data.duration} min` : ''}
  </div>
</header>

<section>
  <h2>Attendees</h2>
  <table>
    <thead><tr><th>Name</th><th>Email</th><th>Role</th><th>Attended</th></tr></thead>
    <tbody>${attendeeRows}</tbody>
  </table>
</section>

<section>
  <h2>Summary</h2>
  <p>${escapeHtml(data.summary)}</p>
</section>

<section>
  <h2>Key Discussion Points</h2>
  ${discussionHtml}
</section>

<section>
  <h2>Decisions Made</h2>
  ${decisionsHtml}
</section>

<section>
  <h2>Action Items</h2>
  <table>
    <thead><tr><th>Task</th><th>Assignee</th><th>Deadline</th><th>Priority</th></tr></thead>
    <tbody>${actionRows}</tbody>
  </table>
</section>

${nextMeetingHtml}

<footer>
  Generated on ${data.generatedAt.toUTCString()}
</footer>

</body>
</html>`;
}

/**
 * Renders MoM data as GitHub-Flavored Markdown.
 */
function formatAsMarkdown(data: MoMData): string {
    const dateStr = data.meetingDate.toLocaleDateString('en-GB', {
        weekday: 'long', year: 'numeric', month: 'long', day: 'numeric',
    });
    const duration = data.duration != null ? ` | **Duration:** ${data.duration} min` : '';

    const lines: string[] = [];

    // ── Header ─────────────────────────────────────────────────────────────
    lines.push(`# Meeting Minutes: ${data.meetingTitle}`, '');
    lines.push(`**Date:** ${dateStr}${duration}`, '');
    lines.push('---', '');

    // ── Attendees ──────────────────────────────────────────────────────────
    lines.push('## Attendees', '');
    lines.push('| Name | Email | Role | Attended |');
    lines.push('|------|-------|------|----------|');
    for (const a of data.attendees) {
        lines.push(`| ${a.name} | ${a.email} | ${a.role} | ${a.attended ? '✓' : '—'} |`);
    }
    lines.push('');

    // ── Summary ────────────────────────────────────────────────────────────
    lines.push('## Summary', '');
    lines.push(data.summary, '');

    // ── Discussion Points ──────────────────────────────────────────────────
    lines.push('## Key Discussion Points', '');
    if (data.discussionPoints.length === 0) {
        lines.push('_No discussion points recorded._', '');
    } else {
        for (const dp of data.discussionPoints) {
            lines.push(`### ${dp.topic}`, '');
            for (const detail of dp.details) {
                lines.push(`- ${detail}`);
            }
            lines.push('');
        }
    }

    // ── Decisions ──────────────────────────────────────────────────────────
    lines.push('## Decisions Made', '');
    if (data.decisions.length === 0) {
        lines.push('_No formal decisions recorded._', '');
    } else {
        for (const d of data.decisions) {
            const by = d.madeBy ? ` *(${d.madeBy})*` : '';
            lines.push(`- **${d.decision}**${by}`);
            if (d.rationale) lines.push(`  > ${d.rationale}`);
        }
        lines.push('');
    }

    // ── Action Items ───────────────────────────────────────────────────────
    lines.push('## Action Items', '');
    lines.push('| Task | Assignee | Deadline | Priority |');
    lines.push('|------|----------|----------|----------|');
    if (data.actionItems.length === 0) {
        lines.push('| — | — | — | — |');
    } else {
        for (const a of data.actionItems) {
            lines.push(
                `| ${a.title} | ${a.assignee ?? '—'} | ${a.deadline ?? '—'} | ${a.priority} |`
            );
        }
    }
    lines.push('');

    // ── Next Meeting ───────────────────────────────────────────────────────
    if (data.nextMeetingDate) {
        lines.push('## Next Meeting', '');
        lines.push(data.nextMeetingDate, '');
    }

    // ── Footer ─────────────────────────────────────────────────────────────
    lines.push('---', '');
    lines.push(`_Generated on ${data.generatedAt.toUTCString()}_`);

    return lines.join('\n');
}

// ─────────────────────────────────────────────────────────────────────────────
// Database helpers
// ─────────────────────────────────────────────────────────────────────────────

interface MeetingMeta {
    id: string;
    title: string;
    scheduledStartTime: Date;
    duration: number | null;
    participants: Array<{
        role: string;
        attended: boolean;
        user: { name: string | null; email: string };
    }>;
}

async function loadMeetingMeta(meetingId: string): Promise<MeetingMeta> {
    const meeting = await prisma.meeting.findUnique({
        where: { id: meetingId },
        select: {
            id: true,
            title: true,
            scheduledStartTime: true,
            duration: true,
            participants: {
                select: {
                    role: true,
                    attended: true,
                    user: { select: { name: true, email: true } },
                },
            },
        },
    });

    if (!meeting) throw new NotFoundError('Meeting');
    return meeting;
}

// ─────────────────────────────────────────────────────────────────────────────
// Public API
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Generate structured Meeting Minutes from a transcript.
 *
 * @param transcript  Full-text string or a `StructuredTranscript` object
 * @param options     meetingId is required; format defaults to 'markdown'
 */
export async function generateMeetingMinutes(
    transcript: string | StructuredTranscript,
    options: MoMOptions
): Promise<MoMData> {
    const { meetingId, format = 'markdown', persist = true } = options;

    // Normalise transcript input
    const transcriptText =
        typeof transcript === 'string' ? transcript : transcript.fullText;

    if (!transcriptText.trim()) {
        throw new BadRequestError('Transcript text is empty — nothing to generate minutes from.');
    }

    // Load meeting metadata for context and attendee list
    const meta = await loadMeetingMeta(meetingId);

    const attendees: MoMAttendee[] = meta.participants.map((p) => ({
        name: p.user.name ?? 'Unknown',
        email: p.user.email,
        role: p.role,
        attended: p.attended,
    }));

    const attendeeBlock = attendees.length === 0
        ? '(no attendees listed)'
        : attendees
            .map((a) => `- ${a.name} <${a.email}> (${a.role}${a.attended ? ', attended' : ''})`)
            .join('\n');

    // ── Call GPT ──────────────────────────────────────────────────────────
    const systemPrompt = getSystemPrompt();
    const userPrompt = buildUserPrompt(
        transcriptText,
        attendeeBlock,
        meta.title,
        meta.scheduledStartTime
    );

    const raw = await callGPTWithRetry(systemPrompt, userPrompt);

    // ── Assemble MoMData ──────────────────────────────────────────────────
    const momData: MoMData = {
        meetingId,
        meetingTitle: meta.title,
        meetingDate: meta.scheduledStartTime,
        duration: meta.duration ?? undefined,
        attendees,
        summary: raw.summary,
        discussionPoints: raw.discussionPoints,
        decisions: raw.decisions,
        actionItems: raw.actionItems,
        nextMeetingDate: raw.nextMeetingDate ?? null,
        formatted: '',    // set below
        format,
        generatedAt: new Date(),
    };

    momData.formatted = format === 'html'
        ? formatAsHTML(momData)
        : formatAsMarkdown(momData);

    // ── Persist to meeting row ────────────────────────────────────────────
    if (persist) {
        await prisma.meeting.update({
            where: { id: meetingId },
            data: { minutesOfMeeting: momData.formatted },
        });
    }

    return momData;
}

/**
 * Retrieve and re-render previously generated minutes in a different format
 * without calling GPT again.
 *
 * Useful when minutes were generated as Markdown and the client now needs HTML
 * (or vice-versa). Returns null if no minutes exist yet.
 */
export async function getMeetingMinutes(
    meetingId: string,
    format: MoMFormat = 'markdown'
): Promise<string | null> {
    const meeting = await prisma.meeting.findUnique({
        where: { id: meetingId },
        select: { minutesOfMeeting: true },
    });

    if (!meeting) throw new NotFoundError('Meeting');
    return meeting.minutesOfMeeting ?? null;
}
