/**
 * How far a title or episode was watched, from its saved progress. The 95% line
 * is the same one the players use to start over instead of resuming.
 */
export const WATCHED_RATIO = 0.95;
/** Below this the title was only opened, not really started. */
const STARTED_SEC = 10;

export interface WatchState {
    /** 0..1 */
    ratio: number;
    watched: boolean;
    /** Started and not finished: worth a "continue". */
    inProgress: boolean;
    /** Where it stopped, in seconds. */
    position: number;
    /** What is left, in seconds (0 when the length is unknown). */
    remaining: number;
}

export function watchState(entry: { progress: number; duration: number } | undefined): WatchState {
    const position = entry && Number.isFinite(entry.progress) ? Math.max(0, entry.progress) : 0;
    const duration = entry && Number.isFinite(entry.duration) ? Math.max(0, entry.duration) : 0;
    const ratio = duration > 0 ? Math.min(1, position / duration) : 0;
    const watched = duration > 0 && ratio >= WATCHED_RATIO;
    return {
        ratio,
        watched,
        inProgress: !watched && position > STARTED_SEC,
        position,
        remaining: duration > 0 ? Math.max(0, duration - position) : 0,
    };
}

/** "1:02:05" or "12:05". */
export function formatClock(totalSeconds: number): string {
    const s = Math.max(0, Math.floor(totalSeconds));
    const h = Math.floor(s / 3600);
    const m = Math.floor((s % 3600) / 60);
    const sec = s % 60;
    const pad = (n: number) => String(n).padStart(2, '0');
    return h > 0 ? `${h}:${pad(m)}:${pad(sec)}` : `${m}:${pad(sec)}`;
}

/** Minutes left, rounded up so "0 min" never shows for a few seconds. */
export function minutesLeft(state: WatchState): number {
    return Math.max(1, Math.ceil(state.remaining / 60));
}
