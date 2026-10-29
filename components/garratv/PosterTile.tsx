'use client';

import { memo, useState } from 'react';
import Link from 'next/link';
import { Star } from 'lucide-react';
import { formatRating } from '@/app/lib/formatRating';
import { favoriteTargetProps, type FavoriteType } from '@/app/lib/favoriteTarget';
import LazyImage from './LazyImage';
import { sizedImage } from './images';
import { display, focusPoster, placeholderGradient, progressWidth } from './styles';

interface PosterTileProps {
    href: string;
    title: string;
    image?: string;
    year?: number;
    genre?: string;
    rating?: number;
    /** Red corner badge, e.g. the season count on series. */
    tag?: string;
    /** 0..1 watched ratio, drawn along the bottom edge. */
    progress?: number;
    initialFocus?: boolean;
    /** Makes holding OK on the tile toggle this favorite (components/RemoteFavorites.tsx). */
    favoriteType?: FavoriteType;
    favoriteId?: string | number;
}

function PosterTile({ href, title, image, year, genre, rating, tag, progress, initialFocus, favoriteType, favoriteId }: PosterTileProps) {
    const [failed, setFailed] = useState(false);
    const score = formatRating(rating);
    const showImage = Boolean(image) && !failed;
    const meta = [year ? String(year) : '', genre ? genre.split(/[,/]/)[0].trim() : ''].filter(Boolean).join(' · ');

    return (
        <div className="min-w-0">
            <Link
                href={href}
                aria-label={title}
                data-focusable="true"
                data-own-focus="true"
                data-initial-focus={initialFocus ? 'true' : undefined}
                {...(favoriteType && favoriteId !== undefined ? favoriteTargetProps(favoriteType, favoriteId, title, image, rating) : {})}
                tabIndex={0}
                className={`${focusPoster} relative block rounded-md overflow-hidden`}
                style={showImage ? undefined : { background: placeholderGradient(title) }}
            >
                <div className="ratio ratio-poster">
                    <div className="ratio-fill">
                        {showImage ? (
                            <LazyImage
                                src={sizedImage(image, 'poster') ?? ''}
                                className="w-full h-full object-cover"
                                onError={() => setFailed(true)}
                            />
                        ) : (
                            <span
                                className={`${display} absolute left-3 right-3 bottom-[14px] text-base font-black uppercase leading-[1.05]`}
                                style={{ textShadow: '0 2px 10px rgba(0,0,0,0.5)' }}
                            >
                                {title}
                            </span>
                        )}
                        {score && (
                            <span className="absolute top-2 right-2 h-[22px] px-[7px] flex items-center rounded bg-[rgba(0,0,0,0.72)] text-xs font-extrabold">
                                <Star size={12} className="text-[#F5C451] mr-1" fill="currentColor" strokeWidth={0} />
                                {score}
                            </span>
                        )}
                        {tag && (
                            <span className="absolute top-2 left-2 h-[22px] px-[7px] flex items-center rounded bg-[#E50914] text-[11px] font-extrabold">
                                {tag}
                            </span>
                        )}
                        {progress !== undefined && progress > 0 && (
                            <span className="absolute left-0 right-0 bottom-0 h-[3px] bg-[rgba(255,255,255,0.25)]">
                                <span className="block h-full bg-[#E50914]" style={progressWidth(progress)} />
                            </span>
                        )}
                    </div>
                </div>
            </Link>
            <div className="mt-2.5 px-0.5 min-w-0">
                <p className="text-sm font-bold truncate">{title}</p>
                {meta && <p className="mt-0.5 text-xs text-[#B3B3B3] truncate">{meta}</p>}
            </div>
        </div>
    );
}

// Grids re-render on every filter, sort and page; unchanged tiles skip it.
export default memo(PosterTile);
