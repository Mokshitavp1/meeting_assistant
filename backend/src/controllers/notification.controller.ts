import { Request, Response, NextFunction } from 'express';
import {
    asyncHandler,
    AuthorizationError,
    BadRequestError,
} from '../middleware/error.middleware';
import { getJSON, setJSON } from '../config/redis';

const NOTIFICATION_KEY_PREFIX = 'notifications:user:';
const NOTIFICATION_TTL_SECONDS = 60 * 60 * 24 * 30; // 30 days
const MAX_NOTIFICATIONS = 200;

export interface InAppNotification {
    id: string;
    type: 'task-assignment' | 'task-reminder' | 'task-overdue' | 'meeting-review-ready';
    title: string;
    message: string;
    taskId?: string;
    meetingId?: string;
    meetingTitle?: string;
    createdAt: string;
    read: boolean;
}

/**
 * GET /api/v1/notifications
 * Returns the current user's in-app notifications (from Redis)
 */
export const listNotifications = asyncHandler(
    async (req: Request, res: Response, _next: NextFunction): Promise<void> => {
        if (!req.user) {
            throw new AuthorizationError('Authentication required');
        }

        const key = `${NOTIFICATION_KEY_PREFIX}${req.user.id}`;
        const notifications: InAppNotification[] = (await getJSON<InAppNotification[]>(key)) || [];

        const unreadCount = notifications.filter((n) => !n.read).length;

        res.status(200).json({
            success: true,
            data: {
                notifications,
                unreadCount,
                total: notifications.length,
            },
        });
    }
);

/**
 * PATCH /api/v1/notifications/:id/read
 * Mark a single notification as read
 */
export const markNotificationRead = asyncHandler(
    async (req: Request, res: Response, _next: NextFunction): Promise<void> => {
        if (!req.user) {
            throw new AuthorizationError('Authentication required');
        }

        const { id } = req.params;
        if (!id) {
            throw new BadRequestError('Notification id is required');
        }

        const key = `${NOTIFICATION_KEY_PREFIX}${req.user.id}`;
        const notifications: InAppNotification[] = (await getJSON<InAppNotification[]>(key)) || [];

        const updated = notifications.map((n) =>
            n.id === id ? { ...n, read: true } : n
        );

        await setJSON(key, updated, NOTIFICATION_TTL_SECONDS);

        res.status(200).json({ success: true, message: 'Notification marked as read' });
    }
);

/**
 * PATCH /api/v1/notifications/read-all
 * Mark all notifications as read
 */
export const markAllNotificationsRead = asyncHandler(
    async (req: Request, res: Response, _next: NextFunction): Promise<void> => {
        if (!req.user) {
            throw new AuthorizationError('Authentication required');
        }

        const key = `${NOTIFICATION_KEY_PREFIX}${req.user.id}`;
        const notifications: InAppNotification[] = (await getJSON<InAppNotification[]>(key)) || [];

        const updated = notifications.map((n) => ({ ...n, read: true }));
        await setJSON(key, updated, NOTIFICATION_TTL_SECONDS);

        res.status(200).json({ success: true, message: 'All notifications marked as read' });
    }
);

/**
 * DELETE /api/v1/notifications/:id
 * Delete a single notification
 */
export const deleteNotification = asyncHandler(
    async (req: Request, res: Response, _next: NextFunction): Promise<void> => {
        if (!req.user) {
            throw new AuthorizationError('Authentication required');
        }

        const { id } = req.params;
        if (!id) {
            throw new BadRequestError('Notification id is required');
        }

        const key = `${NOTIFICATION_KEY_PREFIX}${req.user.id}`;
        const notifications: InAppNotification[] = (await getJSON<InAppNotification[]>(key)) || [];

        const updated = notifications.filter((n) => n.id !== id);
        await setJSON(key, updated, NOTIFICATION_TTL_SECONDS);

        res.status(200).json({ success: true, message: 'Notification deleted' });
    }
);
