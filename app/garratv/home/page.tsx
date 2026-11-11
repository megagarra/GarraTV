'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { CalendarDays, Clapperboard, Film, Heart, MonitorPlay, Search, Tv } from 'lucide-react';
import { useData } from '@/app/context/DataContext';
import { useFavorites } from '@/app/context/FavoritesContext';
import { useWatchProgress } from '@/app/context/WatchProgressContext';
import { useI18n, useT } from '@/app/context/I18nContext';
import { useIsAndroidApp } from '@/app/hooks/useIsAndroidApp';
import * as db from '@/app/lib/db';
import type { WatchProgress } from '@/app/context/WatchProgressContext';
import Shell from '@/components/garratv/Shell';
import PosterTile from '@/components/garratv/PosterTile';
import { minutesLeft, watchState } from '@/app/lib/watchState';
import { display, focusCard, focusShortcut, primaryButton } from '@/components/garratv/styles';

// oklch() tints from the design, pre-converted: Chrome 53 has no oklch().
const TINT = {
    live: '#4A0A0E',
    movie: '#1E2634',
    series: '#1B2E26',
};

function watchHref(item: WatchProgress): string {
    if (item.type === 'series' && item.seriesId) {
        const params = new URLSearchParams({ autoplay: 'true' });
        if (item.episodeId !== undefined && item.episodeId !== null) {
            params.set('episode', String(item.episodeId));
        }
        return `/dashboard/watch/series/${item.seriesId}?${params.toString()}`;
    }
    return `/dashboard/watch/movie/${item.streamId}?autoplay=true`;
}

interface BigCardProps {
    href: string;
    title: string;
    subtitle: string;
    tint: string;
    icon: typeof Tv;
    hero?: boolean;
    liveBadge?: string;
    className: string;
}

/** Static generic cover: a per-section gradient with a large icon as the artwork. No network. */
function BigCard({ href, title, subtitle, tint, icon: Icon, hero, liveBadge, className }: BigCardProps) {
    return (
        <Link
            href={href}
            data-focusable="true"
            data-own-focus="true"
            data-initial-focus={hero ? 'true' : undefined}
            tabIndex={0}
            className={`${focusCard} relative block overflow-hidden rounded-xl ${className}`}
            style={{ background: `linear-gradient(135deg, ${tint} 0%, #1F1F1F 55%, #0A0A0A 100%)` }}
        >
            {/* Soft red glow behind the artwork. */}
            <div
                className="absolute top-0 right-0 bottom-0 left-0"
                style={{ background: 'radial-gradient(circle at 78% 38%, rgba(229,9,20,0.22) 0%, transparent 55%)' }}
            />
            <Icon
                className={`absolute text-white opacity-[0.14] ${hero ? 'right-8 top-8 w-[180px] h-[180px] md:w-[260px] md:h-[260px]' : 'right-5 top-5 w-[120px] h-[120px] md:w-[150px] md:h-[150px]'} phone:right-3 phone:top-3 phone:w-[72px] phone:h-[72px]`}
                strokeWidth={1.25}
            />
            <div
                className="absolute top-0 right-0 bottom-0 left-0"
                style={{ background: `linear-gradient(0deg, rgba(0,0,0,0.85) 0%, transparent ${hero ? '60%' : '70%'})` }}
            />

            {liveBadge && (
                <div className={`absolute ${hero ? 'top-[22px] left-6 md:left-9' : 'top-5 left-6 md:left-[30px]'} phone:top-3.5 phone:left-4`}>
                    <span className="inline-flex h-[26px] px-2.5 items-center rounded bg-[#E50914] text-[11px] font-extrabold tracking-[0.12em] uppercase">
                        <span className="w-[7px] h-[7px] rounded-full bg-white mr-[7px]" />
                        {liveBadge}
                    </span>
                </div>
            )}

            <div className={`absolute ${hero ? 'left-6 right-6 bottom-6 md:left-9 md:right-9 md:bottom-[34px]' : 'left-6 right-6 bottom-5 md:left-[30px] md:right-[30px] md:bottom-[26px]'} phone:left-4 phone:right-4 phone:bottom-3.5`}>
                <Icon
                    className={`${hero ? 'w-14 h-14 md:w-[88px] md:h-[88px]' : 'w-[52px] h-[52px]'} short:hidden phone:hidden`}
                    strokeWidth={1.75}
                />
                <p className={`${display} font-black uppercase tracking-[0.02em] leading-none ${hero ? 'mt-[14px] text-[36px] md:text-[56px] phone:text-[26px]' : 'mt-3 text-[34px] phone:text-[22px]'} short:mt-0 phone:mt-0`}>
                    {title}
                </p>
                <p className={`text-[#B3B3B3] ${hero ? 'mt-[14px] text-[15px]' : 'mt-3 text-sm'} phone:mt-1.5 phone:text-xs`}>{subtitle}</p>
            </div>
        </Link>
    );
}

export default function GarraTVHomePage() {
    const t = useT();
    const android = useIsAndroidApp();
    const { locale } = useI18n();
    const { isSyncing, lastSync, syncData } = useData();
    const { favorites, isFavorite } = useFavorites();
    const { progressMap } = useWatchProgress();
    const [counts, setCounts] = useState<{ live: number; movie: number; series: number } | null>(null);
    useEffect(() => {
        let cancelled = false;
        const load = async () => {
            try {
                const [live, movie, series] = await Promise.all([
                    db.getStreamCount('live'),
                    db.getStreamCount('movie'),
                    db.getStreamCount('series'),
                ]);
                if (cancelled) return;
                setCounts({ live, movie, series });
            } catch (err) {
                console.error('[GarraTV] Home counts failed', err);
            }
        };
        load();
        return () => {
            cancelled = true;
        };
    }, [lastSync]);

    // The cards are static, so focus can land as soon as the page mounts.
    useEffect(() => {
        document.querySelector<HTMLElement>('[data-initial-focus="true"]')?.focus();
    }, []);

    const continueItems = Object.keys(progressMap)
        .map((key) => progressMap[key])
        .filter((item) => item && item.name)
        .sort((a, b) => b.timestamp - a.timestamp)
        .slice(0, 12);

    // "S2:E3 · 12 min left": where the title stopped, at a glance.
    const continueCaption = (item: (typeof continueItems)[number]) => {
        const state = watchState(item);
        const episode = item.type === 'series' && item.seasonNum && item.episodeNum
            ? t('garratv.episodeShort', { season: item.seasonNum, episode: item.episodeNum })
            : '';
        const left = state.remaining > 0 ? t('garratv.minutesLeft', { n: minutesLeft(state) }) : '';
        return [episode, left].filter(Boolean).join(' · ') || undefined;
    };

    const fmt = (value: number | undefined) => (value === undefined ? '…' : value.toLocaleString(locale));
    const liveFavorites = favorites.filter((item) => item.type === 'live').length;
    const empty = counts !== null && counts.live + counts.movie + counts.series === 0;

    const shortcuts = [
        { href: '/garratv/live', label: t('garratv.guide'), icon: CalendarDays },
        ...(android ? [] : [{ href: '/dashboard/tv', label: t('garratv.tvMode'), icon: MonitorPlay }]),
        { href: '/dashboard/search', label: t('garratv.search'), icon: Search },
        { href: '/garratv/favorites', label: t('garratv.favorites'), icon: Heart },
    ];

    return (
        <Shell>
            {/* Phones: with nothing to continue, the cards fill the screen; otherwise
                they shrink to leave the continue-watching row in view. */}
            <main className={`flex flex-col px-4 md:px-10 pt-7 pb-8 md:min-h-[calc(100vh-72px)] short:md:px-8 short:pt-5 short:pb-5 short:min-h-[calc(100vh-56px)] phone:px-4 phone:pt-3.5 ${continueItems.length ? 'phone:pb-0 phone:min-h-0' : 'phone:pb-3.5 phone:min-h-screen'}`}>
                {empty && !isSyncing && (
                    <div className="mb-5 flex flex-wrap items-center justify-between bg-[#1F1F1F] border border-[#2A2A2A] rounded-lg px-5 py-4">
                        <p className="text-sm text-[#B3B3B3] mr-4">
                            {t('garratv.syncHint')}
                        </p>
                        {!isSyncing && (
                            <button
                                type="button"
                                data-focusable="true"
                                data-own-focus="true"
                                onClick={() => syncData()}
                                className={`${primaryButton} h-10 px-5 text-sm font-extrabold`}
                            >
                                {t('garratv.refresh')}
                            </button>
                        )}
                    </div>
                )}

                <div className={`md:flex-1 flex flex-col md:flex-row md:min-h-[460px] short:min-h-0 phone:flex-row ${continueItems.length ? 'phone:flex-none phone:h-[222px]' : 'phone:flex-1'}`}>
                    <BigCard
                        href="/garratv/live"
                        title={t('garratv.liveTv')}
                        subtitle={t('garratv.liveSummary', { channels: fmt(counts?.live), favorites: fmt(liveFavorites) })}
                        tint={TINT.live}
                        icon={Tv}
                        hero
                        liveBadge={t('garratv.liveBadge')}
                        className="h-[240px] md:h-auto md:flex-[1.25_1_0%] md:mr-5 short:md:mr-4 phone:h-auto phone:flex-[1.45_1_0%] phone:mr-3"
                    />
                    <div className="flex flex-col md:flex-[1_1_0%] mt-5 md:mt-0 phone:flex-row phone:flex-[2_1_0%] phone:mt-0">
                        <BigCard
                            href="/garratv/movies"
                            title={t('garratv.movies')}
                            subtitle={t('garratv.moviesSummary', { n: fmt(counts?.movie) })}
                            tint={TINT.movie}
                            icon={Film}
                            className="h-[200px] md:h-auto md:flex-1 phone:h-auto phone:flex-1 phone:min-w-0"
                        />
                        <BigCard
                            href="/garratv/series"
                            title={t('garratv.series')}
                            subtitle={t('garratv.seriesSummary', { n: fmt(counts?.series) })}
                            tint={TINT.series}
                            icon={Clapperboard}
                            className="h-[200px] md:h-auto md:flex-1 mt-5 short:md:mt-4 phone:h-auto phone:flex-1 phone:min-w-0 phone:mt-0 phone:ml-3"
                        />
                    </div>
                </div>

                <div className="flex flex-wrap -mx-2 mt-3 short:mt-2 phone:hidden">
                    {/* Three shortcuts in the Android app (no Modo TV): they share the row evenly. */}
                    {shortcuts.map(({ href, label, icon: Icon }) => (
                        <div key={href} className={`w-1/2 ${shortcuts.length === 3 ? 'md:w-1/3' : 'md:w-1/4'} px-2 mt-2`}>
                            <Link
                                href={href}
                                data-focusable="true"
                                data-own-focus="true"
                                tabIndex={0}
                                className={`${focusShortcut} h-[84px] short:h-14 flex items-center justify-center text-base font-bold`}
                            >
                                <Icon size={26} className="mr-[14px] flex-shrink-0" />
                                <span className="truncate">{label}</span>
                            </Link>
                        </div>
                    ))}
                </div>
            </main>

            {continueItems.length > 0 && (
                <section className="px-4 md:px-10 pb-12 short:md:px-8 phone:px-4 phone:pt-3.5 phone:pb-4">
                    <h2 className={`${display} text-[22px] font-extrabold mb-5 phone:text-[15px] phone:mb-2`}>{t('garratv.continueWatching')}</h2>
                    <div className="flex flex-wrap -mx-2.5 phone:-mx-1.5">
                        {continueItems.map((item) => (
                            <div key={`${item.type}-${item.streamId}`} className="w-1/3 sm:w-1/4 lg:w-1/6 px-2.5 pb-7 phone:w-[14.285%] phone:px-1.5 phone:pb-3">
                                <PosterTile
                                    href={watchHref(item)}
                                    title={item.name}
                                    image={item.image}
                                    progress={item.duration > 0 ? item.progress / item.duration : undefined}
                                    caption={continueCaption(item)}
                                    favorite={isFavorite(item.type === 'series' && item.seriesId ? item.seriesId : item.streamId, item.type)}
                                    favoriteLabel={t('garratv.inFavorites')}
                                    favoriteType={item.type === 'series' ? 'series' : 'movie'}
                                    favoriteId={item.type === 'series' && item.seriesId ? item.seriesId : item.streamId}
                                />
                            </div>
                        ))}
                    </div>
                </section>
            )}
        </Shell>
    );
}
