import 'server-only';

import crypto from 'crypto';
import fs from 'fs/promises';
import path from 'path';
import { getCookieValue } from './remoteAccess';
import { dataDir } from './dataDir';

/**
 * "This browser signed in to the Xtream account" — the line between the owner and a
 * visitor. Visitors only get the free tier; everything that touches the account
 * (catalog, playback, settings) needs this session or a paired-device token.
 *
 * The cookie is `expiresAt.nonce.hmac`, signed with a random secret kept in `data/`.
 * Rotating the secret (account replaced or signed out) kills every session at once.
 */

const DATA_DIR = dataDir();
const SECRET_PATH = path.join(DATA_DIR, 'session-secret.json');

export const ACCOUNT_SESSION_COOKIE_NAME = 'garratv_session';
export const ACCOUNT_SESSION_SECONDS = 90 * 24 * 60 * 60;
export const ACCOUNT_DEVICE_SESSION_SECONDS = 365 * 24 * 60 * 60;

let secretCache: string | null = null;

function hasErrorCode(error: unknown, code: string) {
    return typeof error === 'object' && error !== null && 'code' in error && error.code === code;
}

async function writeSecret(): Promise<string> {
    const secret = crypto.randomBytes(32).toString('base64url');
    await fs.mkdir(DATA_DIR, { recursive: true });
    await fs.writeFile(SECRET_PATH, JSON.stringify({ secret }, null, 2), { mode: 0o600 });
    secretCache = secret;
    return secret;
}

async function getSecret(): Promise<string> {
    if (secretCache) return secretCache;

    try {
        const parsed = JSON.parse(await fs.readFile(SECRET_PATH, 'utf-8')) as { secret?: unknown };
        if (typeof parsed.secret === 'string' && parsed.secret.length >= 32) {
            secretCache = parsed.secret;
            return parsed.secret;
        }
    } catch (error) {
        if (!hasErrorCode(error, 'ENOENT')) {
            console.error('[AccountSession] Failed to read secret, generating a new one', error);
        }
    }

    return writeSecret();
}

/** Invalidates every issued session. */
export async function rotateSessionSecret(): Promise<void> {
    await writeSecret();
}

function sign(payload: string, secret: string) {
    return crypto.createHmac('sha256', secret).update(payload).digest('base64url');
}

export async function createAccountSession(ttlSeconds: number = ACCOUNT_SESSION_SECONDS): Promise<string> {
    const secret = await getSecret();
    const expiresAt = Date.now() + ttlSeconds * 1000;
    const nonce = crypto.randomBytes(16).toString('base64url');
    const payload = `${expiresAt}.${nonce}`;
    return `${payload}.${sign(payload, secret)}`;
}

export async function verifyAccountSession(cookieValue: string | undefined): Promise<boolean> {
    if (!cookieValue) return false;

    const [expiresAtValue, nonce, signature] = cookieValue.split('.');
    const expiresAt = Number(expiresAtValue);

    if (!expiresAtValue || !nonce || !signature || !Number.isFinite(expiresAt) || expiresAt <= Date.now()) {
        return false;
    }

    const expected = Buffer.from(sign(`${expiresAtValue}.${nonce}`, await getSecret()));
    const received = Buffer.from(signature);

    return expected.length === received.length && crypto.timingSafeEqual(expected, received);
}

export async function hasAccountSession(request: Request): Promise<boolean> {
    return verifyAccountSession(getCookieValue(request.headers.get('cookie'), ACCOUNT_SESSION_COOKIE_NAME));
}

function isSecureRequest(request: Request) {
    return request.headers.get('x-forwarded-proto') === 'https' || request.url.startsWith('https://');
}

/** Cookie options for `response.cookies.set`. */
export function accountSessionCookie(request: Request, value: string, maxAge: number) {
    return {
        name: ACCOUNT_SESSION_COOKIE_NAME,
        value,
        httpOnly: true,
        sameSite: 'lax' as const,
        secure: isSecureRequest(request),
        path: '/',
        maxAge,
    };
}
