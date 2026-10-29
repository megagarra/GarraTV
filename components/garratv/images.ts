/**
 * TMDB (and the provider mirrors that copy its paths, e.g. file.gstaticontent.com)
 * serve the same picture at several widths under `/t/p/<size>/`. Catalogs ship
 * the big ones (w600 posters, w1280 backdrops); tiles on a TV never need that.
 */
const SIZE: Record<'poster' | 'posterLarge' | 'backdrop', string> = {
    poster: 'w342',
    posterLarge: 'w500',
    backdrop: 'w780',
};

const TMDB_SIZE_SEGMENT = /\/t\/p\/(?:w\d+(?:_and_h\d+[a-z0-9_]*)?|original)\//i;

export function sizedImage(url: string | undefined, kind: keyof typeof SIZE): string | undefined {
    if (!url) return url;
    return TMDB_SIZE_SEGMENT.test(url) ? url.replace(TMDB_SIZE_SEGMENT, `/t/p/${SIZE[kind]}/`) : url;
}
