'use client';

import { useEffect, useState } from 'react';
import { useFavorites } from '@/app/context/FavoritesContext';
import { useData } from '@/app/context/DataContext';
import * as db from '@/app/lib/db';
import type { CachedCategory, ContentType } from '@/app/lib/dbTypes';
import { toCatalogItem, toCatalogItems, type CatalogItem } from '@/app/lib/catalogItem';
import { sortCatalogItems, sortCategories, type SortOption } from '@/app/lib/catalogSort';

export const FILTER_ALL = 'all';
export const FILTER_FAVORITES = 'favorites';
export const FILTER_RECENT = 'recent';

const PAGE = 60;

export function useCatalogData(type: ContentType, filter: string, query: string, sort: SortOption) {
    const { lastSync } = useData();
    const { favorites, isLoaded: favoritesLoaded } = useFavorites();
    const [categories, setCategories] = useState<CachedCategory[]>([]);
    const [counts, setCounts] = useState<Record<string, number>>({});
    const [total, setTotal] = useState(0);
    const [recentCount, setRecentCount] = useState(0);
    const [items, setItems] = useState<CatalogItem[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState('');
    const [page, setPage] = useState(1);
    const [hasMore, setHasMore] = useState(false);

    useEffect(() => {
        setPage(1);
    }, [type, filter, query, sort]);

    useEffect(() => {
        let cancelled = false;

        const loadMeta = async () => {
            try {
                const [cats, grouped, count, recent] = await Promise.all([
                    db.getCategories(type),
                    db.getCategoryCounts(type),
                    db.getStreamCount(type),
                    db.getRecentStreams(type, 200),
                ]);
                if (cancelled) return;
                const map: Record<string, number> = {};
                for (const row of grouped) map[row.category_id] = row.total;
                setCategories(sortCategories(cats, 'name-asc'));
                setCounts(map);
                setTotal(count);
                setRecentCount(recent.length);
            } catch (err) {
                console.error('[StreamFlix] Failed to load categories', err);
                if (!cancelled) setError('catalog.loadCategoriesError');
            }
        };

        loadMeta();
        return () => {
            cancelled = true;
        };
    }, [type, lastSync]);

    useEffect(() => {
        if (filter === FILTER_FAVORITES && !favoritesLoaded) return undefined;

        let cancelled = false;

        const load = async () => {
            if (page === 1) setLoading(true);
            setError('');
            const trimmed = query.trim();
            const pagedAll = filter === FILTER_ALL && trimmed.length < 2 && sort !== 'added';

            try {
                if (trimmed.length >= 2) {
                    const streams = await db.searchStreams(trimmed, type, 80);
                    if (cancelled) return;
                    setItems(sortCatalogItems(toCatalogItems(streams), sort));
                    setHasMore(false);
                } else if (filter === FILTER_FAVORITES) {
                    const own = favorites.filter((item) => item.type === type);
                    const streams = await db.getStreamsByIds(own.map((item) => item.id), type);
                    if (cancelled) return;
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
                    setItems(sortCatalogItems(catalog, sort));
                    setHasMore(false);
                } else if (filter === FILTER_RECENT || (filter === FILTER_ALL && sort === 'added')) {
                    const streams = await db.getRecentStreams(type, 120);
                    if (cancelled) return;
                    setItems(sortCatalogItems(toCatalogItems(streams), 'added'));
                    setHasMore(false);
                } else if (pagedAll) {
                    const streams = await db.listStreams(
                        type,
                        undefined,
                        PAGE,
                        (page - 1) * PAGE,
                        sort === 'rating' ? 'rating' : 'name',
                    );
                    if (cancelled) return;
                    const catalog = toCatalogItems(streams);
                    setItems((current) => {
                        if (page === 1) return catalog;
                        const seen = new Set(current.map((item) => item.id));
                        return current.concat(catalog.filter((item) => !seen.has(item.id)));
                    });
                    setHasMore(streams.length === PAGE);
                } else {
                    const streams = await db.getStreams(filter, type);
                    if (cancelled) return;
                    setItems(sortCatalogItems(toCatalogItems(streams), sort));
                    setHasMore(false);
                }
            } catch (err) {
                console.error('[StreamFlix] Failed to load streams', err);
                if (!cancelled) setError('catalog.loadItemsError');
            } finally {
                if (!cancelled) setLoading(false);
            }
        };

        load();
        return () => {
            cancelled = true;
        };
    }, [type, filter, query, sort, page, favorites, favoritesLoaded, lastSync]);

    const favoriteCount = favorites.filter((item) => item.type === type).length;
    // Size of the selected category, not of the page loaded so far.
    const searching = query.trim().length >= 2;
    const itemCount = !searching && filter === FILTER_ALL
        ? total
        : !searching && counts[filter] !== undefined
            ? counts[filter]
            : items.length;

    return {
        categories,
        counts,
        total,
        recentCount,
        favoriteCount,
        itemCount,
        items,
        loading,
        error,
        hasMore,
        loadMore: () => setPage((current) => current + 1),
    };
}
