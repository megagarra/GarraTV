/**
 * Where the viewer was on a browsing screen (live, movies, series): category,
 * search, layout, the item the remote was on and how far the list was scrolled.
 * Opening a title unmounts the screen; coming back with Back used to start over
 * at "All", at the top, with the cursor on the first item. Kept in memory for the
 * session, which is what Back needs.
 */
export interface ScreenState {
    filter?: string;
    query?: string;
    mode?: 'list' | 'grid';
    /** The live channel playing in the preview. */
    selectedId?: string | null;
    /** `data-favorite-id` of the item the remote was on. */
    focusId?: string | null;
    scrollTop?: number;
}

const screens = new Map<string, ScreenState>();

export function recallScreen(key: string): ScreenState | undefined {
    return screens.get(key);
}

export function rememberScreen(key: string, patch: ScreenState): void {
    screens.set(key, { ...screens.get(key), ...patch });
}

/** The item a focus event landed on (a poster or a channel), if any. */
export function itemIdFromEvent(event: { target: EventTarget | null }): string | null {
    const element = event.target instanceof Element ? event.target.closest('[data-favorite-id]') : null;
    return element ? element.getAttribute('data-favorite-id') : null;
}

const RESTORE_ATTEMPTS = 40;
const RESTORE_INTERVAL_MS = 50;

/**
 * Scrolls back to where the list was and focuses the item that had the remote.
 * Long lists render only the rows on screen and load further pages as they near
 * the end, so the scroll is re-applied until the item exists. Falls back to
 * `fallback` (the screen's usual first focus) when it never shows up.
 */
export function restoreFocus(options: {
    scroller: HTMLElement | null;
    scrollTop: number;
    itemId: string;
    fallback: () => void;
}): () => void {
    let cancelled = false;
    let attempt = 0;
    let timer = 0;
    const find = () => {
        const candidates = document.querySelectorAll<HTMLElement>('[data-favorite-id]');
        for (let i = 0; i < candidates.length; i++) {
            if (candidates[i].getAttribute('data-favorite-id') === options.itemId) return candidates[i];
        }
        return null;
    };
    const step = () => {
        if (cancelled) return;
        if (options.scroller) options.scroller.scrollTop = options.scrollTop;
        const target = find();
        if (target) {
            target.focus();
            // focus() may nudge the list to fit the item; the saved spot wins.
            if (options.scroller) options.scroller.scrollTop = options.scrollTop;
            return;
        }
        attempt += 1;
        if (attempt >= RESTORE_ATTEMPTS) {
            options.fallback();
            return;
        }
        timer = window.setTimeout(step, RESTORE_INTERVAL_MS);
    };
    step();
    return () => {
        cancelled = true;
        window.clearTimeout(timer);
    };
}
