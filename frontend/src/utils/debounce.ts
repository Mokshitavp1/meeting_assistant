/**
 * Debounce & Throttle utilities
 * Prevent excessive re-calls of expensive operations (search, resize, etc.)
 */

/**
 * Debounce: delays invocation until `wait` ms after the last call
 *
 * @example
 * ```ts
 * const search = debounce((q: string) => fetchResults(q), 300);
 * input.addEventListener('input', (e) => search(e.target.value));
 * ```
 */
export function debounce<T extends (...args: unknown[]) => unknown>(
    fn: T,
    wait: number
): (...args: Parameters<T>) => void {
    let timer: ReturnType<typeof setTimeout> | null = null;

    return (...args: Parameters<T>) => {
        if (timer) clearTimeout(timer);
        timer = setTimeout(() => {
            fn(...args);
            timer = null;
        }, wait);
    };
}

/**
 * Throttle: invokes at most once per `limit` ms
 *
 * @example
 * ```ts
 * const onScroll = throttle(() => checkVisibility(), 200);
 * window.addEventListener('scroll', onScroll);
 * ```
 */
export function throttle<T extends (...args: unknown[]) => unknown>(
    fn: T,
    limit: number
): (...args: Parameters<T>) => void {
    let waiting = false;

    return (...args: Parameters<T>) => {
        if (waiting) return;
        fn(...args);
        waiting = true;
        setTimeout(() => {
            waiting = false;
        }, limit);
    };
}
