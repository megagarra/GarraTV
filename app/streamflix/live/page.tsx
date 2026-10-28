'use client';

import { Suspense, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { LayoutGrid, List, Maximize, Star } from 'lucide-react';
import { useAuth } from '@/app/context/AuthContext';
import { useFavorites } from '@/app/context/FavoritesContext';
import { useI18n, useT } from '@/app/context/I18nContext';
import type { CatalogItem } from '@/app/lib/catalogItem';
import Shell from '@/components/streamflix/Shell';
import CategorySidebar from '@/components/streamflix/CategorySidebar';
import LivePreview from '@/components/streamflix/LivePreview';
import { FILTER_ALL, FILTER_FAVORITES, FILTER_RECENT, useCatalogData } from '@/components/streamflix/useCatalogData';
import {
    epgProgress,
    formatEpgDuration,
    formatEpgTime,
    loadShortEpg,
    splitNowNext,
    type EpgEntry,
} from '@/components/streamflix/epg';
import {
    display,
    ghostButton,
    initialsOf,
    placeholderGradient,
    primaryButton,
    progressWidth,
    segmentButton,
    segmented,
} from '@/components/streamflix/styles';

const PAGE = 80;

export default function StreamflixLivePage() {
    return (
        <Suspense fallback={<div className="min-h-screen bg-black" />}>
            <LiveScreen />
        </Suspense>
    );
}

function timeRange(entry: EpgEntry | undefined, locale: string): string {
    if (!entry) return '';
    const start = formatEpgTime(entry.start, locale);
    const end = formatEpgTime(entry.end, locale);
    return start && end ? `${start} – ${end}` : start || end;
}

function nowSeconds(): number {
    return Math.floor(Date.now() / 1000);
}

/** Loads the guide only once the element scrolls into view. */
function useVisibleEpg(guideEnabled: boolean, streamId: string, limit: number) {
    const ref = useRef<HTMLDivElement>(null);
    const [entries, setEntries] = useState<EpgEntry[] | null>(null);

    useEffect(() => {
        const node = ref.current;
        if (!node || !guideEnabled) return undefined;
        let cancelled = false;
        const load = () => {
            loadShortEpg(streamId, limit).then((result) => {
                if (!cancelled) setEntries(result);
            });
        };
        if (typeof IntersectionObserver === 'undefined') {
            load();
            return () => {
                cancelled = true;
            };
        }
        const observer = new IntersectionObserver((records) => {
            if (records.some((record) => record.isIntersecting)) {
                observer.disconnect();
                load();
            }
        }, { rootMargin: '200px 0px' });
        observer.observe(node);
        return () => {
            cancelled = true;
            observer.disconnect();
        };
    }, [guideEnabled, streamId, limit]);

    return { ref, entries };
}

function ChannelLogo({ item, className, textClass }: { item: CatalogItem; className: string; textClass: string }) {
    const [failed, setFailed] = useState(false);
    const showImage = Boolean(item.image) && !failed;
    return (
        <div
            className={`${className} flex-shrink-0 rounded-md overflow-hidden flex items-center justify-center`}
            style={{ background: showImage ? '#0A0A0A' : placeholderGradient(item.name) }}
        >
            {showImage ? (
                <img src={item.image} alt="" loading="lazy" className="w-full h-full object-contain p-1" onError={() => setFailed(true)} />
            ) : (
                <span className={`${display} font-extrabold ${textClass}`}>{initialsOf(item.name)}</span>
            )}
        </div>
    );
}

interface ChannelProps {
    item: CatalogItem;
    number: number;
    selected: boolean;
    favorite: boolean;
    guideEnabled: boolean;
    locale: string;
    initialFocus: boolean;
    onSelect: () => void;
    onToggleFavorite: () => void;
}

function ChannelRow({ item, number, selected, favorite, guideEnabled, locale, initialFocus, onSelect, onToggleFavorite }: ChannelProps) {
    const t = useT();
    const { ref, entries } = useVisibleEpg(guideEnabled, item.id, 2);
    const now = entries ? splitNowNext(entries, nowSeconds()).now : undefined;

    return (
        <div
            ref={ref}
            role="button"
            tabIndex={0}
            data-focusable="true"
            data-own-focus="true"
            data-initial-focus={initialFocus ? 'true' : undefined}
            onClick={onSelect}
            onKeyDown={(event) => {
                if (event.key === 'Enter') onSelect();
            }}
            className={[
                'relative flex items-center py-3 pr-3 pl-5 border-b border-[#1C1C1C] cursor-pointer outline-none transition-colors duration-200',
                'hover:bg-[#2A2A2A] focus:bg-[#2A2A2A] focus:shadow-[inset_0_0_0_2px_#E50914]',
                selected ? 'bg-[#2A2A2A]' : '',
            ].join(' ')}
        >
            {selected && <span className="absolute left-0 top-0 bottom-0 w-1 bg-[#E50914]" />}
            <span className="w-8 flex-shrink-0 text-[13px] font-bold text-[#8C8C8C] tabular-nums">{number}</span>
            <ChannelLogo item={item} className="w-[52px] h-[52px] ml-[14px]" textClass="text-[15px]" />
            <div className="flex-1 min-w-0 ml-[14px]">
                <p className="text-[15px] font-bold truncate">{item.name}</p>
                <p className="mt-[5px] text-[13px] text-[#B3B3B3] truncate">
                    {now ? now.title : entries ? t('streamflix.noProgramme') : ' '}
                </p>
                <div className="mt-[5px] flex items-center">
                    <div className="flex-1 h-[3px] bg-[#333333] rounded-sm overflow-hidden">
                        <div className="h-full bg-[#E50914]" style={progressWidth(now ? epgProgress(now, nowSeconds()) : 0)} />
                    </div>
                    {now && <span className="ml-2 text-[11px] text-[#8C8C8C] tabular-nums">{formatEpgTime(now.end, locale)}</span>}
                </div>
            </div>
            <button
                type="button"
                data-focusable="true"
                data-own-focus="true"
                tabIndex={0}
                aria-label={favorite ? t('streamflix.unfavorite') : t('streamflix.favorite')}
                onClick={(event) => {
                    event.stopPropagation();
                    onToggleFavorite();
                }}
                onKeyDown={(event) => event.stopPropagation()}
                className={`ml-[14px] w-9 h-9 flex-shrink-0 rounded-full flex items-center justify-center outline-none transition duration-200 hover:bg-[#333333] hover:scale-110 focus:bg-[#333333] focus:shadow-[0_0_0_2px_#E50914] ${favorite ? 'text-[#E50914]' : 'text-[#777777]'}`}
            >
                <Star size={18} fill={favorite ? 'currentColor' : 'none'} />
            </button>
        </div>
    );
}

function ChannelTile({ item, number, selected, guideEnabled, initialFocus, onSelect }: Omit<ChannelProps, 'favorite' | 'locale' | 'onToggleFavorite'>) {
    const { ref, entries } = useVisibleEpg(guideEnabled, item.id, 2);
    const now = entries ? splitNowNext(entries, nowSeconds()).now : undefined;

    return (
        <div ref={ref} className="w-1/2 sm:w-1/3 2xl:w-1/4 p-1.5">
            <div
                role="button"
                tabIndex={0}
                data-focusable="true"
                data-own-focus="true"
                data-initial-focus={initialFocus ? 'true' : undefined}
                onClick={onSelect}
                onKeyDown={(event) => {
                    if (event.key === 'Enter') onSelect();
                }}
                className={`p-3 bg-[#1F1F1F] border-2 rounded-lg cursor-pointer outline-none transition duration-200 hover:scale-[1.04] focus:scale-[1.04] hover:border-[#E50914] focus:border-[#E50914] ${selected ? 'border-[#E50914]' : 'border-transparent'}`}
            >
                <div className="ratio ratio-wide">
                    <div className="ratio-fill">
                        <ChannelLogo item={item} className="w-full h-full" textClass="text-[22px]" />
                    </div>
                </div>
                <div className="mt-2.5 flex items-center justify-between">
                    <span className="text-[13px] font-bold truncate">{item.name}</span>
                    <span className="ml-1.5 text-[11px] text-[#8C8C8C]">{number}</span>
                </div>
                <div className="mt-2.5 h-[3px] bg-[#333333] rounded-sm overflow-hidden">
                    <div className="h-full bg-[#E50914]" style={progressWidth(now ? epgProgress(now, nowSeconds()) : 0)} />
                </div>
            </div>
        </div>
    );
}

function LiveScreen() {
    const t = useT();
    const { locale } = useI18n();
    const { isAuthenticated } = useAuth();
    const searchParams = useSearchParams();
    const requested = searchParams.get('channel');
    const initialFilter = searchParams.get('filter') === FILTER_FAVORITES ? FILTER_FAVORITES : FILTER_ALL;
    const { isFavorite, addFavorite, removeFavorite } = useFavorites();
    const [filter, setFilter] = useState(initialFilter);
    const [query, setQuery] = useState('');
    const [mode, setMode] = useState<'list' | 'grid'>('list');
    const [selectedId, setSelectedId] = useState<string | null>(requested);
    const [visible, setVisible] = useState(PAGE);
    const [loadedGuide, setLoadedGuide] = useState<{ id: string; entries: EpgEntry[] } | null>(null);
    const [clock, setClock] = useState(nowSeconds);
    const data = useCatalogData('live', filter, query, 'name-asc');

    const changeFilter = (id: string) => {
        setFilter(id);
        setVisible(PAGE);
    };
    const changeQuery = (value: string) => {
        setQuery(value);
        setVisible(PAGE);
    };

    useEffect(() => {
        const timer = window.setInterval(() => setClock(nowSeconds()), 30000);
        return () => window.clearInterval(timer);
    }, []);

    // The selection falls back to the requested channel, then the first one,
    // whenever the current pick is not in the filtered list.
    const selected = data.items.find((item) => item.id === selectedId)
        ?? data.items.find((item) => item.id === requested)
        ?? data.items[0]
        ?? null;
    const activeId = selected ? selected.id : null;

    useEffect(() => {
        if (!isAuthenticated || !activeId) return undefined;
        let cancelled = false;
        loadShortEpg(activeId, 6).then((entries) => {
            if (!cancelled) setLoadedGuide({ id: activeId, entries });
        });
        return () => {
            cancelled = true;
        };
    }, [isAuthenticated, activeId]);

    const guideLoading = Boolean(activeId) && loadedGuide?.id !== activeId;
    const guide = loadedGuide && loadedGuide.id === activeId ? loadedGuide.entries : [];

    const focusedOnce = useRef(false);
    useEffect(() => {
        if (data.loading || focusedOnce.current) return;
        focusedOnce.current = true;
        document.querySelector<HTMLElement>('[data-initial-focus="true"]')?.focus();
    }, [data.loading]);

    const numbers = new Map<string, number>();
    data.items.forEach((item, index) => numbers.set(item.id, index + 1));
    const { now, next } = splitNowNext(guide, clock);
    const upcoming: EpgEntry[] = [];
    if (now) {
        const start = guide.indexOf(now);
        for (let i = start + 1; i < guide.length && upcoming.length < 4; i++) upcoming.push(guide[i]);
    } else if (next) {
        upcoming.push(next);
    }
    const shown = data.items.slice(0, visible);
    const selectedFavorite = selected ? isFavorite(selected.id, 'live') : false;
    const watchHref = selected
        ? `/dashboard/watch/live/${selected.id}?title=${encodeURIComponent(selected.name)}`
        : '/streamflix/live';

    const toggleFavorite = (item: CatalogItem) => {
        if (isFavorite(item.id, 'live')) removeFavorite(item.id, 'live');
        else addFavorite({ id: item.id, type: 'live', name: item.name, image: item.image });
    };

    const categoryName = data.categories.find((category) => category.category_id === filter)?.category_name;
    const heading = filter === FILTER_ALL
        ? t('streamflix.allChannels')
        : filter === FILTER_FAVORITES
            ? t('streamflix.favorites')
            : filter === FILTER_RECENT
                ? t('streamflix.recent')
                : (categoryName || t('streamflix.liveTv'));

    return (
        <Shell title={t('streamflix.liveTv')} backHref="/streamflix/home" fill>
            <div className="flex flex-col md:flex-row md:h-full">
                <CategorySidebar
                    query={query}
                    onQuery={changeQuery}
                    filter={filter}
                    onFilter={changeFilter}
                    categories={data.categories}
                    counts={data.counts}
                    total={data.total}
                    recentCount={data.recentCount}
                    favoriteCount={data.favoriteCount}
                    variant="live"
                />

                <section className="order-2 md:order-none md:flex-[35_1_0%] min-w-0 md:h-full flex flex-col border-r border-[#222222]">
                    <div className="flex-shrink-0 flex items-center justify-between bg-[#141414] px-5 py-[18px] border-b border-[#222222]">
                        <div className="min-w-0 mr-3">
                            <p className={`${display} text-xl font-extrabold truncate`}>{heading}</p>
                            <p className="mt-0.5 text-xs text-[#B3B3B3]">{t('streamflix.channelCount', { n: data.itemCount.toLocaleString(locale) })}</p>
                        </div>
                        <div className={segmented}>
                            <button
                                type="button"
                                data-focusable="true"
                                data-own-focus="true"
                                aria-label={t('streamflix.listView')}
                                aria-pressed={mode === 'list'}
                                onClick={() => setMode('list')}
                                className={`${segmentButton(mode === 'list')} w-9 h-[30px] flex items-center justify-center`}
                            >
                                <List size={16} />
                            </button>
                            <button
                                type="button"
                                data-focusable="true"
                                data-own-focus="true"
                                aria-label={t('streamflix.gridView')}
                                aria-pressed={mode === 'grid'}
                                onClick={() => setMode('grid')}
                                className={`${segmentButton(mode === 'grid')} w-9 h-[30px] ml-0.5 flex items-center justify-center`}
                            >
                                <LayoutGrid size={16} />
                            </button>
                        </div>
                    </div>

                    <div className="flex-1 min-h-0 md:overflow-y-auto overflow-x-hidden">
                        {data.loading && shown.length === 0 ? (
                            <p className="px-6 py-12 text-center text-sm text-[#B3B3B3]">{t('streamflix.loading')}</p>
                        ) : data.error ? (
                            <p className="px-6 py-12 text-center text-sm text-[#E50914]">{t(data.error)}</p>
                        ) : shown.length === 0 ? (
                            <p className="px-6 py-12 text-center text-sm text-[#B3B3B3]">{t('streamflix.noChannels')}</p>
                        ) : mode === 'list' ? (
                            shown.map((item, index) => (
                                <ChannelRow
                                    key={item.id}
                                    item={item}
                                    number={numbers.get(item.id) ?? index + 1}
                                    selected={item.id === activeId}
                                    favorite={isFavorite(item.id, 'live')}
                                    guideEnabled={isAuthenticated}
                                    locale={locale}
                                    initialFocus={item.id === activeId}
                                    onSelect={() => setSelectedId(item.id)}
                                    onToggleFavorite={() => toggleFavorite(item)}
                                />
                            ))
                        ) : (
                            <div className="flex flex-wrap p-2.5">
                                {shown.map((item, index) => (
                                    <ChannelTile
                                        key={item.id}
                                        item={item}
                                        number={numbers.get(item.id) ?? index + 1}
                                        selected={item.id === activeId}
                                        guideEnabled={isAuthenticated}
                                        initialFocus={item.id === activeId}
                                        onSelect={() => setSelectedId(item.id)}
                                    />
                                ))}
                            </div>
                        )}
                        {(visible < data.items.length || data.hasMore) && (
                            <div className="p-4">
                                <button
                                    type="button"
                                    data-focusable="true"
                                    data-own-focus="true"
                                    className={`${ghostButton} w-full h-11 text-sm`}
                                    onClick={() => {
                                        if (visible < data.items.length) setVisible((count) => count + PAGE);
                                        else data.loadMore();
                                    }}
                                >
                                    {t('streamflix.loadMore')}
                                </button>
                            </div>
                        )}
                    </div>
                </section>

                <section className="order-1 md:order-none md:flex-[45_1_0%] min-w-0 md:h-full md:overflow-y-auto overflow-x-hidden px-4 pt-4 pb-6 md:px-7 md:pt-6 md:pb-10">
                    {selected ? (
                        <>
                            <LivePreview
                                key={selected.id}
                                streamId={selected.id}
                                number={numbers.get(selected.id) ?? 1}
                                title={selected.name}
                                poster={selected.image}
                                timeRange={timeRange(now, locale)}
                                progress={now ? epgProgress(now, clock) : 0}
                                fullscreenHref={watchHref}
                            />

                            <div className="mt-6 flex items-center justify-between">
                                <span className={`${display} text-xs font-bold tracking-[0.16em] uppercase text-[#B3B3B3]`}>
                                    {t('streamflix.programGuide')}
                                </span>
                            </div>

                            {guideLoading ? (
                                <p className="mt-3.5 text-sm text-[#B3B3B3]">{t('streamflix.loading')}</p>
                            ) : !now ? (
                                <div className="mt-3.5 bg-[#1F1F1F] border border-[#2A2A2A] rounded-lg p-5 text-sm text-[#B3B3B3]">
                                    {t('streamflix.noEpg')}
                                </div>
                            ) : (
                                <>
                                    <div className="mt-3.5 bg-[#1F1F1F] border border-[#2A2A2A] rounded-lg p-5">
                                        <div className="flex items-center">
                                            <span className="text-[11px] font-extrabold tracking-[0.14em] uppercase text-[#E50914]">{t('streamflix.now')}</span>
                                            <span className="ml-2.5 text-[13px] text-[#B3B3B3] tabular-nums">{timeRange(now, locale)}</span>
                                        </div>
                                        <p className={`${display} mt-3 text-[22px] font-extrabold leading-tight`}>{now.title}</p>
                                        <div className="mt-3 h-1 bg-[#333333] rounded-sm overflow-hidden">
                                            <div className="h-full bg-[#E50914]" style={progressWidth(epgProgress(now, clock))} />
                                        </div>
                                        {now.description && <p className="mt-3 text-sm leading-relaxed text-[#B3B3B3]">{now.description}</p>}
                                    </div>

                                    {upcoming.length > 0 && (
                                        <>
                                            <p className="mt-5 text-[11px] font-extrabold tracking-[0.14em] uppercase text-[#B3B3B3]">{t('streamflix.next')}</p>
                                            <div className="mt-3.5 border border-[#2A2A2A] rounded-lg overflow-hidden">
                                                {upcoming.map((entry) => (
                                                    <div key={`${entry.start}-${entry.title}`} className="flex items-center px-[18px] py-3.5 bg-[#181818] border-b border-[#222222] last:border-b-0">
                                                        <span className="w-[46px] flex-shrink-0 text-sm font-bold tabular-nums">{formatEpgTime(entry.start, locale)}</span>
                                                        <span className="flex-1 min-w-0 ml-[18px] text-sm text-[#B3B3B3] truncate">{entry.title}</span>
                                                        <span className="ml-[18px] text-xs text-[#8C8C8C] whitespace-nowrap">{formatEpgDuration(entry)}</span>
                                                    </div>
                                                ))}
                                            </div>
                                        </>
                                    )}
                                </>
                            )}

                            <div className="mt-5 flex flex-wrap">
                                <Link
                                    href={watchHref}
                                    data-focusable="true"
                                    data-own-focus="true"
                                    className={`${primaryButton} h-[46px] px-[22px] mr-3 mb-3 flex items-center text-sm font-extrabold tracking-[0.04em]`}
                                >
                                    <Maximize size={18} className="mr-2.5" />
                                    {t('streamflix.fullscreen')}
                                </Link>
                                <button
                                    type="button"
                                    data-focusable="true"
                                    data-own-focus="true"
                                    onClick={() => toggleFavorite(selected)}
                                    className={`${ghostButton} h-[46px] px-[22px] mb-3 flex items-center text-sm`}
                                >
                                    <Star size={18} className={`mr-2.5 ${selectedFavorite ? 'text-[#E50914]' : ''}`} fill={selectedFavorite ? 'currentColor' : 'none'} />
                                    {selectedFavorite ? t('streamflix.favorited') : t('streamflix.favorite')}
                                </button>
                            </div>
                        </>
                    ) : !data.loading ? (
                        <p className="py-12 text-center text-sm text-[#B3B3B3]">{t('streamflix.noChannels')}</p>
                    ) : null}
                </section>
            </div>
        </Shell>
    );
}
