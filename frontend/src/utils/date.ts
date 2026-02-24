/**
 * Date formatting utilities
 * Thin wrappers around date-fns for consistent date handling
 */
import {
    format,
    formatDistanceToNow,
    isAfter,
    isBefore,
    parseISO,
    differenceInMinutes,
    differenceInHours,
    differenceInDays,
} from 'date-fns';

/** Parse an ISO string safely (returns Date from string or as-is if already Date) */
export function toDate(value: string | Date): Date {
    return typeof value === 'string' ? parseISO(value) : value;
}

/** Format a date for display: "Feb 24, 2026 10:30 AM" */
export function formatDateTime(value: string | Date): string {
    return format(toDate(value), 'MMM d, yyyy h:mm a');
}

/** Format date only: "Feb 24, 2026" */
export function formatDate(value: string | Date): string {
    return format(toDate(value), 'MMM d, yyyy');
}

/** Format time only: "10:30 AM" */
export function formatTime(value: string | Date): string {
    return format(toDate(value), 'h:mm a');
}

/** Human-readable relative time: "3 hours ago", "in 2 days" */
export function formatRelative(value: string | Date): string {
    return formatDistanceToNow(toDate(value), { addSuffix: true });
}

/** Deadline label with urgency coloring: "3d left", "2h left", "1d overdue" */
export function formatDeadline(value: string | Date): { label: string; urgency: 'overdue' | 'urgent' | 'soon' | 'normal' } {
    const date = toDate(value);
    const now = new Date();

    if (isBefore(date, now)) {
        const days = differenceInDays(now, date);
        const hours = differenceInHours(now, date);
        const label = days > 0 ? `${days}d overdue` : `${hours}h overdue`;
        return { label, urgency: 'overdue' };
    }

    const days = differenceInDays(date, now);
    const hours = differenceInHours(date, now);
    const minutes = differenceInMinutes(date, now);

    if (days > 3) return { label: `${days}d left`, urgency: 'normal' };
    if (days > 0) return { label: `${days}d left`, urgency: 'soon' };
    if (hours > 0) return { label: `${hours}h left`, urgency: 'urgent' };
    return { label: `${minutes}m left`, urgency: 'urgent' };
}

/** Check if a date is in the past */
export function isPast(value: string | Date): boolean {
    return isBefore(toDate(value), new Date());
}

/** Check if a date is in the future */
export function isFuture(value: string | Date): boolean {
    return isAfter(toDate(value), new Date());
}
