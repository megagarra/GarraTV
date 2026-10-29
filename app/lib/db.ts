import type { CachedCategory, CachedStream, ContentType, SavedSubtitle, SyncMetadata } from './dbTypes';
import { apiFetch } from './apiClient';

export type { CachedCategory, CachedStream, ContentType, SavedSubtitle, SyncMetadata };

interface CacheResponse<T> {
    data: T | null;
}

/**
 * Catalog reads only change when a sync finishes (DataContext then calls
 * clearClientCache), so navigating Home -> Filmes -> Detalhe -> back reuses them
 * instead of asking the server again. Concurrent identical requests share one fetch.
 */
const CACHEABLE = new Set([
    'getCategories',
    'getStreams',
    'searchStreams',
    'getStreamCount',
    'getCategoryCounts',
    'listCatalog',
    'pageCatalog',
    'countDatedStreams',
    'listStreams',
    'getRecentStreams',
    'getStreamsByIds',
    'getDetail',
]);
const CLIENT_CACHE_TTL_MS = 10 * 60 * 1000;
const MAX_CLIENT_CACHE_ENTRIES = 300;

interface ClientCacheEntry {
    at: number;
    value: Promise<unknown>;
}

const clientCache = new Map<string, ClientCacheEntry>();

/** Drops every cached catalog read; called when a sync completes. */
export function clearClientCache(): void {
    clientCache.clear();
}

function forgetDetail(type: ContentType, id: string | number) {
    clientCache.delete(`getDetail:${JSON.stringify({ type, id })}`);
}

async function requestCache<T>(action: string, payload: Record<string, unknown> = {}): Promise<T | undefined> {
    if (!CACHEABLE.has(action)) return fetchLibrary<T>(action, payload);

    const key = `${action}:${JSON.stringify(payload)}`;
    const hit = clientCache.get(key);
    if (hit && Date.now() - hit.at < CLIENT_CACHE_TTL_MS) return hit.value as Promise<T | undefined>;

    const value = fetchLibrary<T>(action, payload);
    clientCache.set(key, { at: Date.now(), value });
    // A failed read must not stick.
    value.catch(() => clientCache.delete(key));
    if (clientCache.size > MAX_CLIENT_CACHE_ENTRIES) {
        const oldest = clientCache.keys().next().value;
        if (oldest !== undefined) clientCache.delete(oldest);
    }
    return value;
}

async function fetchLibrary<T>(action: string, payload: Record<string, unknown>): Promise<T | undefined> {
    const response = await apiFetch('/api/library', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action, ...payload }),
    });

    if (!response.ok) {
        throw new Error(`Library action failed: ${action}`);
    }

    const body = await response.json() as CacheResponse<T>;
    return body.data ?? undefined;
}

async function writeCache(action: string, payload: Record<string, unknown> = {}) {
    const response = await apiFetch('/api/library', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action, ...payload }),
    });

    if (!response.ok) {
        throw new Error(`Library action failed: ${action}`);
    }
}

export const saveDetail = async (type: ContentType, id: string | number, data: unknown) => {
    forgetDetail(type, id);
    await writeCache('saveDetail', { type, id, data });
};

export const getDetail = async <T = unknown>(type: ContentType, id: string | number): Promise<T | undefined> => {
    return requestCache<T>('getDetail', { type, id });
};

export const saveCategories = async (categories: CachedCategory[]) => {
    await writeCache('saveCategories', { categories });
};

export const getCategories = async (type?: ContentType): Promise<CachedCategory[]> => {
    return await requestCache<CachedCategory[]>('getCategories', { type }) ?? [];
};

export const saveStreams = async (streams: CachedStream[]) => {
    await writeCache('saveStreams', { streams });
};

export const getStreams = async (categoryId: string, type: ContentType): Promise<CachedStream[]> => {
    return await requestCache<CachedStream[]>('getStreams', { categoryId, type }) ?? [];
};

export const searchStreams = async (query: string, type?: ContentType, limit?: number): Promise<CachedStream[]> => {
    return await requestCache<CachedStream[]>('searchStreams', { query, type, limit }) ?? [];
};

export const getStreamCount = async (type?: ContentType): Promise<number> => {
    return await requestCache<number>('getStreamCount', { type }) ?? 0;
};

export const getCategoryCounts = async (type: ContentType): Promise<{ category_id: string; total: number }[]> => {
    return await requestCache<{ category_id: string; total: number }[]>('getCategoryCounts', { type }) ?? [];
};

export const listCatalog = async (type: ContentType, categoryId?: string): Promise<CachedStream[]> => {
    return await requestCache<CachedStream[]>('listCatalog', { type, categoryId }) ?? [];
};

export type CatalogOrder = 'name' | 'added' | 'rating';

export interface CatalogPage {
    items: CachedStream[];
    total: number;
}

/** One sorted page of a grid plus the full list size (server-side, indexed). */
export const pageCatalog = async (query: {
    type: ContentType;
    categoryId?: string;
    recentOnly?: boolean;
    order: CatalogOrder;
    limit: number;
    offset: number;
}): Promise<CatalogPage> => {
    return await requestCache<CatalogPage>('pageCatalog', { ...query }) ?? { items: [], total: 0 };
};

export const countDatedStreams = async (type: ContentType): Promise<number> => {
    return await requestCache<number>('countDatedStreams', { type }) ?? 0;
};

export const listStreams = async (
    type: ContentType,
    categoryId: string | undefined,
    limit: number,
    offset: number,
    order: 'name' | 'rating' = 'name',
): Promise<CachedStream[]> => {
    return await requestCache<CachedStream[]>('listStreams', { type, categoryId, limit, offset, order }) ?? [];
};

export const getRecentStreams = async (type: ContentType, limit = 60): Promise<CachedStream[]> => {
    return await requestCache<CachedStream[]>('getRecentStreams', { type, limit }) ?? [];
};

export const getStreamsByIds = async (ids: (string | number)[], type?: ContentType): Promise<CachedStream[]> => {
    return await requestCache<CachedStream[]>('getStreamsByIds', { ids, type }) ?? [];
};

export const saveSyncMetadata = async (meta: SyncMetadata) => {
    await writeCache('saveSyncMetadata', { meta });
};

export const getSyncMetadata = async (type: string): Promise<SyncMetadata | undefined> => {
    return requestCache<SyncMetadata>('getSyncMetadata', { type });
};

export const clearCache = async () => {
    clearClientCache();
    await writeCache('clearCache');
};

export const saveTMDbCache = async (key: string, data: unknown) => {
    await writeCache('saveTMDbCache', { key, data });
};

export const getTMDbCache = async <T = unknown>(key: string): Promise<{ data: T; timestamp: number } | undefined> => {
    return requestCache<{ data: T; timestamp: number }>('getTMDbCache', { key });
};

export const clearExpiredTMDbCache = async (ttl: number = 1000 * 60 * 60 * 24) => {
    await writeCache('clearExpiredTMDbCache', { ttl });
};

export const saveCarouselCache = async (dateKey: string, data: unknown[]) => {
    await writeCache('saveCarouselCache', { dateKey, data });
};

export const getCarouselCache = async <T = never>(dateKey: string): Promise<T[] | undefined> => {
    return requestCache<T[]>('getCarouselCache', { dateKey });
};

export const clearExpiredCarouselCache = async (currentDateKey: string) => {
    await writeCache('clearExpiredCarouselCache', { currentDateKey });
};

export interface SpotlightItem {
    title: string;
    subtitle?: string;
    image?: string;
    logo?: string;
    start?: number;
    end?: number;
    matchup?: [string, string];
    poster?: string;
    kicker?: string;
    startsAt?: string;
    href: string;
    reason: 'now' | 'today' | 'trending' | 'new';
}

export interface Spotlight {
    live: SpotlightItem[];
    movie: SpotlightItem[];
    series: SpotlightItem[];
    generatedAt: number;
}

/** Home "right now" picks: live programme on air, trending/new movies and series. */
export const getSpotlight = async (lang: string): Promise<Spotlight | null> => {
    try {
        const response = await apiFetch('/api/spotlight', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ lang }),
        });
        if (!response.ok) return null;
        const payload = await response.json() as { data?: Spotlight };
        return payload.data ?? null;
    } catch (error) {
        console.error('[Spotlight] Request failed', error);
        return null;
    }
};
