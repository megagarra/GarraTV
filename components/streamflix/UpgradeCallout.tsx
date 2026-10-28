'use client';

import Link from 'next/link';
import { Clapperboard, Film, LogIn, MessageCircle, Tv } from 'lucide-react';
import { useT } from '@/app/context/I18nContext';
import type { FreeContact } from '@/app/lib/freeChannelsApi';
import { display, ghostButton, primaryButton } from './styles';

/** "Unlock everything" pitch for guests: what the full account adds and who to contact. */
export default function UpgradeCallout({ contact, compact }: { contact: FreeContact; compact?: boolean }) {
    const t = useT();
    const perks = [
        { icon: Tv, label: t('streamflix.upgradePerkLive') },
        { icon: Film, label: t('streamflix.upgradePerkMovies') },
        { icon: Clapperboard, label: t('streamflix.upgradePerkSeries') },
    ];

    return (
        <div className={compact ? '' : 'bg-[#1F1F1F] border border-[#2A2A2A] rounded-lg p-5 md:p-6'}>
            <p className="text-[11px] font-extrabold tracking-[0.14em] uppercase text-[#E50914]">{t('streamflix.upgradeKicker')}</p>
            <p className={`${display} mt-2 text-[22px] font-extrabold leading-tight`}>{t('streamflix.upgradeTitle')}</p>
            <ul className="mt-4 space-y-2">
                {perks.map(({ icon: Icon, label }) => (
                    <li key={label} className="flex items-center text-sm text-[#B3B3B3]">
                        <Icon size={18} className="mr-3 flex-shrink-0 text-white" />
                        {label}
                    </li>
                ))}
            </ul>
            <p className="mt-4 text-sm leading-relaxed text-[#B3B3B3]">
                {contact.label ? t('streamflix.upgradeContact', { contact: contact.label }) : t('streamflix.upgradeContactGeneric')}
            </p>
            <div className="mt-5 flex flex-wrap">
                {contact.url && (
                    <a
                        href={contact.url}
                        target="_blank"
                        rel="noreferrer"
                        data-focusable="true"
                        data-own-focus="true"
                        className={`${primaryButton} h-[46px] px-[22px] mr-3 mb-3 flex items-center text-sm font-extrabold tracking-[0.04em]`}
                    >
                        <MessageCircle size={18} className="mr-2.5" />
                        {t('streamflix.upgradeCta')}
                    </a>
                )}
                <Link
                    href="/streamflix"
                    data-focusable="true"
                    data-own-focus="true"
                    className={`${ghostButton} h-[46px] px-[22px] mb-3 flex items-center text-sm`}
                >
                    <LogIn size={18} className="mr-2.5" />
                    {t('streamflix.upgradeHaveAccess')}
                </Link>
            </div>
        </div>
    );
}
