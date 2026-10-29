import 'server-only';

import type { CachedCategory, CachedStream, ContentType } from './dbTypes';
import * as sqlite from './sqliteCache';

export interface XtreamCredentials {
    hostUrl: string;
    username: string;
    password: string;
}

export type SyncStage = 'waiting' | 'downloading' | 'saving' | 'done' | 'error';

export interface SyncProgressUpdate {
    progress: number;
    message: string;
    type?: ContentType;
    /** Where this type is now; the loading screen shows one row per type. */
    stage?: SyncStage;
    processed?: number;
    total?: number;
}

interface SyncStep {
    type: ContentType;
    categoryAction: string;
    streamAction: string;
    /**
     * Fetch the listing one category at a time. Movie/series listings run to
     * tens of MB; throttled panels serve them at ~25 KB/s and drop the socket
     * after a couple of minutes, so one big request never completes, while
     * per-category requests each finish well inside that window.
     */
    perCategory: boolean;
    /** Share of the overall progress bar (roughly the share of the wait). */
    weight: number;
}

const SYNC_STEPS: SyncStep[] = [
    { type: 'live', categoryAction: 'get_live_categories', streamAction: 'get_live_streams', perCategory: false, weight: 0.1 },
    { type: 'movie', categoryAction: 'get_vod_categories', streamAction: 'get_vod_streams', perCategory: true, weight: 0.6 },
    { type: 'series', categoryAction: 'get_series_categories', streamAction: 'get_series', perCategory: true, weight: 0.3 },
];

const SQLITE_BATCH_SIZE = 1000;

function asRecord(value: unknown): Record<string, unknown> {
    return value && typeof value === 'object' ? value as Record<string, unknown> : {};
}

function stringValue(value: unknown): string | undefined {
    if (value === undefined || value === null || value === '') return undefined;
    return String(value);
}

function numberValue(value: unknown): number {
    if (typeof value === 'number') return value;
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : 0;
}

function stringArrayValue(value: unknown): string[] | undefined {
    if (!Array.isArray(value)) return undefined;
    return value.filter(item => typeof item === 'string');
}

function mapCategory(item: unknown, type: ContentType): CachedCategory {
    const record = asRecord(item);

    return {
        category_id: String(record.category_id ?? ''),
        category_name: String(record.category_name ?? ''),
        parent_id: numberValue(record.parent_id),
        type,
    };
}

function mapStream(item: unknown, type: ContentType): CachedStream {
    const record = asRecord(item);

    return {
        id: String(record.stream_id ?? record.series_id ?? ''),
        category_id: String(record.category_id ?? ''),
        name: String(record.name ?? ''),
        type,
        icon: stringValue(record.stream_icon) ?? stringValue(record.cover),
        rating: stringValue(record.rating),
        added: stringValue(record.added),
        container_extension: stringValue(record.container_extension),
        epg_channel_id: stringValue(record.epg_channel_id),
        stream_type: stringValue(record.stream_type),
        cover: stringValue(record.cover),
        plot: stringValue(record.plot),
        cast: stringValue(record.cast),
        director: stringValue(record.director),
        genre: stringValue(record.genre),
        release_date: stringValue(record.releaseDate) ?? stringValue(record.release_date),
        rating_5based: stringValue(record.rating_5based),
        backdrop_path: stringArrayValue(record.backdrop_path),
        last_modified: stringValue(record.last_modified),
    };
}

async function yieldToEventLoop() {
    await new Promise(resolve => setTimeout(resolve, 0));
}

async function fetchWithRetry(url: string, action: string, signal: AbortSignal, maxRetries = 3): Promise<Response> {
    let response: Response | undefined;
    let lastError: unknown;

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
        if (signal.aborted) throw new DOMException('Aborted', 'AbortError');

        try {
            response = await fetch(url, { signal });
            if (response.ok || response.status < 500) break;
        } catch (error) {
            lastError = error;
        }

        if (attempt < maxRetries) {
            console.warn(`[ServerSync] Retry ${attempt + 1}/${maxRetries} for ${action}`);
            await new Promise(resolve => setTimeout(resolve, 1000));
        }
    }

    if (!response) {
        throw lastError instanceof Error ? lastError : new Error(`Failed to fetch ${action}`);
    }

    return response;
}

async function fetchXtreamArray(
    credentials: XtreamCredentials,
    action: string,
    signal: AbortSignal,
    extra: Record<string, string> = {},
): Promise<unknown[]> {
    const baseUrl = credentials.hostUrl.replace(/\/$/, '');
    const params = new URLSearchParams({
        username: credentials.username,
        password: credentials.password,
        action,
        ...extra,
    });
    const url = `${baseUrl}/player_api.php?${params.toString()}`;

    // The movie list is tens of MB; panels often drop the connection halfway
    // through the body ("terminated"/ECONNRESET). fetchWithRetry only covers a
    // failure before the headers, so the whole request is retried here too.
    let lastError: unknown;
    for (let attempt = 0; attempt <= BODY_RETRIES; attempt++) {
        if (signal.aborted) throw new DOMException('Aborted', 'AbortError');
        try {
            const response = await fetchWithRetry(url, action, signal);
            if (!response.ok) {
                throw new Error(`Xtream action ${action} failed: ${response.status} ${response.statusText}`);
            }
            const data = await response.json();
            return Array.isArray(data) ? data : [];
        } catch (error) {
            if (signal.aborted) throw error;
            lastError = error;
            if (attempt < BODY_RETRIES) {
                console.warn(`[ServerSync] ${action} interrupted, retrying (${attempt + 1}/${BODY_RETRIES})`);
                await new Promise(resolve => setTimeout(resolve, 1500 * (attempt + 1)));
            }
        }
    }
    throw lastError instanceof Error ? lastError : new Error(`Failed to fetch ${action}`);
}

const BODY_RETRIES = 3;

/** Share of one type's work, 0..1. */
function stepFraction(stage: SyncStage, processed: number, total: number): number {
    if (stage === 'done') return 1;
    if (total > 0 && (stage === 'downloading' || stage === 'saving')) return Math.min(1, processed / total);
    return stage === 'downloading' ? 0.02 : 0;
}

// The live list arrives in one piece (tens of thousands of channels) and SQLite
// writes are synchronous: yielding between batches keeps the relay answering the
// channel the user is already trying to watch while the catalog is still saving.
async function saveBatch(rawStreams: unknown[], type: ContentType, keepIds: string[]) {
    for (let index = 0; index < rawStreams.length; index += SQLITE_BATCH_SIZE) {
        const batch = rawStreams
            .slice(index, index + SQLITE_BATCH_SIZE)
            .map(item => mapStream(item, type))
            .filter(stream => stream.id && stream.category_id && stream.name);
        sqlite.saveStreams(batch);
        for (const stream of batch) keepIds.push(String(stream.id));
        await yieldToEventLoop();
    }
}

export async function syncXtreamToSqlite(
    credentials: XtreamCredentials,
    signal: AbortSignal,
    onProgress: (update: SyncProgressUpdate) => void
) {
    const fractions: Record<ContentType, number> = { live: 0, movie: 0, series: 0 };
    const report = (step: SyncStep, stage: SyncStage, message: string, processed = 0, total = 0) => {
        fractions[step.type] = stepFraction(stage, processed, total);
        const overall = SYNC_STEPS.reduce((sum, item) => sum + fractions[item.type] * item.weight, 0);
        onProgress({ progress: Math.round(overall * 100), message, type: step.type, stage, processed, total });
    };

    // One provider request at a time, one type after another: Xtream accounts
    // often allow a single connection (max_connections: 1) and reset extras.
    for (const step of SYNC_STEPS) {
        if (signal.aborted) throw new DOMException('Aborted', 'AbortError');
        try {
            report(step, 'downloading', `Baixando ${step.type}`);
            const categories = (await fetchXtreamArray(credentials, step.categoryAction, signal))
                .map(item => mapCategory(item, step.type))
                .filter(category => category.category_id);
            sqlite.saveCategories(categories);
            sqlite.pruneCategories(step.type, categories.map(category => category.category_id));

            const keepIds: string[] = [];
            if (step.perCategory && categories.length > 0) {
                // Each category is written as soon as it arrives, so the catalog
                // fills in steadily and the progress counts real categories.
                for (let index = 0; index < categories.length; index++) {
                    if (signal.aborted) throw new DOMException('Aborted', 'AbortError');
                    const rows = await fetchXtreamArray(credentials, step.streamAction, signal, {
                        category_id: categories[index].category_id,
                    });
                    await saveBatch(rows, step.type, keepIds);
                    report(step, 'downloading', `Baixando ${step.type}`, index + 1, categories.length);
                    await yieldToEventLoop();
                }
            } else {
                const rows = await fetchXtreamArray(credentials, step.streamAction, signal);
                report(step, 'saving', `Gravando ${step.type}`, 0, rows.length);
                await saveBatch(rows, step.type, keepIds);
                await yieldToEventLoop();
            }

            // Only after the whole listing arrived, so a half-finished step never
            // deletes content the provider still has.
            const removed = sqlite.pruneStreams(step.type, keepIds);
            if (removed > 0) {
                console.log(`[ServerSync] Removed ${removed} ${step.type} entries no longer offered by the provider`);
            }
            report(step, 'done', `${step.type} pronto`, keepIds.length, keepIds.length);
        } catch (error) {
            if (!signal.aborted) report(step, 'error', `Falha ao baixar ${step.type}`);
            throw error;
        }
    }

    const timestamp = Date.now();
    sqlite.saveSyncMetadata({ type: 'categories', lastSync: timestamp });

    onProgress({
        progress: 100,
        message: 'Sincronizacao concluida',
    });

    return timestamp;
}
