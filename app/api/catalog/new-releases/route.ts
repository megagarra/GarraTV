import { NextResponse } from 'next/server';
import { enforceAccountAccess } from '@/app/lib/apiAuth';
import { getNewReleases } from '@/app/lib/newReleases';
import { resolveProfileId } from '@/app/lib/userStore';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
    const accessResponse = await enforceAccountAccess(request);
    if (accessResponse) return accessResponse;

    try {
        return NextResponse.json({ data: getNewReleases(resolveProfileId(request)) });
    } catch (error) {
        console.error('[API NewReleases] Request failed:', error);
        return NextResponse.json({ error: 'Failed to fetch new releases' }, { status: 500 });
    }
}
