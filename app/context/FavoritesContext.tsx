'use client';

import React, { createContext, useCallback, useContext, useMemo, useState, useEffect, useRef, ReactNode } from 'react';
import { apiFetch } from '../lib/apiClient';

// Simplified Item for Favorites (storing just enough to render a card)
export interface FavoriteItem {
    id: string | number;
    type: 'live' | 'movie' | 'series';
    name: string;
    image?: string;
    rating?: string;
}

interface FavoritesState {
    favorites: FavoriteItem[];
    /** False until the initial backend/localStorage load resolves (fixes D8's flash of "empty"). */
    isLoaded: boolean;
    addFavorite: (item: FavoriteItem) => void;
    removeFavorite: (id: string | number, type: 'live' | 'movie' | 'series') => void;
    isFavorite: (id: string | number, type: 'live' | 'movie' | 'series') => boolean;
}

const FavoritesContext = createContext<FavoritesState | undefined>(undefined);

export const FavoritesProvider = ({ children }: { children: ReactNode }) => {
    const [favorites, setFavorites] = useState<FavoriteItem[]>([]);
    const [isLoaded, setIsLoaded] = useState(false);
    // Tracks whether `favorites` has been changed by the user (add/remove)
    // since the initial load, so the load itself doesn't trigger a redundant
    // POST right after the GET on every boot.
    const hasUserChangeRef = useRef(false);

    // Load from Backend on mount
    useEffect(() => {
        const loadFavorites = async () => {
            try {
                const res = await apiFetch('/api/favorites');
                if (res.ok) {
                    const data = await res.json();
                    setFavorites(data);
                }
            } catch (e) {
                console.error("Failed to fetch favorites from backend", e);
                // Fallback to localStorage if backend fails
                const stored = localStorage.getItem('garratv_favorites');
                if (stored) {
                    try {
                        setFavorites(JSON.parse(stored));
                    } catch (e) {
                        console.error("Failed to parse localStorage favorites", e);
                    }
                }
            } finally {
                setIsLoaded(true);
            }
        };
        loadFavorites();
    }, []);

    // The local cache must track whatever we last saw, including the list the
    // backend just handed us — otherwise the offline fallback in loadFavorites
    // would serve stale data forever.
    useEffect(() => {
        if (isLoaded) {
            localStorage.setItem('garratv_favorites', JSON.stringify(favorites));
        }
    }, [favorites, isLoaded]);

    // Writing back to the backend, on the other hand, is only warranted for
    // real user-driven add/remove changes: posting the list we just fetched
    // would be a redundant round trip on every boot.
    useEffect(() => {
        if (isLoaded && hasUserChangeRef.current) {
            const syncFavorites = async () => {
                try {
                    await apiFetch('/api/favorites', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify(favorites)
                    });
                } catch (e) {
                    console.error("Failed to sync favorites to backend", e);
                }
            };
            syncFavorites();
        }
    }, [favorites, isLoaded]);

    const addFavorite = useCallback((item: FavoriteItem) => {
        hasUserChangeRef.current = true;
        setFavorites(prev => {
            if (prev.some(f => f.id === item.id && f.type === item.type)) return prev;
            return [...prev, item];
        });
    }, []);

    const removeFavorite = useCallback((id: string | number, type: 'live' | 'movie' | 'series') => {
        hasUserChangeRef.current = true;
        setFavorites(prev => prev.filter(item => !(item.id === id && item.type === type)));
    }, []);

    // Long lists call isFavorite once per row; a Set keyed by "type:id" makes it
    // O(1) instead of a scan of every favorite. String ids keep the old loose
    // (string/number) id match.
    const favoriteKeys = useMemo(
        () => new Set(favorites.map(item => `${item.type}:${String(item.id)}`)),
        [favorites],
    );
    const isFavorite = useCallback(
        (id: string | number, type: 'live' | 'movie' | 'series') => favoriteKeys.has(`${type}:${String(id)}`),
        [favoriteKeys],
    );

    const value = useMemo(
        () => ({ favorites, isLoaded, addFavorite, removeFavorite, isFavorite }),
        [favorites, isLoaded, addFavorite, removeFavorite, isFavorite],
    );

    return (
        <FavoritesContext.Provider value={value}>
            {children}
        </FavoritesContext.Provider>
    );
};

export const useFavorites = () => {
    const context = useContext(FavoritesContext);
    if (context === undefined) {
        throw new Error('useFavorites must be used within a FavoritesProvider');
    }
    return context;
};
