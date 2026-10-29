'use client';

/**
 * Wires the server-less Android app before any screen asks for data: rendered
 * first in the root layout of the APK build only. Installed at module load,
 * not in an effect, so the very first apiFetch already goes in-process.
 */
import { installNativeFetch } from './nativeFetch';

type LocalApiHandler = (path: string, init: RequestInit) => Promise<Response> | null;

interface AndroidWindow {
    GarraTVApp?: unknown;
    __garratvLocalApi?: LocalApiHandler;
}

if (typeof window !== 'undefined') {
    const win = window as unknown as AndroidWindow;
    if (win.GarraTVApp && !win.__garratvLocalApi) {
        installNativeFetch();
        // The route table pulls every server module in; loading it lazily keeps it
        // out of the first paint while requests made meanwhile simply wait for it.
        const backend = import('./localApi');
        win.__garratvLocalApi = (path, init) => {
            if (/^\/api\/(relay|vod)(\/|\?|$)/.test(path)) return null;
            return backend.then(module => module.handleLocalApi(path, init));
        };
    }
}

export default function AndroidBoot() {
    return null;
}
