import crypto from 'crypto';
import { google, calendar_v3 } from 'googleapis';
import { prisma } from '../config/database';
import { getJSON, setJSON } from '../config/redis';
import { BadRequestError, ExternalServiceError, NotFoundError } from '../middleware/error.middleware';

const GOOGLE_CALENDAR_SCOPES = ['https://www.googleapis.com/auth/calendar'];
const GOOGLE_REDIRECT_URI = process.env.GOOGLE_CALENDAR_REDIRECT_URI || '';

const TOKEN_KEY_PREFIX = 'calendar:google:tokens:';
const EVENT_MAP_KEY_PREFIX = 'calendar:google:event-map:';
const EVENT_REVERSE_MAP_KEY_PREFIX = 'calendar:google:event-reverse:';
const SYNC_TOKEN_KEY_PREFIX = 'calendar:google:sync-token:';
const CHANNEL_KEY_PREFIX = 'calendar:google:channel:';

const DATA_TTL_SECONDS = 60 * 60 * 24 * 180;

export interface GoogleCalendarTokens {
    access_token?: string;
    refresh_token?: string;
    scope?: string;
    token_type?: string;
    expiry_date?: number;
}

export interface GoogleOAuthCallbackResult {
    connected: boolean;
    hasRefreshToken: boolean;
    expiryDate?: number;
}

export interface CreateTaskCalendarEventInput {
    userId: string;
    taskId: string;
    title: string;
    description?: string | null;
    dueDate: string;
    timezone?: string;
    attendeesEmails?: string[];
}

export interface CalendarEventOperationResult {
    eventId: string;
    htmlLink?: string;
}

export interface StartCalendarWatchInput {
    userId: string;
    webhookUrl: string;
}

export interface CalendarWatchChannel {
    channelId: string;
    resourceId: string;
    expiration?: string;
}

export interface CalendarWebhookHeaders {
    channelId: string;
    resourceState?: string;
    resourceId?: string;
    messageNumber?: string;
}

interface ChannelMetadata {
    userId: string;
    resourceId?: string;
    expiration?: string;
}

function getGoogleOAuthClient() {
    const clientId = process.env.GOOGLE_CLIENT_ID;
    const clientSecret = process.env.GOOGLE_CLIENT_SECRET;

    if (!clientId || !clientSecret || !GOOGLE_REDIRECT_URI) {
        throw new ExternalServiceError(
            'Google Calendar',
            'Google OAuth configuration is missing (GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, GOOGLE_CALENDAR_REDIRECT_URI)'
        );
    }

    return new google.auth.OAuth2(clientId, clientSecret, GOOGLE_REDIRECT_URI);
}

function getTokenEncryptionSecret(): Buffer {
    const secret = process.env.CALENDAR_TOKEN_SECRET;
    if (!secret) {
        throw new ExternalServiceError(
            'Google Calendar',
            'CALENDAR_TOKEN_SECRET is not configured'
        );
    }

    return crypto.createHash('sha256').update(secret).digest();
}

function encryptTokenPayload(payload: GoogleCalendarTokens): string {
    const key = getTokenEncryptionSecret();
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);

    const plaintext = JSON.stringify(payload);
    const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
    const authTag = cipher.getAuthTag();

    return `${iv.toString('base64')}.${authTag.toString('base64')}.${encrypted.toString('base64')}`;
}

function decryptTokenPayload(ciphertext: string): GoogleCalendarTokens {
    const parts = ciphertext.split('.');
    if (parts.length !== 3) {
        throw new ExternalServiceError('Google Calendar', 'Stored token payload is malformed');
    }

    const [ivEncoded, authTagEncoded, encryptedEncoded] = parts;
    const key = getTokenEncryptionSecret();

    const decipher = crypto.createDecipheriv(
        'aes-256-gcm',
        key,
        Buffer.from(ivEncoded, 'base64')
    );

    decipher.setAuthTag(Buffer.from(authTagEncoded, 'base64'));

    const decrypted = Buffer.concat([
        decipher.update(Buffer.from(encryptedEncoded, 'base64')),
        decipher.final(),
    ]);

    return JSON.parse(decrypted.toString('utf8')) as GoogleCalendarTokens;
}

async function storeUserTokens(userId: string, tokens: GoogleCalendarTokens): Promise<void> {
    const encrypted = encryptTokenPayload(tokens);
    await setJSON(`${TOKEN_KEY_PREFIX}${userId}`, { encrypted }, DATA_TTL_SECONDS);
}

async function getUserTokens(userId: string): Promise<GoogleCalendarTokens | null> {
    const record = await getJSON<{ encrypted: string }>(`${TOKEN_KEY_PREFIX}${userId}`);
    if (!record?.encrypted) {
        return null;
    }

    return decryptTokenPayload(record.encrypted);
}

async function getAuthorizedCalendarClient(userId: string): Promise<calendar_v3.Calendar> {
    const oauth2Client = getGoogleOAuthClient();
    const storedTokens = await getUserTokens(userId);

    if (!storedTokens) {
        throw new ExternalServiceError('Google Calendar', 'User has not connected Google Calendar');
    }

    oauth2Client.setCredentials(storedTokens);

    try {
        await oauth2Client.getAccessToken();
    } catch (error) {
        throw new ExternalServiceError(
            'Google Calendar',
            `Failed to refresh Google token: ${error instanceof Error ? error.message : 'Unknown error'}`
        );
    }

    const latestCredentials = oauth2Client.credentials;
    const mergedTokens: GoogleCalendarTokens = {
        ...storedTokens,
        ...latestCredentials,
        refresh_token: latestCredentials.refresh_token || storedTokens.refresh_token,
    };

    await storeUserTokens(userId, mergedTokens);

    return google.calendar({ version: 'v3', auth: oauth2Client });
}

async function mapTaskEvent(userId: string, taskId: string, eventId: string): Promise<void> {
    await Promise.all([
        setJSON(`${EVENT_MAP_KEY_PREFIX}${userId}:${taskId}`, { eventId }, DATA_TTL_SECONDS),
        setJSON(`${EVENT_REVERSE_MAP_KEY_PREFIX}${userId}:${eventId}`, { taskId }, DATA_TTL_SECONDS),
    ]);
}

async function getMappedEventId(userId: string, taskId: string): Promise<string | null> {
    const mapping = await getJSON<{ eventId: string }>(`${EVENT_MAP_KEY_PREFIX}${userId}:${taskId}`);
    return mapping?.eventId || null;
}

async function getMappedTaskId(userId: string, eventId: string): Promise<string | null> {
    const mapping = await getJSON<{ taskId: string }>(
        `${EVENT_REVERSE_MAP_KEY_PREFIX}${userId}:${eventId}`
    );
    return mapping?.taskId || null;
}

async function saveSyncToken(userId: string, syncToken: string): Promise<void> {
    await setJSON(`${SYNC_TOKEN_KEY_PREFIX}${userId}`, { syncToken }, DATA_TTL_SECONDS);
}

async function getSyncToken(userId: string): Promise<string | null> {
    const record = await getJSON<{ syncToken: string }>(`${SYNC_TOKEN_KEY_PREFIX}${userId}`);
    return record?.syncToken || null;
}

function buildTaskEventDateTimes(dueDateISO: string, timezone?: string) {
    const dueDate = new Date(dueDateISO);
    if (Number.isNaN(dueDate.getTime())) {
        throw new BadRequestError('Invalid dueDate for calendar event');
    }

    const startDate = new Date(dueDate.getTime() - 30 * 60 * 1000);

    return {
        start: {
            dateTime: startDate.toISOString(),
            timeZone: timezone || 'UTC',
        },
        end: {
            dateTime: dueDate.toISOString(),
            timeZone: timezone || 'UTC',
        },
    };
}

export function getGoogleOAuthConsentUrl(userId: string, state?: string): string {
    const oauth2Client = getGoogleOAuthClient();
    return oauth2Client.generateAuthUrl({
        access_type: 'offline',
        prompt: 'consent',
        scope: GOOGLE_CALENDAR_SCOPES,
        state: state || userId,
    });
}

export async function handleGoogleOAuthCallback(
    userId: string,
    code: string
): Promise<GoogleOAuthCallbackResult> {
    const oauth2Client = getGoogleOAuthClient();

    try {
        const tokenResponse = await oauth2Client.getToken(code);
        const tokens = tokenResponse.tokens;

        if (!tokens.access_token) {
            throw new ExternalServiceError('Google Calendar', 'Google did not return an access token');
        }

        const existingTokens = await getUserTokens(userId);
        const mergedTokens: GoogleCalendarTokens = {
            ...existingTokens,
            ...tokens,
            refresh_token: tokens.refresh_token || existingTokens?.refresh_token,
        };

        await storeUserTokens(userId, mergedTokens);

        return {
            connected: true,
            hasRefreshToken: Boolean(mergedTokens.refresh_token),
            expiryDate: mergedTokens.expiry_date,
        };
    } catch (error) {
        throw new ExternalServiceError(
            'Google Calendar',
            `OAuth callback failed: ${error instanceof Error ? error.message : 'Unknown error'}`
        );
    }
}

export async function createTaskCalendarEvent(
    input: CreateTaskCalendarEventInput
): Promise<CalendarEventOperationResult> {
    const calendarClient = await getAuthorizedCalendarClient(input.userId);

    try {
        const dateTimes = buildTaskEventDateTimes(input.dueDate, input.timezone);
        const response = await calendarClient.events.insert({
            calendarId: 'primary',
            requestBody: {
                summary: input.title,
                description: input.description || undefined,
                start: dateTimes.start,
                end: dateTimes.end,
                attendees: input.attendeesEmails?.map((email) => ({ email })),
                reminders: {
                    useDefault: false,
                    overrides: [
                        { method: 'email', minutes: 24 * 60 },
                        { method: 'email', minutes: 60 },
                    ],
                },
            },
        });

        const eventId = response.data.id;
        if (!eventId) {
            throw new ExternalServiceError('Google Calendar', 'Failed to create calendar event');
        }

        await mapTaskEvent(input.userId, input.taskId, eventId);

        return {
            eventId,
            htmlLink: response.data.htmlLink || undefined,
        };
    } catch (error) {
        throw new ExternalServiceError(
            'Google Calendar',
            `Create event failed: ${error instanceof Error ? error.message : 'Unknown error'}`
        );
    }
}

export async function updateTaskCalendarEventDeadline(input: {
    userId: string;
    taskId: string;
    dueDate: string;
    timezone?: string;
}): Promise<CalendarEventOperationResult> {
    const calendarClient = await getAuthorizedCalendarClient(input.userId);
    const mappedEventId = await getMappedEventId(input.userId, input.taskId);

    if (!mappedEventId) {
        throw new NotFoundError('Calendar event mapping');
    }

    try {
        const dateTimes = buildTaskEventDateTimes(input.dueDate, input.timezone);
        const response = await calendarClient.events.patch({
            calendarId: 'primary',
            eventId: mappedEventId,
            requestBody: {
                start: dateTimes.start,
                end: dateTimes.end,
            },
        });

        return {
            eventId: mappedEventId,
            htmlLink: response.data.htmlLink || undefined,
        };
    } catch (error) {
        throw new ExternalServiceError(
            'Google Calendar',
            `Update event failed: ${error instanceof Error ? error.message : 'Unknown error'}`
        );
    }
}

export async function deleteTaskCalendarEvent(input: {
    userId: string;
    taskId: string;
}): Promise<void> {
    const calendarClient = await getAuthorizedCalendarClient(input.userId);
    const mappedEventId = await getMappedEventId(input.userId, input.taskId);

    if (!mappedEventId) {
        return;
    }

    try {
        await calendarClient.events.delete({
            calendarId: 'primary',
            eventId: mappedEventId,
        });
    } catch (error) {
        throw new ExternalServiceError(
            'Google Calendar',
            `Delete event failed: ${error instanceof Error ? error.message : 'Unknown error'}`
        );
    }
}

export async function startGoogleCalendarWatch(
    input: StartCalendarWatchInput
): Promise<CalendarWatchChannel> {
    const calendarClient = await getAuthorizedCalendarClient(input.userId);

    try {
        const channelId = crypto.randomUUID();
        const response = await calendarClient.events.watch({
            calendarId: 'primary',
            requestBody: {
                id: channelId,
                type: 'web_hook',
                address: input.webhookUrl,
            },
        });

        await setJSON(
            `${CHANNEL_KEY_PREFIX}${channelId}`,
            {
                userId: input.userId,
                resourceId: response.data.resourceId,
                expiration: response.data.expiration,
            } satisfies ChannelMetadata,
            DATA_TTL_SECONDS
        );

        return {
            channelId,
            resourceId: response.data.resourceId || '',
            expiration: response.data.expiration || undefined,
        };
    } catch (error) {
        throw new ExternalServiceError(
            'Google Calendar',
            `Start watch failed: ${error instanceof Error ? error.message : 'Unknown error'}`
        );
    }
}

async function applyExternalEventChangesToTask(
    userId: string,
    event: calendar_v3.Schema$Event
): Promise<void> {
    const eventId = event.id;
    if (!eventId) {
        return;
    }

    const taskId = await getMappedTaskId(userId, eventId);
    if (!taskId) {
        return;
    }

    const task = await prisma.task.findUnique({ where: { id: taskId } });
    if (!task) {
        return;
    }

    if (event.status === 'cancelled') {
        await prisma.task.update({
            where: { id: task.id },
            data: {
                status: 'cancelled',
            },
        });
        return;
    }

    const eventEndDateTime = event.end?.dateTime || null;
    if (eventEndDateTime) {
        const parsed = new Date(eventEndDateTime);
        if (!Number.isNaN(parsed.getTime())) {
            await prisma.task.update({
                where: { id: task.id },
                data: {
                    dueDate: parsed,
                },
            });
        }
    }
}

export async function syncCalendarChanges(userId: string): Promise<void> {
    const calendarClient = await getAuthorizedCalendarClient(userId);
    const syncToken = await getSyncToken(userId);

    let pageToken: string | undefined;
    let nextSyncToken: string | undefined;

    try {
        do {
            const response = await calendarClient.events.list({
                calendarId: 'primary',
                singleEvents: true,
                showDeleted: true,
                maxResults: 250,
                pageToken,
                syncToken: syncToken || undefined,
            });

            const events = response.data.items || [];
            for (const event of events) {
                await applyExternalEventChangesToTask(userId, event);
            }

            pageToken = response.data.nextPageToken || undefined;
            nextSyncToken = response.data.nextSyncToken || nextSyncToken;
        } while (pageToken);

        if (nextSyncToken) {
            await saveSyncToken(userId, nextSyncToken);
        }
    } catch (error: any) {
        if (error?.code === 410) {
            await saveSyncToken(userId, '');
            await syncCalendarChanges(userId);
            return;
        }

        throw new ExternalServiceError(
            'Google Calendar',
            `Sync failed: ${error instanceof Error ? error.message : 'Unknown error'}`
        );
    }
}

export async function handleGoogleCalendarWebhook(
    headers: CalendarWebhookHeaders
): Promise<{ synced: boolean; reason?: string }> {
    if (!headers.channelId) {
        throw new BadRequestError('Missing X-Goog-Channel-ID header');
    }

    const channel = await getJSON<ChannelMetadata>(`${CHANNEL_KEY_PREFIX}${headers.channelId}`);
    if (!channel?.userId) {
        return { synced: false, reason: 'Unknown webhook channel' };
    }

    if (headers.resourceState === 'sync') {
        return { synced: false, reason: 'Initial sync notification acknowledged' };
    }

    await syncCalendarChanges(channel.userId);
    return { synced: true };
}

export async function getStoredGoogleTokenMetadata(userId: string): Promise<{
    connected: boolean;
    hasAccessToken: boolean;
    hasRefreshToken: boolean;
    expiryDate?: number;
}> {
    const tokens = await getUserTokens(userId);
    if (!tokens) {
        return {
            connected: false,
            hasAccessToken: false,
            hasRefreshToken: false,
        };
    }

    return {
        connected: true,
        hasAccessToken: Boolean(tokens.access_token),
        hasRefreshToken: Boolean(tokens.refresh_token),
        expiryDate: tokens.expiry_date,
    };
}

