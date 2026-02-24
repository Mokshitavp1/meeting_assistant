import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import request from 'supertest';
import type { Application } from 'express';
import { describe, it, expect, beforeAll, beforeEach, afterEach, afterAll, jest } from '@jest/globals';

jest.mock('@aws-sdk/client-s3', () => ({
    S3Client: class {
        send = jest.fn<() => Promise<Record<string, never>>>().mockResolvedValue({});
    },
    PutObjectCommand: jest.fn(),
    DeleteObjectCommand: jest.fn(),
    GetObjectCommand: jest.fn(),
}));

jest.mock('@aws-sdk/s3-request-presigner', () => ({
    getSignedUrl: jest
        .fn<() => Promise<string>>()
        .mockResolvedValue('https://example.com/signed-url'),
}));

import { prisma, DatabaseClient } from '../../src/config/database';

type TestUser = {
    id: string;
    email: string;
    token: string;
};

type SeedState = {
    creator: TestUser;
    member: TestUser;
    outsider: TestUser;
    workspaceId: string;
    meetingId: string;
};

let app: Application;
let jwtUtil: typeof import('../../src/utils/jwt.util');
let seed: SeedState;

function uniqueEmail(prefix: string): string {
    return `${prefix}.${Date.now()}.${Math.random().toString(36).slice(2, 8)}@example.com`;
}

async function cleanupTestData(): Promise<void> {
    await prisma.meetingParticipant.deleteMany({
        where: {
            OR: [
                { user: { email: { contains: '@example.com' } } },
                { meeting: { title: { startsWith: '[itest]' } } },
            ],
        },
    });

    await prisma.task.deleteMany({
        where: {
            OR: [
                { title: { startsWith: '[itest]' } },
                { meeting: { title: { startsWith: '[itest]' } } },
            ],
        },
    });

    await prisma.meeting.deleteMany({
        where: {
            title: { startsWith: '[itest]' },
        },
    });

    await prisma.workspaceMember.deleteMany({
        where: {
            user: { email: { contains: '@example.com' } },
        },
    });

    await prisma.workspace.deleteMany({
        where: {
            name: { startsWith: '[itest]' },
        },
    });

    await prisma.refreshToken.deleteMany({
        where: {
            user: { email: { contains: '@example.com' } },
        },
    });

    await prisma.user.deleteMany({
        where: {
            email: { contains: '@example.com' },
        },
    });
}

async function createTestUser(email: string, name: string): Promise<TestUser> {
    const user = await prisma.user.create({
        data: {
            email,
            password: 'hashed-password-for-integration-tests',
            name,
            role: 'user',
            isActive: true,
            isEmailVerified: true,
        },
    });

    return {
        id: user.id,
        email: user.email,
        token: jwtUtil.generateAccessToken(user.id, user.email),
    };
}

async function seedMeetingGraph(): Promise<SeedState> {
    const creator = await createTestUser(uniqueEmail('creator'), 'Creator User');
    const member = await createTestUser(uniqueEmail('member'), 'Member User');
    const outsider = await createTestUser(uniqueEmail('outsider'), 'Outsider User');

    const workspace = await prisma.workspace.create({
        data: {
            name: `[itest] workspace ${Date.now()}`,
            description: 'integration workspace',
            inviteCode: `itest-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
        },
    });

    await prisma.workspaceMember.createMany({
        data: [
            { workspaceId: workspace.id, userId: creator.id, role: 'admin' },
            { workspaceId: workspace.id, userId: member.id, role: 'member' },
        ],
    });

    const meeting = await prisma.meeting.create({
        data: {
            title: `[itest] seeded meeting ${Date.now()}`,
            description: 'seeded meeting for integration tests',
            workspaceId: workspace.id,
            scheduledStartTime: new Date(Date.now() + 60 * 60 * 1000),
            createdById: creator.id,
            participants: {
                create: [
                    { userId: creator.id, role: 'organizer' },
                    { userId: member.id, role: 'participant' },
                ],
            },
        },
    });

    return {
        creator,
        member,
        outsider,
        workspaceId: workspace.id,
        meetingId: meeting.id,
    };
}

describe('Meeting API Integration', () => {
    beforeAll(async () => {
        process.env.NODE_ENV = 'test';
        process.env.JWT_ACCESS_SECRET = process.env.JWT_ACCESS_SECRET || 'integration-access-secret';
        process.env.JWT_REFRESH_SECRET = process.env.JWT_REFRESH_SECRET || 'integration-refresh-secret';
        process.env.JWT_ISSUER = process.env.JWT_ISSUER || 'ai-meeting-assistant';
        process.env.JWT_AUDIENCE = process.env.JWT_AUDIENCE || 'api';
        process.env.RATE_LIMIT_ENABLED = 'false';

        jwtUtil = await import('../../src/utils/jwt.util');
        app = (await import('../../src/app')).default;

        await DatabaseClient.connect();
    });

    beforeEach(async () => {
        await cleanupTestData();
        seed = await seedMeetingGraph();
    });

    afterEach(async () => {
        await cleanupTestData();
    });

    afterAll(async () => {
        await DatabaseClient.disconnect();
    });

    it('creates meeting for authenticated user', async () => {
        const response = await request(app)
            .post('/api/v1/meetings')
            .set('Authorization', `Bearer ${seed.creator.token}`)
            .send({
                title: '[itest] created meeting',
                description: 'created via integration test',
                workspaceId: seed.workspaceId,
                scheduledStartTime: new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString(),
                participantIds: [seed.member.id],
            });

        expect(response.status).toBe(201);
        expect(response.body.success).toBe(true);
        expect(response.body.data.meeting.title).toBe('[itest] created meeting');
        expect(response.body.data.meeting.workspaceId).toBe(seed.workspaceId);
    });

    it('uploads recording for authenticated workspace member', async () => {
        const fakeRecordingPath = path.join(
            os.tmpdir(),
            `itest-recording-${Date.now()}.wav`
        );
        await fs.writeFile(fakeRecordingPath, Buffer.from('RIFF....WAVEfmt '));

        const response = await request(app)
            .post(`/api/v1/meetings/${seed.meetingId}/recording`)
            .set('Authorization', `Bearer ${seed.member.token}`)
            .attach('recording', fakeRecordingPath);

        expect(response.status).toBe(200);
        expect(response.body.success).toBe(true);
        expect(response.body.data.recordingUrl).toEqual(expect.any(String));

        await fs.unlink(fakeRecordingPath).catch(() => undefined);
    });

    it('starts meeting', async () => {
        const response = await request(app)
            .post(`/api/v1/meetings/${seed.meetingId}/start`)
            .set('Authorization', `Bearer ${seed.creator.token}`)
            .send();

        expect(response.status).toBe(200);
        expect(response.body.success).toBe(true);
        expect(response.body.data.meeting.status).toBe('in_progress');
    });

    it('ends meeting', async () => {
        await request(app)
            .post(`/api/v1/meetings/${seed.meetingId}/start`)
            .set('Authorization', `Bearer ${seed.creator.token}`)
            .send();

        const response = await request(app)
            .post(`/api/v1/meetings/${seed.meetingId}/end`)
            .set('Authorization', `Bearer ${seed.creator.token}`)
            .send();

        expect(response.status).toBe(200);
        expect(response.body.success).toBe(true);
        expect(response.body.data.meeting.status).toBe('completed');
    });

    it('triggers AI processing', async () => {
        await prisma.meeting.update({
            where: { id: seed.meetingId },
            data: {
                recordingUrl: 'https://example.com/fake-recording.wav',
                recordingPath: 'recordings/fake-recording.wav',
            },
        });

        const response = await request(app)
            .post(`/api/v1/meetings/${seed.meetingId}/process`)
            .set('Authorization', `Bearer ${seed.creator.token}`)
            .send();

        expect(response.status).toBe(202);
        expect(response.body.success).toBe(true);
        expect(response.body.data.meetingId).toBe(seed.meetingId);
        expect(response.body.data.status).toBe('processing');
    });

    it('gets meeting details for member', async () => {
        const response = await request(app)
            .get(`/api/v1/meetings/${seed.meetingId}`)
            .set('Authorization', `Bearer ${seed.member.token}`);

        expect(response.status).toBe(200);
        expect(response.body.success).toBe(true);
        expect(response.body.data.meeting.id).toBe(seed.meetingId);
    });

    it('denies access for non-members', async () => {
        const response = await request(app)
            .get(`/api/v1/meetings/${seed.meetingId}`)
            .set('Authorization', `Bearer ${seed.outsider.token}`);

        expect(response.status).toBe(403);
        expect(response.body.success).toBe(false);
    });
});
