'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Clapperboard, Film, Heart, House, Search, Settings, Tv } from 'lucide-react';
import { useT } from '@/app/context/I18nContext';
import { display } from './styles';

/**
 * Phone-on-its-side navigation: a 56px column on the left instead of the 72px
 * header, which a 360–430px-tall screen cannot spare. Only shown by the
 * `phone:` variant; on every other screen it is display: none.
 */
export default function PhoneRail() {
    const t = useT();
    const pathname = usePathname() ?? '';

    const items = [
        { href: '/garratv/home', label: t('nav.home'), icon: House },
        { href: '/garratv/live', label: t('garratv.liveTv'), icon: Tv },
        { href: '/garratv/movies', label: t('garratv.movies'), icon: Film },
        { href: '/garratv/series', label: t('garratv.series'), icon: Clapperboard },
        { href: '/dashboard/search', label: t('garratv.search'), icon: Search },
        { href: '/garratv/favorites', label: t('garratv.favorites'), icon: Heart },
    ];

    const link = (href: string, label: string, Icon: typeof Tv) => {
        const active = pathname.indexOf(href) === 0;
        return (
            <Link
                key={href}
                href={href}
                aria-label={label}
                aria-current={active ? 'page' : undefined}
                className={[
                    'relative w-11 h-11 mb-1 flex flex-shrink-0 items-center justify-center rounded-[10px] outline-none transition-colors duration-200 focus:shadow-[0_0_0_2px_#E50914]',
                    active ? 'bg-[#2A2A2A] text-white' : 'text-[#B3B3B3] hover:text-white',
                ].join(' ')}
            >
                {active && <span className="absolute -left-1.5 top-2.5 bottom-2.5 w-[3px] rounded-sm bg-[#E50914]" />}
                <Icon size={20} />
            </Link>
        );
    };

    return (
        <nav
            aria-label={t('garratv.navigation')}
            className="hidden phone:flex w-14 flex-shrink-0 flex-col items-center py-2 bg-black border-r border-[#222222] overflow-y-auto"
        >
            <span className={`${display} h-8 mb-1 flex flex-shrink-0 items-center text-[22px] font-black text-[#E50914]`} aria-hidden="true">G</span>
            {items.map(({ href, label, icon }) => link(href, label, icon))}
            <span className="flex-1" />
            {link('/dashboard/settings', t('nav.settings'), Settings)}
        </nav>
    );
}
