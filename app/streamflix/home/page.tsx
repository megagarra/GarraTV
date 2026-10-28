'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { CalendarDays, Clapperboard, Film, Heart, MonitorPlay, Search, Tv } from 'lucide-react';
import { useData } from '@/app/context/DataContext';
import { useFavorites } from '@/app/context/FavoritesContext';
import { useWatchProgress } from '@/app/context/WatchProgressContext';
import { useI18n, useT } from '@/app/context/I18nContext';
import * as db from '@/app/lib/db';
import type { ContentType } from '@/app/lib/dbTypes';
import type { WatchProgress } from '@/app/context/WatchProgressContext';
import Shell from '@/components/streamflix/Shell';
import PosterTile from '@/components/streamflix/PosterTile';
import { display, focusCard, focusShortcut, primaryButton } from '@/components/streamflix/styles';

// oklch() tints from the design, pre-converted: Chrome 53 has no oklch().
const TINT = {
    live: '#4A0A0E',
    movie: '#1E2634',
    series: '#1B2E26',
};

/** Wide stills first (backdrops), then posters, best rated first. */
async function backdrops(type: ContentType): Promise<string[]> {
    const streams = await db.listStreams(type, undefined, 12, 0, 'rating');
    const wide: string[] = [];
    const posters: string[] = [];
    for (const stream of streams) {
        const backdrop = stream.backdrop_path?.find((url) => url.indexOf('http') === 0);
        if (backdrop) wide.push(backdrop);
        const poster = stream.cover || stream.icon;
        if (poster) posters.push(poster);
    }
    return wide.concat(posters);
}

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
    image?: string;
    tint: string;
    icon: typeof Tv;
    hero?: boolean;
    liveBadge?: string;
    className: string;
}

function BigCard({ href, title, subtitle, image, tint, icon: Icon, hero, liveBadge, className }: BigCardProps) {
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
            {image && (
                // Partial opacity lets the tinted gradient behind it color the still.
                <img src={image} alt="" className="absolute top-0 left-0 w-full h-full object-cover opacity-40" />
            )}
            <div
                className="absolute top-0 right-0 bottom-0 left-0"
                style={{ background: `linear-gradient(0deg, rgba(0,0,0,0.85) 0%, transparent ${hero ? '60%' : '70%'})` }}
            />
            {liveBadge && (
                <span className="absolute top-[22px] left-6 h-[26px] px-2.5 flex items-center rounded bg-[#E50914] text-[11px] font-extrabold tracking-[0.12em] uppercase">
                    <span className="w-[7px] h-[7px] rounded-full bg-white mr-[7px]" />
                    {liveBadge}
                </span>
            )}
            <div className={`absolute ${hero ? 'left-6 right-6 bottom-6 md:left-9 md:right-9 md:bottom-[34px]' : 'left-6 right-6 bottom-5 md:left-[30px] md:right-[30px] md:bottom-[26px]'}`}>
                <Icon className={hero ? 'w-14 h-14 md:w-[88px] md:h-[88px]' : 'w-[52px] h-[52px]'} strokeWidth={1.75} />
                <p className={`${display} font-black uppercase tracking-[0.02em] leading-none ${hero ? 'mt-[14px] text-[36px] md:text-[56px]' : 'mt-3 text-[34px]'}`}>
                    {title}
                </p>
                <p className={`text-[#B3B3B3] ${hero ? 'mt-[14px] text-[15px]' : 'mt-3 text-sm'}`}>{subtitle}</p>
            </div>
        </Link>
    );
}

export default function StreamflixHomePage() {
    const t = useT();
    const { locale } = useI18n();
    const { isSyncing, syncProgress, lastSync, syncData } = useData();
    const { favorites } = useFavorites();
    const { progressMap } = useWatchProgress();
    const [counts, setCounts] = useState<{ live: number; movie: number; series: number } | null>(null);
    const [images, setImages] = useState<{ live?: string; movie?: string; series?: string }>({});

    useEffect(() => {
        let cancelled = false;
        const load = async () => {
            try {
                const [live, movie, series, movieImages, seriesImages] = await Promise.all([
                    db.getStreamCount('live'),
                    db.getStreamCount('movie'),
                    db.getStreamCount('series'),
                    backdrops('movie'),
                    backdrops('series'),
                ]);
                if (cancelled) return;
                setCounts({ live, movie, series });
                // Channel logos make poor backdrops; the live card borrows another film still.
                setImages({ live: movieImages[1] ?? movieImages[0], movie: movieImages[0], series: seriesImages[0] });
            } catch (err) {
                console.error('[StreamFlix] Home counts failed', err);
            }
        };
        load();
        return () => {
            cancelled = true;
        };
    }, [lastSync]);

    useEffect(() => {
        document.querySelector<HTMLElement>('[data-initial-focus="true"]')?.focus();
    }, []);

    const continueItems = Object.keys(progressMap)
        .map((key) => progressMap[key])
        .filter((item) => item && item.name)
        .sort((a, b) => b.timestamp - a.timestamp)
        .slice(0, 12);

    const fmt = (value: number | undefined) => (value === undefined ? '…' : value.toLocaleString(locale));
    const liveFavorites = favorites.filter((item) => item.type === 'live').length;
    const empty = counts !== null && counts.live + counts.movie + counts.series === 0;

    const shortcuts = [
        { href: '/streamflix/live', label: t('streamflix.guide'), icon: CalendarDays },
        { href: '/dashboard/tv', label: t('streamflix.tvMode'), icon: MonitorPlay },
        { href: '/dashboard/search', label: t('streamflix.search'), icon: Search },
        { href: '/streamflix/favorites', label: t('streamflix.favorites'), icon: Heart },
    ];

    return (
        <Shell>
            <main className="flex flex-col px-4 md:px-10 pt-7 pb-8 md:min-h-[calc(100vh-72px)]">
                {(isSyncing || (empty && !isSyncing)) && (
                    <div className="mb-5 flex flex-wrap items-center justify-between bg-[#1F1F1F] border border-[#2A2A2A] rounded-lg px-5 py-4">
                        <p className="text-sm text-[#B3B3B3] mr-4">
                            {isSyncing ? t('streamflix.syncing', { n: syncProgress }) : t('streamflix.syncHint')}
                        </p>
                        {!isSyncing && (
                            <button
                                type="button"
                                data-focusable="true"
                                data-own-focus="true"
                                onClick={() => syncData()}
                                className={`${primaryButton} h-10 px-5 text-sm font-extrabold`}
                            >
                                {t('streamflix.refresh')}
                            </button>
                        )}
                    </div>
                )}

                <div className="md:flex-1 flex flex-col md:flex-row md:min-h-[460px]">
                    <BigCard
                        href="/streamflix/live"
                        title={t('streamflix.liveTv')}
                        subtitle={t('streamflix.liveSummary', { channels: fmt(counts?.live), favorites: fmt(liveFavorites) })}
                        image={images.live}
                        tint={TINT.live}
                        icon={Tv}
                        hero
                        liveBadge={t('streamflix.liveBadge')}
                        className="h-[240px] md:h-auto md:flex-[1.25_1_0%] md:mr-5"
                    />
                    <div className="flex flex-col md:flex-[1_1_0%] mt-5 md:mt-0">
                        <BigCard
                            href="/streamflix/movies"
                            title={t('streamflix.movies')}
                            subtitle={t('streamflix.moviesSummary', { n: fmt(counts?.movie) })}
                            image={images.movie}
                            tint={TINT.movie}
                            icon={Film}
                            className="h-[200px] md:h-auto md:flex-1"
                        />
                        <BigCard
                            href="/streamflix/series"
                            title={t('streamflix.series')}
                            subtitle={t('streamflix.seriesSummary', { n: fmt(counts?.series) })}
                            image={images.series}
                            tint={TINT.series}
                            icon={Clapperboard}
                            className="h-[200px] md:h-auto md:flex-1 mt-5"
                        />
                    </div>
                </div>

                <div className="flex flex-wrap -mx-2 mt-3">
                    {shortcuts.map(({ href, label, icon: Icon }) => (
                        <div key={href} className="w-1/2 md:w-1/4 px-2 mt-2">
                            <Link
                                href={href}
                                data-focusable="true"
                                data-own-focus="true"
                                tabIndex={0}
                                className={`${focusShortcut} h-[84px] flex items-center justify-center text-base font-bold`}
                            >
                                <Icon size={26} className="mr-[14px] flex-shrink-0" />
                                <span className="truncate">{label}</span>
                            </Link>
                        </div>
                    ))}
                </div>
            </main>

            {continueItems.length > 0 && (
                <section className="px-4 md:px-10 pb-12">
                    <h2 className={`${display} text-[22px] font-extrabold mb-5`}>{t('streamflix.continueWatching')}</h2>
                    <div className="flex flex-wrap -mx-2.5">
                        {continueItems.map((item) => (
                            <div key={`${item.type}-${item.streamId}`} className="w-1/3 sm:w-1/4 lg:w-1/6 px-2.5 pb-7">
                                <PosterTile
                                    href={watchHref(item)}
                                    title={item.name}
                                    image={item.image}
                                    progress={item.duration > 0 ? item.progress / item.duration : undefined}
                                />
                            </div>
                        ))}
                    </div>
                </section>
            )}
        </Shell>
    );
}
