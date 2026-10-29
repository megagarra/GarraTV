'use client';

import { useEffect, useRef } from 'react';
import { Check, Clapperboard, Film, Loader2, LogIn, RefreshCw, Tv, X } from 'lucide-react';
import { useAuth } from '@/app/context/AuthContext';
import { useData, useSyncStatus, type SyncTypeProgress } from '@/app/context/DataContext';
import { useI18n, useT } from '@/app/context/I18nContext';
import { Wordmark } from './Header';
import { display, ghostButton, primaryButton, progressWidth } from './styles';

const ROWS = [
    { type: 'live' as const, label: 'garratv.liveTv', icon: Tv },
    { type: 'movie' as const, label: 'garratv.movies', icon: Film },
    { type: 'series' as const, label: 'garratv.series', icon: Clapperboard },
];

/** 0..1 for one row's bar (categories fetched, or rows saved). */
function rowFraction(progress: SyncTypeProgress): number {
    if (progress.stage === 'done') return 1;
    if (progress.stage === 'saving' || progress.stage === 'downloading') {
        return progress.total > 0 ? progress.processed / progress.total : 0;
    }
    return 0;
}

/**
 * Full-screen gate shown while the catalog syncs: the app only appears once
 * channels, movies and series are all in, so no screen ever renders half a list.
 */
export default function CatalogLoadingScreen() {
    const t = useT();
    const { locale } = useI18n();
    const { isSyncing, catalogChecked, syncError, syncData } = useData();
    const { syncProgress, perType } = useSyncStatus();
    const { logout } = useAuth();
    const retryRef = useRef<HTMLButtonElement>(null);
    const failed = Boolean(syncError) && !isSyncing;

    useEffect(() => {
        if (failed) retryRef.current?.focus();
    }, [failed]);

    const fmt = (value: number) => value.toLocaleString(locale);
    const statusText = (progress: SyncTypeProgress): string => {
        switch (progress.stage) {
            case 'downloading':
                return progress.total > 0
                    ? t('garratv.loadingCategories', { done: fmt(progress.processed), total: fmt(progress.total) })
                    : t('garratv.loadingDownloading');
            case 'saving':
                return t('garratv.loadingSaving', { done: fmt(progress.processed), total: fmt(progress.total) });
            case 'done':
                return t('garratv.loadingDone', { total: fmt(progress.total) });
            case 'error':
                return t('garratv.loadingFailed');
            default:
                return isSyncing ? t('garratv.loadingWaiting') : t('garratv.loadingChecking');
        }
    };

    return (
        <div className="min-h-screen bg-black text-white flex flex-col items-center justify-center px-6 py-10">
            <Wordmark size="text-[34px]" />

            <div className="mt-10 w-full max-w-[560px]">
                <p className={`${display} text-[26px] md:text-[28px] font-extrabold leading-tight text-center`}>
                    {failed ? t('garratv.loadingErrorTitle') : t('garratv.loadingTitle')}
                </p>
                <p className="mt-2 text-sm text-[#B3B3B3] text-center">
                    {failed ? syncError : catalogChecked ? t('garratv.loadingSubtitle') : t('garratv.loadingChecking')}
                </p>

                <div className="mt-8 bg-[#141414] border border-[#262626] rounded-lg overflow-hidden">
                    {ROWS.map(({ type, label, icon: Icon }, index) => {
                        const progress = perType[type];
                        const done = progress.stage === 'done';
                        const busy = progress.stage === 'downloading' || progress.stage === 'saving';
                        return (
                            <div key={type} className={`px-5 py-4 ${index ? 'border-t border-[#222222]' : ''}`}>
                                <div className="flex items-center">
                                    <span className={`w-10 h-10 flex-shrink-0 rounded-full flex items-center justify-center ${done ? 'bg-[#E50914]' : 'bg-[#1F1F1F] border border-[#333333]'}`}>
                                        <Icon size={18} />
                                    </span>
                                    <div className="flex-1 min-w-0 ml-4">
                                        <p className="text-[15px] font-bold">{t(label)}</p>
                                        <p className="mt-0.5 text-xs text-[#B3B3B3] tabular-nums truncate">{statusText(progress)}</p>
                                    </div>
                                    <span className="ml-3 w-6 flex-shrink-0 flex justify-end">
                                        {done && <Check size={20} className="text-[#E50914]" />}
                                        {busy && <Loader2 size={18} className="animate-spin text-[#B3B3B3]" />}
                                        {progress.stage === 'error' && <X size={20} className="text-[#E50914]" />}
                                    </span>
                                </div>
                                <div className="mt-3 h-1 bg-[#333333] rounded-sm overflow-hidden">
                                    {progress.stage === 'downloading' && progress.total === 0 ? (
                                        <div className="h-full w-1/3 bg-[#E50914] animate-pulse" />
                                    ) : (
                                        <div className="h-full bg-[#E50914] transition-all duration-500" style={progressWidth(rowFraction(progress))} />
                                    )}
                                </div>
                            </div>
                        );
                    })}
                </div>

                {failed ? (
                    <div className="mt-6 flex justify-center">
                        <button
                            ref={retryRef}
                            type="button"
                            data-focusable="true"
                            data-own-focus="true"
                            onClick={() => syncData()}
                            className={`${primaryButton} ${display} h-[52px] px-8 flex items-center text-[15px] font-extrabold tracking-[0.08em] uppercase`}
                        >
                            <RefreshCw size={18} className="mr-2.5" />
                            {t('garratv.loadingRetry')}
                        </button>
                        <button
                            type="button"
                            data-focusable="true"
                            data-own-focus="true"
                            onClick={() => logout('/garratv')}
                            className={`${ghostButton} h-[52px] px-6 ml-3 flex items-center text-[15px]`}
                        >
                            <LogIn size={18} className="mr-2.5" />
                            {t('garratv.loadingOtherAccount')}
                        </button>
                    </div>
                ) : (
                    <div className="mt-6">
                        <div className="flex justify-between text-xs text-[#B3B3B3] tabular-nums">
                            <span>{t('garratv.loadingOverall')}</span>
                            <span>{syncProgress}%</span>
                        </div>
                        <div className="mt-2 h-1.5 bg-[#333333] rounded-sm overflow-hidden">
                            <div className="h-full bg-white transition-all duration-500" style={progressWidth(syncProgress / 100)} />
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
}
