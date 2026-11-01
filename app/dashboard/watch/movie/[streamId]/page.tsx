'use client';

import { useEffect, useRef, useState, useMemo } from 'react';
import { useParams, useRouter, useSearchParams } from 'next/navigation';
import { useAuth } from '@/app/context/AuthContext';
import { useWatchProgress } from '@/app/context/WatchProgressContext';
import { useT } from '@/app/context/I18nContext';
import VideoPlayer from '@/components/VideoPlayer';
import type Hls from 'hls.js';
import { ArrowLeft, Play, Calendar, Star, Clock, Subtitles } from 'lucide-react';
import Loader from '@/components/Loader';
import SubtitleSearchPanel from '@/components/SubtitleSearchPanel';
import LimitReachedModal from '@/components/LimitReachedModal';
import { apiFetch, apiUrl } from '@/app/lib/apiClient';
import * as db from '@/app/lib/db';
import type { CachedStream } from '@/app/lib/dbTypes';
import { recallDetail, rememberDetail } from '@/app/lib/detailMemo';
import { vodPath } from '@/app/lib/vodWarmup';
import { formatRating } from '@/app/lib/formatRating';
import BroadcastStartModal from '@/components/BroadcastStartModal';
import BroadcastToggle from '@/components/BroadcastToggle';
import Badge from '@/components/ui/Badge';
import Button from '@/components/ui/Button';
import EmptyState from '@/components/ui/EmptyState';
import FavoriteButton from '@/components/FavoriteButton';
import { useConnectionLimit } from '@/app/hooks/useConnectionLimit';
import { useShareBroadcast, useSyncPlayback, syncKey, relaySrc } from '@/app/hooks/useLiveShare';
import { useVodRelayHeartbeat } from '@/app/hooks/useVodRelayHeartbeat';
import { getAutoBroadcast } from '@/app/lib/device';
import SyncButton from '@/components/SyncButton';

// Types for Movie Info
interface MovieInfo {
    info: {
        movie_image: string;
        name: string;
        plot: string;
        director: string;
        releasedate: string;
        rating: string;
        duration: string;
        /** Real length in seconds, from the provider — the broadcast timeline needs it. */
        duration_secs?: number;
        genre: string;
    };
    movie_data: {
        stream_id: number;
        container_extension: string;
        name: string;
    };
}

import { useData } from '@/app/context/DataContext';
import { useTMDb } from '@/app/context/TMDbContext';
import { useSubtitle } from '@/app/context/SubtitleContext';

const isMovieInfo = (value: unknown): value is MovieInfo =>
    !!value && !!(value as MovieInfo).info && !!(value as MovieInfo).movie_data;

/** Enough to start playing from the catalog row alone, before the provider's detail arrives. */
function movieFromStream(row: CachedStream): MovieInfo | null {
    if (!row.container_extension) return null;
    return {
        info: {
            movie_image: row.cover || row.icon || '',
            name: row.name,
            plot: row.plot || '',
            director: row.director || '',
            releasedate: row.release_date || '',
            rating: row.rating || '',
            duration: '',
            genre: row.genre || '',
        },
        movie_data: { stream_id: Number(row.id), container_extension: row.container_extension, name: row.name },
    };
}

/** A limit check this recent is still good when "Watch" is pressed. */
const LIMIT_CHECK_FRESH_MS = 30_000;

export default function WatchMoviePage() {
    const { isAuthenticated } = useAuth();
    const { updateProgress, getProgress, isLoaded: progressLoaded, loadingDetails } = useWatchProgress();
    const { getCachedDetail, saveCachedDetail } = useData();
    const { searchMovie, isConfigured: tmdbConfigured } = useTMDb();
    const { getSavedSubtitle } = useSubtitle();
    const t = useT();
    const params = useParams();
    const router = useRouter();
    const streamId = params.streamId as string;
    const isDetailLoading = loadingDetails[`movie-${streamId}`];

    // Opened right after its title screen: the detail is already in memory.
    const [movie, setMovie] = useState<MovieInfo | null>(() => {
        const remembered = recallDetail<MovieInfo>('movie', streamId);
        return isMovieInfo(remembered) ? remembered : null;
    });
    const [loading, setLoading] = useState(() => movie === null);
    const [isPlaying, setIsPlaying] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [subtitleUrl, setSubtitleUrl] = useState<string | null>(null);
    const [showSubtitlePanel, setShowSubtitlePanel] = useState(false);
    const [tmdbId, setTmdbId] = useState<number | undefined>(undefined);
    const [showLimitModal, setShowLimitModal] = useState(false);
    const checkConnectionLimit = useConnectionLimit();
    const [isSharing, setIsSharing] = useState(() => getAutoBroadcast());
    const [showStartModal, setShowStartModal] = useState(false);
    // Where the broadcast should start. `null` = not picked by hand (auto-broadcast),
    // which falls back to the saved progress.
    const [broadcastStart, setBroadcastStart] = useState<number | null>(null);
    // "Join" (Modo TV) params — via useSearchParams to work on the client.
    const searchParams = useSearchParams();
    // Opened straight into the player (GarraTV "Assistir", continue watching):
    // closing it returns to where the user came from instead of this detail screen.
    const [openedToPlay] = useState(() => searchParams.get('autoplay') === 'true');
    // "From the start" on the title screen: the saved position is ignored once.
    const [startFromZero] = useState(() => searchParams.get('start') === '0');
    const isJoining = searchParams.get('join') === '1';
    const joinExt = searchParams.get('ext') || undefined;
    const joinPoster = searchParams.get('poster') || undefined;
    const joinTitle = searchParams.get('title') || undefined;

    // Time sync between players (broadcaster + viewers of the same movie).
    const [videoEl, setVideoEl] = useState<HTMLVideoElement | null>(null);
    const [hlsInstance, setHlsInstance] = useState<Hls | null>(null);
    const { canSync, sync } = useSyncPlayback({
        videoEl,
        hls: hlsInstance,
        streamKey: syncKey('movie', streamId),
        role: isJoining ? 'viewer' : 'broadcaster',
        active: isJoining || (isPlaying && isSharing),
    });

    // Holds the ffmpeg broadcast only while this device is really playing it.
    useVodRelayHeartbeat({
        videoEl,
        contentType: 'movie',
        streamId,
        active: isJoining || (isPlaying && isSharing),
        onEnded: () => {
            if (isJoining) router.back();
            else setIsSharing(false);
        },
        // Viewer only: the broadcaster reloads itself through its own src change.
        onRestart: () => { if (isJoining) setReloadNonce((n) => n + 1); },
    });
    // Bumped when the broadcast is seeked, to force the joined player to reload.
    const [reloadNonce, setReloadNonce] = useState(0);

    // Calculate resumeTime synchronously based on progressLoaded
    const resumeTime = useMemo(() => {
        if (!progressLoaded || startFromZero) return 0;
        const progress = getProgress(streamId);
        if (progress && progress.progress > 10) {
            // Check if progress is near the end (more than 95%)
            if (progress.duration > 0) {
                const percentage = (progress.progress / progress.duration) * 100;
                if (percentage > 95) return 0;
            }
            return progress.progress;
        }
        return 0;
    }, [streamId, getProgress, progressLoaded, startFromZero]);

    // The start point is baked into ffmpeg when the broadcast is created, so it is decided
    // once. Leaving it derived from the saved progress would move it while broadcasting
    // (the progress now keeps being written), rewriting the stream URL mid-playback and
    // reloading the player over and over.
    useEffect(() => {
        if (!isSharing || !isPlaying) return;
        setBroadcastStart(prev => prev ?? resumeTime);
    }, [isSharing, isPlaying, resumeTime]);

    useEffect(() => {
        if (!isAuthenticated || !streamId || isJoining) return;

        const loadMovieInfo = async () => {
            if (isMovieInfo(recallDetail('movie', streamId))) return;
            let settled = false;
            let provisionalShown = false;
            try {
                // Try cache first
                const cached = await getCachedDetail<MovieInfo>('movie', streamId);
                if (cached && cached.info && cached.movie_data) {
                    rememberDetail('movie', streamId, cached);
                    setMovie(cached);
                    setLoading(false);
                    return;
                }

                // The provider's detail is a slow round-trip. When the player opens
                // straight away, the catalog row already says which file to request.
                if (openedToPlay) {
                    db.getStreamsByIds([streamId], 'movie')
                        .then(([row]) => {
                            const provisional = row && movieFromStream(row);
                            if (settled || !provisional) return;
                            provisionalShown = true;
                            setMovie((current) => current ?? provisional);
                            setLoading(false);
                        })
                        .catch(() => undefined);
                }

                const res = await apiFetch('/api/proxy', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        action: 'get_vod_info',
                        vod_id: streamId
                    })
                });

                const data = await res.json();
                if (data && data.info && data.movie_data) {
                    rememberDetail('movie', streamId, data);
                    // A provisional entry already playing keeps its container: changing it
                    // would swap the player's source mid-start.
                    setMovie((current) => current && current.movie_data.container_extension !== data.movie_data.container_extension
                        ? { ...data, movie_data: { ...data.movie_data, container_extension: current.movie_data.container_extension } }
                        : data);
                    // Lazy cache the detail; nothing on screen waits for the write.
                    saveCachedDetail('movie', streamId, data).catch(() => undefined);
                } else if (!provisionalShown) {
                    setError(t('watch.movieDetailsNotFound'));
                }
            } catch (err) {
                console.error(err);
                // Playback already started from the catalog row; only the extras are missing.
                if (!provisionalShown) setError(t('watch.movieDetailsError'));
            } finally {
                settled = true;
                setLoading(false);
            }
        };

        loadMovieInfo();
    }, [isAuthenticated, streamId, isJoining, openedToPlay, getCachedDetail, saveCachedDetail, t]);

    // Resolve TMDB ID for better subtitle matching
    useEffect(() => {
        if (!movie || !tmdbConfigured || tmdbId) return;

        const resolveTmdbId = async () => {
            try {
                const result = await searchMovie(movie.info.name);
                if (result) {
                    setTmdbId(result.id);
                }
            } catch (err) {
                console.error('[WatchMoviePage] Failed to resolve TMDB ID:', err);
            }
        };

        resolveTmdbId();
    }, [movie, tmdbConfigured, tmdbId, searchMovie]);

    // Load saved subtitle on mount
    useEffect(() => {
        if (!streamId) return;

        const loadSavedSub = async () => {
            const saved = await getSavedSubtitle(streamId);
            if (saved && saved.vtt) {
                console.log('[WatchMoviePage] loading saved subtitle');
                const blob = new Blob([saved.vtt], { type: 'text/vtt' });
                setSubtitleUrl(URL.createObjectURL(blob));
            }
        };
        loadSavedSub();
    }, [streamId, getSavedSubtitle]);

    // Auto-play from continue watching
    useEffect(() => {
        if (searchParams.get('autoplay') === 'true' && movie && !isPlaying && progressLoaded) {
            setIsPlaying(true);
            // Clear autoplay search params immediately to prevent loop. The History API
            // (synced by the App Router) skips a router round-trip while the video starts.
            window.history.replaceState(null, '', window.location.pathname);
        }
    }, [searchParams, movie, progressLoaded, isPlaying]);

    // The limit is asked as soon as the details are up, so "Watch" rarely waits for it.
    // It cannot run alongside playback: the panel would count our own new connection.
    const limitCheck = useRef<{ at: number; result: Promise<boolean> } | null>(null);
    const showingDetails = !!movie && !isPlaying && !isJoining && !openedToPlay;
    useEffect(() => {
        if (showingDetails) limitCheck.current = { at: Date.now(), result: checkConnectionLimit() };
    }, [showingDetails, checkConnectionLimit]);

    const handlePlay = async () => {
        // Movie/series have no relay yet (VOD requires ffmpeg); when exhausted, we offer
        // joining a live broadcast instead of failing playback.
        const recent = limitCheck.current && Date.now() - limitCheck.current.at < LIMIT_CHECK_FRESH_MS
            ? limitCheck.current.result
            : checkConnectionLimit();
        limitCheck.current = null;
        if (await recent) {
            setShowLimitModal(true);
            return;
        }
        setIsPlaying(true);
    };

    const handleProgress = (currentTime: number, duration: number) => {
        if (!movie) return;
        updateProgress({
            streamId: movie.movie_data.stream_id,
            type: 'movie',
            progress: currentTime,
            duration: duration,
            timestamp: Date.now(),
            name: movie.info.name,
            image: movie.info.movie_image
        });
    };

    const broadcastInfo = useMemo(
        () =>
            movie
                ? {
                      contentType: 'movie' as const,
                      streamId,
                      title: movie.info.name,
                      poster: movie.info.movie_image,
                      ext: movie.movie_data.container_extension,
                  }
                : null,
        [movie, streamId]
    );
    // Registers the broadcast when I share (not when just joining someone else's).
    useShareBroadcast(isSharing && !isJoining, broadcastInfo, () => setIsSharing(false));

    // Join another device broadcast (via VOD relay): does not depend on loading details.
    if (isJoining) {
        // The nonce changes on a broadcast seek, so the player reloads onto the new
        // timeline instead of stalling on a playlist that jumped backwards.
        const src = relaySrc({ contentType: 'movie', streamId, ext: joinExt })
            + (reloadNonce ? `&_r=${reloadNonce}` : '');
        return (
            <div className="fixed inset-0 bg-bg z-50 flex flex-col">
                <div className="relative flex-1 flex items-center justify-center">
                    <VideoPlayer
                        src={src}
                        poster={joinPoster}
                        autoPlay={true}
                        onBack={() => router.back()}
                        title={joinTitle}
                        onVideoElement={setVideoEl}
                        onHlsInstance={setHlsInstance}
                        topRightSlot={
                            <div className="flex items-center space-x-2">
                                {canSync && <SyncButton role="viewer" onClick={sync} />}
                                <Badge tone="live" dot>{t('watch.tvMode')}</Badge>
                            </div>
                        }
                    />
                </div>
            </div>
        );
    }

    if (loading || !progressLoaded || isDetailLoading) return <Loader />;

    if (error || !movie) {
        return (
            <div className="min-h-screen bg-bg flex flex-col items-center justify-center">
                <EmptyState
                    title={error || t('watch.movieNotFound')}
                    action={
                        <Button variant="secondary" icon={ArrowLeft} onClick={() => router.back()}>
                            {t('common.back')}
                        </Button>
                    }
                />
            </div>
        );
    }

    if (isPlaying) {
        const extension = movie.movie_data.container_extension;
        const directUrl = apiUrl(vodPath('movie', streamId, extension));
        const startSeconds = broadcastStart ?? resumeTime;
        // Only the provider's own length is trustworthy here; the relay stream carries
        // just a sliding window, so without this the bar would measure the window.
        const titleDuration = movie.info.duration_secs ?? 0;

        // Seek outside the window: the upstream is re-read from the new point, which
        // moves every device watching this broadcast (one stream, like a channel).
        const handleBroadcastSeek = async (absolute: number) => {
            const start = Math.floor(absolute);
            try {
                const res = await apiFetch('/api/relay/vod', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ action: 'seek', contentType: 'movie', streamId, ext: extension, start }),
                });
                if (!res.ok) return;
                // Reloads the player at the new offset (the src carries `start`).
                setBroadcastStart(start);
            } catch {
                /* seek is best-effort; the broadcast keeps running where it was */
            }
        };
        // While broadcasting the player's clock is the relay window, not the title: the real
        // position is where ffmpeg started plus what has played since. Without this conversion
        // the progress would be unusable, which is why it used to be dropped altogether.
        const handleBroadcastProgress = (currentTime: number) => {
            handleProgress(startSeconds + currentTime, titleDuration);
        };
        // Compartilhando → toca via relay (mesmo stream que outros aparelhos entram, estilo canal).
        const streamUrl = isSharing
            ? relaySrc({ contentType: 'movie', streamId, ext: extension, start: startSeconds })
            : directUrl;

        // Direct-to-provider playback can hit a CORS wall behind a reverse proxy
        // (the browser reaches our domain fine, but the Xtream host itself sends
        // no CORS headers). Auto-enabling Modo TV switches to the same-origin
        // relay, which does the cross-origin fetch server-side instead.
        const handleCorsFallback = isSharing ? undefined : () => setIsSharing(true);

        return (
            <div className="fixed inset-0 bg-bg z-50 flex flex-col">
                <div className="relative flex-1 flex items-center justify-center">
                    <VideoPlayer
                        src={streamUrl}
                        poster={movie.info.movie_image}
                        autoPlay={true}
                        initialTime={isSharing ? 0 : resumeTime}
                        onProgress={isSharing ? handleBroadcastProgress : handleProgress}
                        timeOffset={isSharing ? startSeconds : 0}
                        totalDuration={isSharing ? titleDuration : 0}
                        onSeekBeyondWindow={isSharing ? handleBroadcastSeek : undefined}
                        onBack={() => (openedToPlay ? router.back() : setIsPlaying(false))}
                        subtitleUrl={subtitleUrl || undefined}
                        title={movie.info.name}
                        onVideoElement={setVideoEl}
                        onHlsInstance={setHlsInstance}
                        onCorsFallback={handleCorsFallback}
                        topRightSlot={
                            <div className="flex items-center space-x-2">
                                {isSharing && canSync && <SyncButton role="broadcaster" onClick={sync} />}
                                <BroadcastToggle
                                    active={isSharing}
                                    onToggle={() => {
                                        // Stopping is immediate; starting asks where to begin (the point is
                                        // baked into ffmpeg and cannot change once it is running).
                                        if (isSharing) {
                                            setIsSharing(false);
                                            setBroadcastStart(null);
                                        } else {
                                            setShowStartModal(true);
                                        }
                                    }}
                                />
                            </div>
                        }
                    />
                </div>
                {showStartModal && <BroadcastStartModal
                    resumeTime={resumeTime}
                    duration={getProgress(streamId)?.duration}
                    onCancel={() => setShowStartModal(false)}
                    onConfirm={(start) => {
                        setBroadcastStart(start);
                        setIsSharing(true);
                        setShowStartModal(false);
                    }}
                />}
            </div>
        );
    }

    // Opened to play: the player takes over on the next render. Drawing the details
    // (blurred backdrop and all) for that one frame only costs a TV time.
    if (openedToPlay) return <Loader />;

    // Details View
    const hasProgress = resumeTime > 0;
    const ratingLabel = formatRating(movie.info.rating);

    return (
        <div className="min-h-screen bg-bg text-ink">
            {/* Background Backdrop (using poster logic if backdrop not available, blurred) */}
            <div className="absolute inset-0 overflow-hidden">
                <div
                    className="absolute inset-0 bg-cover bg-center blur-3xl opacity-30 scale-110"
                    style={{ backgroundImage: `url(${movie.info.movie_image})` }}
                />
                <div className="absolute inset-0 bg-gradient-to-t from-bg via-bg/80 to-transparent" />
                <div className="absolute inset-0 w-1/2 bg-gradient-to-r from-bg/80 to-transparent" />
            </div>

            <div className="relative z-10 px-6 md:px-10 lg:px-14 py-8">
                <Button variant="ghost" icon={ArrowLeft} onClick={() => router.back()} className="mb-8">
                    {t('common.back')}
                </Button>

                <div className="flex flex-col lg:flex-row space-y-10 lg:space-y-0 lg:space-x-16 items-start">
                    {/* Poster */}
                    <div className="w-full max-w-[300px] lg:max-w-[400px] flex-shrink-0 rounded-xl overflow-hidden shadow-2xl shadow-black/50 mx-auto lg:mx-0">
                        <img
                            src={movie.info.movie_image}
                            alt={movie.info.name}
                            className="w-full h-auto"
                            onError={(e) => e.currentTarget.src = 'https://via.placeholder.com/300x450?text=Sem+Poster'}
                        />
                    </div>

                    {/* Metadata */}
                    <div className="flex-1 space-y-6">
                        <h1 className="text-3xl md:text-5xl font-semibold tracking-tight leading-tight">{movie.info.name}</h1>

                        <div className="flex flex-wrap items-center">
                            {movie.info.releasedate && (
                                <span className="mr-2 mb-2">
                                    <Badge>
                                        <Calendar size={14} className="mr-1.5" /> {movie.info.releasedate}
                                    </Badge>
                                </span>
                            )}
                            {ratingLabel && (
                                <span className="mr-2 mb-2 flex items-center text-sm text-ink-2 tnum">
                                    <Star size={16} className="mr-1 text-ink-2" fill="currentColor" /> {ratingLabel}
                                </span>
                            )}
                            {movie.info.duration && (
                                <span className="mr-2 mb-2">
                                    <Badge>
                                        <Clock size={14} className="mr-1.5" /> {movie.info.duration}
                                    </Badge>
                                </span>
                            )}
                        </div>

                        <p className="text-sm md:text-base text-ink-2 leading-relaxed max-w-3xl">
                            {movie.info.plot || t('watch.noDescription')}
                        </p>

                        <div className="space-y-1 text-sm text-ink-2">
                            {movie.info.genre && <p><span className="text-ink font-medium">{t('watch.genre')}</span> {movie.info.genre}</p>}
                            {movie.info.director && <p><span className="text-ink font-medium">{t('watch.director')}</span> {movie.info.director}</p>}
                        </div>

                        <div className="flex items-center space-x-3">
                            <Button variant="primary" size="lg" icon={Play} onClick={handlePlay} data-autofocus="true">
                                {hasProgress ? <>{t('watch.resume')} · <span className="tnum ml-1">{formatDuration(resumeTime)}</span></> : t('watch.watch')}
                            </Button>
                            <Button variant="secondary" size="lg" icon={Subtitles} onClick={() => setShowSubtitlePanel(true)}>
                                {subtitleUrl ? t('watch.subtitlesReady') : t('watch.subtitles')}
                            </Button>
                            <FavoriteButton
                                item={{
                                    id: movie.movie_data.stream_id,
                                    type: 'movie',
                                    name: movie.info.name,
                                    image: movie.info.movie_image,
                                    rating: movie.info.rating,
                                }}
                            />
                        </div>
                    </div>
                </div>
            </div>

            {showSubtitlePanel && (
                <SubtitleSearchPanel
                    title={movie.info.name}
                    year={movie.info.releasedate}
                    tmdbId={tmdbId}
                    streamId={streamId}
                    onSubtitleSelected={(url) => setSubtitleUrl(url)}
                    onClose={() => setShowSubtitlePanel(false)}
                />
            )}

            <LimitReachedModal open={showLimitModal} onClose={() => setShowLimitModal(false)} />
        </div>
    );
}

/** Formats seconds as "H:MM:SS" or "M:SS" for the "Retomar" label. */
function formatDuration(totalSeconds: number): string {
    const s = Math.max(0, Math.floor(totalSeconds));
    const h = Math.floor(s / 3600);
    const m = Math.floor((s % 3600) / 60);
    const sec = s % 60;
    const pad = (n: number) => String(n).padStart(2, '0');
    return h > 0 ? `${h}:${pad(m)}:${pad(sec)}` : `${m}:${pad(sec)}`;
}
