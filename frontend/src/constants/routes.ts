/**
 * Application route paths — single source of truth
 */

export const ROUTES = {
    LOGIN: '/login',
    REGISTER: '/register',
    FORGOT_PASSWORD: '/forgot-password',
    DASHBOARD: '/dashboard',
    WORKSPACES: '/workspaces',
    WORKSPACE_DETAIL: (id: string) => `/workspaces/${id}`,
    MEETINGS: '/meetings',
    MEETING_DETAIL: (id: string) => `/meetings/${id}`,
    MEETING_LIVE: (id: string) => `/meetings/${id}/live`,
    MY_TASKS: '/tasks/my',
    ALL_TASKS: '/tasks/all',
    TASK_DETAIL: (id: string) => `/tasks/${id}`,
    SETTINGS_PROFILE: '/settings/profile',
    SETTINGS_NOTIFICATIONS: '/settings/notifications',
    SETTINGS_INTEGRATIONS: '/settings/integrations',
} as const;
