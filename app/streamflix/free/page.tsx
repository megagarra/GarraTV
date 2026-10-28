'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Globe, Lock, LogIn, X } from 'lucide-react';
import { useAuth } from '@/app/context/AuthContext';
import { useI18n, useT } from '@/app/context/I18nContext';
import type { CachedCategory } from '@/app/lib/dbTypes';
import {
    fetchFreeChannels,
    countryNameFormatter,
    fetchFreeCountries,
    freeStreamPath,
    readSavedCountry,
    saveCountry,
    systemRegion,
    type FreeChannelList,
    type FreeChannelSummary,
    type FreeCountry,
} from '@/app/lib/freeChannelsApi';
import { Wordmark } from '@/components/streamflix/Header';
import CategorySidebar from '@/components/streamflix/CategorySidebar';
import CountryPicker, { CountryButton } from '@/components/streamflix/CountryPicker';
import LivePreview from '@/components/streamflix/LivePreview';
import UpgradeCallout from '@/components/streamflix/UpgradeCallout';
import { FILTER_ALL } from '@/components/streamflix/useCatalogData';
import { display, ghostButton, initialsOf, placeholderGradient, primaryButton } from '@/components/streamflix/styles';

const PAGE = 80;

function ChannelLogo({ channel }: { channel: FreeChannelSummary }) {
    const [failed, setFailed] = useState(false);
    const showImage = Boolean(channel.logo) && !failed;
    return (
        <div
            className="w-[52px] h-[52px] ml-[14px] flex-shrink-0 rounded-md overflow-hidden flex items-center justify-center"
            style={{ background: showImage ? '#0A0A0A' : placeholderGradient(channel.name) }}
        >
            {showImage ? (
                <img src={channel.logo} alt="" loading="lazy" className="w-full h-full object-contain p-1" onError={() => setFailed(true)} />
            ) : (
                <span className={`${display} text-[15px] font-extrabold`}>{initialsOf(channel.name)}</span>
            )}
        </div>
    );
}

export default function StreamflixFreePage() {
    const t = useT();
    const { locale } = useI18n();
    const router = useRouter();
    const { isAuthenticated, isLoading } = useAuth();
    const [list, setList] = useState<FreeChannelList | null>(null);
    const [failed, setFailed] = useState(false);
    const [filter, setFilter] = useState(FILTER_ALL);
    const [query, setQuery] = useState('');
    const [selectedId, setSelectedId] = useState<string | null>(null);
    const [visible, setVisible] = useState(PAGE);
    const [upgradeOpen, setUpgradeOpen] = useState(false);
    const [countries, setCountries] = useState<FreeCountry[]>([]);
    const [defaultCountry, setDefaultCountry] = useState<string | null>(null);
    // Last pick, else the system language's region; the server swaps an
    // unknown code for its default country and echoes back what it used.
    const [country, setCountry] = useState<string | null>(() => readSavedCountry() ?? systemRegion());
    const [pickerOpen, setPickerOpen] = useState(false);

    // Subscribers have the full catalog; the free tier is for guests only.
    useEffect(() => {
        if (!isLoading && isAuthenticated) router.replace('/streamflix/home');
    }, [isAuthenticated, isLoading, router]);

    useEffect(() => {
        let cancelled = false;
        fetchFreeCountries()
            .then((result) => {
                if (cancelled) return;
                setCountries(result.countries);
                setDefaultCountry(result.defaultCountry);
            })
            .catch((err: unknown) => console.error('[StreamFlix] Country list unavailable', err));
        return () => {
            cancelled = true;
        };
    }, []);

    useEffect(() => {
        let cancelled = false;
        fetchFreeChannels(country ?? undefined)
            .then((result) => {
                if (cancelled) return;
                setList(result);
                setFailed(false);
            })
            .catch((err: unknown) => {
                console.error('[StreamFlix] Free channels unavailable', err);
                if (!cancelled) setFailed(true);
            });
        return () => {
            cancelled = true;
        };
    }, [country]);

    const pickCountry = (code: string) => {
        setPickerOpen(false);
        saveCountry(code);
        if (code === list?.country) return;
        setList(null);
        setFailed(false);
        setFilter(FILTER_ALL);
        setQuery('');
        setSelectedId(null);
        setVisible(PAGE);
        setCountry(code);
    };

    const groupLabel = (group: string) => {
        const key = `streamflix.freeGroups.${group}`;
        const label = t(key);
        return label === key ? group : label;
    };

    const channels = useMemo(() => list?.channels ?? [], [list]);
    const counts = useMemo(() => {
        const map: Record<string, number> = {};
        for (const channel of channels) {
            for (const group of channel.groups) map[group] = (map[group] ?? 0) + 1;
        }
        return map;
    }, [channels]);
    const categories: CachedCategory[] = Object.keys(counts)
        .map((group) => ({ category_id: group, category_name: groupLabel(group), parent_id: 0, type: 'live' as const }))
        .sort((a, b) => a.category_name.localeCompare(b.category_name, locale));

    const folded = query.trim().toLowerCase();
    const filtered = channels.filter((channel) =>
        (filter === FILTER_ALL || channel.groups.indexOf(filter) !== -1)
        && (!folded || channel.name.toLowerCase().indexOf(folded) !== -1));
    const shown = filtered.slice(0, visible);
    const numbers = new Map<string, number>();
    channels.forEach((channel, index) => numbers.set(channel.id, index + 1));
    const selected = filtered.find((channel) => channel.id === selectedId) ?? filtered[0] ?? null;
    const contact = list?.contact ?? { label: '', url: '' };
    const activeCode = list?.country ?? country;
    const activeCountry = countries.find((entry) => entry.code === activeCode) ?? null;
    const nameOfCountry = countryNameFormatter(locale);
    const region = systemRegion();
    const suggested = [region, defaultCountry, activeCode].filter((code): code is string => Boolean(code));

    const focusedOnce = useRef(false);
    useEffect(() => {
        if (!list || focusedOnce.current) return;
        focusedOnce.current = true;
        document.querySelector<HTMLElement>('[data-initial-focus="true"]')?.focus();
    }, [list]);

    const changeFilter = (id: string) => {
        setFilter(id);
        setVisible(PAGE);
    };
    const changeQuery = (value: string) => {
        setQuery(value);
        setVisible(PAGE);
    };

    if (isLoading || isAuthenticated) {
        return <div className="min-h-screen bg-black" />;
    }

    const heading = filter === FILTER_ALL ? t('streamflix.allChannels') : groupLabel(filter);

    return (
        <div className="h-screen flex flex-col bg-[#141414] text-white">
            <header className="relative z-30 h-[72px] flex-shrink-0 flex items-center justify-between px-4 md:px-10 bg-black border-b border-[#222222]">
                <div className="flex items-center min-w-0 mr-3">
                    <Wordmark size="text-xl md:text-2xl" />
                    <div className="hidden md:flex items-center min-w-0 ml-4">
                        <span className="w-px h-6 bg-[#333333] mr-4" />
                        <span className={`${display} text-sm font-bold uppercase tracking-[0.12em] whitespace-nowrap`}>{t('streamflix.freeTitle')}</span>
                        <span className="ml-3 h-6 px-2.5 flex items-center rounded bg-[#E50914] text-[11px] font-extrabold tracking-[0.12em] uppercase">
                            {t('streamflix.freeBadge')}
                        </span>
                    </div>
                </div>
                <div className="flex items-center">
                    <div className="mr-2.5">
                        <CountryButton country={activeCountry} onClick={() => setPickerOpen(true)} />
                    </div>
                    <button
                        type="button"
                        data-focusable="true"
                        data-own-focus="true"
                        onClick={() => setUpgradeOpen(true)}
                        className={`${primaryButton} h-10 px-3 md:px-4 mr-2.5 flex items-center text-[13px] font-extrabold`}
                    >
                        <Lock size={16} className="md:mr-2" />
                        <span className="hidden md:inline">{t('streamflix.unlockAll')}</span>
                    </button>
                    <Link
                        href="/streamflix"
                        data-focusable="true"
                        data-own-focus="true"
                        className={`${ghostButton} h-10 px-3 md:px-4 flex items-center text-[13px]`}
                    >
                        <LogIn size={16} className="mr-2" />
                        {t('streamflix.signIn')}
                    </Link>
                </div>
            </header>

            <div className="flex-1 min-h-0 overflow-y-auto overflow-x-hidden md:overflow-hidden">
                <div className="flex flex-col md:flex-row md:h-full">
                    <CategorySidebar
                        query={query}
                        onQuery={changeQuery}
                        filter={filter}
                        onFilter={changeFilter}
                        categories={categories}
                        counts={counts}
                        total={channels.length}
                        recentCount={0}
                        favoriteCount={0}
                        variant="live"
                        showFavorites={false}
                    />

                    <section className="order-2 md:order-none md:flex-[35_1_0%] min-w-0 md:h-full flex flex-col border-r border-[#222222]">
                        <div className="flex-shrink-0 flex items-center justify-between bg-[#141414] px-5 py-[18px] border-b border-[#222222]">
                            <div className="min-w-0 mr-3">
                                <p className={`${display} text-xl font-extrabold truncate`}>{heading}</p>
                                <p className="mt-0.5 text-xs text-[#B3B3B3] truncate">
                                    {t('streamflix.channelCount', { n: filtered.length.toLocaleString(locale) })}
                                    {activeCountry ? ` · ${nameOfCountry(activeCountry)}` : ''}
                                </p>
                            </div>
                            <button
                                type="button"
                                data-focusable="true"
                                data-own-focus="true"
                                onClick={() => setPickerOpen(true)}
                                disabled={countries.length === 0}
                                className={`${ghostButton} h-9 px-3 flex-shrink-0 flex items-center text-[13px] disabled:opacity-50`}
                            >
                                <Globe size={16} className="mr-2" />
                                {t('streamflix.countryChange')}
                            </button>
                        </div>
                        <div className="flex-1 min-h-0 md:overflow-y-auto overflow-x-hidden">
                            {!list && !failed ? (
                                <p className="px-6 py-12 text-center text-sm text-[#B3B3B3]">{t('streamflix.loading')}</p>
                            ) : failed ? (
                                <p className="px-6 py-12 text-center text-sm text-[#E50914]">{t('streamflix.freeUnavailable')}</p>
                            ) : shown.length === 0 ? (
                                <div className="px-6 py-12 text-center">
                                    <p className="text-sm text-[#B3B3B3]">{t(channels.length ? 'streamflix.noChannels' : 'streamflix.countryEmpty')}</p>
                                    {!channels.length && countries.length > 0 && (
                                        <button
                                            type="button"
                                            data-focusable="true"
                                            data-own-focus="true"
                                            onClick={() => setPickerOpen(true)}
                                            className={`${primaryButton} mt-4 h-11 px-5 inline-flex items-center text-sm font-extrabold`}
                                        >
                                            <Globe size={16} className="mr-2" />
                                            {t('streamflix.countryChange')}
                                        </button>
                                    )}
                                </div>
                            ) : (
                                shown.map((channel) => {
                                    const active = selected?.id === channel.id;
                                    return (
                                        <button
                                            key={channel.id}
                                            type="button"
                                            data-focusable="true"
                                            data-own-focus="true"
                                            data-initial-focus={active ? 'true' : undefined}
                                            onClick={() => setSelectedId(channel.id)}
                                            className={[
                                                'relative w-full flex items-center py-3 pr-3 pl-5 border-b border-[#1C1C1C] text-left outline-none transition-colors duration-200',
                                                'hover:bg-[#2A2A2A] focus:bg-[#2A2A2A] focus:shadow-[inset_0_0_0_2px_#E50914]',
                                                active ? 'bg-[#2A2A2A]' : '',
                                            ].join(' ')}
                                        >
                                            {active && <span className="absolute left-0 top-0 bottom-0 w-1 bg-[#E50914]" />}
                                            <span className="w-8 flex-shrink-0 text-[13px] font-bold text-[#8C8C8C] tabular-nums">{numbers.get(channel.id)}</span>
                                            <ChannelLogo channel={channel} />
                                            <span className="flex-1 min-w-0 ml-[14px]">
                                                <span className="block text-[15px] font-bold truncate">{channel.name}</span>
                                                <span className="block mt-[5px] text-[13px] text-[#B3B3B3] truncate">
                                                    {channel.groups.map(groupLabel).join(' · ') || t('streamflix.liveTv')}
                                                </span>
                                            </span>
                                        </button>
                                    );
                                })
                            )}
                            {visible < filtered.length && (
                                <div className="p-4">
                                    <button
                                        type="button"
                                        data-focusable="true"
                                        data-own-focus="true"
                                        className={`${ghostButton} w-full h-11 text-sm`}
                                        onClick={() => setVisible((count) => count + PAGE)}
                                    >
                                        {t('streamflix.loadMore')}
                                    </button>
                                </div>
                            )}
                        </div>
                    </section>

                    <section className="order-1 md:order-none md:flex-[45_1_0%] min-w-0 md:h-full md:overflow-y-auto overflow-x-hidden px-4 pt-4 pb-6 md:px-7 md:pt-6 md:pb-10">
                        {selected && (
                            <>
                                <LivePreview
                                    key={selected.id}
                                    streamId={selected.id}
                                    src={freeStreamPath(selected.id)}
                                    number={numbers.get(selected.id) ?? 1}
                                    title={selected.name}
                                    poster={selected.logo}
                                    progress={0}
                                />
                                <div className="mt-6 bg-[#1F1F1F] border border-[#2A2A2A] rounded-lg p-5">
                                    <span className="text-[11px] font-extrabold tracking-[0.14em] uppercase text-[#E50914]">{t('streamflix.now')}</span>
                                    <p className={`${display} mt-3 text-[22px] font-extrabold leading-tight`}>{selected.name}</p>
                                    <p className="mt-3 text-sm leading-relaxed text-[#B3B3B3]">{t('streamflix.freeChannelNote')}</p>
                                </div>
                            </>
                        )}
                        <div className="mt-5">
                            <UpgradeCallout contact={contact} />
                        </div>
                        <p className="mt-4 text-xs text-[#8C8C8C]">{t('streamflix.freeSource')}</p>
                    </section>
                </div>
            </div>

            {pickerOpen && countries.length > 0 && (
                <CountryPicker
                    countries={countries}
                    current={activeCode}
                    suggested={suggested}
                    onSelect={pickCountry}
                    onClose={() => setPickerOpen(false)}
                />
            )}

            {upgradeOpen && (
                <div className="fixed top-0 right-0 bottom-0 left-0 z-[100] bg-[rgba(0,0,0,0.8)] flex items-center justify-center p-4" onClick={() => setUpgradeOpen(false)}>
                    <div
                        role="dialog"
                        aria-modal="true"
                        className="relative w-full max-w-[480px] bg-[#141414] border border-[#262626] rounded-lg p-7 md:p-9 shadow-[0_30px_80px_rgba(0,0,0,0.7)]"
                        onClick={(event) => event.stopPropagation()}
                    >
                        <button
                            type="button"
                            data-focusable="true"
                            data-own-focus="true"
                            aria-label={t('modal.close')}
                            onClick={() => setUpgradeOpen(false)}
                            className="absolute top-4 right-4 w-9 h-9 rounded-full flex items-center justify-center text-[#B3B3B3] outline-none hover:bg-[#2A2A2A] hover:text-white focus:shadow-[0_0_0_2px_#E50914]"
                        >
                            <X size={18} />
                        </button>
                        <UpgradeCallout contact={contact} compact />
                    </div>
                </div>
            )}
        </div>
    );
}
