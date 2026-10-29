'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { ChevronDown, Heart, Play, Star, Video } from 'lucide-react';
import { useAuth } from '@/app/context/AuthContext';
import { useData } from '@/app/context/DataContext';
import { useFavorites } from '@/app/context/FavoritesContext';
import { useWatchProgress } from '@/app/context/WatchProgressContext';
import { useT } from '@/app/context/I18nContext';
import { apiFetch } from '@/app/lib/apiClient';
import * as db from '@/app/lib/db';
import type { CachedStream } from '@/app/lib/dbTypes';
import { formatRating } from '@/app/lib/formatRating';
import Shell from '@/components/garratv/Shell';
import { display, ghostButton, placeholderGradient, primaryButton, progressWidth } from '@/components/garratv/styles';

interface VodInfo {
    name?: string;
    movie_image?: string;
    cover?: string;
    plot?: string;
    cast?: string;
    director?: string;
    genre?: string;
    releasedate?: string;
    releaseDate?: string;
    rating?: string;
    duration?: string;
    duration_secs?: number | string;
    age?: string;
    mpaa_rating?: string;
    backdrop_path?: string[];
    youtube_trailer?: string;
}

interface VodPayload {
    info?: VodInfo;
    movie_data?: { name?: string };
}

interface Episode {
    id: string;
    episode_num?: string | number;
    title?: string;
    info?: { movie_image?: string; plot?: string; duration?: string; duration_secs?: number | string };
}

interface SeriesPayload {
    info?: VodInfo;
    episodes?: Record<string, Episode[]>;
}

/** Full details already fetched this session, so going back to a title is instant. */
const detailMemo = new Map<string, VodPayload | SeriesPayload>();

/** What the catalog row alone can show before the provider's detail arrives. */
function infoFromStream(row: CachedStream): VodInfo {
    const image = row.cover || row.icon;
    return {
        name: row.name,
        movie_image: image,
        cover: image,
        plot: row.plot,
        cast: row.cast,
        director: row.director,
        genre: row.genre,
        releasedate: row.release_date,
        rating: row.rating,
        backdrop_path: row.backdrop_path,
    };
}

function httpUrl(value: string | undefined): string | undefined {
    if (!value) return undefined;
    if (value.indexOf('http://') === 0 || value.indexOf('https://') === 0) return value;
    return undefined;
}

function yearFrom(value: string | undefined): string {
    return value?.match(/\b(19|20)\d{2}\b/)?.[0] ?? '';
}

function trailerHref(value: string): string {
    if (value.indexOf('http://') === 0 || value.indexOf('https://') === 0) return value;
    return `https://www.youtube.com/watch?v=${encodeURIComponent(value)}`;
}

/** "2h 17min" from the provider's "02:17:00" or a seconds count. */
function formatRuntime(duration: string | undefined, seconds: number | string | undefined): string {
    let total = Number(seconds);
    if (!Number.isFinite(total) || total <= 0) {
        const parts = (duration ?? '').split(':').map((part) => Number(part));
        if (parts.length === 3 && parts.every((part) => Number.isFinite(part))) {
            total = parts[0] * 3600 + parts[1] * 60 + parts[2];
        } else {
            return duration?.trim() ?? '';
        }
    }
    const minutes = Math.round(total / 60);
    if (minutes <= 0) return '';
    const hours = Math.floor(minutes / 60);
    if (!hours) return `${minutes} min`;
    const rest = minutes % 60;
    return rest ? `${hours}h ${rest}min` : `${hours}h`;
}

function episodeHref(seriesId: string, episodeId: string): string {
    return `/dashboard/watch/series/${seriesId}?episode=${encodeURIComponent(episodeId)}&autoplay=true`;
}

export default function GarraTVTitlePage() {
    const t = useT();
    const params = useParams<{ kind: string; id: string }>();
    const kind = params.kind === 'series' ? 'series' : params.kind === 'movie' ? 'movie' : null;
    const id = params.id;
    const { isAuthenticated } = useAuth();
    const { getCachedDetail, saveCachedDetail } = useData();
    const { isFavorite, addFavorite, removeFavorite } = useFavorites();
    const { getProgress, loadDetail } = useWatchProgress();
    const [info, setInfo] = useState<VodInfo | null>(null);
    const [episodes, setEpisodes] = useState<Record<string, Episode[]>>({});
    const [season, setSeason] = useState('');
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState('');
    const [posterFailed, setPosterFailed] = useState(false);

    useEffect(() => {
        if (kind && id) loadDetail(kind, id);
    }, [kind, id, loadDetail]);

    useEffect(() => {
        if (!kind || !id || !isAuthenticated) return undefined;
        let cancelled = false;

        const memoKey = `${kind}:${id}`;
        let full = false;
        let provisional = false;

        const apply = (payload: VodPayload | SeriesPayload) => {
            setInfo(payload.info ?? null);
            if (kind === 'series') {
                const seriesEpisodes = (payload as SeriesPayload).episodes ?? {};
                setEpisodes(seriesEpisodes);
                const seasons = Object.keys(seriesEpisodes).sort((a, b) => Number(a) - Number(b));
                setSeason(seasons[0] ?? '');
            }
        };

        const load = async () => {
            setError('');
            const remembered = detailMemo.get(memoKey);
            if (remembered) {
                // Opened before in this session: no request, no loading state.
                apply(remembered);
                setLoading(false);
                return;
            }
            setLoading(true);

            // The catalog row already has title, poster, rating and (for series)
            // the synopsis: show it while the full detail is fetched.
            db.getStreamsByIds([id], kind)
                .then(([row]) => {
                    if (cancelled || full || !row) return;
                    provisional = true;
                    setInfo(infoFromStream(row));
                    setLoading(false);
                })
                .catch(() => undefined);

            try {
                const cached = await getCachedDetail<VodPayload | SeriesPayload>(kind, id);
                const cachedOk = cached && cached.info && (kind === 'movie' || (cached as SeriesPayload).episodes);
                let payload = cachedOk ? cached : null;

                if (!payload) {
                    const response = await apiFetch('/api/proxy', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({
                            action: kind === 'movie' ? 'get_vod_info' : 'get_series_info',
                            ...(kind === 'movie' ? { vod_id: id } : { series_id: id }),
                        }),
                    });
                    const data = await response.json() as VodPayload | SeriesPayload;
                    if (data?.info) {
                        payload = data;
                        // Nothing on screen depends on the write; don't wait for it.
                        saveCachedDetail(kind, id, data).catch(() => undefined);
                    }
                }

                if (cancelled) return;
                if (!payload?.info) {
                    // The catalog row stays up when the provider has no detail for it.
                    if (!provisional) {
                        setError(t('garratv.empty'));
                        setInfo(null);
                    }
                    return;
                }

                full = true;
                detailMemo.set(memoKey, payload);
                if (detailMemo.size > 100) {
                    const oldest = detailMemo.keys().next().value;
                    if (oldest !== undefined) detailMemo.delete(oldest);
                }
                apply(payload);
            } catch (err) {
                console.error('[GarraTV] Title details failed', err);
                if (!cancelled && !provisional) setError(t('catalog.loadItemsError'));
            } finally {
                if (!cancelled) setLoading(false);
            }
        };

        load();
        return () => {
            cancelled = true;
        };
    }, [kind, id, isAuthenticated, getCachedDetail, saveCachedDetail, t]);

    const seasons = useMemo(
        () => Object.keys(episodes).sort((a, b) => Number(a) - Number(b)),
        [episodes],
    );

    useEffect(() => {
        if (loading) return;
        document.querySelector<HTMLElement>('[data-initial-focus="true"]')?.focus();
    }, [loading]);

    const backHref = kind === 'series' ? '/garratv/series' : '/garratv/movies';
    const sectionName = t(kind === 'series' ? 'garratv.series' : 'garratv.movies');

    if (!kind) {
        return (
            <Shell title={sectionName} backHref="/garratv/home">
                <p className="px-10 py-16 text-center text-sm text-[#B3B3B3]">{t('garratv.empty')}</p>
            </Shell>
        );
    }

    const seasonEpisodes = season ? (episodes[season] ?? []) : [];
    const saved = isFavorite(id, kind);
    const title = info?.name || '';
    const poster = httpUrl(info?.movie_image) || httpUrl(info?.cover);
    const backdrop = httpUrl(info?.backdrop_path?.[0]) || poster;
    const year = yearFrom(info?.releasedate || info?.releaseDate);
    const rating = formatRating(info?.rating);
    const trailer = info?.youtube_trailer?.trim();
    const age = (info?.age || info?.mpaa_rating || '').trim();
    const runtime = kind === 'movie'
        ? formatRuntime(info?.duration, info?.duration_secs)
        : seasons.length ? t(seasons.length === 1 ? 'garratv.seasonCountOne' : 'garratv.seasonCount', { n: seasons.length }) : '';
    const firstEpisode = seasonEpisodes[0];
    const watchHref = kind === 'movie'
        ? `/dashboard/watch/movie/${id}?autoplay=true`
        : firstEpisode ? episodeHref(id, String(firstEpisode.id)) : '';

    const toggleFavorite = () => {
        if (!title) return;
        if (saved) removeFavorite(id, kind);
        else addFavorite({ id, type: kind, name: title, image: poster, rating: info?.rating });
    };

    return (
        <Shell title={sectionName} backHref={backHref}>
            {loading ? (
                <p className="px-10 py-16 text-center text-sm text-[#B3B3B3]">{t('garratv.loading')}</p>
            ) : error ? (
                <p className="px-10 py-16 text-center text-sm text-[#E50914]">{error}</p>
            ) : (
                <>
                    <section className="relative md:min-h-[600px] short:min-h-0 flex items-end overflow-hidden">
                        <div className="absolute top-0 right-0 bottom-0 left-0" style={{ background: placeholderGradient(title) }}>
                            {backdrop && <img src={backdrop} alt="" className="w-full h-full object-cover" />}
                        </div>
                        <div
                            className="absolute top-0 right-0 bottom-0 left-0"
                            style={{ background: 'linear-gradient(90deg, #000 0%, rgba(0,0,0,0.92) 30%, rgba(0,0,0,0.55) 62%, rgba(0,0,0,0.1) 100%)' }}
                        />
                        <div
                            className="absolute top-0 right-0 bottom-0 left-0"
                            style={{ background: 'linear-gradient(0deg, #141414 0%, transparent 35%)' }}
                        />

                        <div className="relative w-full flex flex-wrap items-end px-4 pt-10 pb-8 md:px-14 md:pt-[120px] md:pb-14 short:md:px-10 short:md:pt-10 short:md:pb-8 phone:px-5 phone:pt-5 phone:pb-3 phone:flex-nowrap">
                            <div className="w-[140px] md:w-[250px] short:md:w-[180px] phone:w-[120px] flex-shrink-0 mr-6 md:mr-10 phone:mr-5 mb-6 phone:mb-3 rounded-lg overflow-hidden border border-[rgba(255,255,255,0.08)] shadow-[0_30px_60px_rgba(0,0,0,0.7)]" style={{ background: placeholderGradient(title) }}>
                                <div className="ratio ratio-poster">
                                    {poster && !posterFailed && (
                                        <img src={poster} alt={title} className="ratio-fill object-cover" onError={() => setPosterFailed(true)} />
                                    )}
                                </div>
                            </div>

                            <div className="flex-1 min-w-[260px] max-w-[720px] mb-6 phone:mb-3 phone:min-w-0">
                                <p className="text-xs font-extrabold tracking-[0.2em] uppercase text-[#E50914]">
                                    {t(kind === 'movie' ? 'garratv.kindMovie' : 'garratv.kindSeries')}
                                </p>
                                <h1 className={`${display} mt-[18px] text-[36px] md:text-[60px] short:md:text-[44px] phone:mt-2 phone:text-[28px] font-black leading-none tracking-[-0.01em]`}>{title}</h1>
                                <div className="mt-[18px] flex flex-wrap items-center text-[15px] text-[#B3B3B3]">
                                    {rating && (
                                        <span className="mr-[18px] mb-2 flex items-center font-extrabold text-white">
                                            <Star size={16} className="text-[#F5C451] mr-1.5" fill="currentColor" strokeWidth={0} />
                                            {rating}
                                        </span>
                                    )}
                                    {year && <span className="mr-[18px] mb-2">{year}</span>}
                                    {runtime && <span className="mr-[18px] mb-2">{runtime}</span>}
                                    {age && (
                                        <span className="mr-[18px] mb-2 px-2 py-0.5 border border-[#555555] rounded text-xs font-bold text-white">{age}</span>
                                    )}
                                    {info?.genre && <span className="mb-2">{info.genre}</span>}
                                </div>
                                {info?.plot && <p className="mt-2.5 text-base leading-relaxed text-white">{info.plot}</p>}
                                {(info?.cast || info?.director) && (
                                    <div className="mt-[18px] text-sm text-[#B3B3B3] space-y-1">
                                        {info?.cast && (
                                            <p><span className="text-[#8C8C8C]">{t('garratv.cast')}: </span>{info.cast}</p>
                                        )}
                                        {info?.director && (
                                            <p><span className="text-[#8C8C8C]">{t('garratv.director')}: </span>{info.director}</p>
                                        )}
                                    </div>
                                )}

                                <div className="mt-6 flex flex-wrap">
                                    {watchHref && (
                                        <Link
                                            href={watchHref}
                                            data-focusable="true"
                                            data-own-focus="true"
                                            data-initial-focus="true"
                                            className={`${primaryButton} ${display} h-[52px] px-[30px] mr-3 mb-3 flex items-center text-[15px] font-extrabold tracking-[0.08em] uppercase hover:scale-[1.03] focus:scale-[1.03]`}
                                        >
                                            <Play size={20} className="mr-2.5" fill="currentColor" />
                                            {t('garratv.watch')}
                                        </Link>
                                    )}
                                    {trailer && (
                                        <a
                                            href={trailerHref(trailer)}
                                            target="_blank"
                                            rel="noreferrer"
                                            data-focusable="true"
                                            data-own-focus="true"
                                            className={`${ghostButton} h-[52px] px-6 mr-3 mb-3 flex items-center text-[15px] hover:scale-[1.03] focus:scale-[1.03]`}
                                        >
                                            <Video size={20} className="mr-2.5" />
                                            {t('garratv.trailer')}
                                        </a>
                                    )}
                                    <button
                                        type="button"
                                        data-focusable="true"
                                        data-own-focus="true"
                                        onClick={toggleFavorite}
                                        className={`${ghostButton} h-[52px] px-6 mb-3 flex items-center text-[15px] hover:scale-[1.03] focus:scale-[1.03]`}
                                    >
                                        <Heart size={20} className={`mr-2.5 ${saved ? 'text-[#E50914]' : ''}`} fill={saved ? 'currentColor' : 'none'} />
                                        {saved ? t('garratv.favorited') : t('garratv.favorite')}
                                    </button>
                                </div>
                            </div>
                        </div>
                    </section>

                    {kind === 'series' && seasons.length > 0 && (
                        <section className="max-w-[1280px] px-4 pt-2 pb-16 md:px-14">
                            <div className="flex flex-wrap items-center justify-between mb-5">
                                <h2 className={`${display} text-[26px] font-extrabold mr-4`}>{t('garratv.episodes')}</h2>
                                <div className="relative">
                                    <select
                                        value={season}
                                        onChange={(event) => setSeason(event.target.value)}
                                        data-focusable="true"
                                        data-own-focus="true"
                                        aria-label={t('garratv.seasonLabel', { n: season })}
                                        className="h-11 pl-4 pr-11 bg-[#2A2A2A] border border-[#333333] rounded-md text-[15px] font-bold text-white appearance-none cursor-pointer outline-none transition-colors duration-200 focus:border-[#E50914]"
                                    >
                                        {seasons.map((value) => (
                                            <option key={value} value={value} className="bg-[#1F1F1F]">{t('garratv.seasonLabel', { n: value })}</option>
                                        ))}
                                    </select>
                                    <ChevronDown size={18} className="absolute right-[14px] top-[13px] pointer-events-none" />
                                </div>
                            </div>

                            {seasonEpisodes.map((episode, index) => {
                                const episodeTitle = episode.title || t('garratv.episodeLabel', { n: episode.episode_num ?? index + 1 });
                                const image = httpUrl(episode.info?.movie_image);
                                const watched = getProgress(episode.id);
                                const ratio = watched && watched.duration > 0 ? watched.progress / watched.duration : 0;
                                const duration = formatRuntime(episode.info?.duration, episode.info?.duration_secs);
                                return (
                                    <Link
                                        key={episode.id}
                                        href={episodeHref(id, String(episode.id))}
                                        data-focusable="true"
                                        data-own-focus="true"
                                        className="flex items-center px-4 py-[18px] rounded-lg border-b border-[#222222] outline-none transition-colors duration-200 hover:bg-[#1F1F1F] focus:bg-[#1F1F1F] focus:shadow-[inset_0_0_0_2px_#E50914]"
                                    >
                                        <span className={`${display} hidden sm:block w-8 flex-shrink-0 text-center text-[26px] font-bold text-[#8C8C8C]`}>
                                            {episode.episode_num ?? index + 1}
                                        </span>
                                        <div
                                            className="relative w-[120px] md:w-[210px] flex-shrink-0 sm:ml-5 rounded-md overflow-hidden"
                                            style={{ background: placeholderGradient(episodeTitle) }}
                                        >
                                            <div className="ratio ratio-wide">
                                                <div className="ratio-fill flex items-center justify-center">
                                                    {image && <img src={image} alt="" loading="lazy" className="absolute top-0 left-0 w-full h-full object-cover" />}
                                                    <span className="relative w-10 h-10 rounded-full bg-[rgba(0,0,0,0.55)] border-[1.5px] border-[rgba(255,255,255,0.8)] flex items-center justify-center">
                                                        <Play size={16} className="ml-0.5" fill="currentColor" />
                                                    </span>
                                                    {ratio > 0 && (
                                                        <span className="absolute left-0 right-0 bottom-0 h-[3px] bg-[rgba(255,255,255,0.25)]">
                                                            <span className="block h-full bg-[#E50914]" style={progressWidth(ratio)} />
                                                        </span>
                                                    )}
                                                </div>
                                            </div>
                                        </div>
                                        <div className="flex-1 min-w-0 ml-5">
                                            <div className="flex items-baseline justify-between">
                                                <span className="text-base font-bold truncate">{episodeTitle}</span>
                                                {duration && <span className="ml-3 flex-shrink-0 text-[13px] text-[#B3B3B3]">{duration}</span>}
                                            </div>
                                            {episode.info?.plot && (
                                                <p className="mt-1.5 text-sm leading-normal text-[#B3B3B3] line-clamp-2">{episode.info.plot}</p>
                                            )}
                                        </div>
                                    </Link>
                                );
                            })}
                        </section>
                    )}
                </>
            )}
        </Shell>
    );
}
