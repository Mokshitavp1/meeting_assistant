/**
 * LocalStorage wrapper with JSON serialization, error handling, and type safety
 */

const PREFIX = 'meeting_';

function prefixKey(key: string): string {
    return `${PREFIX}${key}`;
}

export function getItem<T>(key: string, fallback: T): T {
    try {
        const raw = localStorage.getItem(prefixKey(key));
        return raw !== null ? (JSON.parse(raw) as T) : fallback;
    } catch {
        return fallback;
    }
}

export function setItem<T>(key: string, value: T): void {
    try {
        localStorage.setItem(prefixKey(key), JSON.stringify(value));
    } catch (err) {
        console.warn(`[storage] Failed to set "${key}"`, err);
    }
}

export function removeItem(key: string): void {
    try {
        localStorage.removeItem(prefixKey(key));
    } catch {
        // Ignore
    }
}

export function clear(): void {
    try {
        const keys = Object.keys(localStorage).filter((k) => k.startsWith(PREFIX));
        keys.forEach((k) => localStorage.removeItem(k));
    } catch {
        // Ignore
    }
}

export default { getItem, setItem, removeItem, clear };
