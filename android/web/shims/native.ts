/**
 * The @JavascriptInterface objects the Android shell injects (see
 * android/app/src/main/java/.../bridge). Every call is synchronous: the WebView
 * blocks this thread until Kotlin returns, which is what lets the server code,
 * written against synchronous better-sqlite3, run here unchanged.
 */

export interface NativeDbBridge {
    open(name: string): number;
    exec(handle: number, sql: string): string;
    query(handle: number, sql: string, paramsJson: string, mode: string): string;
}

export interface NativeFsBridge {
    readFile(path: string): string;
    writeFile(path: string, data: string): string;
    mkdir(path: string): string;
    readdir(path: string): string;
    unlink(path: string): string;
    stat(path: string): string;
}

export interface NativeHttpBridge {
    request(id: string, method: string, url: string, headersJson: string, body: string): void;
}

export interface NativeAppBridge {
    onConfigChanged(): void;
}

interface GarraTVNativeWindow {
    GarraTVDb?: NativeDbBridge;
    GarraTVFs?: NativeFsBridge;
    GarraTVHttp?: NativeHttpBridge;
    GarraTVApp?: NativeAppBridge;
}

function nativeWindow(): GarraTVNativeWindow {
    return (typeof window === 'undefined' ? {} : window) as unknown as GarraTVNativeWindow;
}

export function dbBridge(): NativeDbBridge {
    const bridge = nativeWindow().GarraTVDb;
    if (!bridge) throw new Error('GarraTVDb bridge unavailable');
    return bridge;
}

export function fsBridge(): NativeFsBridge {
    const bridge = nativeWindow().GarraTVFs;
    if (!bridge) throw new Error('GarraTVFs bridge unavailable');
    return bridge;
}

export function httpBridge(): NativeHttpBridge | undefined {
    return nativeWindow().GarraTVHttp;
}

export function appBridge(): NativeAppBridge | undefined {
    return nativeWindow().GarraTVApp;
}

interface BridgeReply {
    result?: unknown;
    error?: string;
    code?: string;
}

/** Bridge calls answer `{result}` or `{error, code}`; errors become thrown Errors with Node-like codes. */
export function unwrap<T>(raw: string): T {
    const reply = JSON.parse(raw) as BridgeReply;
    if (reply.error !== undefined) {
        const error = new Error(reply.error) as Error & { code?: string };
        error.code = reply.code;
        throw error;
    }
    return reply.result as T;
}
