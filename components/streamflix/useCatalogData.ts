'use client';

import { useEffect, useRef, useState } from 'react';
import { useFavorites } from '@/app/context/FavoritesContext';
import { useData } from '@/app/context/DataContext';
import * as db from '@/app/lib/db';
import type { CachedCategory, ContentType } from '@/app/lib/dbTypes';
import { toCatalogItem, toCatalogItems, type CatalogItem } from '@/app/lib/catalogItem';
import { sortCatalogItems, sortCategories, type SortOption } from '@/app/lib/catalogSort';

export const FILTER_ALL = 'all';
export const FILTER_FAVORITES = 'favorites';
export const FILTER_RECENT = 'recent';

export function useCatalogData(type: ContentType, filter: string, query: string, sort: SortOption) {
    const { lastSync, isSyncing } = useData();
    const { favorites, isLoaded: favoritesLoaded } = useFavorites();
    const [categories, setCategories] = useState<CachedCategory[]>([]);
    const [counts, setCounts] = useState<Record<string, number>>({});
    const [total, setTotal] = useState(0);
    const [recentCount, setRecentCount] = useState(0);
    const [items, setItems] = useState<CatalogItem[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState('');
    const [metaReady, setMetaReady] = useState(false);
    const readyKeyRef = useRef('');

    useEffect(() => {
        let cancelled = false;
        setMetaReady(false);

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
                console.error('[StreamFlix] Failed to load categories', err);
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

    useEffect(() => {
        if (!metaReady) {
            if (!readyKeyRef.current) setLoading(true);
            return undefined;
        }
        if (filter === FILTER_FAVORITES && query.trim().length < 2) return undefined;

        const trimmed = query.trim();
        const searching = trimmed.length >= 2;
        const requestKey = `${type}|${filter}|${trimmed}|${sort}`;
        const sameList = readyKeyRef.current === requestKey;

        // An empty cache mid-sync is not a finished list. A list already on screen
        // stays up until the replacement arrives whole.
        if (isSyncing && total === 0 && !searching && filter !== FILTER_FAVORITES) {
            readyKeyRef.current = '';
            setLoading(true);
            setItems([]);
            setError('');
            return undefined;
        }

        let cancelled = false;

        const publish = (catalog: CatalogItem[]) => {
            if (cancelled) return;
            setItems(catalog);
            readyKeyRef.current = requestKey;
            setLoading(false);
        };

        const load = async () => {
            if (!sameList) {
                setLoading(true);
                setItems([]);
            }
            setError('');

            try {
                if (searching) {
                    const streams = await db.searchStreams(trimmed, type, 300);
                    publish(sortCatalogItems(toCatalogItems(streams), sort));
                    return;
                }

                const streams = await db.listCatalog(type, filter === FILTER_ALL || filter === FILTER_RECENT ? undefined : filter);
                if (cancelled) return;
                const catalog = toCatalogItems(streams);
                publish(sortCatalogItems(
                    filter === FILTER_RECENT ? catalog.filter((item) => item.addedAt > 0) : catalog,
                    filter === FILTER_RECENT ? 'added' : sort,
                ));
            } catch (err) {
                console.error('[StreamFlix] Failed to load streams', err);
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
    }, [type, filter, query, sort, lastSync, isSyncing, total, metaReady]);

    useEffect(() => {
        if (filter !== FILTER_FAVORITES || query.trim().length >= 2) return undefined;
        if (!metaReady || !favoritesLoaded) {
            setLoading(true);
            setItems([]);
            return undefined;
        }

        const trimmed = query.trim();
        const requestKey = `${type}|${filter}|${trimmed}|${sort}`;
        const sameList = readyKeyRef.current === requestKey;
        let cancelled = false;

        const load = async () => {
            if (!sameList) {
                setLoading(true);
                setItems([]);
            }
            setError('');
            try {
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
                if (cancelled) return;
                setItems(sortCatalogItems(catalog, sort));
                readyKeyRef.current = requestKey;
                setLoading(false);
            } catch (err) {
                console.error('[StreamFlix] Failed to load streams', err);
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
    }, [type, filter, query, sort, favorites, favoritesLoaded, metaReady]);

    const favoriteCount = favorites.filter((item) => item.type === type).length;
    const searching = query.trim().length >= 2;
    const itemCount = !searching && filter === FILTER_ALL
        ? total
        : !searching && filter === FILTER_RECENT
            ? recentCount
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
    };
}
