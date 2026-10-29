export type FavoriteType = 'live' | 'movie' | 'series';

/**
 * Marks a focusable channel / movie / series as a long-press target: holding OK
 * on it toggles the favorite (components/RemoteFavorites.tsx). Spread onto the
 * element that receives focus.
 */
export function favoriteTargetProps(type: FavoriteType, id: string | number, name: string, image?: string, rating?: number | string) {
    return {
        'data-favorite-type': type,
        'data-favorite-id': String(id),
        'data-favorite-name': name,
        'data-favorite-image': image || undefined,
        'data-favorite-rating': rating === undefined || rating === null || rating === '' ? undefined : String(rating),
    };
}
