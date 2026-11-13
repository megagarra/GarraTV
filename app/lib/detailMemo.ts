/**
 * Provider details (get_vod_info / get_series_info) already fetched in this
 * session, shared by the title screen and the player. Opening the player right
 * after the title screen then needs no request at all, not even a cache read.
 */
const MAX_ENTRIES = 100;
const memo = new Map<string, unknown>();

const keyOf = (kind: 'movie' | 'series', id: string | number) => `${kind}:${id}`;

export function recallDetail<T>(kind: 'movie' | 'series', id: string | number): T | undefined {
    return memo.get(keyOf(kind, id)) as T | undefined;
}

export function rememberDetail(kind: 'movie' | 'series', id: string | number, payload: unknown): void {
    const key = keyOf(kind, id);
    memo.delete(key);
    memo.set(key, payload);
    if (memo.size > MAX_ENTRIES) {
        const oldest = memo.keys().next().value;
        if (oldest !== undefined) memo.delete(oldest);
    }
}
