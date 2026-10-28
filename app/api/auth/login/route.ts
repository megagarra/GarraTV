import { NextResponse } from 'next/server';
import fs from 'fs/promises';
import path from 'path';
import { enforceApiAccess } from '@/app/lib/apiAuth';
import { publicUserInfo, readCredentials } from '@/app/lib/liveShare';
import {
    ACCOUNT_SESSION_SECONDS,
    accountSessionCookie,
    createAccountSession,
    hasAccountSession,
    rotateSessionSecret,
} from '@/app/lib/accountSession';

export const runtime = 'nodejs';

const CONFIG_PATH = path.join(process.cwd(), 'data', 'config.json');

function normalizeHost(hostUrl: string): string {
    return hostUrl.trim().replace(/\/+$/, '').toLowerCase();
}

/**
 * Signs this browser in. The credentials are checked against the provider and kept
 * only on the server; the browser gets an httpOnly session cookie and the account
 * info, never the password back.
 *
 * Once an account is saved, only someone who already holds a session may replace it
 * with a different one; logging in with the saved account is how another browser in
 * the house gets its own session.
 */
export async function POST(request: Request) {
    const accessResponse = await enforceApiAccess(request);
    if (accessResponse) return accessResponse;

    try {
        const body = await request.json().catch(() => ({})) as { username?: unknown; password?: unknown; hostUrl?: unknown };
        const username = typeof body.username === 'string' ? body.username.trim() : '';
        const password = typeof body.password === 'string' ? body.password : '';
        const hostUrl = typeof body.hostUrl === 'string' ? body.hostUrl.trim().replace(/\/+$/, '') : '';

        if (!username || !password || !hostUrl) {
            return NextResponse.json({ error: 'Missing credentials or host URL' }, { status: 400 });
        }
        if (!/^https?:\/\//i.test(hostUrl)) {
            return NextResponse.json({ error: 'Invalid host URL' }, { status: 400 });
        }

        const saved = await readCredentials();
        const replacesAccount = !!saved && (
            normalizeHost(saved.hostUrl) !== normalizeHost(hostUrl) || saved.username !== username
        );
        if (replacesAccount && !await hasAccountSession(request)) {
            return NextResponse.json({ error: 'Outra conta já está configurada neste servidor' }, { status: 403 });
        }

        const params = new URLSearchParams({ username, password });
        const response = await fetch(`${hostUrl}/player_api.php?${params.toString()}`);

        if (!response.ok) {
            return NextResponse.json(
                { error: `Failed to connect to server: ${response.statusText}` },
                { status: response.status }
            );
        }

        const data = await response.json();

        if (!data?.user_info || data.user_info.auth === 0) {
            return NextResponse.json({ error: 'Authentication failed' }, { status: 401 });
        }

        await fs.mkdir(path.dirname(CONFIG_PATH), { recursive: true });
        await fs.writeFile(CONFIG_PATH, JSON.stringify({
            credentials: { hostUrl, username, password },
            user: data.user_info,
            server: data.server_info,
        }, null, 2));

        // A new account must not inherit the sessions opened for the previous one.
        if (replacesAccount) {
            await rotateSessionSecret();
        }

        const result = NextResponse.json({ user_info: publicUserInfo(data.user_info), server_info: data.server_info });
        result.cookies.set(accountSessionCookie(request, await createAccountSession(), ACCOUNT_SESSION_SECONDS));
        return result;
    } catch (error) {
        console.error('[Auth] Login failed', error instanceof Error ? error.message : error);
        return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
    }
}
