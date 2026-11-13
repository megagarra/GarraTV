import { apiFetch } from '@/app/lib/apiClient';
import * as db from '@/app/lib/db';
import { recallDetail, rememberDetail } from '@/app/lib/detailMemo';

type DetailKind = 'movie' | 'series';

/** What the title screen and the player need from a detail before they can use it. */
export function isCompleteDetail(kind: DetailKind, payload: unknown): boolean {
    if (!payload || typeof payload !== 'object') return false;
    const value = payload as { info?: unknown; movie_data?: unknown; episodes?: unknown };
    return !!value.info && (kind === 'movie' ? !!value.movie_data : !!value.episodes);
}

let inFlight: string | null = null;

/**
 * Fetches a title's detail into memory while the remote rests on its poster, so
 * the title screen opens complete and "Watch" needs no round-trip. One at a
 * time: scrolling past a row must not queue a burst of provider calls.
 */
export function prefetchDetail(kind: DetailKind, id: string): void {
    const key = `${kind}:${id}`;
    if (inFlight || isCompleteDetail(kind, recallDetail(kind, id))) return;
    inFlight = key;
    (async () => {
        const cached = await db.getDetail(kind, id);
        if (isCompleteDetail(kind, cached)) {
            rememberDetail(kind, id, cached);
            return;
        }
        const response = await apiFetch('/api/proxy', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(kind === 'movie'
                ? { action: 'get_vod_info', vod_id: id }
                : { action: 'get_series_info', series_id: id }),
        });
        const data: unknown = await response.json();
        if (!isCompleteDetail(kind, data)) return;
        rememberDetail(kind, id, data);
        await db.saveDetail(kind, id, data);
    })()
        .catch(() => undefined)
        .then(() => {
            inFlight = null;
        });
}

const TITLE_HREF = /\/garratv\/title\/(movie|series)\/([^/?#]+)/;

/**
 * Focus handler for a container of title links: the poster the remote stays on
 * for a moment gets its detail prefetched. Returns the handler and a cancel.
 */
export function createLingerPrefetch(delayMs = 500): { onFocus: (event: { target: EventTarget | null }) => void; cancel: () => void } {
    let timer = 0;
    const cancel = () => window.clearTimeout(timer);
    const onFocus = (event: { target: EventTarget | null }) => {
        cancel();
        const link = event.target instanceof Element ? event.target.closest('a[href]') : null;
        const match = link ? TITLE_HREF.exec(link.getAttribute('href') || '') : null;
        if (!match) return;
        const kind = match[1] as DetailKind;
        const id = decodeURIComponent(match[2]);
        timer = window.setTimeout(() => prefetchDetail(kind, id), delayMs);
    };
    return { onFocus, cancel };
}
