import 'server-only';

import { promises as fs } from 'fs';
import crypto from 'crypto';
import path from 'path';

/**
 * Free tier: public channels from the iptv-org collection
 * (https://github.com/iptv-org/iptv), watchable without an Xtream account.
 *
 * Each country has its own playlist (`countries/<cc>.m3u`). Playlists are
 * fetched server-side, parsed once and cached under `data/free-channels/`, so
 * guests never talk to GitHub directly and the relay can resolve a channel id
 * to its URL without accepting arbitrary URLs.
 */

const DATA_DIR = path.join(process.cwd(), 'data');
const CONFIG_FILE = path.join(DATA_DIR, 'free-tier.json');
const CACHE_DIR = path.join(DATA_DIR, 'free-channels');
const COUNTRIES_FILE = path.join(CACHE_DIR, 'countries.json');
const PLAYLIST_TTL_MS = 12 * 60 * 60 * 1000;
const COUNTRIES_TTL_MS = 24 * 60 * 60 * 1000;

const PLAYLIST_BASE = 'https://iptv-org.github.io/iptv/countries/';
// PLAYLISTS.md lists exactly the countries that have a playlist, with flag and name.
const COUNTRY_INDEX_URL = 'https://raw.githubusercontent.com/iptv-org/iptv/master/PLAYLISTS.md';

export const DEFAULT_COUNTRY = 'br';

export interface FreeChannel {
    /** `<country>-<hash>`: the prefix tells the relay which playlist to look in. */
    id: string;
    name: string;
    logo?: string;
    /** iptv-org categories (English), e.g. "News", "Kids". */
    groups: string[];
    url: string;
}

export interface FreeCountry {
    /** Lower-case ISO 3166-1 alpha-2, as used in the playlist path. */
    code: string;
    /** English name from iptv-org; the client localizes it when it can. */
    name: string;
}

export interface FreeTierConfig {
    /** Country shown when the visitor's own region has no playlist. */
    defaultCountry: string;
    /** How to reach the admin for a full Xtream account. */
    contactLabel: string;
    /** Link for the contact button (mailto:, https://wa.me/..., tel:). */
    contactUrl: string;
}

interface CachedPlaylist {
    country: string;
    updatedAt: number;
    channels: FreeChannel[];
}

interface CachedCountries {
    updatedAt: number;
    countries: FreeCountry[];
}

const DEFAULT_CONFIG: FreeTierConfig = {
    defaultCountry: DEFAULT_COUNTRY,
    contactLabel: 'thegarra@gmail.com',
    contactUrl: 'mailto:thegarra@gmail.com',
};

const playlists = new Map<string, CachedPlaylist>();
const refreshing = new Map<string, Promise<CachedPlaylist>>();
let countriesMemory: CachedCountries | null = null;
let countriesRefresh: Promise<CachedCountries> | null = null;

function isNotFound(error: unknown): boolean {
    return typeof error === 'object' && error !== null && (error as { code?: string }).code === 'ENOENT';
}

function isCountryCode(value: string): boolean {
    return /^[a-z]{2}$/.test(value);
}

export async function getFreeTierConfig(): Promise<FreeTierConfig> {
    try {
        const parsed = JSON.parse(await fs.readFile(CONFIG_FILE, 'utf-8')) as Partial<FreeTierConfig>;
        const country = typeof parsed.defaultCountry === 'string' ? parsed.defaultCountry.toLowerCase() : '';
        return {
            defaultCountry: isCountryCode(country) ? country : DEFAULT_CONFIG.defaultCountry,
            contactLabel: typeof parsed.contactLabel === 'string' ? parsed.contactLabel : DEFAULT_CONFIG.contactLabel,
            contactUrl: typeof parsed.contactUrl === 'string' ? parsed.contactUrl : DEFAULT_CONFIG.contactUrl,
        };
    } catch (error) {
        if (!isNotFound(error)) console.error('[FreeChannels] Failed to read config', error);
        return { ...DEFAULT_CONFIG };
    }
}

export async function saveFreeTierConfig(config: FreeTierConfig): Promise<void> {
    await fs.mkdir(DATA_DIR, { recursive: true });
    await fs.writeFile(CONFIG_FILE, JSON.stringify(config, null, 2), 'utf-8');
}

function attribute(line: string, name: string): string {
    const match = line.match(new RegExp(`${name}="([^"]*)"`));
    return match ? match[1].trim() : '';
}

/** "Globo News (720p) [Not 24/7]" -> "Globo News". */
function cleanName(raw: string): string {
    return raw
        .replace(/\[[^\]]*\]/g, '')
        .replace(/\(\d{3,4}[pi]\)/gi, '')
        .replace(/\s+/g, ' ')
        .trim();
}

/**
 * Parses an iptv-org M3U. Entries the browser cannot play are dropped: ones that
 * need a custom Referer/User-Agent (#EXTVLCOPT), geo-blocked ones and adult groups.
 */
export function parseM3u(text: string, country: string): FreeChannel[] {
    const lines = text.split(/\r?\n/);
    const channels: FreeChannel[] = [];
    const seen = new Set<string>();
    let info: string | null = null;
    let needsOptions = false;

    for (const rawLine of lines) {
        const line = rawLine.trim();
        if (!line) continue;

        if (line.indexOf('#EXTINF') === 0) {
            info = line;
            needsOptions = false;
            continue;
        }
        if (line.indexOf('#EXTVLCOPT') === 0) {
            needsOptions = true;
            continue;
        }
        if (line.charAt(0) === '#' || !info) continue;

        const entry = info;
        info = null;
        if (needsOptions || !/^https?:\/\//i.test(line)) continue;

        const comma = entry.lastIndexOf('",');
        const rawName = comma >= 0 ? entry.slice(comma + 2) : entry.slice(entry.indexOf(',') + 1);
        if (/geo-blocked/i.test(rawName)) continue;

        const groups = attribute(entry, 'group-title')
            .split(';')
            .map((group) => group.trim())
            .filter((group) => group && group !== 'Undefined');
        if (groups.some((group) => /xxx/i.test(group))) continue;

        const name = cleanName(rawName) || rawName.trim();
        // A hash of the URL keeps ids stable across refreshes even when tvg-id repeats.
        const id = `${country}-${crypto.createHash('sha1').update(line).digest('hex').slice(0, 12)}`;
        if (!name || seen.has(id)) continue;
        seen.add(id);

        const logo = attribute(entry, 'tvg-logo');
        channels.push({ id, name, logo: logo || undefined, groups, url: line });
    }

    return channels.sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }));
}

/** `- 🇧🇷 Brazil <code>https://iptv-org.github.io/iptv/countries/br.m3u</code>` */
export function parseCountryIndex(markdown: string): FreeCountry[] {
    const countries: FreeCountry[] = [];
    const seen = new Set<string>();
    const pattern = /^-\s+(?:\S+\s+)?(.+?)\s*<code>https:\/\/iptv-org\.github\.io\/iptv\/countries\/([a-z]{2})\.m3u<\/code>/;
    for (const line of markdown.split(/\r?\n/)) {
        const match = line.match(pattern);
        if (!match || seen.has(match[2])) continue;
        seen.add(match[2]);
        countries.push({ code: match[2], name: match[1].trim() });
    }
    return countries;
}

async function readJson<T>(file: string): Promise<T | null> {
    try {
        return JSON.parse(await fs.readFile(file, 'utf-8')) as T;
    } catch (error) {
        if (!isNotFound(error)) console.error('[FreeChannels] Failed to read cache', file, error);
        return null;
    }
}

async function writeJson(file: string, value: unknown): Promise<void> {
    await fs.mkdir(CACHE_DIR, { recursive: true });
    await fs.writeFile(file, JSON.stringify(value), 'utf-8');
}

/** Countries that have a playlist, refreshed daily; a failed refresh serves the stale copy. */
export async function getFreeCountries(): Promise<FreeCountry[]> {
    const fresh = (entry: CachedCountries | null) => entry !== null && Date.now() - entry.updatedAt < COUNTRIES_TTL_MS;
    if (fresh(countriesMemory)) return (countriesMemory as CachedCountries).countries;
    if (!countriesMemory) {
        countriesMemory = await readJson<CachedCountries>(COUNTRIES_FILE);
        if (fresh(countriesMemory)) return (countriesMemory as CachedCountries).countries;
    }

    if (!countriesRefresh) {
        countriesRefresh = (async () => {
            const response = await fetch(COUNTRY_INDEX_URL, { redirect: 'follow' });
            if (!response.ok) throw new Error(`Country index ${response.status}`);
            const countries = parseCountryIndex(await response.text());
            if (!countries.length) throw new Error('Country index without countries');
            const entry: CachedCountries = { updatedAt: Date.now(), countries };
            await writeJson(COUNTRIES_FILE, entry);
            return entry;
        })().finally(() => {
            countriesRefresh = null;
        });
    }

    try {
        countriesMemory = await countriesRefresh;
        return countriesMemory.countries;
    } catch (error) {
        console.error('[FreeChannels] Country index refresh failed', error);
        if (countriesMemory) return countriesMemory.countries;
        throw error;
    }
}

/** Only countries from the index are fetched, so the playlist URL is never user-controlled. */
export async function resolveCountry(requested: string | null | undefined): Promise<string> {
    const config = await getFreeTierConfig();
    const code = (requested ?? '').toLowerCase();
    if (!isCountryCode(code)) return config.defaultCountry;
    try {
        const countries = await getFreeCountries();
        return countries.some((country) => country.code === code) ? code : config.defaultCountry;
    } catch {
        // Without the index, accept a well-formed code; the fetch itself fails safely.
        return code;
    }
}

async function download(country: string): Promise<CachedPlaylist> {
    const response = await fetch(`${PLAYLIST_BASE}${country}.m3u`, { redirect: 'follow' });
    if (!response.ok) throw new Error(`Playlist ${country} ${response.status}`);
    const playlist: CachedPlaylist = { country, updatedAt: Date.now(), channels: parseM3u(await response.text(), country) };
    await writeJson(path.join(CACHE_DIR, `${country}.json`), playlist);
    return playlist;
}

/** Cached list for one country, refreshed every 12h; a failed refresh keeps the stale copy. */
export async function getFreeChannels(country: string, force = false): Promise<CachedPlaylist> {
    const fresh = (entry: CachedPlaylist | null | undefined) =>
        !!entry && Date.now() - entry.updatedAt < PLAYLIST_TTL_MS;

    let current = playlists.get(country) ?? null;
    if (!force && fresh(current)) return current as CachedPlaylist;
    if (!force && !current) {
        current = await readJson<CachedPlaylist>(path.join(CACHE_DIR, `${country}.json`));
        if (current && Array.isArray(current.channels)) {
            playlists.set(country, current);
            if (fresh(current)) return current;
        }
    }

    let pending = refreshing.get(country);
    if (!pending) {
        pending = download(country).finally(() => {
            refreshing.delete(country);
        });
        refreshing.set(country, pending);
    }

    try {
        const playlist = await pending;
        playlists.set(country, playlist);
        return playlist;
    } catch (error) {
        console.error('[FreeChannels] Playlist refresh failed', country, error);
        if (current) return current;
        throw error;
    }
}

export async function findFreeChannel(id: string): Promise<FreeChannel | null> {
    const country = id.split('-')[0];
    if (!isCountryCode(country)) return null;
    try {
        const playlist = await getFreeChannels(country);
        return playlist.channels.find((channel) => channel.id === id) ?? null;
    } catch {
        // No playlist for that country: same answer as an unknown channel.
        return null;
    }
}
