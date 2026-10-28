'use client';

import { useT } from '@/app/context/I18nContext';
import AccountSection from '@/components/settings/AccountSection';
import CatalogSection from '@/components/settings/CatalogSection';
import LanguageSection from '@/components/settings/LanguageSection';
import ProfilesSection from '@/components/settings/ProfilesSection';
import SubtitlesSection from '@/components/settings/SubtitlesSection';
import TmdbSection from '@/components/settings/TmdbSection';
import FreeTierSection from '@/components/settings/FreeTierSection';
import TvModeSection from '@/components/settings/TvModeSection';
import DiagnosticsSection from '@/components/settings/DiagnosticsSection';

/** Everything that used to live in the sidebar and the home header pills. */
// StreamFlix card: same surface as the EPG "now" card.
const CARD = 'bg-surface border border-line rounded-lg p-5 md:p-6';

export default function SettingsPage() {
    const t = useT();

    return (
        <div className="px-4 md:px-10 pt-7 pb-12 max-w-4xl">
            <h1 className="font-display text-[28px] font-extrabold text-ink mb-7">{t('settings.title')}</h1>

            <div className="space-y-5">
                <section className={CARD}><AccountSection /></section>
                <section className={CARD}><LanguageSection /></section>
                <section className={CARD}><CatalogSection /></section>
                <section className={CARD}><ProfilesSection /></section>
                <section id="legendas" className={CARD}><SubtitlesSection /></section>
                <section className={CARD}><TmdbSection /></section>
                <section className={CARD}><TvModeSection /></section>
                <section className={CARD}><FreeTierSection /></section>
                <section className={CARD}><DiagnosticsSection /></section>
            </div>
        </div>
    );
}
