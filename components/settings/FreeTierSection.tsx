'use client';

import { useEffect, useMemo, useState } from 'react';
import { RefreshCw, Save } from 'lucide-react';
import { useI18n } from '@/app/context/I18nContext';
import {
    countryNameFormatter,
    fetchFreeChannels,
    fetchFreeCountries,
    FreeTierRequestError,
    refreshFreeChannels,
    saveFreeTierConfig,
    type FreeCountry,
} from '@/app/lib/freeChannelsApi';
import Button from '@/components/ui/Button';
import Field, { inputClassName } from '@/components/ui/Field';
import SectionHeader from '@/components/ui/SectionHeader';

/** Free tier (iptv-org lists for guests) and the contact shown to unlock the full account. */
export default function FreeTierSection() {
    const { t, locale } = useI18n();
    const [countries, setCountries] = useState<FreeCountry[]>([]);
    const [defaultCountry, setDefaultCountry] = useState('');
    const [contactLabel, setContactLabel] = useState('');
    const [contactUrl, setContactUrl] = useState('');
    const [count, setCount] = useState<number | null>(null);
    const [saving, setSaving] = useState(false);
    const [refreshing, setRefreshing] = useState(false);
    const [message, setMessage] = useState('');

    useEffect(() => {
        let cancelled = false;
        Promise.all([fetchFreeCountries(), fetchFreeChannels()])
            .then(([countryList, list]) => {
                if (cancelled) return;
                setCountries(countryList.countries);
                setDefaultCountry(countryList.defaultCountry);
                setContactLabel(list.contact.label);
                setContactUrl(list.contact.url);
                setCount(list.channels.length);
            })
            .catch((err: unknown) => console.error('[Settings] Free tier config unavailable', err));
        return () => {
            cancelled = true;
        };
    }, []);

    const sortedCountries = useMemo(() => {
        const nameOf = countryNameFormatter(locale);
        return countries
            .map((country) => ({ code: country.code, label: nameOf(country) }))
            .sort((a, b) => a.label.localeCompare(b.label, locale));
    }, [countries, locale]);

    const errorMessage = (err: unknown, fallbackKey: string) => {
        if (err instanceof FreeTierRequestError && err.status === 401) return t('settings.freeTier.sessionRequired');
        return err instanceof Error ? err.message : t(fallbackKey);
    };

    const save = async () => {
        setSaving(true);
        setMessage('');
        try {
            await saveFreeTierConfig({ defaultCountry, contactLabel, contactUrl });
            setMessage(t('settings.freeTier.saved'));
        } catch (err: unknown) {
            setMessage(errorMessage(err, 'settings.freeTier.saveFailed'));
        } finally {
            setSaving(false);
        }
    };

    const refresh = async () => {
        setRefreshing(true);
        setMessage('');
        try {
            const total = await refreshFreeChannels(defaultCountry);
            setCount(total);
            setMessage(t('settings.freeTier.refreshed', { n: total }));
        } catch (err: unknown) {
            setMessage(errorMessage(err, 'settings.freeTier.refreshFailed'));
        } finally {
            setRefreshing(false);
        }
    };

    return (
        <div>
            <SectionHeader
                title={t('settings.freeTier.title')}
                description={t('settings.freeTier.description')}
                count={count ?? undefined}
            />
            <div className="space-y-4 mt-4">
                <Field label={t('settings.freeTier.contactLabel')} htmlFor="free-contact-label" hint={t('settings.freeTier.contactLabelHint')}>
                    <input
                        id="free-contact-label"
                        value={contactLabel}
                        onChange={(event) => setContactLabel(event.target.value)}
                        placeholder={t('settings.freeTier.contactLabelPlaceholder')}
                        className={inputClassName}
                        data-focusable="true"
                    />
                </Field>
                <Field label={t('settings.freeTier.contactUrl')} htmlFor="free-contact-url" hint={t('settings.freeTier.contactUrlHint')}>
                    <input
                        id="free-contact-url"
                        value={contactUrl}
                        onChange={(event) => setContactUrl(event.target.value)}
                        placeholder="mailto:contato@exemplo.com"
                        className={inputClassName}
                        data-focusable="true"
                    />
                </Field>
                <Field label={t('settings.freeTier.defaultCountry')} htmlFor="free-default-country" hint={t('settings.freeTier.defaultCountryHint')}>
                    <select
                        id="free-default-country"
                        value={defaultCountry}
                        onChange={(event) => setDefaultCountry(event.target.value)}
                        className={`${inputClassName} max-w-[20rem]`}
                        data-focusable="true"
                        tabIndex={0}
                    >
                        {sortedCountries.map((country) => (
                            <option key={country.code} value={country.code}>{country.label}</option>
                        ))}
                    </select>
                </Field>
            </div>
            <div className="flex flex-wrap mt-5">
                <Button variant="primary" icon={Save} loading={saving} onClick={save} className="mr-3 mb-2">
                    {t('common.save')}
                </Button>
                <Button variant="secondary" icon={RefreshCw} loading={refreshing} onClick={refresh} disabled={!defaultCountry} className="mb-2">
                    {t('settings.freeTier.refresh')}
                </Button>
            </div>
            {message && <p className="mt-2 text-sm text-ink-2">{message}</p>}
        </div>
    );
}
