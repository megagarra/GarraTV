import { apiFetch } from './apiClient';

/** Client-side facade for /api/free-channels (iptv-org free tier). */

export interface FreeChannelSummary {
    id: string;
    name: string;
    logo?: string;
    groups: string[];
}

export interface FreeContact {
    label: string;
    url: string;
}

export interface FreeChannelList {
    country: string;
    channels: FreeChannelSummary[];
    updatedAt: number;
    contact: FreeContact;
    defaultCountry: string;
}

export interface FreeCountry {
    code: string;
    name: string;
}

const COUNTRY_STORAGE_KEY = 'garratv_free_country';

/** A failed owner action; `status` 401 means this browser is not signed in to the account. */
export class FreeTierRequestError extends Error {
    constructor(message: string, readonly status: number) {
        super(message);
        this.name = 'FreeTierRequestError';
    }
}

export async function fetchFreeChannels(country?: string): Promise<FreeChannelList> {
    const query = country ? `?country=${encodeURIComponent(country)}` : '';
    const response = await apiFetch(`/api/free-channels${query}`);
    const payload = await response.json() as { data?: FreeChannelList; error?: string };
    if (!response.ok && !payload.data) throw new Error(payload.error || 'free-channels');
    if (!payload.data) throw new Error('free-channels');
    return payload.data;
}

export async function fetchFreeCountries(): Promise<{ countries: FreeCountry[]; defaultCountry: string }> {
    const response = await apiFetch('/api/free-channels?view=countries');
    const payload = await response.json() as { data?: { countries: FreeCountry[]; defaultCountry: string }; error?: string };
    if (!response.ok || !payload.data) throw new Error(payload.error || 'countries');
    return payload.data;
}

export async function saveFreeTierConfig(config: { defaultCountry: string; contactLabel: string; contactUrl: string }): Promise<void> {
    const response = await apiFetch('/api/free-channels', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'saveConfig', ...config }),
    });
    if (!response.ok) {
        const payload = await response.json().catch(() => ({})) as { error?: string };
        throw new FreeTierRequestError(payload.error || 'save', response.status);
    }
}

export async function refreshFreeChannels(country: string): Promise<number> {
    const response = await apiFetch('/api/free-channels', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'refresh', country }),
    });
    const payload = await response.json().catch(() => ({})) as { data?: { count: number }; error?: string };
    if (!response.ok || !payload.data) throw new FreeTierRequestError(payload.error || 'refresh', response.status);
    return payload.data.count;
}

/** Relay URL for a free channel; the server maps the id to the stream. */
export function freeStreamPath(id: string): string {
    return `/api/relay?free=${encodeURIComponent(id)}`;
}

/** The visitor's last pick, if any. */
export function readSavedCountry(): string | null {
    try {
        return localStorage.getItem(COUNTRY_STORAGE_KEY);
    } catch {
        return null;
    }
}

export function saveCountry(code: string): void {
    try {
        localStorage.setItem(COUNTRY_STORAGE_KEY, code);
    } catch {
        /* storage unavailable: the pick lasts for this visit only */
    }
}

/** Region of the system language ("pt-BR" -> "br"), the best first guess of where the visitor is. */
export function systemRegion(): string | null {
    if (typeof navigator === 'undefined') return null;
    const tags = navigator.languages && navigator.languages.length ? navigator.languages : [navigator.language];
    for (const tag of tags) {
        const match = /^[a-z]{2,3}[-_]([a-z]{2})\b/i.exec(tag || '');
        if (match) return match[1].toLowerCase();
    }
    return null;
}

interface DisplayNamesLike {
    of(code: string): string | undefined;
}

type DisplayNamesCtor = new (locales: string[], options: { type: 'region' }) => DisplayNamesLike;

/**
 * Country name in the UI language. Intl.DisplayNames needs Chrome 81, so older
 * TVs keep the English name from iptv-org.
 */
export function countryNameFormatter(locale: string): (country: FreeCountry) => string {
    const ctor = (Intl as unknown as { DisplayNames?: DisplayNamesCtor }).DisplayNames;
    let names: DisplayNamesLike | null = null;
    try {
        names = ctor ? new ctor([locale], { type: 'region' }) : null;
    } catch {
        names = null;
    }
    return (country) => {
        try {
            return (names && names.of(country.code.toUpperCase())) || country.name;
        } catch {
            return country.name;
        }
    };
}

/**
 * Flag image. Emoji flags don't render on Windows or most TV browsers, so a
 * small PNG from flagcdn is used instead.
 */
export function flagUrl(code: string): string {
    return `https://flagcdn.com/w40/${code.toLowerCase()}.png`;
}
