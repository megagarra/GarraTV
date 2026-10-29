export const responseCache = new Map<string, { data: unknown[]; timestamp: number; total: number }>();
export const CACHE_TTL = 5 * 60 * 1000; // 5 minutes

export function getCacheKey(hostUrl: string, username: string, action: string): string {
    return `${hostUrl}:${username}:${action}`;
}

export function cleanExpiredCache() {
    const now = Date.now();
    for (const [key, entry] of responseCache) {
        if (now - entry.timestamp > CACHE_TTL) {
            responseCache.delete(key);
        }
    }
}

let lastCleanup = Date.now();

export function performPeriodicCleanup() {
    if (Date.now() - lastCleanup > 2 * 60 * 1000) {
        cleanExpiredCache();
        lastCleanup = Date.now();
    }
}

const HEADERS_TIMEOUT_MS = 10 * 1000;

/**
 * Per-title answers (details, short EPG) change slowly; caching them briefly
 * makes reopening a title or a channel instant.
 */
const INFO_TTL_MS: Record<string, number> = {
    get_vod_info: 10 * 60 * 1000,
    get_series_info: 10 * 60 * 1000,
    get_short_epg: 2 * 60 * 1000,
    get_simple_data_table: 2 * 60 * 1000,
};
const MAX_INFO_ENTRIES = 500;
const infoCache = new Map<string, { data: unknown; at: number }>();

export function infoCacheKey(hostUrl: string, username: string, action: string, params: Record<string, unknown>): string | null {
    if (!INFO_TTL_MS[action]) return null;
    return `${hostUrl}:${username}:${action}:${JSON.stringify(params)}`;
}

export function readInfoCache(key: string, action: string): unknown | undefined {
    const hit = infoCache.get(key);
    if (!hit) return undefined;
    if (Date.now() - hit.at > INFO_TTL_MS[action]) {
        infoCache.delete(key);
        return undefined;
    }
    return hit.data;
}

export function writeInfoCache(key: string, data: unknown): void {
    // Empty answers ([] from a flaky panel) are not worth keeping.
    if (Array.isArray(data) && data.length === 0) return;
    infoCache.set(key, { data, at: Date.now() });
    if (infoCache.size > MAX_INFO_ENTRIES) {
        const oldest = infoCache.keys().next().value;
        if (oldest !== undefined) infoCache.delete(oldest);
    }
}

/**
 * Fetch with retry logic
 */
export async function fetchWithRetry(apiUrl: string, action: string, maxRetries: number = 3): Promise<Response> {
    let response: Response | undefined;
    let lastError: unknown;

    for (let i = 0; i <= maxRetries; i++) {
        // Only the wait for the response headers is bounded: a hung provider used
        // to stall the detail page forever, while a big listing may legitimately
        // take a while to stream its body.
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), HEADERS_TIMEOUT_MS);
        try {
            response = await fetch(apiUrl, { signal: controller.signal });
            clearTimeout(timer);

            if (response.ok || response.status < 500) {
                break;
            }

            if (i < maxRetries) {
                console.warn(`[Proxy] Retry ${i + 1}/${maxRetries} for ${action} due to status ${response.status}`);
                await new Promise(resolve => setTimeout(resolve, 1000));
            }
        } catch (error) {
            clearTimeout(timer);
            lastError = error;
            if (i < maxRetries) {
                console.warn(`[Proxy] Retry ${i + 1}/${maxRetries} for ${action} due to error:`, error);
                await new Promise(resolve => setTimeout(resolve, 1000));
            }
        }
    }

    if (!response) {
        throw lastError || new Error('Fetch failed after retries');
    }

    console.log(`[Proxy] Response: ${response.status} ${response.statusText}`);
    return response;
}

/**
 * Parse response body (JSON or text)
 */
export async function parseResponse(response: Response): Promise<unknown> {
    const contentType = response.headers.get('content-type');
    if (contentType && contentType.includes('application/json')) {
        return response.json();
    }

    const text = await response.text();
    try {
        return JSON.parse(text);
    } catch {
        return text;
    }
}
