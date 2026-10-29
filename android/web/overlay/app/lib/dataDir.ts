/**
 * Android replacement for app/lib/dataDir.ts (copied over it in the APK build).
 * A virtual path: the file bridge roots it in the app's private storage.
 */
export function dataDir(): string {
    return '/app/data';
}
