import { apiFetch } from '@/app/lib/apiClient';

export interface EpgEntry {
    title: string;
    description: string;
    start: number;
    end: number;
}

function looksLikeBase64(value: string): boolean {
    return value.length >= 4 && value.length % 4 === 0 && /^[A-Za-z0-9+/]+={0,2}$/.test(value);
}

/** Xtream often base64-encodes EPG title and description. Plain text is kept as sent. */
export function decodeEpgField(value: unknown): string {
    if (typeof value !== 'string') return '';
    const trimmed = value.trim();
    if (!trimmed || !looksLikeBase64(trimmed)) return trimmed;

    try {
        const binary = atob(trimmed);
        const bytes = new Uint8Array(binary.length);
        for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
        const decoded = new TextDecoder('utf-8').decode(bytes).trim();
        if (!decoded || decoded.indexOf('\uFFFD') !== -1) return trimmed;
        return decoded;
    } catch {
        return trimmed;
    }
}

export function parseEpgPayload(payload: unknown): EpgEntry[] {
    if (!payload || typeof payload !== 'object') return [];
    const listings = (payload as { epg_listings?: unknown }).epg_listings;
    if (!Array.isArray(listings)) return [];

    const entries: EpgEntry[] = [];
    for (const item of listings) {
        if (!item || typeof item !== 'object') continue;
        const row = item as Record<string, unknown>;
        const start = Number(row.start_timestamp);
        const end = Number(row.stop_timestamp);
        const title = decodeEpgField(row.title);
        const description = decodeEpgField(row.description);
        if (!title && !description) continue;
        entries.push({
            title,
            description,
            start: Number.isFinite(start) ? start : 0,
            end: Number.isFinite(end) ? end : 0,
        });
    }
    return entries;
}

export function splitNowNext(entries: EpgEntry[], nowSec: number): { now?: EpgEntry; next?: EpgEntry } {
    const index = entries.findIndex((entry) => entry.start > 0 && entry.end > entry.start && entry.start <= nowSec && nowSec < entry.end);
    const current = index >= 0 ? entries[index] : entries[0];
    if (!current) return {};
    const currentIndex = index >= 0 ? index : 0;
    return { now: current, next: entries[currentIndex + 1] };
}

export function epgProgress(entry: EpgEntry, nowSec: number): number {
    if (!entry.start || !entry.end || entry.end <= entry.start) return 0;
    const ratio = (nowSec - entry.start) / (entry.end - entry.start);
    if (ratio <= 0) return 0;
    if (ratio >= 1) return 1;
    return ratio;
}

export function formatEpgTime(unixSec: number, locale: string): string {
    if (!unixSec) return '';
    return new Date(unixSec * 1000).toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit' });
}

const CACHE_TTL_MS = 10 * 60 * 1000;
const MAX_CONCURRENT = 3;
const epgCache = new Map<string, { at: number; request: Promise<EpgEntry[]> }>();
const waiting: (() => void)[] = [];
let running = 0;

// Every visible channel row asks for its guide; a small queue keeps that from
// turning into a burst of provider requests while the list scrolls.
function enqueue<T>(task: () => Promise<T>): Promise<T> {
    return new Promise<T>((resolve, reject) => {
        const run = () => {
            running++;
            task().then(resolve, reject).then(() => {
                running--;
                const next = waiting.shift();
                if (next) next();
            });
        };
        if (running < MAX_CONCURRENT) run();
        else waiting.push(run);
    });
}

/** Short EPG for one channel, cached per channel/limit for a few minutes. */
export function loadShortEpg(streamId: string, limit: number): Promise<EpgEntry[]> {
    const key = `${streamId}|${limit}`;
    const cached = epgCache.get(key);
    if (cached && Date.now() - cached.at < CACHE_TTL_MS) return cached.request;

    const request = enqueue(async () => {
        const response = await apiFetch('/api/proxy', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ action: 'get_short_epg', stream_id: streamId, limit }),
        });
        return parseEpgPayload(await response.json());
    }).catch((err: unknown) => {
        console.error('[StreamFlix] EPG request failed', err);
        epgCache.delete(key);
        return [] as EpgEntry[];
    });

    epgCache.set(key, { at: Date.now(), request });
    return request;
}

/** "1h 30min" / "45 min" from a programme's bounds. */
export function formatEpgDuration(entry: EpgEntry): string {
    if (!entry.start || !entry.end || entry.end <= entry.start) return '';
    const minutes = Math.round((entry.end - entry.start) / 60);
    const hours = Math.floor(minutes / 60);
    const rest = minutes % 60;
    if (!hours) return `${minutes} min`;
    return rest ? `${hours}h ${rest}min` : `${hours}h`;
}
