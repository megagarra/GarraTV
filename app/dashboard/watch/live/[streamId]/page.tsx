'use client';

import { useCallback, useMemo, useState } from 'react';
import { useParams, useRouter, useSearchParams } from 'next/navigation';
import { useAuth } from '@/app/context/AuthContext';
import { useT } from '@/app/context/I18nContext';
import VideoPlayer from '@/components/VideoPlayer';
import type Hls from 'hls.js';
import SyncButton from '@/components/SyncButton';
import BroadcastToggle from '@/components/BroadcastToggle';
import Badge from '@/components/ui/Badge';
import { useShareBroadcast, useSyncPlayback, syncKey } from '@/app/hooks/useLiveShare';
import { getAutoBroadcast } from '@/app/lib/device';
import { apiUrl } from '@/app/lib/apiClient';
import { useLiveChannelZap } from '@/app/hooks/useLiveChannelZap';
import type { CatalogItem } from '@/app/lib/catalogItem';
import ChannelBanner from '@/components/player/ChannelBanner';

export default function WatchLivePage() {
    const { isAuthenticated } = useAuth();
    const t = useT();
    const params = useParams();
    const router = useRouter();
    const searchParams = useSearchParams();
    // Zapping swaps the channel in place (no remount, so the player and the
    // broadcast toggle survive) and only rewrites the URL; this holds the
    // channel the user tuned to since the page opened.
    const [zappedId, setZappedId] = useState<string | null>(null);
    const streamId = zappedId ?? (params.streamId as string);

    // Coming from "Modo TV": I watch another device broadcast (via relay, 0 new connection).
    const isJoining = searchParams.get('join') === '1';

    const handleChannelSwitch = useCallback((channel: CatalogItem) => {
        setZappedId(channel.id);
        // replace, not push: Back returns to the channel grid, not through
        // every channel flipped past.
        window.history.replaceState(null, '', `/dashboard/watch/live/${encodeURIComponent(channel.id)}`);
    }, []);
    const zap = useLiveChannelZap(streamId, handleChannelSwitch);

    // The query carries title/poster only for the channel the page was opened
    // with (Modo TV join); after a switch they come from the channel list.
    const title = (!zappedId && searchParams.get('title')) || zap.current?.name || t('watch.channelFallback', { id: streamId });
    const poster = (!zappedId && searchParams.get('poster')) || zap.current?.image || undefined;

    // Broadcast toggle (starts on if the device is in "broadcast everything").
    const [isSharing, setIsSharing] = useState(() => getAutoBroadcast());
    const useRelay = isJoining || isSharing;

    // Time sync between players (only when playback goes through the relay).
    const [videoEl, setVideoEl] = useState<HTMLVideoElement | null>(null);
    const [hlsInstance, setHlsInstance] = useState<Hls | null>(null);
    const { canSync, sync } = useSyncPlayback({
        videoEl,
        hls: hlsInstance,
        streamKey: syncKey('live', streamId),
        role: isJoining ? 'viewer' : 'broadcaster',
        active: useRelay,
    });

    const streamUrl = useMemo(() => {
        if (!isAuthenticated || !streamId) return null;
        // Live always goes through the same-origin relay — never straight to the
        // provider. Xtream answers the .m3u8 with a 302 to a tokenized CDN that
        // sends no CORS headers, so hls.js (the only HLS path on WebOS/desktop
        // Chrome, which lack native HLS) is blocked when it fetches directly.
        // The relay does the cross-origin fetch server-side, rewrites the
        // playlist, and coalesces viewers into ~1 upstream connection.
        return apiUrl(`/api/relay?type=live&streamId=${encodeURIComponent(streamId)}`);
    }, [isAuthenticated, streamId]);

    const broadcastInfo = useMemo(
        () => ({ contentType: 'live' as const, streamId, title, poster }),
        [streamId, title, poster]
    );
    // Register/heartbeat only when I am broadcasting (not when just watching someone else).
    useShareBroadcast(isSharing && !isJoining, broadcastInfo);

    if (!streamUrl) {
        return (
            <div className="min-h-screen bg-bg flex items-center justify-center text-ink-2">
                {t('watch.preparingStream')}
            </div>
        );
    }

    const shareToggle = !isJoining ? (
        <BroadcastToggle active={isSharing} onToggle={() => setIsSharing((v) => !v)} />
    ) : (
        <Badge tone="live" dot>{t('watch.tvMode')}</Badge>
    );

    return (
        <div className="fixed inset-0 bg-bg z-50 flex flex-col">
            <div className="absolute inset-0 overflow-hidden pointer-events-none">
                <div className="absolute inset-0 bg-gradient-to-t from-bg via-bg/40 to-transparent z-10" />
            </div>

            <div className="relative flex-1 flex items-center justify-center">
                <VideoPlayer
                    src={streamUrl}
                    poster={poster}
                    autoPlay={true}
                    onBack={() => router.back()}
                    title={title}
                    onVideoElement={setVideoEl}
                    onHlsInstance={setHlsInstance}
                    onCorsFallback={() => setIsSharing(true)}
                    // Watching someone else's broadcast follows their channel.
                    onChannelStep={isJoining ? undefined : zap.step}
                    overlaySlot={isJoining ? undefined : <ChannelBanner target={zap.banner} />}
                    topRightSlot={
                        <div className="flex items-center space-x-2">
                            {useRelay && canSync && <SyncButton role={isJoining ? 'viewer' : 'broadcaster'} onClick={sync} />}
                            {shareToggle}
                        </div>
                    }
                />
            </div>
        </div>
    );
}
