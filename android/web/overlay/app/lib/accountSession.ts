/**
 * Android replacement for app/lib/accountSession.ts (copied over it in the APK
 * build). There is no visitor/owner split inside the app: whoever holds the
 * device is the owner, so sessions are always valid and nothing is signed.
 */

export const ACCOUNT_SESSION_COOKIE_NAME = 'garratv_session';
export const ACCOUNT_SESSION_SECONDS = 90 * 24 * 60 * 60;
export const ACCOUNT_DEVICE_SESSION_SECONDS = 365 * 24 * 60 * 60;

export async function rotateSessionSecret(): Promise<void> {
    /* nothing to rotate */
}

export async function createAccountSession(_ttlSeconds: number = ACCOUNT_SESSION_SECONDS): Promise<string> {
    void _ttlSeconds;
    return 'android';
}

export async function verifyAccountSession(_cookieValue: string | undefined): Promise<boolean> {
    void _cookieValue;
    return true;
}

export async function hasAccountSession(_request: Request): Promise<boolean> {
    void _request;
    return true;
}

export function accountSessionCookie(_request: Request, value: string, maxAge: number) {
    void _request;
    return { name: ACCOUNT_SESSION_COOKIE_NAME, value, path: '/', maxAge };
}
