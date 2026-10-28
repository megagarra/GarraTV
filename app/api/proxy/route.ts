import { NextResponse } from 'next/server';
import {
    responseCache,
    CACHE_TTL,
    getCacheKey,
    performPeriodicCleanup,
    fetchWithRetry,
    parseResponse
} from './cache';
import { enforceAccountAccess } from '@/app/lib/apiAuth';
import { publicUserInfo, readCredentials } from '@/app/lib/liveShare';

/** The bare `player_api.php` answer carries `user_info.password`; it must not reach the client. */
function withoutPassword(data: unknown): unknown {
    if (!data || typeof data !== 'object' || Array.isArray(data) || !('user_info' in data)) return data;
    return { ...data, user_info: publicUserInfo((data as { user_info: unknown }).user_info) };
}

export async function POST(request: Request) {
    const accessResponse = await enforceAccountAccess(request);
    if (accessResponse) return accessResponse;

    try {
        const body = await request.json();
        const { action, page, limit, ...otherParams } = body;
        // Any credentials a stale client still sends are dropped: the account is the server's.
        delete otherParams.hostUrl;
        delete otherParams.username;
        delete otherParams.password;

        const credentials = await readCredentials();
        if (!credentials) {
            return NextResponse.json({ error: 'Conta não configurada' }, { status: 503 });
        }
        const { hostUrl, username, password } = credentials;

        // Periodic cache cleanup (every 2 minutes)
        performPeriodicCleanup();

        const baseUrl = hostUrl.replace(/\/$/, '');

        // ---- PAGINATED MODE ----
        // When page & limit are provided, serve from server-side cache
        if (page !== undefined && limit !== undefined) {
            const cacheKey = getCacheKey(hostUrl, username, action);
            let cached = responseCache.get(cacheKey);

            // If no cache or expired, fetch from upstream first
            if (!cached || Date.now() - cached.timestamp > CACHE_TTL) {
                console.log(`[Proxy] Paginated: Fetching full data for ${action} (cache miss)`);

                const params = new URLSearchParams({
                    username,
                    password,
                    action: action || '',
                    ...otherParams
                });
                const apiUrl = `${baseUrl}/player_api.php?${params.toString()}`;

                const response = await fetchWithRetry(apiUrl, action);
                if (!response.ok) {
                    return NextResponse.json(
                        { error: `Upstream error: ${response.statusText}` },
                        { status: response.status }
                    );
                }

                const data = await parseResponse(response);

                if (Array.isArray(data)) {
                    cached = { data, timestamp: Date.now(), total: data.length };
                    responseCache.set(cacheKey, cached);
                    console.log(`[Proxy] Paginated: Cached ${data.length} items for ${action}`);
                } else {
                    // Non-array response, return directly
                    return NextResponse.json(withoutPassword(data));
                }
            }

            // Serve the requested page
            const pageNum = Math.max(1, parseInt(page));
            const pageSize = Math.min(5000, Math.max(1, parseInt(limit)));
            const startIdx = (pageNum - 1) * pageSize;
            const endIdx = Math.min(startIdx + pageSize, cached.total);
            const pageData = cached.data.slice(startIdx, endIdx);

            const totalPages = Math.ceil(cached.total / pageSize);

            console.log(`[Proxy] Paginated: ${action} page ${pageNum}/${totalPages} (${pageData.length} items, total: ${cached.total})`);

            return NextResponse.json({
                items: pageData,
                page: pageNum,
                limit: pageSize,
                total: cached.total,
                totalPages,
                hasMore: pageNum < totalPages
            });
        }

        // ---- STANDARD MODE (non-paginated, for categories and small requests) ----
        const params = new URLSearchParams({
            username,
            password,
            action: action || '',
            ...otherParams
        });

        const apiUrl = `${baseUrl}/player_api.php?${params.toString()}`;

        console.log(`[Proxy] Action: ${action}`);
        if (Object.keys(otherParams).length > 0) {
            console.log(`[Proxy] Params:`, JSON.stringify(otherParams));
        }

        const response = await fetchWithRetry(apiUrl, action);

        if (!response.ok) {
            return NextResponse.json(
                { error: `Upstream error: ${response.statusText}`, details: response.status === 504 ? 'Gateway Timeout' : undefined },
                { status: response.status }
            );
        }

        const data = await parseResponse(response);
        const count = Array.isArray(data) ? data.length : 'object';
        console.log(`[Proxy] Data: ${count} items/type`);

        return NextResponse.json(withoutPassword(data));

    } catch (error: unknown) {
        console.error('[Proxy] CRITICAL Error:', error);
        return NextResponse.json(
            { error: 'Internal Server Error', details: error instanceof Error ? error.message : undefined },
            { status: 500 }
        );
    }
}

