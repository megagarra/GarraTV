/**
 * `next/server` for route handlers running inside the WebView. NextResponse is a
 * plain Response here; cookies are a no-op (the app has no sessions to keep —
 * the active profile travels in the X-GarraTV-Profile header).
 */

const noopCookies = {
    set: () => undefined,
    delete: () => undefined,
    get: () => undefined,
    getAll: () => [],
    has: () => false,
};

export class NextResponse<Body = unknown> extends Response {
    readonly cookies = noopCookies;

    static json<JsonBody>(body: JsonBody, init?: ResponseInit): NextResponse<JsonBody> {
        const headers = new Headers(init?.headers ?? {});
        if (!headers.has('content-type')) headers.set('content-type', 'application/json');
        return new NextResponse<JsonBody>(JSON.stringify(body), { ...init, headers });
    }

    static redirect(url: string | URL, init?: number | ResponseInit): NextResponse {
        const status = typeof init === 'number' ? init : init?.status ?? 307;
        return new NextResponse(null, { status, headers: { location: String(url) } });
    }

    static next(): NextResponse {
        return new NextResponse(null, { status: 200 });
    }

    /** Keeps the generic parameter used by callers' type annotations. */
    declare readonly __body?: Body;
}

export class NextRequest extends Request {
    get nextUrl(): URL {
        return new URL(this.url);
    }
}

export const after = (task: () => unknown): void => {
    Promise.resolve().then(task).catch(() => undefined);
};
