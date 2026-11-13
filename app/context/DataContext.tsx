'use client';

import React, { createContext, useContext, useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { usePathname } from 'next/navigation';
import { useAuth } from './AuthContext';
import * as db from '../lib/db';
import { apiFetch } from '../lib/apiClient';

export type SyncStage = 'waiting' | 'downloading' | 'saving' | 'done' | 'error';

export interface SyncTypeProgress {
    stage: SyncStage;
    processed: number;
    total: number;
}

export type SyncPerType = Record<'live' | 'movie' | 'series', SyncTypeProgress>;

interface DataContextType {
    isSyncing: boolean;
    lastSync: number | null;
    /** The first catalog check after sign-in has answered (synced or not). */
    catalogChecked: boolean;
    /** Message of the last failed sync, cleared when a new one starts. */
    syncError: string | null;
    syncData: () => Promise<void>;
    cancelSync: () => void;
    getCachedCategories: (type: 'live' | 'movie' | 'series') => Promise<db.CachedCategory[]>;
    getCachedStreams: (categoryId: string, type: 'live' | 'movie' | 'series') => Promise<db.CachedStream[]>;
    searchCachedStreams: (query: string, type?: 'live' | 'movie' | 'series', limit?: number) => Promise<db.CachedStream[]>;
    getCachedDetail: <T = Record<string, unknown>>(type: db.ContentType, id: string | number) => Promise<T | undefined>;
    saveCachedDetail: (type: db.ContentType, id: string | number, data: unknown) => Promise<void>;
}

/** Ticks every second during a sync; kept apart so screens don't re-render with it. */
interface SyncStatusContextType {
    syncProgress: number;
    perType: SyncPerType;
}

const DataContext = createContext<DataContextType | undefined>(undefined);
const SyncStatusContext = createContext<SyncStatusContextType | undefined>(undefined);

interface ServerSyncJob {
    id: string;
    status: 'running' | 'completed' | 'failed' | 'cancelled';
    progress: number;
    message: string;
    lastSync?: number;
    error?: string;
    perType?: SyncPerType;
}

const POLL_MS = 1000;

const HOUR_MS = 60 * 60 * 1000;
/** A catalog older than this is refreshed in the background, when nobody is using the app. */
const REFRESH_AFTER_MS = 24 * HOUR_MS;
/** Past this age the catalog is too far behind to browse: refresh it up front, on open. */
const BLOCKING_AFTER_MS = 7 * 24 * HOUR_MS;
/** No remote/keyboard/touch input for this long counts as "nobody is using the app". */
const IDLE_MS = 3 * 60 * 1000;
const SCHEDULER_TICK_MS = 60 * 1000;
/** Wait after a background refresh that failed or was interrupted. */
const RETRY_AFTER_MS = 30 * 60 * 1000;
const PLAYER_PATH = '/dashboard/watch/';

type SyncMode = 'foreground' | 'background';

function idlePerType(): SyncPerType {
    const waiting = (): SyncTypeProgress => ({ stage: 'waiting', processed: 0, total: 0 });
    return { live: waiting(), movie: waiting(), series: waiting() };
}

/** Something is playing (the player page or a live preview). */
function isWatching(pathname: string): boolean {
    if (pathname.indexOf(PLAYER_PATH) === 0) return true;
    if (typeof document === 'undefined') return false;
    const videos = document.getElementsByTagName('video');
    for (let index = 0; index < videos.length; index++) {
        if (!videos[index].paused && !videos[index].ended) return true;
    }
    return false;
}

export function DataProvider({ children }: { children: React.ReactNode }) {
    const { isAuthenticated, user, server } = useAuth();
    const pathname = usePathname() ?? '';
    // Which account is signed in; the credentials themselves stay on the server.
    const accountIdentity = isAuthenticated && user && server ? `${server.url}|${user.username}` : null;
    const [isSyncing, setIsSyncing] = useState(false);
    const [syncProgress, setSyncProgress] = useState(0);
    const [perType, setPerType] = useState<SyncPerType>(idlePerType);
    const [lastSync, setLastSync] = useState<number | null>(null);
    const [checkedFor, setCheckedFor] = useState<string | null>(null);
    const [syncError, setSyncError] = useState<string | null>(null);
    const activeJobIdRef = useRef<string | null>(null);
    const cancelPollingRef = useRef(false);
    /** The sync in flight, if any. A background one runs unseen, without locking the screens. */
    const modeRef = useRef<SyncMode | null>(null);
    const initializedForRef = useRef<string | null>(null);
    const pathnameRef = useRef(pathname);
    const lastInputRef = useRef(0);
    /** When the stored catalog was last refreshed, including a refresh not shown yet. */
    const catalogAgeRef = useRef<number | null>(null);
    /** A finished background refresh waiting for a moment that does not disturb the user. */
    const pendingSyncRef = useRef<number | null>(null);
    const retryAfterRef = useRef(0);

    const showCatalog = useCallback((timestamp: number) => {
        pendingSyncRef.current = null;
        catalogAgeRef.current = timestamp;
        // New catalog: whatever the screens cached is stale now.
        db.clearClientCache();
        setLastSync(timestamp);
    }, []);

    const cancelSync = useCallback(() => {
        cancelPollingRef.current = true;
        const jobId = activeJobIdRef.current;

        if (jobId) {
            apiFetch(`/api/sync?jobId=${encodeURIComponent(jobId)}`, { method: 'DELETE' })
                .catch(error => console.error('Failed to cancel server sync', error));
        }

        activeJobIdRef.current = null;
        modeRef.current = null;
        setIsSyncing(false);
        setSyncProgress(0);
        setPerType(idlePerType());
        console.log('Sync cancelled by user');
    }, []);

    const runSync = useCallback(async (mode: SyncMode) => {
        cancelPollingRef.current = false;
        modeRef.current = mode;
        if (mode === 'foreground') {
            setIsSyncing(true);
            setSyncProgress(0);
            setPerType(idlePerType());
            setSyncError(null);
        }

        // Read on every use: a background sync turns into a foreground one when
        // the user asks for an update while it runs.
        const inForeground = () => modeRef.current === 'foreground';
        const apply = (job: ServerSyncJob) => {
            if (!inForeground()) return;
            setSyncProgress(job.progress);
            if (job.perType) setPerType(job.perType);
        };

        try {
            console.log(`[DataContext] Starting ${mode} sync via /api/sync`);
            const startResponse = await apiFetch('/api/sync', { method: 'POST' });

            if (!startResponse.ok) {
                throw new Error('Falha ao iniciar sincronizacao no servidor');
            }

            const startBody = await startResponse.json() as { job: ServerSyncJob };
            activeJobIdRef.current = startBody.job.id;
            apply(startBody.job);

            while (!cancelPollingRef.current && activeJobIdRef.current) {
                // A background refresh gives way to playback: the provider often allows
                // one connection, and the checkpoints make stopping here free.
                if (!inForeground() && isWatching(pathnameRef.current)) {
                    await apiFetch(`/api/sync?jobId=${encodeURIComponent(activeJobIdRef.current)}`, { method: 'DELETE' });
                    retryAfterRef.current = Date.now() + RETRY_AFTER_MS;
                    break;
                }

                const statusResponse = await apiFetch(`/api/sync?jobId=${encodeURIComponent(activeJobIdRef.current)}`);
                if (!statusResponse.ok) {
                    throw new Error('Falha ao consultar sincronizacao no servidor');
                }

                const statusBody = await statusResponse.json() as { job: ServerSyncJob | null };
                const job = statusBody.job;

                if (!job) break;

                apply(job);

                if (job.status === 'completed') {
                    const timestamp = job.lastSync ?? Date.now();
                    catalogAgeRef.current = timestamp;
                    const unattended = Date.now() - lastInputRef.current >= IDLE_MS;
                    if (inForeground() || unattended) {
                        showCatalog(timestamp);
                    } else {
                        // Someone is browsing: swap the catalog in on their next
                        // navigation instead of reloading the list under their focus.
                        pendingSyncRef.current = timestamp;
                    }
                    if (inForeground()) setSyncProgress(100);
                    break;
                }

                if (job.status === 'failed') {
                    throw new Error(job.error || job.message || 'Falha na sincronizacao');
                }

                if (job.status === 'cancelled') {
                    break;
                }

                await new Promise(resolve => setTimeout(resolve, POLL_MS));
            }
        } catch (error) {
            console.error('Server sync error:', error);
            if (inForeground()) {
                setSyncError(error instanceof Error ? error.message : 'Falha na sincronizacao');
            } else {
                retryAfterRef.current = Date.now() + RETRY_AFTER_MS;
            }
        } finally {
            activeJobIdRef.current = null;
            if (inForeground()) {
                // A short beat on 100% so the loading screen visibly completes.
                setTimeout(() => {
                    modeRef.current = null;
                    setIsSyncing(false);
                    setSyncProgress(0);
                }, 400);
            } else {
                modeRef.current = null;
            }
        }
    }, [showCatalog]);

    const syncData = useCallback(async () => {
        if (!isAuthenticated || modeRef.current === 'foreground') return;
        if (modeRef.current === 'background') {
            // Already refreshing unseen: show that same run instead of starting another.
            modeRef.current = 'foreground';
            setSyncError(null);
            setIsSyncing(true);
            return;
        }
        await runSync('foreground');
    }, [isAuthenticated, runSync]);

    // Cleanup on unmount
    useEffect(() => {
        return () => {
            cancelPollingRef.current = true;
        };
    }, []);

    // Runs the initial metadata check once per signed-in account, as soon as it
    // is known (AuthContext fills it in asynchronously). Keying on the account
    // identity, and not on a plain boolean, matters twice: a sync failure must
    // not re-trigger this effect (the identity is unchanged), but a different
    // account logging in must, since this provider outlives logout — it lives in
    // the root layout, so `logout()` only navigates and never unmounts it.
    //
    // Only a missing or very old catalog syncs here, behind the loading screen.
    // A catalog that is merely a day old opens right away and is refreshed by
    // the scheduler below, once the app sits unused.
    useEffect(() => {
        if (!accountIdentity) return;

        if (initializedForRef.current === accountIdentity) return;
        initializedForRef.current = accountIdentity;

        const initData = async () => {
            let meta: Awaited<ReturnType<typeof db.getSyncMetadata>> = undefined;
            try {
                meta = await db.getSyncMetadata('categories');
            } catch (error) {
                console.error('[DataContext] Sync metadata unavailable', error);
            }
            pendingSyncRef.current = null;
            catalogAgeRef.current = meta ? meta.lastSync : null;
            if (meta) setLastSync(meta.lastSync);
            if (!meta || Date.now() - meta.lastSync > BLOCKING_AFTER_MS) {
                // Flag first so the loading screen takes over before the first paint
                // of a stale or empty catalog.
                setIsSyncing(true);
                void syncData();
            }
            setCheckedFor(accountIdentity);
        };
        initData();
    }, [accountIdentity, syncData]);

    // Background refresh: once a day, and only while nobody is using the app —
    // no input for a few minutes and nothing playing. Opening the app or
    // browsing never triggers it, so it never gets in the way of watching.
    useEffect(() => {
        if (!accountIdentity) return;

        lastInputRef.current = Date.now();
        const touch = () => { lastInputRef.current = Date.now(); };
        const events = ['keydown', 'pointerdown', 'touchstart', 'wheel'];
        events.forEach(name => window.addEventListener(name, touch, true));

        const tick = () => {
            const now = Date.now();
            if (modeRef.current !== null || catalogAgeRef.current === null) return;
            if (now - catalogAgeRef.current < REFRESH_AFTER_MS || now < retryAfterRef.current) return;
            if (now - lastInputRef.current < IDLE_MS || document.hidden) return;
            if (isWatching(pathnameRef.current)) return;
            void runSync('background');
        };
        const timer = window.setInterval(tick, SCHEDULER_TICK_MS);

        return () => {
            window.clearInterval(timer);
            events.forEach(name => window.removeEventListener(name, touch, true));
        };
    }, [accountIdentity, runSync]);

    // A catalog refreshed in the background appears on the next navigation.
    useEffect(() => {
        pathnameRef.current = pathname;
        if (pendingSyncRef.current !== null && modeRef.current === null) {
            showCatalog(pendingSyncRef.current);
        }
    }, [pathname, showCatalog]);

    const getCachedCategories = useCallback(async (type: 'live' | 'movie' | 'series') => {
        return db.getCategories(type);
    }, []);

    const getCachedStreams = useCallback(async (categoryId: string, type: 'live' | 'movie' | 'series') => {
        return db.getStreams(categoryId, type);
    }, []);

    const searchCachedStreams = useCallback(async (query: string, type?: 'live' | 'movie' | 'series', limit?: number) => {
        return db.searchStreams(query, type, limit);
    }, []);

    const getCachedDetail = useCallback(async <T = Record<string, unknown>,>(type: db.ContentType, id: string | number) => {
        return db.getDetail<T>(type, id);
    }, []);

    const saveCachedDetail = useCallback(async (type: db.ContentType, id: string | number, data: unknown) => {
        await db.saveDetail(type, id, data);
    }, []);

    const catalogChecked = accountIdentity !== null && checkedFor === accountIdentity;

    const value = useMemo<DataContextType>(() => ({
        isSyncing,
        lastSync,
        catalogChecked,
        syncError,
        syncData,
        cancelSync,
        getCachedCategories,
        getCachedStreams,
        searchCachedStreams,
        getCachedDetail,
        saveCachedDetail,
    }), [isSyncing, lastSync, catalogChecked, syncError, syncData, cancelSync, getCachedCategories, getCachedStreams, searchCachedStreams, getCachedDetail, saveCachedDetail]);

    const status = useMemo<SyncStatusContextType>(() => ({ syncProgress, perType }), [syncProgress, perType]);

    return (
        <DataContext.Provider value={value}>
            <SyncStatusContext.Provider value={status}>
                {children}
            </SyncStatusContext.Provider>
        </DataContext.Provider>
    );
}

export function useData() {
    const context = useContext(DataContext);
    if (context === undefined) {
        throw new Error('useData must be used within a DataProvider');
    }
    return context;
}

/** Live sync progress; only the loading UI should subscribe to this. */
export function useSyncStatus() {
    const context = useContext(SyncStatusContext);
    if (context === undefined) {
        throw new Error('useSyncStatus must be used within a DataProvider');
    }
    return context;
}

/**
 * Whether screens must wait behind the catalog loading screen: until the first
 * catalog check answers, during a foreground sync (the first one, the refresh
 * button, or a catalog too old to browse), and while there is no complete catalog
 * after a failed first sync. The daily refresh runs in the background, unseen.
 * A foreground sync locks the screen on purpose: on a TV the remote keeps moving focus
 * over a catalog that is being rewritten underneath it, which led to half-loaded
 * rows and dead clicks. When a sync completes, SyncHomeRedirect takes the user to
 * the home screen. The player is the one place left running (DashboardChrome).
 */
export function useCatalogBlocked(): boolean {
    const { catalogChecked, isSyncing, syncError, lastSync } = useData();
    if (!catalogChecked || isSyncing) return true;
    return lastSync === null && syncError !== null;
}
