'use client';

import React, { createContext, useContext, useState, useEffect, useCallback, useMemo, useRef } from 'react';
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

function idlePerType(): SyncPerType {
    const waiting = (): SyncTypeProgress => ({ stage: 'waiting', processed: 0, total: 0 });
    return { live: waiting(), movie: waiting(), series: waiting() };
}

export function DataProvider({ children }: { children: React.ReactNode }) {
    const { isAuthenticated, user, server } = useAuth();
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
    const isSyncingRef = useRef(false);
    const initializedForRef = useRef<string | null>(null);

    const cancelSync = useCallback(() => {
        cancelPollingRef.current = true;
        const jobId = activeJobIdRef.current;

        if (jobId) {
            apiFetch(`/api/sync?jobId=${encodeURIComponent(jobId)}`, { method: 'DELETE' })
                .catch(error => console.error('Failed to cancel server sync', error));
        }

        activeJobIdRef.current = null;
        isSyncingRef.current = false;
        setIsSyncing(false);
        setSyncProgress(0);
        setPerType(idlePerType());
        console.log('Sync cancelled by user');
    }, []);

    const syncData = useCallback(async () => {
        if (!isAuthenticated || isSyncingRef.current) return;

        cancelPollingRef.current = false;
        isSyncingRef.current = true;
        setIsSyncing(true);
        setSyncProgress(0);
        setPerType(idlePerType());
        setSyncError(null);

        const apply = (job: ServerSyncJob) => {
            setSyncProgress(job.progress);
            if (job.perType) setPerType(job.perType);
        };

        try {
            console.log('[DataContext] Starting server-side sync via /api/sync');
            const startResponse = await apiFetch('/api/sync', { method: 'POST' });

            if (!startResponse.ok) {
                throw new Error('Falha ao iniciar sincronizacao no servidor');
            }

            const startBody = await startResponse.json() as { job: ServerSyncJob };
            activeJobIdRef.current = startBody.job.id;
            apply(startBody.job);

            while (!cancelPollingRef.current && activeJobIdRef.current) {
                const statusResponse = await apiFetch(`/api/sync?jobId=${encodeURIComponent(activeJobIdRef.current)}`);
                if (!statusResponse.ok) {
                    throw new Error('Falha ao consultar sincronizacao no servidor');
                }

                const statusBody = await statusResponse.json() as { job: ServerSyncJob | null };
                const job = statusBody.job;

                if (!job) break;

                apply(job);

                if (job.status === 'completed') {
                    // New catalog: whatever the screens cached is stale now.
                    db.clearClientCache();
                    setLastSync(job.lastSync ?? Date.now());
                    setSyncProgress(100);
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
            setSyncError(error instanceof Error ? error.message : 'Falha na sincronizacao');
        } finally {
            activeJobIdRef.current = null;
            // A short beat on 100% so the loading screen visibly completes.
            setTimeout(() => {
                isSyncingRef.current = false;
                setIsSyncing(false);
                setSyncProgress(0);
            }, 400);
        }
    }, [isAuthenticated]);

    // Cleanup on unmount
    useEffect(() => {
        return () => {
            cancelPollingRef.current = true;
        };
    }, []);

    // Runs the initial metadata check + auto-sync once per signed-in account,
    // as soon as it is known (AuthContext fills it in asynchronously). Keying on
    // the account identity, and not on a plain boolean, matters twice: a sync
    // failure must not re-trigger this effect (the identity is unchanged), but a
    // different account logging in must, since this provider outlives logout — it
    // lives in the root layout, so `logout()` only navigates and never unmounts it.
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
            const oneDay = 24 * 60 * 60 * 1000;
            const needsSync = !meta || Date.now() - meta.lastSync > oneDay;
            if (meta) setLastSync(meta.lastSync);
            if (needsSync) {
                console.log('Sincronizando conteúdo automaticamente...');
                // Flag first so the loading screen takes over before the first paint
                // of a stale or empty catalog.
                setIsSyncing(true);
                void syncData();
            }
            setCheckedFor(accountIdentity);
        };
        initData();
    }, [accountIdentity, syncData]);

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
 * catalog check answers, and while there is no complete catalog yet (first sign-in,
 * after signing out, or a first sync that failed). A refresh of an existing
 * catalog — the daily one takes 10+ minutes on throttled providers — runs in the
 * background with the current catalog on screen and a progress pill in the header.
 */
export function useCatalogBlocked(): boolean {
    const { catalogChecked, isSyncing, syncError, lastSync } = useData();
    if (!catalogChecked) return true;
    return lastSync === null && (isSyncing || syncError !== null);
}
