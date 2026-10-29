'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { CalendarDays, Clapperboard, Film, Heart, MonitorPlay, Search, Tv } from 'lucide-react';
import { useAuth } from '@/app/context/AuthContext';
import { useData } from '@/app/context/DataContext';
import { useFavorites } from '@/app/context/FavoritesContext';
import { useWatchProgress } from '@/app/context/WatchProgressContext';
import { useI18n, useT } from '@/app/context/I18nContext';
import { useIsAndroidApp } from '@/app/hooks/useIsAndroidApp';
import * as db from '@/app/lib/db';
import type { ContentType } from '@/app/lib/dbTypes';
import type { WatchProgress } from '@/app/context/WatchProgressContext';
import Shell from '@/components/garratv/Shell';
import PosterTile from '@/components/garratv/PosterTile';
import { formatEpgTime } from '@/components/garratv/epg';
import { sizedImage } from '@/components/garratv/images';
import { display, focusCard, focusShortcut, primaryButton } from '@/components/garratv/styles';

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

const ROTATE_MS = 9000;
const SPOTLIGHT_REFRESH_MS = 4 * 60 * 1000;

interface BigCardProps {
    href: string;
    title: string;
    subtitle: string;
    /** "Right now" picks; the card cycles through them. */
    spotlight: db.SpotlightItem[];
    /** Background while the picks load or when there are none. */
    fallbackImage?: string;
    tint: string;
    icon: typeof Tv;
    hero?: boolean;
    liveBadge?: string;
    className: string;
}

function BigCard({ href, title, subtitle, spotlight, fallbackImage, tint, icon: Icon, hero, liveBadge, className }: BigCardProps) {
    const t = useT();
    const { locale } = useI18n();
    const [index, setIndex] = useState(0);
    const count = spotlight.length;
    const active = count ? index % count : 0;
    const current = count ? spotlight[active] : null;

    useEffect(() => {
        if (count < 2) return undefined;
        const timer = window.setInterval(() => setIndex((value) => value + 1), ROTATE_MS);
        return () => window.clearInterval(timer);
    }, [count]);

    const showMatchup = Boolean(current && current.matchup && !current.image);
    const labels: Record<db.SpotlightItem['reason'], string> = {
        now: t('garratv.spotlightNow'),
        today: t('garratv.spotlightToday', { time: current?.startsAt ?? '' }),
        trending: t('garratv.spotlightTrending'),
        new: t('garratv.spotlightNew'),
    };
    const label = current ? labels[current.reason] : '';
    const until = current && current.reason === 'now' && current.end
        ? t('garratv.spotlightUntil', { time: formatEpgTime(current.end, locale) })
        : '';
    const tag = current?.kicker ?? '';

    return (
        <Link
            href={current && (current.reason === 'now' || current.reason === 'today') ? current.href : href}
            data-focusable="true"
            data-own-focus="true"
            data-initial-focus={hero ? 'true' : undefined}
            tabIndex={0}
            className={`${focusCard} relative block overflow-hidden rounded-xl ${className}`}
            style={{ background: `linear-gradient(135deg, ${tint} 0%, #1F1F1F 55%, #0A0A0A 100%)` }}
        >
            {!count && fallbackImage && (
                <img src={sizedImage(fallbackImage, 'backdrop')} alt="" className="absolute top-0 left-0 w-full h-full object-cover opacity-40" />
            )}
            {/* Stacked images crossfade: opacity transitions work on Chrome 53. Partial
                opacity on the current one lets the tint still color it. */}
            {spotlight.map((item, layer) => {
                // Two layers at most: the current pick and the next one, which
                // preloads invisibly so the swap is a fade, not a blank frame.
                const visible = layer === active;
                if (!visible && layer !== (active + 1) % count) return null;
                if (item.image) {
                    return (
                        <img
                            key={`${item.href}-${layer}`}
                            src={sizedImage(item.image, 'backdrop')}
                            alt=""
                            className="absolute top-0 left-0 w-full h-full object-cover transition-opacity duration-1000"
                            style={{ opacity: visible ? 0.5 : 0 }}
                        />
                    );
                }
                if (!item.poster) return null;
                // Portrait art only: a dimmed, enlarged copy as the backdrop and the
                // poster itself sharp on the right, so nothing gets cropped into mush.
                // No blur(): it repaints the whole card on every fade on old TVs.
                return (
                    <div
                        key={`${item.href}-${layer}`}
                        className="absolute top-0 right-0 bottom-0 left-0 transition-opacity duration-1000"
                        style={{ opacity: visible ? 1 : 0 }}
                    >
                        <img
                            src={sizedImage(item.poster, 'poster')}
                            alt=""
                            className="absolute top-0 left-0 w-full h-full object-cover opacity-20"
                            style={{ transform: 'scale(1.15)' }}
                        />
                        <img
                            src={sizedImage(item.poster, 'posterLarge')}
                            alt=""
                            className={`absolute right-6 rounded-md object-contain shadow-[0_18px_40px_rgba(0,0,0,0.75)] ${hero ? 'top-6 md:right-9' : 'top-5 md:right-[30px]'}`}
                            style={{ height: hero ? 'calc(100% - 72px)' : 'calc(100% - 60px)', width: 'auto' }}
                        />
                    </div>
                );
            })}
            {current && !current.image && !current.poster && current.logo && (
                <img
                    src={current.logo}
                    alt=""
                    className="absolute top-[30%] right-[6%] w-[30%] max-w-[260px] h-[40%] object-contain opacity-25"
                />
            )}
            <div
                className="absolute top-0 right-0 bottom-0 left-0"
                style={{ background: `linear-gradient(0deg, rgba(0,0,0,0.85) 0%, transparent ${hero ? '60%' : '70%'})` }}
            />
            <div
                className="absolute top-0 right-0 bottom-0 left-0"
                style={{ background: 'linear-gradient(180deg, rgba(0,0,0,0.6) 0%, transparent 45%)' }}
            />

            <div className={`absolute ${hero ? 'top-[22px] left-6 right-6 md:left-9 md:right-9' : 'top-5 left-6 right-6 md:left-[30px] md:right-[30px]'} phone:top-3.5 phone:left-4 phone:right-4`}>
                {liveBadge && (
                    <span className="inline-flex h-[26px] px-2.5 items-center rounded bg-[#E50914] text-[11px] font-extrabold tracking-[0.12em] uppercase">
                        <span className="w-[7px] h-[7px] rounded-full bg-white mr-[7px]" />
                        {liveBadge}
                    </span>
                )}
                {current && (
                    <div className={`${liveBadge ? 'mt-4 phone:mt-2' : ''} max-w-[90%]`}>
                        <p className="text-[11px] font-extrabold tracking-[0.14em] uppercase text-[#E50914]">
                            {label}
                            {tag && <span className="ml-2 text-white">· {tag}</span>}
                            {until && <span className="ml-2 text-[#B3B3B3] tracking-normal normal-case font-bold">{until}</span>}
                        </p>
                        {showMatchup && current.matchup ? (
                            <p className={`${display} mt-2 font-black uppercase leading-[1.05] ${hero ? 'text-[22px] md:text-[34px]' : 'text-lg'} phone:text-base`}>
                                <span className="block truncate">{current.matchup[0]}</span>
                                <span className="block text-[#E50914]">×</span>
                                <span className="block truncate">{current.matchup[1]}</span>
                            </p>
                        ) : (
                            <p className={`${display} mt-1.5 font-extrabold leading-tight line-clamp-2 ${hero ? 'text-xl md:text-[28px]' : 'text-base md:text-lg'} phone:text-[15px]`}>
                                {current.title}
                            </p>
                        )}
                        {current.subtitle && (
                            <p className={`mt-1 text-[#B3B3B3] truncate ${hero ? 'text-sm' : 'hidden md:block text-xs'} phone:hidden`}>{current.subtitle}</p>
                        )}
                    </div>
                )}
            </div>

            <div className={`absolute ${hero ? 'left-6 right-6 bottom-6 md:left-9 md:right-9 md:bottom-[34px]' : 'left-6 right-6 bottom-5 md:left-[30px] md:right-[30px] md:bottom-[26px]'} phone:left-4 phone:right-4 phone:bottom-3.5`}>
                {/* On short screens (540px TVs) the cards have no room for both the icon
                    and the "right now" pick above it; phones never show it. */}
                <Icon
                    className={`${hero ? 'w-14 h-14 md:w-[88px] md:h-[88px]' : 'w-[52px] h-[52px]'} ${current ? 'short:hidden' : ''} phone:hidden`}
                    strokeWidth={1.75}
                />
                <p className={`${display} font-black uppercase tracking-[0.02em] leading-none ${hero ? 'mt-[14px] text-[36px] md:text-[56px] phone:text-[26px]' : 'mt-3 text-[34px] phone:text-[22px]'} phone:mt-0`}>
                    {title}
                </p>
                <p className={`text-[#B3B3B3] ${hero ? 'mt-[14px] text-[15px]' : 'mt-3 text-sm'} phone:mt-1.5 phone:text-xs`}>{subtitle}</p>
            </div>

            {count > 1 && (
                <div className="absolute right-5 bottom-3 flex">
                    {spotlight.map((item, dot) => (
                        <span
                            key={`${item.href}-dot-${dot}`}
                            className={`h-1.5 ml-1.5 rounded-full transition-all duration-300 ${dot === active ? 'w-5 bg-white' : 'w-1.5 bg-[rgba(255,255,255,0.4)]'}`}
                        />
                    ))}
                </div>
            )}
        </Link>
    );
}

/** Ceiling on how long the dashboard waits for highlights and pictures. */
const REVEAL_TIMEOUT_MS = 3000;

/**
 * True once every URL has loaded (or failed), so the cards appear with their
 * pictures instead of popping them in one by one.
 */
function useImagesReady(urls: (string | undefined)[], enabled: boolean): boolean {
    const [readyFor, setReadyFor] = useState('');
    const key = urls.filter(Boolean).join('|');

    useEffect(() => {
        if (!enabled) return undefined;
        const list = urls.filter((url): url is string => Boolean(url));
        let pending = list.length;
        let cancelled = false;
        const finish = () => {
            if (!cancelled) setReadyFor(key);
        };
        if (pending === 0) {
            const timer = window.setTimeout(finish, 0);
            return () => {
                cancelled = true;
                window.clearTimeout(timer);
            };
        }
        const done = () => {
            pending -= 1;
            if (pending === 0) finish();
        };
        for (const url of list) {
            const image = new Image();
            image.onload = done;
            image.onerror = done;
            image.src = url;
        }
        return () => {
            cancelled = true;
        };
        // `key` stands for `urls`.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [key, enabled]);

    return enabled && readyFor === key;
}

function HomeSkeleton() {
    const block = 'bg-[#1F1F1F] rounded-xl animate-pulse';
    return (
        <main className="flex flex-col px-4 md:px-10 pt-7 pb-8 md:min-h-[calc(100vh-72px)] short:md:px-8 short:pt-5 short:pb-5 short:min-h-[calc(100vh-56px)] phone:px-4 phone:pt-3.5 phone:pb-0 phone:min-h-0" aria-hidden="true">
            <div className="md:flex-1 flex flex-col md:flex-row md:min-h-[460px] short:min-h-0 phone:flex-row phone:flex-none phone:h-[222px]">
                <div className={`h-[240px] md:h-auto md:flex-[1.25_1_0%] md:mr-5 phone:h-auto phone:flex-[1.45_1_0%] phone:mr-3 ${block}`} />
                <div className="flex flex-col md:flex-[1_1_0%] mt-5 md:mt-0 phone:flex-row phone:flex-[2_1_0%] phone:mt-0">
                    <div className={`h-[200px] md:h-auto md:flex-1 phone:h-auto phone:flex-1 ${block}`} />
                    <div className={`h-[200px] md:h-auto md:flex-1 mt-5 phone:h-auto phone:flex-1 phone:mt-0 phone:ml-3 ${block}`} />
                </div>
            </div>
            <div className="flex flex-wrap -mx-2 mt-3 phone:hidden">
                {[0, 1, 2, 3].map((key) => (
                    <div key={key} className="w-1/2 md:w-1/4 px-2 mt-2">
                        <div className="h-[84px] bg-[#1F1F1F] rounded-[10px] animate-pulse" />
                    </div>
                ))}
            </div>
        </main>
    );
}

export default function GarraTVHomePage() {
    const t = useT();
    const android = useIsAndroidApp();
    const { locale } = useI18n();
    const { isSyncing, lastSync, syncData } = useData();
    const { favorites } = useFavorites();
    const { isAuthenticated } = useAuth();
    const { progressMap } = useWatchProgress();
    const [counts, setCounts] = useState<{ live: number; movie: number; series: number } | null>(null);
    const [images, setImages] = useState<{ live?: string; movie?: string; series?: string }>({});
    const [spotlight, setSpotlight] = useState<db.Spotlight | null>(null);
    const [revealTimedOut, setRevealTimedOut] = useState(false);

    // Highlights normally answer at once (server-side stale-while-revalidate);
    // this only stops a slow provider from holding the dashboard back.
    useEffect(() => {
        const timer = window.setTimeout(() => setRevealTimedOut(true), REVEAL_TIMEOUT_MS);
        return () => window.clearTimeout(timer);
    }, []);

    // What's on now changes by the minute; the server caches, so polling is cheap.
    useEffect(() => {
        if (!isAuthenticated) return undefined;
        let cancelled = false;
        const load = () => {
            db.getSpotlight(locale).then((result) => {
                if (!cancelled && result) setSpotlight(result);
            });
        };
        load();
        const timer = window.setInterval(load, SPOTLIGHT_REFRESH_MS);
        return () => {
            cancelled = true;
            window.clearInterval(timer);
        };
    }, [locale, lastSync, isAuthenticated]);

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
                console.error('[GarraTV] Home counts failed', err);
            }
        };
        load();
        return () => {
            cancelled = true;
        };
    }, [lastSync]);

    const firstPicture = (items: db.SpotlightItem[] | undefined, fallback?: string) => {
        const item = items?.[0];
        if (item?.image) return sizedImage(item.image, 'backdrop');
        if (item?.poster) return sizedImage(item.poster, 'posterLarge');
        return sizedImage(fallback, 'backdrop');
    };
    const dataReady = counts !== null && (spotlight !== null || revealTimedOut);
    const picturesReady = useImagesReady([
        firstPicture(spotlight?.live, images.live),
        firstPicture(spotlight?.movie, images.movie),
        firstPicture(spotlight?.series, images.series),
    ], dataReady);
    const ready = dataReady && (picturesReady || revealTimedOut);

    useEffect(() => {
        if (!ready) return;
        document.querySelector<HTMLElement>('[data-initial-focus="true"]')?.focus();
    }, [ready]);

    const continueItems = Object.keys(progressMap)
        .map((key) => progressMap[key])
        .filter((item) => item && item.name)
        .sort((a, b) => b.timestamp - a.timestamp)
        .slice(0, 12);

    const fmt = (value: number | undefined) => (value === undefined ? '…' : value.toLocaleString(locale));
    const liveFavorites = favorites.filter((item) => item.type === 'live').length;
    const empty = counts !== null && counts.live + counts.movie + counts.series === 0;

    const shortcuts = [
        { href: '/garratv/live', label: t('garratv.guide'), icon: CalendarDays },
        ...(android ? [] : [{ href: '/dashboard/tv', label: t('garratv.tvMode'), icon: MonitorPlay }]),
        { href: '/dashboard/search', label: t('garratv.search'), icon: Search },
        { href: '/garratv/favorites', label: t('garratv.favorites'), icon: Heart },
    ];

    if (!ready) {
        return (
            <Shell>
                <HomeSkeleton />
            </Shell>
        );
    }

    return (
        <Shell>
            {/* Phones: with nothing to continue, the cards fill the screen; otherwise
                they shrink to leave the continue-watching row in view. */}
            <main className={`flex flex-col px-4 md:px-10 pt-7 pb-8 md:min-h-[calc(100vh-72px)] short:md:px-8 short:pt-5 short:pb-5 short:min-h-[calc(100vh-56px)] phone:px-4 phone:pt-3.5 ${continueItems.length ? 'phone:pb-0 phone:min-h-0' : 'phone:pb-3.5 phone:min-h-screen'} animate-[sfFadeIn_250ms_ease-out]`}>
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
                        spotlight={spotlight ? spotlight.live : []}
                        fallbackImage={images.live}
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
                            spotlight={spotlight ? spotlight.movie : []}
                            fallbackImage={images.movie}
                            tint={TINT.movie}
                            icon={Film}
                            className="h-[200px] md:h-auto md:flex-1 phone:h-auto phone:flex-1 phone:min-w-0"
                        />
                        <BigCard
                            href="/garratv/series"
                            title={t('garratv.series')}
                            subtitle={t('garratv.seriesSummary', { n: fmt(counts?.series) })}
                            spotlight={spotlight ? spotlight.series : []}
                            fallbackImage={images.series}
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
