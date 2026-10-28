'use client';

import { useMemo } from 'react';
import { useFavorites } from '@/app/context/FavoritesContext';
import { useT } from '@/app/context/I18nContext';
import Shell from '@/components/streamflix/Shell';
import PosterTile from '@/components/streamflix/PosterTile';
import { display } from '@/components/streamflix/styles';

export default function StreamflixFavoritesPage() {
    const t = useT();
    const { favorites, isLoaded } = useFavorites();

    const groups = useMemo(() => ({
        live: favorites.filter((item) => item.type === 'live'),
        movie: favorites.filter((item) => item.type === 'movie'),
        series: favorites.filter((item) => item.type === 'series'),
    }), [favorites]);

    const hrefFor = (type: 'live' | 'movie' | 'series', id: string | number) => {
        if (type === 'live') return `/streamflix/live?channel=${encodeURIComponent(String(id))}`;
        return `/streamflix/title/${type}/${id}`;
    };

    return (
        <Shell title={t('streamflix.favorites')} backHref="/streamflix/home">
            <div className="px-4 md:px-9 pt-7 pb-12">
                <h1 className={`${display} text-[28px] font-extrabold mb-7`}>{t('streamflix.favorites')}</h1>
                {!isLoaded ? (
                    <p className="text-sm text-[#B3B3B3]">{t('streamflix.loading')}</p>
                ) : favorites.length === 0 ? (
                    <p className="py-16 text-center text-sm text-[#B3B3B3]">{t('streamflix.noFavorites')}</p>
                ) : (
                    (['live', 'movie', 'series'] as const).filter((type) => groups[type].length > 0).map((type, sectionIndex) => (
                        <section key={type} className="mb-10">
                            <h2 className={`${display} text-xl font-extrabold mb-5`}>
                                {t(type === 'live' ? 'streamflix.liveTv' : type === 'movie' ? 'streamflix.movies' : 'streamflix.series')}
                            </h2>
                            <div className="flex flex-wrap -mx-2.5">
                                {groups[type].map((item, index) => (
                                    <div key={`${item.type}-${item.id}`} className="w-1/3 sm:w-1/4 lg:w-1/6 xl:w-[12.5%] px-2.5 pb-7">
                                        <PosterTile
                                            href={hrefFor(item.type, item.id)}
                                            title={item.name}
                                            image={item.image}
                                            rating={item.rating ? Number(item.rating) : undefined}
                                            initialFocus={sectionIndex === 0 && index === 0}
                                        />
                                    </div>
                                ))}
                            </div>
                        </section>
                    ))
                )}
            </div>
        </Shell>
    );
}
