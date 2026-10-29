'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useFavorites } from '@/app/context/FavoritesContext';
import { useData } from '@/app/context/DataContext';
import * as db from '@/app/lib/db';
import type { CachedCategory, ContentType } from '@/app/lib/dbTypes';
import { toCatalogItem, toCatalogItems, type CatalogItem } from '@/app/lib/catalogItem';
import { sortCatalogItems, sortCategories, type SortOption } from '@/app/lib/catalogSort';

export const FILTER_ALL = 'all';
export const FILTER_FAVORITES = 'favorites';
export const FILTER_RECENT = 'recent';

/** Rows fetched per request; the windowed grids ask for the next page near the end. */
const PAGE = 60;
const SEARCH_DEBOUNCE_MS = 250;

function orderFor(sort: SortOption): db.CatalogOrder {
    if (sort === 'added') return 'added';
    if (sort === 'rating') return 'rating';
    return 'name';
}

/**
 * Catalog for one screen: categories and counts, plus the list for the current
 * filter, fetched a page at a time from the server (sorted there, by index)
 * instead of downloading the whole content type up front.
 */
export function useCatalogData(type: ContentType, filter: string, query: string, sort: SortOption) {
    const { lastSync } = useData();
    const { favorites, isLoaded: favoritesLoaded } = useFavorites();
    const [categories, setCategories] = useState<CachedCategory[]>([]);
    const [counts, setCounts] = useState<Record<string, number>>({});
    const [total, setTotal] = useState(0);
    const [recentCount, setRecentCount] = useState(0);
    const [items, setItems] = useState<CatalogItem[]>([]);
    const [listTotal, setListTotal] = useState(0);
    const [loading, setLoading] = useState(true);
    const [loadingMore, setLoadingMore] = useState(false);
    const [error, setError] = useState('');
    const [metaReady, setMetaReady] = useState(false);
    const [debouncedQuery, setDebouncedQuery] = useState(query.trim());
    // Identifies the list currently in `items`, so a late page from a previous
    // filter is never appended to the new one.
    const listKeyRef = useRef('');
    const loadingMoreRef = useRef(false);

    useEffect(() => {
        const trimmed = query.trim();
        if (trimmed === debouncedQuery) return undefined;
        const timer = window.setTimeout(() => setDebouncedQuery(trimmed), trimmed ? SEARCH_DEBOUNCE_MS : 0);
        return () => window.clearTimeout(timer);
    }, [query, debouncedQuery]);

    useEffect(() => {
        let cancelled = false;

        const loadMeta = async () => {
            try {
                const [cats, grouped, count, dated] = await Promise.all([
                    db.getCategories(type),
                    db.getCategoryCounts(type),
                    db.getStreamCount(type),
                    db.countDatedStreams(type),
                ]);
                if (cancelled) return;
                const map: Record<string, number> = {};
                for (const row of grouped) map[row.category_id] = row.total;
                setCategories(sortCategories(cats, 'name-asc'));
                setCounts(map);
                setTotal(count);
                setRecentCount(dated);
            } catch (err) {
                console.error('[GarraTV] Failed to load categories', err);
                if (!cancelled) setError('catalog.loadCategoriesError');
            } finally {
                if (!cancelled) setMetaReady(true);
            }
        };

        loadMeta();
        return () => {
            cancelled = true;
        };
    }, [type, lastSync]);

    const searching = debouncedQuery.length >= 2;
    const pageQuery = useMemo(() => ({
        type,
        categoryId: filter === FILTER_ALL || filter === FILTER_RECENT || filter === FILTER_FAVORITES ? undefined : filter,
        recentOnly: filter === FILTER_RECENT,
        order: filter === FILTER_RECENT ? 'added' as const : orderFor(sort),
    }), [type, filter, sort]);
    const listKey = `${type}|${filter}|${debouncedQuery}|${sort}|${lastSync ?? ''}`;

    // First page (or the whole result, for search and favorites).
    useEffect(() => {
        if (!metaReady) return undefined;
        if (filter === FILTER_FAVORITES && !searching && !favoritesLoaded) return undefined;

        let cancelled = false;
        listKeyRef.current = listKey;
        loadingMoreRef.current = false;
        setLoading(true);
        setLoadingMore(false);
        setError('');

        const publish = (catalog: CatalogItem[], size: number) => {
            if (cancelled) return;
            setItems(catalog);
            setListTotal(size);
            setLoading(false);
        };

        const load = async () => {
            try {
                if (searching) {
                    const streams = await db.searchStreams(debouncedQuery, type, 300);
                    const catalog = sortCatalogItems(toCatalogItems(streams), sort);
                    publish(catalog, catalog.length);
                    return;
                }

                if (filter === FILTER_FAVORITES) {
                    const own = favorites.filter((item) => item.type === type);
                    const streams = await db.getStreamsByIds(own.map((item) => item.id), type);
                    const catalog = toCatalogItems(streams);
                    const found = new Set(catalog.map((item) => item.id));
                    for (const favorite of own) {
                        const id = String(favorite.id);
                        if (found.has(id)) continue;
                        catalog.push(toCatalogItem({
                            id,
                            category_id: '',
                            name: favorite.name,
                            type,
                            icon: favorite.image,
                            cover: favorite.image,
                            rating: favorite.rating,
                        }));
                    }
                    const sorted = sortCatalogItems(catalog, sort);
                    publish(sorted, sorted.length);
                    return;
                }

                const page = await db.pageCatalog({ ...pageQuery, limit: PAGE, offset: 0 });
                publish(toCatalogItems(page.items), page.total);
            } catch (err) {
                console.error('[GarraTV] Failed to load streams', err);
                if (!cancelled) {
                    setError('catalog.loadItemsError');
                    setLoading(false);
                }
            }
        };

        load();
        return () => {
            cancelled = true;
        };
        // `favorites` matters only for the favorites filter; the key covers the rest.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [listKey, metaReady, favoritesLoaded, filter === FILTER_FAVORITES ? favorites : null]);

    const hasMore = !searching && filter !== FILTER_FAVORITES && items.length < listTotal;

    /** Appends the next page; safe to call repeatedly while one is in flight. */
    const loadMore = useCallback(() => {
        if (!hasMore || loadingMoreRef.current) return;
        loadingMoreRef.current = true;
        setLoadingMore(true);
        const key = listKeyRef.current;
        db.pageCatalog({ ...pageQuery, limit: PAGE, offset: items.length })
            .then((page) => {
                if (listKeyRef.current !== key) return;
                setItems((current) => current.concat(toCatalogItems(page.items)));
                setListTotal(page.total);
            })
            .catch((err: unknown) => console.error('[GarraTV] Failed to load more', err))
            .finally(() => {
                if (listKeyRef.current === key) {
                    loadingMoreRef.current = false;
                    setLoadingMore(false);
                }
            });
    }, [hasMore, pageQuery, items.length]);

    const favoriteCount = useMemo(() => favorites.filter((item) => item.type === type).length, [favorites, type]);
    const itemCount = searching || filter === FILTER_FAVORITES ? items.length : listTotal;

    return {
        categories,
        counts,
        total,
        recentCount,
        favoriteCount,
        itemCount,
        items,
        loading: loading || !metaReady,
        loadingMore,
        hasMore,
        loadMore,
        error,
    };
}
