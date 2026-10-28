'use client';

import { useEffect, useRef, useState } from 'react';
import { useI18n, useT } from '@/app/context/I18nContext';
import type { ContentType } from '@/app/lib/dbTypes';
import type { SortOption } from '@/app/lib/catalogSort';
import { useSortPreference } from '@/app/hooks/useSortPreference';
import Shell from '@/components/streamflix/Shell';
import CategorySidebar from '@/components/streamflix/CategorySidebar';
import PosterTile from '@/components/streamflix/PosterTile';
import { FILTER_ALL, FILTER_FAVORITES, FILTER_RECENT, useCatalogData } from '@/components/streamflix/useCatalogData';
import { display, ghostButton, segmentButton, segmented } from '@/components/streamflix/styles';

const SORTS: SortOption[] = ['name-asc', 'added', 'rating'];
const PAGE = 60;

export default function CatalogScreen({ type }: { type: Extract<ContentType, 'movie' | 'series'> }) {
    const t = useT();
    const { locale } = useI18n();
    const [filter, setFilter] = useState(FILTER_ALL);
    const [query, setQuery] = useState('');
    const [storedSort, setSort] = useSortPreference(`streamflix_${type}`, 'name-asc');
    const sort = SORTS.indexOf(storedSort) === -1 ? 'name-asc' : storedSort;
    const [visible, setVisible] = useState(PAGE);
    const data = useCatalogData(type, filter, query, sort);
    const scrollRef = useRef<HTMLElement>(null);

    useEffect(() => {
        // scrollTop, not Element.scrollTo (Chrome 61).
        if (scrollRef.current) scrollRef.current.scrollTop = 0;
    }, [type, filter, query, sort]);

    const changeFilter = (id: string) => {
        setFilter(id);
        setVisible(PAGE);
    };
    const changeQuery = (value: string) => {
        setQuery(value);
        setVisible(PAGE);
    };
    const changeSort = (option: SortOption) => {
        setSort(option);
        setVisible(PAGE);
    };

    const focusedOnce = useRef(false);
    useEffect(() => {
        if (data.loading || focusedOnce.current) return;
        focusedOnce.current = true;
        document.querySelector<HTMLElement>('[data-initial-focus="true"]')?.focus();
    }, [data.loading]);

    const sectionName = t(type === 'movie' ? 'streamflix.movies' : 'streamflix.series');
    const categoryName = data.categories.find((category) => category.category_id === filter)?.category_name;
    const heading = filter === FILTER_ALL
        ? t('streamflix.all')
        : filter === FILTER_FAVORITES
            ? t('streamflix.favorites')
            : filter === FILTER_RECENT
                ? t('streamflix.recent')
                : (categoryName || sectionName);

    const shown = data.items.slice(0, visible);
    const moreInMemory = visible < data.items.length;
    const sortLabel: Record<string, string> = {
        'name-asc': t('streamflix.sortAz'),
        added: t('streamflix.sortRecent'),
        rating: t('streamflix.sortRating'),
    };

    return (
        <Shell title={sectionName} backHref="/streamflix/home" fill>
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
                    variant="vod"
                />
                <section ref={scrollRef} className="md:flex-[80_1_0%] min-w-0 md:h-full md:overflow-y-auto overflow-x-hidden px-4 pt-5 pb-12 md:px-9 md:pt-7">
                    <div className="flex flex-wrap items-center justify-between mb-7">
                        <div className="flex items-baseline min-w-0 mr-4 mb-2">
                            <h1 className={`${display} text-[28px] font-extrabold truncate`}>{heading}</h1>
                            <span className="ml-3 text-sm text-[#B3B3B3] whitespace-nowrap">
                                {t('streamflix.titleCount', { n: data.itemCount.toLocaleString(locale) })}
                            </span>
                        </div>
                        <div className="flex items-center mb-2">
                            <span className="hidden sm:inline mr-2.5 text-[13px] text-[#B3B3B3]">{t('streamflix.sortBy')}</span>
                            <div className={segmented} role="group" aria-label={t('streamflix.sortBy')}>
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

                    {data.loading && shown.length === 0 ? (
                        <p className="py-16 text-center text-sm text-[#B3B3B3]">{t('streamflix.loading')}</p>
                    ) : data.error ? (
                        <p className="py-16 text-center text-sm text-[#E50914]">{t(data.error)}</p>
                    ) : shown.length === 0 ? (
                        <p className="py-16 text-center text-sm text-[#B3B3B3]">{t('streamflix.noTitles')}</p>
                    ) : (
                        // Flex-wrap columns instead of CSS grid: grid needs Chrome 57.
                        <div className="flex flex-wrap -mx-2.5">
                            {shown.map((item, index) => (
                                <div key={item.id} className="w-1/3 sm:w-1/4 lg:w-1/5 xl:w-1/6 2xl:w-[14.285%] px-2.5 pb-7">
                                    <PosterTile
                                        href={`/streamflix/title/${type}/${item.id}`}
                                        title={item.name}
                                        image={item.image}
                                        year={item.year}
                                        genre={item.genre}
                                        rating={item.rating}
                                        initialFocus={index === 0}
                                    />
                                </div>
                            ))}
                        </div>
                    )}

                    {(moreInMemory || data.hasMore) && (
                        <div className="flex justify-center mt-2">
                            <button
                                type="button"
                                data-focusable="true"
                                data-own-focus="true"
                                className={`${ghostButton} h-11 px-8 text-sm`}
                                onClick={() => {
                                    if (moreInMemory) setVisible((count) => count + PAGE);
                                    else data.loadMore();
                                }}
                            >
                                {t('streamflix.loadMore')}
                            </button>
                        </div>
                    )}
                </section>
            </div>
        </Shell>
    );
}
