import { NextResponse } from 'next/server';
import fs from 'fs/promises';
import path from 'path';
import { enforceAccountAccess, enforceApiAccess, getRequestDevice } from '@/app/lib/apiAuth';
import { forgetCredentials, publicUserInfo } from '@/app/lib/liveShare';
import { ACCOUNT_SESSION_COOKIE_NAME, hasAccountSession, rotateSessionSecret } from '@/app/lib/accountSession';
import { dataDir } from '@/app/lib/dataDir';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const CONFIG_PATH = path.join(dataDir(), 'config.json');

// GET - whether this caller is signed in, plus the account info the UI shows.
// The credentials never leave the server.
export async function GET(request: Request) {
    const accessResponse = await enforceApiAccess(request);
    if (accessResponse) return accessResponse;

    const signedIn = !!getRequestDevice(request) || await hasAccountSession(request);
    if (!signedIn) {
        return NextResponse.json({ authenticated: false });
    }

    try {
        const data = JSON.parse(await fs.readFile(CONFIG_PATH, 'utf-8'));
        if (!data?.credentials || !data.user || !data.server) {
            return NextResponse.json({ authenticated: false });
        }
        return NextResponse.json({ authenticated: true, user: publicUserInfo(data.user), server: data.server });
    } catch (error: unknown) {
        if (typeof error === 'object' && error !== null && (error as { code?: string }).code === 'ENOENT') {
            return NextResponse.json({ authenticated: false });
        }
        return NextResponse.json({ error: 'Failed to read config' }, { status: 500 });
    }
}

// POST - sign out: forgets the account and ends every session opened for it.
export async function POST(request: Request) {
    const accessResponse = await enforceAccountAccess(request);
    if (accessResponse) return accessResponse;

    try {
        await fs.writeFile(CONFIG_PATH, JSON.stringify({}, null, 2));
        forgetCredentials();
        await rotateSessionSecret();
        const response = NextResponse.json({ success: true });
        response.cookies.set({ name: ACCOUNT_SESSION_COOKIE_NAME, value: '', path: '/', maxAge: 0 });
        return response;
    } catch {
        return NextResponse.json({ error: 'Failed to save config' }, { status: 500 });
    }
}
