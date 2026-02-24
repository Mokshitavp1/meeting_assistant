import { Router } from 'express';

/**
 * Main API Router
 * Centralizes all route modules and provides API versioning
 */

// Import route modules
// Note: Uncomment and create the corresponding route files as needed

import authRoutes from './auth.routes';
import workspaceRoutes from './workspace.routes';
import meetingRoutes from './meeting.routes';
import taskRoutes from './task.routes';

// Import middleware
import { authLimiter } from '../app';

/**
 * Create API v1 Router
 */
const createV1Router = (): Router => {
    const router = Router();

    // ======================
    // PUBLIC ROUTES
    // ======================

    // Authentication routes (public with rate limiting)
    router.use('/auth', authLimiter, authRoutes);

    // ======================
    // PROTECTED ROUTES
    // ======================
    // Note: Add authentication middleware to protected routes
    // Example: router.use('/users', authenticate, userRoutes);

    // User management routes
    // router.use('/users', userRoutes);

    // Workspace management routes
    router.use('/workspaces', workspaceRoutes);

    // Meeting management routes
    router.use('/meetings', meetingRoutes);

    // Task management routes
    router.use('/tasks', taskRoutes);

    // Transcription routes (AI transcription services)
    // router.use('/transcriptions', transcriptionRoutes);

    // Summary routes (AI-generated meeting summaries)
    // router.use('/summaries', summaryRoutes);

    // Action item routes (extracted from meetings)
    // router.use('/action-items', actionItemRoutes);

    // Integration routes (Google Calendar, Slack, etc.)
    // router.use('/integrations', integrationRoutes);

    // Notification routes
    // router.use('/notifications', notificationRoutes);

    // Search routes (full-text search across meetings, transcripts)
    // router.use('/search', searchRoutes);

    // Analytics routes (usage statistics, insights)
    // router.use('/analytics', analyticsRoutes);

    // Settings routes (user preferences, workspace settings)
    // router.use('/settings', settingsRoutes);

    // API v1 info endpoint
    router.get('/', (req, res) => {
        res.json({
            version: 'v1',
            name: 'AI Meeting Assistant API',
            endpoints: {
                auth: '/api/v1/auth',
                users: '/api/v1/users',
                workspaces: '/api/v1/workspaces',
                meetings: '/api/v1/meetings',
                tasks: '/api/v1/tasks',
                transcriptions: '/api/v1/transcriptions',
                summaries: '/api/v1/summaries',
                actionItems: '/api/v1/action-items',
                integrations: '/api/v1/integrations',
                notifications: '/api/v1/notifications',
                search: '/api/v1/search',
                analytics: '/api/v1/analytics',
                settings: '/api/v1/settings',
            },
            timestamp: new Date().toISOString(),
        });
    });

    return router;
};

/**
 * Main API Router with versioning
 */
const apiRouter = Router();

// Mount API versions
apiRouter.use('/v1', createV1Router());

// Default version redirect (latest)
apiRouter.get('/', (req, res) => {
    res.redirect('/api/v1');
});

// API version info
apiRouter.get('/versions', (req, res) => {
    res.json({
        versions: ['v1'],
        latest: 'v1',
        deprecated: [],
        timestamp: new Date().toISOString(),
    });
});

export default apiRouter;
export { createV1Router };
