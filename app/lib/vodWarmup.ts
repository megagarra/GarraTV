import { apiUrl } from '@/app/lib/apiClient';

/**
 * Xtream panels answer every VOD request with a slow 302 to a tokenized CDN
 * URL. Both VOD proxies (the Next route and the Android VodProxy) remember
 * where a title redirected to, so a HEAD sent while the user is still on the
 * title screen makes the real "Play" go straight to the CDN.
 *
 * Only call this where nothing else is playing: on accounts limited to one
 * connection, a warm-up next to a running stream could cost that stream.
 */
const WARM_TTL_MS = 4 * 60_000;
const warmed = new Map<string, number>();

export function vodPath(type: 'movie' | 'series', id: string | number, ext: string): string {
    return `/api/vod/${type}/${encodeURIComponent(`${id}.${ext}`)}`;
}

export function warmVod(type: 'movie' | 'series', id: string | number, ext: string | undefined): void {
    if (!id || !ext) return;
    const path = vodPath(type, id, ext);
    const last = warmed.get(path);
    if (last && Date.now() - last < WARM_TTL_MS) return;
    warmed.set(path, Date.now());
    fetch(apiUrl(path), { method: 'HEAD', cache: 'no-store' }).catch(() => warmed.delete(path));
}
