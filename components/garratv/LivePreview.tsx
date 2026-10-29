'use client';

import { useEffect, useImperativeHandle, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import type HlsType from 'hls.js';
import { Maximize, Pause, Play, Volume2, VolumeX } from 'lucide-react';
import { apiUrl } from '@/app/lib/apiClient';
import { prefersNativeHls } from '@/app/lib/deviceProfile';
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
    ref?: React.Ref<LivePreviewHandle>;
}

/** Lets the channel list open the preview fullscreen (a second OK on the playing channel). */
export interface LivePreviewHandle {
    fullscreen: () => void;
}

interface LegacyFullscreen {
    webkitRequestFullscreen?: () => void;
}

const controlButton =
    'w-8 h-8 flex items-center justify-center rounded text-white outline-none transition-colors duration-200 hover:text-[#E50914] focus:shadow-[0_0_0_2px_#E50914]';

export default function LivePreview({ streamId, number, title, poster, timeRange, progress, fullscreenHref, src: srcOverride, ref }: LivePreviewProps) {
    const t = useT();
    const router = useRouter();
    const videoRef = useRef<HTMLVideoElement>(null);
    const frameRef = useRef<HTMLDivElement>(null);
    const [muted, setMuted] = useState(false);
    const [paused, setPaused] = useState(false);
    const [failed, setFailed] = useState(false);

    useEffect(() => {
        const video = videoRef.current;
        if (!video || !streamId) return undefined;

        // The parent keys this component by stream, so state starts fresh per channel.
        let disposed = false;
        const src = apiUrl(srcOverride || `/api/relay?type=live&streamId=${encodeURIComponent(streamId)}`);
        let hls: HlsType | null = null;

        const onError = () => {
            if (!disposed) setFailed(true);
        };
        const onPause = () => setPaused(true);
        const onPlay = () => setPaused(false);
        // Autoplay with sound is refused without a gesture. Stay paused then,
        // so the preview never starts silently. Runs once: the { once: true }
        // listener option only exists from Chrome 55, so a flag does it here.
        let started = false;
        const startWithSound = () => {
            if (disposed || started) return;
            started = true;
            video.muted = false;
            video.volume = 1;
            const attempt = video.play();
            if (attempt) attempt.catch(() => {
                if (!disposed) setPaused(true);
            });
        };

        const canPlayNative = video.canPlayType('application/vnd.apple.mpegurl') !== '';
        const playNative = () => {
            video.src = src;
            video.addEventListener('canplay', startWithSound);
        };

        // TVs and Safari play HLS natively: hls.js is never downloaded there. Desktop
        // Chromium also claims native HLS now, but starts far slower than hls.js.
        if (canPlayNative && (prefersNativeHls() || !('MediaSource' in window))) {
            playNative();
        } else {
            // ~400 KB that only the browsers without native HLS need, fetched
            // when a preview actually starts instead of with the channel list.
            import('hls.js')
                .then(({ default: Hls }) => {
                    if (disposed) return;
                    if (!Hls.isSupported()) {
                        if (canPlayNative) playNative();
                        else onError();
                        return;
                    }
                    hls = new Hls({
                        enableWorker: false,
                        maxBufferLength: 20,
                        // Append each segment while it downloads. Not on TVs, where
                        // AbortController is a polyfill that cannot cancel a fetch.
                        progressive: !prefersNativeHls(),
                        // Fetch the first segment while the playlist is parsed, and
                        // start nearer the live edge: a faster first frame.
                        startFragPrefetch: true,
                        liveSyncDurationCount: 3,
                    });
                    hls.on(Hls.Events.ERROR, (_, data) => {
                        if (data.fatal) onError();
                    });
                    hls.on(Hls.Events.MANIFEST_PARSED, startWithSound);
                    hls.loadSource(src);
                    hls.attachMedia(video);
                })
                .catch(onError);
        }

        video.addEventListener('error', onError);
        video.addEventListener('pause', onPause);
        video.addEventListener('play', onPlay);
        return () => {
            disposed = true;
            video.removeEventListener('error', onError);
            video.removeEventListener('pause', onPause);
            video.removeEventListener('play', onPlay);
            video.removeEventListener('canplay', startWithSound);
            if (hls) hls.destroy();
            video.removeAttribute('src');
            video.load();
        };
    }, [streamId, srcOverride]);

    useEffect(() => {
        const video = videoRef.current;
        if (!video) return;
        video.muted = muted;
        if (!muted) video.volume = 1;
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

    useImperativeHandle(ref, () => ({
        fullscreen: () => {
            if (fullscreenHref) router.push(fullscreenHref);
            else goFullscreen();
        },
    }));

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
                            playsInline
                        />
                    )}

                    <div className="absolute top-4 left-4 right-4 flex items-center">
                        <span className="h-6 px-2.5 flex flex-shrink-0 items-center rounded bg-[#E50914] text-[11px] font-extrabold tracking-[0.1em] uppercase">
                            <span className="w-1.5 h-1.5 rounded-full bg-white mr-1.5" />
                            {t('garratv.liveBadge')}
                        </span>
                        <span className="ml-2.5 text-sm font-bold truncate" style={{ textShadow: '0 1px 4px rgba(0,0,0,0.6)' }}>
                            {number} · {title}
                        </span>
                    </div>

                    {failed && (
                        <div className="absolute left-4 right-4 bottom-16 text-center">
                            <p className="inline-block px-4 py-2 rounded-md bg-[rgba(0,0,0,0.72)] text-sm font-bold">
                                {t('garratv.streamOffline')}
                            </p>
                        </div>
                    )}
                    {paused && !failed && (
                        <button
                            type="button"
                            data-focusable="true"
                            data-own-focus="true"
                            onClick={togglePlay}
                            aria-label={t('garratv.play')}
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
                            aria-label={paused ? t('garratv.play') : t('garratv.pause')}
                            className={controlButton}
                        >
                            {paused ? <Play size={20} fill="currentColor" /> : <Pause size={20} fill="currentColor" />}
                        </button>
                        <button
                            type="button"
                            data-focusable="true"
                            data-own-focus="true"
                            onClick={() => setMuted((value) => !value)}
                            aria-label={muted ? t('garratv.unmute') : t('garratv.mute')}
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
                                aria-label={t('garratv.fullscreen')}
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
                                aria-label={t('garratv.fullscreen')}
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
