/**
 * Cross-origin requests from the in-app backend (Xtream panel, TMDB, OpenSubtitles)
 * would hit CORS in a WebView. GETs are rerouted to `/__net`, which the Kotlin shell
 * fetches natively and streams back; other methods go through the GarraTVHttp
 * bridge, since a WebView cannot see the body of an intercepted request.
 */
import { httpBridge } from './shims/native';

interface NativeHttpReply {
    status: number;
    headers: Record<string, string>;
    body: string;
    error?: string;
}

const pending = new Map<string, (reply: NativeHttpReply) => void>();
let nextId = 0;

function headerRecord(source: HeadersInit | undefined): Record<string, string> {
    const record: Record<string, string> = {};
    new Headers(source ?? {}).forEach((value, key) => {
        record[key] = value;
    });
    return record;
}

function viaBridge(url: string, init: RequestInit): Promise<Response> {
    const bridge = httpBridge();
    if (!bridge) return Promise.reject(new TypeError('GarraTVHttp bridge unavailable'));
    const id = `h${++nextId}`;
    return new Promise<Response>((resolve, reject) => {
        pending.set(id, (reply) => {
            if (reply.error) {
                reject(new TypeError(reply.error));
                return;
            }
            resolve(new Response(reply.body, { status: reply.status, headers: reply.headers }));
        });
        bridge.request(id, (init.method || 'GET').toUpperCase(), url, JSON.stringify(headerRecord(init.headers)), typeof init.body === 'string' ? init.body : '');
    });
}

export function installNativeFetch(): void {
    const win = window as unknown as { __garratvHttpDone?: (id: string, reply: NativeHttpReply) => void };
    win.__garratvHttpDone = (id, reply) => {
        const settle = pending.get(id);
        pending.delete(id);
        settle?.(reply);
    };

    const pageFetch = window.fetch.bind(window);
    window.fetch = (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
        const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
        let target: URL;
        try {
            target = new URL(url, window.location.href);
        } catch {
            return pageFetch(input, init);
        }
        if (target.origin === window.location.origin || !/^https?:$/.test(target.protocol)) {
            return pageFetch(input, init);
        }

        const options: RequestInit = init ?? (input instanceof Request ? { method: input.method, headers: input.headers } : {});
        const method = (options.method || 'GET').toUpperCase();
        if (method === 'GET' || method === 'HEAD') {
            return pageFetch(`/__net?u=${encodeURIComponent(target.toString())}`, {
                method,
                headers: options.headers,
                signal: options.signal,
            });
        }
        return viaBridge(target.toString(), options);
    };
}
