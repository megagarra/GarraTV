import { NextResponse } from 'next/server';
import { enforceAccountAccess, enforceApiAccess } from '@/app/lib/apiAuth';
import * as library from '@/app/lib/sqliteCache';
import type { ContentType } from '@/app/lib/dbTypes';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type LibraryAction =
    | 'saveDetail'
    | 'getDetail'
    | 'saveCategories'
    | 'getCategories'
    | 'saveStreams'
    | 'getStreams'
    | 'searchStreams'
    | 'getStreamCount'
    | 'getCategoryCounts'
    | 'listStreams'
    | 'listCatalog'
    | 'countDatedStreams'
    | 'getRecentStreams'
    | 'getStreamsByIds'
    | 'saveSyncMetadata'
    | 'getSyncMetadata'
    | 'clearCache'
    | 'saveTMDbCache'
    | 'getTMDbCache'
    | 'clearExpiredTMDbCache'
    | 'saveCarouselCache'
    | 'getCarouselCache'
    | 'clearExpiredCarouselCache';

interface LibraryRequestBody {
    action?: LibraryAction;
    id?: string | number;
    ids?: (string | number)[];
    type?: ContentType | string;
    categoryId?: string;
    categories?: Parameters<typeof library.saveCategories>[0];
    streams?: Parameters<typeof library.saveStreams>[0];
    meta?: Parameters<typeof library.saveSyncMetadata>[0];
    query?: string;
    limit?: number;
    offset?: number;
    order?: 'name' | 'rating';
    key?: string;
    dateKey?: string;
    currentDateKey?: string;
    ttl?: number;
    data?: unknown;
}

const CONTENT_TYPES: ContentType[] = ['live', 'movie', 'series'];

/** Reads stay open (the sign-in screen's poster mosaic uses them); writes are owner-only. */
const WRITE_ACTIONS: LibraryAction[] = [
    'saveDetail',
    'saveCategories',
    'saveStreams',
    'saveSyncMetadata',
    'clearCache',
    'saveTMDbCache',
    'clearExpiredTMDbCache',
    'saveCarouselCache',
    'clearExpiredCarouselCache',
];

function jsonData(data: unknown) {
    return NextResponse.json({ data: data ?? null });
}

function asContentType(value: unknown): ContentType | undefined {
    return CONTENT_TYPES.find(type => type === value);
}

export async function POST(request: Request) {
    const accessResponse = await enforceApiAccess(request);
    if (accessResponse) return accessResponse;

    try {
        const body = await request.json() as LibraryRequestBody;

        if (body.action && WRITE_ACTIONS.indexOf(body.action) >= 0) {
            const accountResponse = await enforceAccountAccess(request);
            if (accountResponse) return accountResponse;
        }

        // The detail cache is keyed per content type: a `series_id` and a `stream_id`
        // can be the same number and must not read back each other's payload.
        if (body.action === 'saveDetail' || body.action === 'getDetail') {
            const detailType = asContentType(body.type);
            if (!detailType) {
                return NextResponse.json({ error: 'Tipo de conteúdo inválido' }, { status: 400 });
            }

            if (body.action === 'getDetail') {
                return jsonData(library.getDetail(detailType, body.id ?? ''));
            }

            library.saveDetail(detailType, body.id ?? '', body.data);
            return NextResponse.json({ success: true });
        }

        switch (body.action) {
            case 'saveCategories':
                library.saveCategories(body.categories ?? []);
                return NextResponse.json({ success: true });
            case 'getCategories':
                return jsonData(library.getCategories(body.type as ContentType | undefined));
            case 'saveStreams':
                library.saveStreams(body.streams ?? []);
                return NextResponse.json({ success: true });
            case 'getStreams':
                return jsonData(library.getStreams(String(body.categoryId ?? ''), body.type as ContentType));
            case 'searchStreams':
                return jsonData(library.searchStreams(
                    String(body.query ?? ''),
                    body.type as ContentType | undefined,
                    body.limit,
                ));
            case 'getStreamCount':
                return jsonData(library.getStreamCount(body.type as ContentType | undefined));
            case 'getCategoryCounts': {
                const contentType = asContentType(body.type);
                if (!contentType) {
                    return NextResponse.json({ error: 'Tipo de conteúdo inválido' }, { status: 400 });
                }
                return jsonData(library.getCategoryCounts(contentType));
            }
            case 'listStreams': {
                const contentType = asContentType(body.type);
                if (!contentType) {
                    return NextResponse.json({ error: 'Tipo de conteúdo inválido' }, { status: 400 });
                }
                const categoryId = body.categoryId ? String(body.categoryId) : undefined;
                return jsonData(library.listStreams(
                    contentType,
                    categoryId,
                    body.limit ?? 60,
                    body.offset ?? 0,
                    body.order === 'rating' ? 'rating' : 'name',
                ));
            }
            case 'listCatalog': {
                const contentType = asContentType(body.type);
                if (!contentType) {
                    return NextResponse.json({ error: 'Tipo de conteúdo inválido' }, { status: 400 });
                }
                const categoryId = body.categoryId ? String(body.categoryId) : undefined;
                return jsonData(library.listCatalog(contentType, categoryId));
            }
            case 'countDatedStreams': {
                const contentType = asContentType(body.type);
                if (!contentType) {
                    return NextResponse.json({ error: 'Tipo de conteúdo inválido' }, { status: 400 });
                }
                return jsonData(library.countDatedStreams(contentType));
            }
            case 'getRecentStreams': {
                const contentType = asContentType(body.type);
                if (!contentType) {
                    return NextResponse.json({ error: 'Tipo de conteúdo inválido' }, { status: 400 });
                }
                return jsonData(library.getRecentStreams(contentType, body.limit ?? 60));
            }
            case 'getStreamsByIds':
                return jsonData(library.getStreamsByIds(body.ids ?? [], asContentType(body.type)));
            case 'saveSyncMetadata':
                if (body.meta) library.saveSyncMetadata(body.meta);
                return NextResponse.json({ success: true });
            case 'getSyncMetadata':
                return jsonData(library.getSyncMetadata(String(body.type ?? '')));
            case 'clearCache':
                library.clearCache();
                return NextResponse.json({ success: true });
            case 'saveTMDbCache':
                library.saveTMDbCache(String(body.key ?? ''), body.data);
                return NextResponse.json({ success: true });
            case 'getTMDbCache':
                return jsonData(library.getTMDbCache(String(body.key ?? '')));
            case 'clearExpiredTMDbCache':
                library.clearExpiredTMDbCache(body.ttl ?? 1000 * 60 * 60 * 24);
                return NextResponse.json({ success: true });
            case 'saveCarouselCache':
                library.saveCarouselCache(String(body.dateKey ?? ''), Array.isArray(body.data) ? body.data : []);
                return NextResponse.json({ success: true });
            case 'getCarouselCache':
                return jsonData(library.getCarouselCache(String(body.dateKey ?? '')));
            case 'clearExpiredCarouselCache':
                library.clearExpiredCarouselCache(String(body.currentDateKey ?? ''));
                return NextResponse.json({ success: true });
            default:
                return NextResponse.json({ error: 'Invalid library action' }, { status: 400 });
        }
    } catch (error) {
        console.error('[Library] Request failed:', error);
        return NextResponse.json({ error: 'Library request failed' }, { status: 500 });
    }
}
