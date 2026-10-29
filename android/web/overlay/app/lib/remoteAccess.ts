/**
 * Android replacement for app/lib/remoteAccess.ts (copied over it in the APK
 * build). The remote-access PIN guards a server exposed to a network; the app
 * has none, so access is never required. Cookie parsing is kept as-is because
 * userStore reads the profile cookie through it.
 */

export const REMOTE_ACCESS_COOKIE_NAME = 'garratv_remote_access';
export const REMOTE_ACCESS_SESSION_SECONDS = 7 * 24 * 60 * 60;
export const REMOTE_ACCESS_DEVICE_SESSION_SECONDS = 365 * 24 * 60 * 60;

export interface RemoteAccessState {
    required: boolean;
    configured: boolean;
    authorized: boolean;
}

export function isRemoteAccessRequired(_hostHeader: string | null) {
    void _hostHeader;
    return false;
}

export function getRequestHost(request: Request) {
    return request.headers.get('x-forwarded-host') || request.headers.get('host');
}

export function getCookieValue(cookieHeader: string | null, name: string) {
    if (!cookieHeader) {
        return undefined;
    }

    const cookie = cookieHeader
        .split(';')
        .map(part => part.trim())
        .find(part => part.startsWith(`${name}=`));

    return cookie ? decodeURIComponent(cookie.slice(name.length + 1)) : undefined;
}

export async function getRemoteAccessState(_hostHeader: string | null, _cookieValue?: string): Promise<RemoteAccessState> {
    void _hostHeader;
    void _cookieValue;
    return { required: false, configured: false, authorized: true };
}

export async function enforceRemoteAccessForApi(_request: Request) {
    void _request;
    return null;
}
