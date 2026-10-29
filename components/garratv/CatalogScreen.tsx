'use client';

import { useEffect, useRef, useState } from 'react';
import { useI18n, useT } from '@/app/context/I18nContext';
import type { ContentType } from '@/app/lib/dbTypes';
import type { SortOption } from '@/app/lib/catalogSort';
import { useWindowedRows } from '@/app/hooks/useWindowedRows';
import { useSortPreference } from '@/app/hooks/useSortPreference';
import Shell from '@/components/garratv/Shell';
import CategorySidebar from '@/components/garratv/CategorySidebar';
import PosterTile from '@/components/garratv/PosterTile';
import { FILTER_ALL, FILTER_FAVORITES, FILTER_RECENT, useCatalogData } from '@/components/garratv/useCatalogData';
import { PosterGridSkeleton, SidebarSkeleton } from '@/components/garratv/Skeletons';
import { display, segmentButton, segmented } from '@/components/garratv/styles';

const SORTS: SortOption[] = ['name-asc', 'added', 'rating'];

export default function CatalogScreen({ type }: { type: Extract<ContentType, 'movie' | 'series'> }) {
    const t = useT();
    const { locale } = useI18n();
    const [filter, setFilter] = useState(FILTER_ALL);
    const [query, setQuery] = useState('');
    const [storedSort, setSort] = useSortPreference(`garratv_${type}`, 'name-asc');
    const sort = SORTS.indexOf(storedSort) === -1 ? 'name-asc' : storedSort;
    const data = useCatalogData(type, filter, query, sort);
    // Only the rows on screen (plus one screen of slack) are in the DOM; the
    // next server page is requested as the window nears the loaded end.
    const { containerRef: gridRef, start: windowStart, end: windowEnd, topSpace, bottomSpace } = useWindowedRows({
        itemCount: data.items.length,
        onNearEnd: data.loadMore,
        resetKey: `${type}|${filter}|${query}|${sort}`,
    });
    const visibleItems = data.items.slice(windowStart, windowEnd);
    const scrollRef = useRef<HTMLElement>(null);

    useEffect(() => {
        // scrollTop, not Element.scrollTo (Chrome 61).
        if (scrollRef.current) scrollRef.current.scrollTop = 0;
    }, [type, filter, query, sort]);

    const changeSort = (option: SortOption) => setSort(option);

    const focusedOnce = useRef(false);
    useEffect(() => {
        if (data.loading || focusedOnce.current) return;
        focusedOnce.current = true;
        document.querySelector<HTMLElement>('[data-initial-focus="true"]')?.focus();
    }, [data.loading]);

    const sectionName = t(type === 'movie' ? 'garratv.movies' : 'garratv.series');
    const categoryName = data.categories.find((category) => category.category_id === filter)?.category_name;
    const heading = filter === FILTER_ALL
        ? t('garratv.all')
        : filter === FILTER_FAVORITES
            ? t('garratv.favorites')
            : filter === FILTER_RECENT
                ? t('garratv.recent')
                : (categoryName || sectionName);

    const sortLabel: Record<string, string> = {
        'name-asc': t('garratv.sortAz'),
        added: t('garratv.sortRecent'),
        rating: t('garratv.sortRating'),
    };

    // First open: the final layout in placeholder form until categories and the
    // first page are both in, never a half-filled screen.
    if (data.loading && data.categories.length === 0) {
        return (
            <Shell title={sectionName} backHref="/garratv/home" fill>
                <div className="flex flex-col md:flex-row md:h-full phone:flex-col phone:h-full">
                    <SidebarSkeleton />
                    <section className="md:flex-[80_1_0%] min-w-0 md:h-full overflow-hidden px-4 pt-5 md:px-9 md:pt-7 phone:px-4 phone:pt-3">
                        <div className="h-8 w-56 mb-7 bg-[#1F1F1F] rounded animate-pulse" />
                        <PosterGridSkeleton />
                    </section>
                </div>
            </Shell>
        );
    }

    if (data.error) {
        return (
            <Shell title={sectionName} backHref="/garratv/home" fill>
                <p className="py-16 text-center text-sm text-[#E50914]">{t(data.error)}</p>
            </Shell>
        );
    }

    return (
        <Shell title={sectionName} backHref="/garratv/home" fill>
            <div className="flex flex-col md:flex-row md:h-full phone:flex-col phone:h-full">
                <CategorySidebar
                    query={query}
                    onQuery={setQuery}
                    filter={filter}
                    onFilter={setFilter}
                    categories={data.categories}
                    counts={data.counts}
                    total={data.total}
                    recentCount={data.recentCount}
                    favoriteCount={data.favoriteCount}
                    variant="vod"
                />
                <section ref={scrollRef} className="md:flex-[80_1_0%] min-w-0 md:h-full md:overflow-y-auto overflow-x-hidden px-4 pt-5 pb-12 md:px-9 md:pt-7 phone:flex-1 phone:min-h-0 phone:h-auto phone:overflow-y-auto phone:px-4 phone:pt-3 phone:pb-6">
                    <div className="flex flex-wrap items-center justify-between mb-7 short:mb-4 phone:mb-1">
                        <div className="flex items-baseline min-w-0 mr-4 mb-2">
                            <h1 className={`${display} text-[28px] short:text-2xl phone:text-xl font-extrabold truncate`}>{heading}</h1>
                            <span className="ml-3 text-sm text-[#B3B3B3] whitespace-nowrap">
                                {t('garratv.titleCount', { n: data.itemCount.toLocaleString(locale) })}
                            </span>
                        </div>
                        <div className="flex items-center mb-2">
                            <span className="hidden sm:inline phone:hidden mr-2.5 text-[13px] text-[#B3B3B3]">{t('garratv.sortBy')}</span>
                            <div className={segmented} role="group" aria-label={t('garratv.sortBy')}>
                                {SORTS.map((option, index) => (
                                    <button
                                        key={option}
                                        type="button"
                                        data-focusable="true"
                                        data-own-focus="true"
                                        aria-pressed={sort === option}
                                        onClick={() => changeSort(option)}
                                        className={`${segmentButton(sort === option)} h-8 px-3 text-[13px] font-bold whitespace-nowrap ${index ? 'ml-0.5' : ''} ${sort === option ? '!bg-[#2A2A2A]' : ''}`}
                                    >
                                        {sortLabel[option]}
                                    </button>
                                ))}
                            </div>
                        </div>
                    </div>

                    {data.loading ? (
                        <PosterGridSkeleton />
                    ) : data.items.length === 0 ? (
                        <p className="py-16 text-center text-sm text-[#B3B3B3]">{t('garratv.noTitles')}</p>
                    ) : (
                        // Flex-wrap columns instead of CSS grid: grid needs Chrome 57.
                        <div ref={gridRef} className="flex flex-wrap -mx-2.5 phone:-mx-1.5">
                            {topSpace > 0 && <div className="w-full" style={{ height: topSpace }} />}
                            {visibleItems.map((item, index) => (
                                <div key={item.id} data-window-cell className="w-1/3 sm:w-1/4 lg:w-1/5 xl:w-1/6 2xl:w-[14.285%] px-2.5 pb-7 phone:w-[14.285%] phone:px-1.5 phone:pb-4">
                                    <PosterTile
                                        href={`/garratv/title/${type}/${item.id}`}
                                        title={item.name}
                                        image={item.image}
                                        year={item.year}
                                        genre={item.genre}
                                        rating={item.rating}
                                        initialFocus={windowStart + index === 0}
                                        favoriteType={type}
                                        favoriteId={item.id}
                                    />
                                </div>
                            ))}
                            {bottomSpace > 0 && <div className="w-full" style={{ height: bottomSpace }} />}
                        </div>
                    )}

                    {data.loadingMore && <PosterGridSkeleton count={6} />}
                </section>
            </div>
        </Shell>
    );
}
