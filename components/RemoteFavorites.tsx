'use client';

import { useEffect, useRef, useState } from 'react';
import { Heart, HeartOff } from 'lucide-react';
import { useFavorites, type FavoriteItem } from '@/app/context/FavoritesContext';
import { useT } from '@/app/context/I18nContext';
import { isRemoteControlDevice } from '@/app/lib/deviceProfile';
import type { FavoriteType } from '@/app/lib/favoriteTarget';

/** How long OK must be held for a favorite instead of a click. */
const LONG_PRESS_MS = 650;
const TOAST_MS = 1800;
const TYPES: FavoriteType[] = ['live', 'movie', 'series'];

function isOkKey(event: KeyboardEvent): boolean {
    // 23 = DPAD_CENTER on remotes whose OK isn't mapped to Enter.
    return event.key === 'Enter' || event.keyCode === 13 || event.keyCode === 23;
}

/** The focused element when it is a favorite target (lib/favoriteTarget.ts). */
function focusedTarget(): HTMLElement | null {
    const el = document.activeElement;
    if (!(el instanceof HTMLElement)) return null;
    const type = el.getAttribute('data-favorite-type') as FavoriteType | null;
    return type && TYPES.indexOf(type) !== -1 && el.getAttribute('data-favorite-id') ? el : null;
}

/**
 * Remote-control favorites: holding OK on a channel, movie or series adds it to
 * favorites (or removes it), with a short confirmation. While OK is down on such
 * an element its own action is held back; released before the long-press time,
 * the press goes through as an ordinary click, so a short OK behaves as before.
 * TVs only — touch and mouse have the favorite buttons.
 */
export default function RemoteFavorites() {
    const t = useT();
    const { favorites, addFavorite, removeFavorite } = useFavorites();
    const [toast, setToast] = useState<{ added: boolean; key: number } | null>(null);
    // The key handlers are installed once; they read the current list from here.
    const favoritesRef = useRef(favorites);
    useEffect(() => {
        favoritesRef.current = favorites;
    }, [favorites]);
    const actionsRef = useRef({ addFavorite, removeFavorite });
    useEffect(() => {
        actionsRef.current = { addFavorite, removeFavorite };
    }, [addFavorite, removeFavorite]);

    useEffect(() => {
        if (!isRemoteControlDevice()) return undefined;

        let press: { el: HTMLElement; timer: number; fired: boolean } | null = null;

        const toggle = (el: HTMLElement) => {
            const type = el.getAttribute('data-favorite-type') as FavoriteType;
            const id = el.getAttribute('data-favorite-id') ?? '';
            // Stored ids may be numbers: compare as strings, remove with the stored one.
            const existing = favoritesRef.current.find((item) => item.type === type && String(item.id) === id);
            if (existing) {
                actionsRef.current.removeFavorite(existing.id, type);
            } else {
                const item: FavoriteItem = {
                    id,
                    type,
                    name: el.getAttribute('data-favorite-name') ?? '',
                    image: el.getAttribute('data-favorite-image') ?? undefined,
                    rating: el.getAttribute('data-favorite-rating') ?? undefined,
                };
                actionsRef.current.addFavorite(item);
            }
            setToast({ added: !existing, key: Date.now() });
        };

        const onKeyDown = (event: KeyboardEvent) => {
            if (!isOkKey(event)) return;
            const el = focusedTarget();
            if (!el) return;
            // Hold back the element's own Enter handling and click activation:
            // whether this is a click or a favorite is only known later.
            event.preventDefault();
            event.stopPropagation();
            if (press && press.el === el) {
                // Another keydown before any keyup: OK is still held. Remotes start
                // repeating only after about half a second, so the first repeat
                // already means a long press. Android WebView does not set
                // `event.repeat` on these, hence no check on it.
                if (!press.fired) {
                    window.clearTimeout(press.timer);
                    press.fired = true;
                    toggle(el);
                }
                return;
            }
            if (press) window.clearTimeout(press.timer);
            const current = { el, fired: false, timer: 0 };
            current.timer = window.setTimeout(() => {
                current.fired = true;
                toggle(el);
            }, LONG_PRESS_MS);
            press = current;
        };

        const onKeyUp = (event: KeyboardEvent) => {
            if (!isOkKey(event) || !press) return;
            event.preventDefault();
            event.stopPropagation();
            const { el, timer, fired } = press;
            press = null;
            window.clearTimeout(timer);
            // A short press does what OK always did.
            if (!fired) el.click();
        };

        // A keyup that never arrives (the app went to the background mid-press)
        // must not turn the next OK into a long press.
        const onBlur = () => {
            if (press) window.clearTimeout(press.timer);
            press = null;
        };

        // Capture on window: ahead of React's handlers and the page's own keys.
        window.addEventListener('keydown', onKeyDown, true);
        window.addEventListener('keyup', onKeyUp, true);
        window.addEventListener('blur', onBlur);
        return () => {
            window.removeEventListener('keydown', onKeyDown, true);
            window.removeEventListener('keyup', onKeyUp, true);
            window.removeEventListener('blur', onBlur);
            if (press) window.clearTimeout(press.timer);
        };
    }, []);

    useEffect(() => {
        if (!toast) return undefined;
        const timer = window.setTimeout(() => setToast(null), TOAST_MS);
        return () => window.clearTimeout(timer);
    }, [toast]);

    if (!toast) return null;
    const Icon = toast.added ? Heart : HeartOff;
    return (
        <div className="fixed left-0 right-0 bottom-10 z-[300] flex justify-center pointer-events-none" role="status" aria-live="polite">
            <div key={toast.key} className="h-11 px-5 flex items-center rounded-full bg-[rgba(20,20,20,0.94)] border border-[#333333] text-sm font-bold text-white shadow-[0_12px_32px_rgba(0,0,0,0.6)] animate-[sfFadeIn_200ms_ease-out]">
                <Icon size={18} className="mr-2.5 text-[#E50914]" fill={toast.added ? 'currentColor' : 'none'} />
                {t(toast.added ? 'garratv.favoriteAdded' : 'garratv.favoriteRemoved')}
            </div>
        </div>
    );
}
