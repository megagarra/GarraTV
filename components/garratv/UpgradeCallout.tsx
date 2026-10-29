'use client';

import { useT } from '@/app/context/I18nContext';
import type { FreeContact } from '@/app/lib/freeChannelsApi';

/**
 * "Unlock everything" note for guests: just who to contact. No buttons, so on a
 * TV the remote reads it on the way down and comes straight back up to the video.
 */
export default function UpgradeCallout({ contact, compact }: { contact: FreeContact; compact?: boolean }) {
    const t = useT();

    return (
        <div
            tabIndex={compact ? undefined : 0}
            data-focusable={compact ? undefined : 'true'}
            data-own-focus={compact ? undefined : 'true'}
            className={compact ? '' : 'bg-[#1F1F1F] border border-[#2A2A2A] rounded-lg p-5 md:p-6 outline-none transition-colors duration-200 focus:border-[#E50914]'}
        >
            <p className="text-[11px] font-extrabold tracking-[0.14em] uppercase text-[#E50914]">{t('garratv.upgradeKicker')}</p>
            <p className="mt-3 text-sm leading-relaxed text-[#B3B3B3]">
                {contact.label ? t('garratv.upgradeContact', { contact: contact.label }) : t('garratv.upgradeContactGeneric')}
            </p>
        </div>
    );
}
