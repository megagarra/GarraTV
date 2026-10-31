'use client';

import { useEffect, useRef } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { useData } from '@/app/context/DataContext';

const HOME = '/garratv/home';

/**
 * After every successful catalog sync, go back to the home screen (Live TV,
 * Movies, Series): the screen the user was on was built from the old catalog
 * and its rows, selections and scroll no longer match what is stored. A
 * cancelled or failed sync leaves the user where they were, and so does a sync
 * that ends while a video is playing — the player is never interrupted.
 */
export default function SyncHomeRedirect() {
    const { isSyncing, lastSync } = useData();
    const router = useRouter();
    const pathname = usePathname() ?? '';
    // lastSync when the current sync started; a newer one at the end means it completed.
    const startedWith = useRef<number | null | undefined>(undefined);

    useEffect(() => {
        if (isSyncing) {
            if (startedWith.current === undefined) startedWith.current = lastSync;
            return;
        }
        if (startedWith.current === undefined) return;
        const completed = lastSync !== null && lastSync !== startedWith.current;
        startedWith.current = undefined;
        if (!completed) return;
        if (pathname.indexOf('/dashboard/watch/') === 0) return;
        if (pathname.replace(/\/$/, '') !== HOME) router.replace(HOME);
    }, [isSyncing, lastSync, pathname, router]);

    return null;
}
