'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Check, ChevronDown, Globe, Search, X } from 'lucide-react';
import { useI18n, useT } from '@/app/context/I18nContext';
import { useNavigationOverride } from '@/app/context/NavigationContext';
import { countryNameFormatter, flagUrl, type FreeCountry } from '@/app/lib/freeChannelsApi';
import { display, searchField } from './styles';

function Flag({ code, className }: { code: string; className: string }) {
    const [failed, setFailed] = useState(false);
    if (failed) {
        return (
            <span className={`${className} flex items-center justify-center bg-[#333333] text-[10px] font-extrabold uppercase`}>
                {code}
            </span>
        );
    }
    return <img src={flagUrl(code)} alt="" loading="lazy" className={`${className} object-cover`} onError={() => setFailed(true)} />;
}

interface CountryButtonProps {
    country: FreeCountry | null;
    onClick: () => void;
}

/** Header pill showing the current country; opens the picker. */
export function CountryButton({ country, onClick }: CountryButtonProps) {
    const t = useT();
    const { locale } = useI18n();
    const nameOf = useMemo(() => countryNameFormatter(locale), [locale]);

    return (
        <button
            type="button"
            data-focusable="true"
            data-own-focus="true"
            onClick={onClick}
            aria-label={t('garratv.countryChange')}
            className="h-10 pl-2 pr-2.5 md:pr-3 flex items-center rounded-full bg-[#1F1F1F] border border-[#333333] text-sm font-bold outline-none transition-colors duration-200 hover:border-[#E50914] hover:bg-[#2A2A2A] focus:border-[#E50914] focus:shadow-[0_0_0_2px_#E50914]"
        >
            {country ? (
                <Flag code={country.code} className="w-7 h-5 rounded-sm flex-shrink-0" />
            ) : (
                <Globe size={20} className="flex-shrink-0" />
            )}
            <span className="hidden sm:inline ml-2 max-w-[160px] truncate">{country ? nameOf(country) : t('garratv.countryPick')}</span>
            <ChevronDown size={16} className="ml-1.5 flex-shrink-0 text-[#B3B3B3]" />
        </button>
    );
}

interface CountryPickerProps {
    countries: FreeCountry[];
    current: string | null;
    /** Shown first: the visitor's own region and the server default. */
    suggested: string[];
    onSelect: (code: string) => void;
    onClose: () => void;
}

/** Full-screen, searchable country grid, navigable with a remote's arrows. */
export default function CountryPicker({ countries, current, suggested, onSelect, onClose }: CountryPickerProps) {
    const t = useT();
    const { locale } = useI18n();
    const [query, setQuery] = useState('');
    const searchRef = useRef<HTMLInputElement>(null);
    const nameOf = useMemo(() => countryNameFormatter(locale), [locale]);

    const close = useCallback(() => onClose(), [onClose]);
    useNavigationOverride(close);

    useEffect(() => {
        const onKey = (event: KeyboardEvent) => {
            if (event.key === 'Escape') onClose();
        };
        window.addEventListener('keydown', onKey);
        // The current country is the natural starting point for the remote;
        // the search box is one press up.
        const active = document.querySelector<HTMLElement>('[data-country-current="true"]');
        (active ?? searchRef.current)?.focus();
        return () => window.removeEventListener('keydown', onKey);
    }, [onClose]);

    const named = useMemo(
        () => countries
            .map((country) => ({ country, label: nameOf(country) }))
            .sort((a, b) => a.label.localeCompare(b.label, locale)),
        [countries, nameOf, locale],
    );

    const folded = query.trim().toLowerCase();
    const matches = folded
        ? named.filter(({ country, label }) =>
            label.toLowerCase().indexOf(folded) !== -1
            || country.name.toLowerCase().indexOf(folded) !== -1
            || country.code === folded)
        : named;
    const suggestions = folded
        ? []
        : suggested
            .filter((code, index) => suggested.indexOf(code) === index)
            .map((code) => named.find(({ country }) => country.code === code))
            .filter((entry): entry is { country: FreeCountry; label: string } => entry !== undefined);

    const tile = (country: FreeCountry, label: string, key: string) => {
        const active = country.code === current;
        return (
            <div key={key} className="w-1/2 sm:w-1/3 lg:w-1/4 xl:w-1/5 p-1.5">
                <button
                    type="button"
                    data-focusable="true"
                    data-own-focus="true"
                    data-country-current={active && key.indexOf('all-') === 0 ? 'true' : undefined}
                    onClick={() => onSelect(country.code)}
                    className={[
                        'w-full h-14 px-3 flex items-center rounded-lg border-2 text-left outline-none transition duration-200',
                        'hover:border-[#E50914] hover:bg-[#2A2A2A] focus:border-[#E50914] focus:bg-[#2A2A2A] focus:scale-[1.04]',
                        active ? 'bg-[#2A2A2A] border-[#E50914]' : 'bg-[#1F1F1F] border-transparent',
                    ].join(' ')}
                >
                    <Flag code={country.code} className="w-9 h-6 rounded-sm flex-shrink-0" />
                    <span className="flex-1 min-w-0 ml-3 text-sm font-bold truncate">{label}</span>
                    {active && <Check size={18} className="ml-2 flex-shrink-0 text-[#E50914]" />}
                </button>
            </div>
        );
    };

    return (
        <div
            className="fixed top-0 right-0 bottom-0 left-0 z-[100] bg-[rgba(0,0,0,0.85)] flex items-stretch md:items-center justify-center md:p-8"
            onClick={onClose}
        >
            <div
                role="dialog"
                aria-modal="true"
                aria-label={t('garratv.countryTitle')}
                className="relative w-full max-w-[1100px] md:max-h-[86vh] flex flex-col bg-[#141414] md:border md:border-[#262626] md:rounded-lg shadow-[0_30px_80px_rgba(0,0,0,0.7)]"
                onClick={(event) => event.stopPropagation()}
            >
                <div className="flex-shrink-0 px-5 pt-6 pb-4 md:px-8 md:pt-8 border-b border-[#222222]">
                    <div className="flex items-start justify-between">
                        <div className="mr-4">
                            <p className={`${display} text-[26px] font-extrabold leading-tight`}>{t('garratv.countryTitle')}</p>
                            <p className="mt-1 text-sm text-[#B3B3B3]">{t('garratv.countrySubtitle', { n: countries.length })}</p>
                        </div>
                        <button
                            type="button"
                            data-focusable="true"
                            data-own-focus="true"
                            aria-label={t('modal.close')}
                            onClick={onClose}
                            className="w-10 h-10 flex-shrink-0 rounded-full bg-[#1F1F1F] border border-[#333333] flex items-center justify-center outline-none hover:border-[#E50914] focus:border-[#E50914] focus:shadow-[0_0_0_2px_#E50914]"
                        >
                            <X size={18} />
                        </button>
                    </div>
                    <div className="relative mt-4">
                        <Search size={18} className="absolute left-[14px] top-[13px] text-[#8C8C8C] pointer-events-none" />
                        <input
                            ref={searchRef}
                            value={query}
                            onChange={(event) => setQuery(event.target.value)}
                            placeholder={t('garratv.countrySearch')}
                            aria-label={t('garratv.countrySearch')}
                            className={searchField}
                            data-focusable="true"
                            data-own-focus="true"
                        />
                    </div>
                </div>

                <div className="flex-1 min-h-0 overflow-y-auto px-3.5 py-4 md:px-6 md:py-6">
                    {suggestions.length > 0 && (
                        <>
                            <p className="px-1.5 mb-1 text-[11px] font-extrabold tracking-[0.14em] uppercase text-[#B3B3B3]">{t('garratv.countrySuggested')}</p>
                            <div className="flex flex-wrap mb-4">
                                {suggestions.map(({ country, label }) => tile(country, label, `suggested-${country.code}`))}
                            </div>
                            <p className="px-1.5 mb-1 text-[11px] font-extrabold tracking-[0.14em] uppercase text-[#B3B3B3]">{t('garratv.countryAll')}</p>
                        </>
                    )}
                    {matches.length === 0 ? (
                        <p className="py-12 text-center text-sm text-[#B3B3B3]">{t('garratv.countryNone')}</p>
                    ) : (
                        <div className="flex flex-wrap">
                            {matches.map(({ country, label }) => tile(country, label, `all-${country.code}`))}
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
}
