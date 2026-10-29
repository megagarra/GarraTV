import 'server-only';

import type { ContentType } from './dbTypes';
import { toCatalogItem, type CatalogItem } from './catalogItem';
import * as sqlite from './sqliteCache';
import { listWatchedTitles } from './userStore';

/** How far back a title still counts as "new". */
const NEW_WINDOW_MS = 30 * 24 * 60 * 60 * 1000;
const MAX_ITEMS = 20;

export interface NewReleaseItem extends CatalogItem {
    /** The profile already watched this series and it was updated since. */
    hasNewEpisodes: boolean;
}

/**
 * Recently added movies and recently updated series, for one profile.
 *
 * Series the profile already watched come first when the provider touched them
 * after the last watch — the catalog `last_modified` is the only "episodes were
 * added" signal Xtream gives. Everything else follows newest first. Movies the
 * profile already started are skipped: they are not news to that person.
 */
export function getNewReleases(profileId: string, now = Date.now()): NewReleaseItem[] {
    const watched = listWatchedTitles(profileId);
    const seriesWatchedAt = new Map<string, number>();
    const startedMovies = new Set<string>();
    for (const title of watched) {
        if (title.type === 'series') seriesWatchedAt.set(title.contentId, title.lastWatchedAt);
        else if (title.type === 'movie') startedMovies.add(title.contentId);
    }

    const since = now - NEW_WINDOW_MS;
    const candidates: { id: string; type: ContentType; addedAt: number }[] = [];

    for (const type of ['series', 'movie'] as const) {
        // Indexed range on the write-time `added_at`, instead of parsing every row.
        for (const row of sqlite.getStreamsAddedSince(type, since)) {
            if (type === 'movie' && startedMovies.has(row.id)) continue;
            candidates.push({ id: row.id, type, addedAt: row.addedAt });
        }
    }

    const hasNewEpisodes = (c: { id: string; type: ContentType; addedAt: number }) => {
        const lastWatchedAt = c.type === 'series' ? seriesWatchedAt.get(c.id) : undefined;
        return lastWatchedAt !== undefined && c.addedAt > lastWatchedAt;
    };

    // Ranking: updated-since-watched series, then other series the profile
    // follows, then the rest — each tier newest first.
    const tier = (c: { id: string; type: ContentType; addedAt: number }) =>
        hasNewEpisodes(c) ? 0 : c.type === 'series' && seriesWatchedAt.has(c.id) ? 1 : 2;

    const ranked = candidates
        .sort((a, b) => tier(a) - tier(b) || b.addedAt - a.addedAt)
        .slice(0, MAX_ITEMS);

    const items: NewReleaseItem[] = [];
    for (const candidate of ranked) {
        const [stream] = sqlite.getStreamsByIds([candidate.id], candidate.type);
        if (!stream) continue;
        items.push({ ...toCatalogItem(stream), hasNewEpisodes: hasNewEpisodes(candidate) });
    }
    return items;
}
