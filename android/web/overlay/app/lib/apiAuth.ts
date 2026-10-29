/**
 * Android replacement for app/lib/apiAuth.ts (copied over it in the APK build).
 * The app runs on the owner's own device with no network surface, so every
 * guard passes; device pairing does not exist here.
 */
import type { NextResponse } from 'next/server';

export const DEVICE_AUTH_HEADER = 'X-GarraTV-Device-Auth';
export const DEVICE_AUTH_INVALID = 'invalid';
export const ACCOUNT_SESSION_REQUIRED = 'account_session_required';

export function getRequestDevice(_request: Request): null {
    void _request;
    return null;
}

export function getRequestDeviceProfileId(_request: Request): string | null {
    void _request;
    return null;
}

export async function enforceApiAccess(_request: Request): Promise<NextResponse | null> {
    void _request;
    return null;
}

export async function enforceAccountAccess(_request: Request): Promise<NextResponse | null> {
    void _request;
    return null;
}
