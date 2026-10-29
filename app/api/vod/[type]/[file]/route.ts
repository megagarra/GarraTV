import { NextResponse } from 'next/server';
import { enforceAccountAccess } from '@/app/lib/apiAuth';
import { buildUpstreamVodUrl } from '@/app/lib/liveShare';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Direct VOD playback (movie or series episode) through the server.
 *
 * The provider's VOD URL embeds the account password, so the browser never sees it:
 * the player points at `/api/vod/<type>/<streamId>.<ext>` and this route streams the
 * upstream bytes back, forwarding `Range` so seeking keeps working.
 */

const PASSTHROUGH_HEADERS = ['content-type', 'content-length', 'content-range', 'accept-ranges', 'last-modified', 'etag'];

/**
 * Where a title's panel URL last redirected to. Opening a video takes several
 * range requests in a row (header, the index often stored at the END of an MP4,
 * then the first frames), and the panel answers each with a slow 302 to a
 * tokenized CDN URL — and may count each as a new connection. Going straight to
 * that URL while it is fresh skips the panel for all but the first.
 */
const REDIRECT_TTL_MS = 5 * 60 * 1000;
const MAX_REDIRECTS = 200;
const redirects = new Map<string, { url: string; at: number }>();

async function fetchUpstream(upstreamUrl: string, init: RequestInit): Promise<Response> {
    const known = redirects.get(upstreamUrl);
    if (known && Date.now() - known.at < REDIRECT_TTL_MS) {
        const direct = await fetch(known.url, init).catch(() => null);
        if (direct && (direct.ok || direct.status === 416)) return direct;
        // The player gave up on this range (it does that constantly while seeking):
        // not a sign the cached URL went stale.
        if (init.signal?.aborted) throw new DOMException('Aborted', 'AbortError');
        // Token expired or the CDN moved: ask the panel again.
        await direct?.body?.cancel().catch(() => undefined);
        redirects.delete(upstreamUrl);
    }
    const upstream = await fetch(upstreamUrl, init);
    if (upstream.ok && upstream.url && upstream.url !== upstreamUrl) {
        redirects.delete(upstreamUrl);
        redirects.set(upstreamUrl, { url: upstream.url, at: Date.now() });
        if (redirects.size > MAX_REDIRECTS) {
            const oldest = redirects.keys().next().value;
            if (oldest !== undefined) redirects.delete(oldest);
        }
    }
    return upstream;
}

async function proxy(request: Request, params: Promise<{ type: string; file: string }>, method: 'GET' | 'HEAD') {
    const accessResponse = await enforceAccountAccess(request);
    if (accessResponse) return accessResponse;

    const { type, file } = await params;
    const match = /^(\d+)\.([a-z0-9]{2,5})$/i.exec(file);
    if ((type !== 'movie' && type !== 'series') || !match) {
        return NextResponse.json({ error: 'Parâmetros inválidos' }, { status: 400 });
    }

    const upstreamUrl = await buildUpstreamVodUrl(type, match[1], match[2]);
    if (!upstreamUrl) {
        return NextResponse.json({ error: 'Conta não configurada' }, { status: 503 });
    }

    const headers: Record<string, string> = {};
    const range = request.headers.get('range');
    if (range) headers['range'] = range;

    let upstream: Response;
    try {
        upstream = await fetchUpstream(upstreamUrl, { method, headers, redirect: 'follow', signal: request.signal });
    } catch (error) {
        // Never log the URL: it carries the password.
        if (!request.signal.aborted) {
            console.error('[VOD] Upstream request failed', error instanceof Error ? error.message : error);
        }
        return NextResponse.json({ error: 'Falha ao abrir o vídeo' }, { status: 502 });
    }

    if (!upstream.ok && upstream.status !== 206) {
        await upstream.body?.cancel().catch(() => undefined);
        return NextResponse.json({ error: 'Vídeo indisponível' }, { status: upstream.status === 416 ? 416 : 502 });
    }

    const responseHeaders: Record<string, string> = { 'cache-control': 'no-store' };
    for (const name of PASSTHROUGH_HEADERS) {
        const value = upstream.headers.get(name);
        if (value) responseHeaders[name] = value;
    }
    if (!responseHeaders['accept-ranges']) responseHeaders['accept-ranges'] = 'bytes';

    return new Response(method === 'HEAD' ? null : upstream.body, {
        status: upstream.status,
        headers: responseHeaders,
    });
}

export async function GET(request: Request, { params }: { params: Promise<{ type: string; file: string }> }) {
    return proxy(request, params, 'GET');
}

export async function HEAD(request: Request, { params }: { params: Promise<{ type: string; file: string }> }) {
    return proxy(request, params, 'HEAD');
}
