'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import Hls from 'hls.js';
import { Maximize, Pause, Play, Volume2, VolumeX } from 'lucide-react';
import { apiUrl } from '@/app/lib/apiClient';
import { useT } from '@/app/context/I18nContext';
import { progressWidth } from './styles';

interface LivePreviewProps {
    streamId: string;
    number: number;
    title: string;
    poster?: string;
    /** "14:00 – 16:00" of the current programme, when the guide has it. */
    timeRange?: string;
    progress: number;
    /** Full player route; without it the preview itself goes fullscreen (guests). */
    fullscreenHref?: string;
    /** Stream URL override; defaults to the account's live relay for `streamId`. */
    src?: string;
}

interface LegacyFullscreen {
    webkitRequestFullscreen?: () => void;
}

const controlButton =
    'w-8 h-8 flex items-center justify-center rounded text-white outline-none transition-colors duration-200 hover:text-[#E50914] focus:shadow-[0_0_0_2px_#E50914]';

export default function LivePreview({ streamId, number, title, poster, timeRange, progress, fullscreenHref, src: srcOverride }: LivePreviewProps) {
    const t = useT();
    const videoRef = useRef<HTMLVideoElement>(null);
    const frameRef = useRef<HTMLDivElement>(null);
    const [muted, setMuted] = useState(true);
    const [paused, setPaused] = useState(false);
    const [failed, setFailed] = useState(false);

    useEffect(() => {
        const video = videoRef.current;
        if (!video || !streamId) return undefined;

        // The parent keys this component by stream, so state starts fresh per channel.
        let disposed = false;
        const src = apiUrl(srcOverride || `/api/relay?type=live&streamId=${encodeURIComponent(streamId)}`);
        let hls: Hls | null = null;

        const onError = () => {
            if (!disposed) setFailed(true);
        };
        const onPause = () => setPaused(true);
        const onPlay = () => setPaused(false);

        if (video.canPlayType('application/vnd.apple.mpegurl')) {
            video.src = src;
        } else if (Hls.isSupported()) {
            hls = new Hls({ enableWorker: false, maxBufferLength: 20 });
            hls.on(Hls.Events.ERROR, (_, data) => {
                if (data.fatal) onError();
            });
            hls.loadSource(src);
            hls.attachMedia(video);
        } else {
            onError();
        }

        video.addEventListener('error', onError);
        video.addEventListener('pause', onPause);
        video.addEventListener('play', onPlay);
        return () => {
            disposed = true;
            video.removeEventListener('error', onError);
            video.removeEventListener('pause', onPause);
            video.removeEventListener('play', onPlay);
            if (hls) hls.destroy();
            video.removeAttribute('src');
            video.load();
        };
    }, [streamId, srcOverride]);

    useEffect(() => {
        if (videoRef.current) videoRef.current.muted = muted;
    }, [muted]);

    const togglePlay = () => {
        const video = videoRef.current;
        if (!video) return;
        if (video.paused) {
            const attempt = video.play();
            if (attempt) attempt.catch(() => setPaused(true));
        } else {
            video.pause();
        }
    };

    const goFullscreen = () => {
        const frame = frameRef.current;
        if (!frame) return;
        // Chrome 53 (webOS 4) only has the prefixed API.
        if (frame.requestFullscreen) frame.requestFullscreen().catch(() => undefined);
        else (frame as unknown as LegacyFullscreen).webkitRequestFullscreen?.();
    };

    return (
        <div ref={frameRef} className="relative flex-shrink-0 rounded-lg overflow-hidden border border-[#222222] bg-black">
            <div className="ratio ratio-wide">
                <div className="ratio-fill">
                    {poster && (failed || paused) && (
                        <img src={poster} alt="" className="absolute top-0 left-0 w-full h-full object-contain opacity-60" />
                    )}
                    {!failed && (
                        <video
                            ref={videoRef}
                            className={`w-full h-full object-contain ${paused ? 'opacity-0' : ''}`}
                            autoPlay
                            muted
                            playsInline
                        />
                    )}

                    <div className="absolute top-4 left-4 right-4 flex items-center">
                        <span className="h-6 px-2.5 flex flex-shrink-0 items-center rounded bg-[#E50914] text-[11px] font-extrabold tracking-[0.1em] uppercase">
                            <span className="w-1.5 h-1.5 rounded-full bg-white mr-1.5" />
                            {t('streamflix.liveBadge')}
                        </span>
                        <span className="ml-2.5 text-sm font-bold truncate" style={{ textShadow: '0 1px 4px rgba(0,0,0,0.6)' }}>
                            {number} · {title}
                        </span>
                    </div>

                    {failed && (
                        <div className="absolute left-4 right-4 bottom-16 text-center">
                            <p className="inline-block px-4 py-2 rounded-md bg-[rgba(0,0,0,0.72)] text-sm font-bold">
                                {t('streamflix.streamOffline')}
                            </p>
                        </div>
                    )}
                    {paused && !failed && (
                        <button
                            type="button"
                            data-focusable="true"
                            data-own-focus="true"
                            onClick={togglePlay}
                            aria-label={t('streamflix.play')}
                            className="absolute left-1/2 top-1/2 -ml-9 -mt-9 w-[72px] h-[72px] rounded-full bg-[rgba(0,0,0,0.5)] border-2 border-[rgba(255,255,255,0.85)] flex items-center justify-center outline-none transition duration-200 hover:bg-[#E50914] hover:border-[#E50914] hover:scale-[1.08] focus:bg-[#E50914] focus:border-white"
                        >
                            <Play size={28} fill="currentColor" className="ml-1" />
                        </button>
                    )}

                    <div
                        className="absolute left-0 right-0 bottom-0 pt-7 pb-3 px-4 flex items-center"
                        style={{ background: 'linear-gradient(0deg, rgba(0,0,0,0.85), transparent)' }}
                    >
                        <button
                            type="button"
                            data-focusable="true"
                            data-own-focus="true"
                            onClick={togglePlay}
                            aria-label={paused ? t('streamflix.play') : t('streamflix.pause')}
                            className={controlButton}
                        >
                            {paused ? <Play size={20} fill="currentColor" /> : <Pause size={20} fill="currentColor" />}
                        </button>
                        <button
                            type="button"
                            data-focusable="true"
                            data-own-focus="true"
                            onClick={() => setMuted((value) => !value)}
                            aria-label={muted ? t('streamflix.unmute') : t('streamflix.mute')}
                            className={`${controlButton} ml-2`}
                        >
                            {muted ? <VolumeX size={20} /> : <Volume2 size={20} />}
                        </button>
                        <div className="flex-1 h-[3px] mx-4 bg-[rgba(255,255,255,0.25)] rounded-sm overflow-hidden">
                            <div className="h-full bg-[#E50914]" style={progressWidth(progress)} />
                        </div>
                        {timeRange && <span className="text-xs text-[#B3B3B3] tabular-nums mr-3 whitespace-nowrap">{timeRange}</span>}
                        {fullscreenHref ? (
                            <Link
                                href={fullscreenHref}
                                data-focusable="true"
                                data-own-focus="true"
                                aria-label={t('streamflix.fullscreen')}
                                className={controlButton}
                            >
                                <Maximize size={20} />
                            </Link>
                        ) : (
                            <button
                                type="button"
                                data-focusable="true"
                                data-own-focus="true"
                                onClick={goFullscreen}
                                aria-label={t('streamflix.fullscreen')}
                                className={controlButton}
                            >
                                <Maximize size={20} />
                            </button>
                        )}
                    </div>
                </div>
            </div>
        </div>
    );
}
