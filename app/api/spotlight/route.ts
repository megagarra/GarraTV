import { NextResponse } from 'next/server';
import { enforceAccountAccess } from '@/app/lib/apiAuth';
import { getSpotlight } from '@/app/lib/spotlight';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

interface SpotlightRequestBody {
    lang?: string;
}

/** TMDB language tags; anything else falls back to English. */
function toLanguage(lang: string | undefined): string {
    return lang && /^[a-z]{2}(-[A-Z]{2})?$/.test(lang) ? lang : 'en-US';
}

// POST { lang } -> what's on now (live) and what's hot/new (movies, series) for the
// home cards, built from the account saved on the server. Cached server-side for a
// few minutes.
export async function POST(request: Request) {
    const accessResponse = await enforceAccountAccess(request);
    if (accessResponse) return accessResponse;

    try {
        const body = await request.json().catch(() => ({})) as SpotlightRequestBody;
        const data = await getSpotlight(toLanguage(body.lang));
        return NextResponse.json({ data });
    } catch (error) {
        console.error('[Spotlight] Request failed', error);
        return NextResponse.json({ error: 'Falha ao montar os destaques' }, { status: 500 });
    }
}
