'use client';

import { Clock, Heart, Search, Star } from 'lucide-react';
import type { CachedCategory } from '@/app/lib/dbTypes';
import { useT } from '@/app/context/I18nContext';
import { FILTER_ALL, FILTER_FAVORITES, FILTER_RECENT } from './useCatalogData';
import { searchField } from './styles';

interface CategorySidebarProps {
    query: string;
    onQuery: (value: string) => void;
    filter: string;
    onFilter: (id: string) => void;
    categories: CachedCategory[];
    counts: Record<string, number>;
    total: number;
    recentCount: number;
    favoriteCount: number;
    /** Live TV marks favorites with a star and has no "recently added" entry. */
    variant: 'live' | 'vod';
    /** Guests have no profile, hence no favorites. */
    showFavorites?: boolean;
}

interface Entry {
    id: string;
    label: string;
    count?: number;
    icon?: typeof Star;
    dividerBefore?: boolean;
}

export default function CategorySidebar({
    query,
    onQuery,
    filter,
    onFilter,
    categories,
    counts,
    total,
    recentCount,
    favoriteCount,
    variant,
    showFavorites = true,
}: CategorySidebarProps) {
    const t = useT();

    const entries: Entry[] = [{ id: FILTER_ALL, label: t('streamflix.all'), count: total }];
    if (variant === 'vod') {
        entries.push({ id: FILTER_RECENT, label: t('streamflix.recent'), count: recentCount, icon: Clock });
    }
    if (showFavorites) {
        entries.push({
            id: FILTER_FAVORITES,
            label: t('streamflix.favorites'),
            count: favoriteCount,
            icon: variant === 'live' ? Star : Heart,
        });
    }
    categories.forEach((category, index) => {
        entries.push({
            id: category.category_id,
            label: category.category_name,
            count: counts[category.category_id] ?? 0,
            dividerBefore: index === 0,
        });
    });

    const search = (
        <div className="relative">
            <Search size={18} className="absolute left-[14px] top-[13px] text-[#8C8C8C] pointer-events-none" />
            <input
                value={query}
                onChange={(event) => onQuery(event.target.value)}
                placeholder={t(variant === 'live' ? 'streamflix.searchChannels' : 'streamflix.searchTitles')}
                aria-label={t('streamflix.search')}
                className={searchField}
                data-focusable="true"
                data-own-focus="true"
            />
        </div>
    );

    return (
        <>
            {/* Desktop / TV: fixed-width column with its own scroll. */}
            <aside className="hidden md:block md:flex-[20_1_0%] md:min-w-[240px] h-full overflow-y-auto overflow-x-hidden bg-black border-r border-[#222222] px-3 py-5">
                {search}
                <div className="mt-4">
                    {entries.map((entry) => {
                        const active = entry.id === filter;
                        const Icon = entry.icon;
                        return (
                            <div key={entry.id}>
                                {entry.dividerBefore && <div className="h-px bg-[#222222] mx-1.5 my-2" />}
                                <button
                                    type="button"
                                    data-focusable="true"
                                    data-own-focus="true"
                                    tabIndex={0}
                                    onClick={() => onFilter(entry.id)}
                                    className={[
                                        'relative w-full h-11 mb-0.5 flex items-center pl-[18px] pr-[14px] rounded text-sm text-left outline-none transition-colors duration-200',
                                        'hover:bg-[#2A2A2A] hover:text-white focus:bg-[#2A2A2A] focus:text-white focus:shadow-[inset_0_0_0_2px_#E50914]',
                                        active ? 'bg-[#2A2A2A] text-white font-bold' : 'text-[#B3B3B3] font-medium',
                                    ].join(' ')}
                                >
                                    {active && <span className="absolute left-0 top-2 bottom-2 w-1 rounded-r-sm bg-[#E50914]" />}
                                    {Icon && <Icon size={16} className="flex-shrink-0 mr-2.5" />}
                                    <span className="flex-1 min-w-0 truncate">{entry.label}</span>
                                    {entry.count !== undefined && (
                                        <span className="ml-2.5 text-xs font-normal text-[#8C8C8C] tabular-nums">{entry.count}</span>
                                    )}
                                </button>
                            </div>
                        );
                    })}
                </div>
            </aside>

            {/* Mobile: search plus horizontally scrolling chips. */}
            <div className="md:hidden bg-black border-b border-[#222222] px-4 py-3">
                {search}
                <div className="flex overflow-x-auto -mx-4 px-4 mt-3 pb-1">
                    {entries.map((entry) => {
                        const active = entry.id === filter;
                        return (
                            <button
                                key={entry.id}
                                type="button"
                                data-focusable="true"
                                data-own-focus="true"
                                tabIndex={0}
                                onClick={() => onFilter(entry.id)}
                                className={[
                                    'flex-shrink-0 h-9 px-[14px] mr-2 rounded-[18px] border text-[13px] font-bold whitespace-nowrap flex items-center outline-none transition-colors duration-200 focus:shadow-[0_0_0_2px_#ffffff]',
                                    active ? 'bg-[#E50914] border-[#E50914]' : 'bg-[#1F1F1F] border-[#333333]',
                                ].join(' ')}
                            >
                                {entry.label}
                                {entry.count !== undefined && <span className="ml-1.5 opacity-70 text-xs font-medium">{entry.count}</span>}
                            </button>
                        );
                    })}
                </div>
            </div>
        </>
    );
}
