import 'server-only';

import { promises as fs } from 'fs';
import path from 'path';
import * as sqlite from './sqliteCache';
import type { CachedStream } from './dbTypes';
import { readCredentials } from './liveShare';
import { parseAddedAt } from './catalogItem';
import { cleanSearchQuery, extractYear, findBestMatch } from './tmdb';
import { dataDir } from './dataDir';

/**
 * "What's on right now" for the home cards: the live programme worth tuning into
 * (a big match, the Sunday-night show while it airs) and the movies/series people
 * are watching or that just landed in the catalog. Recomputed every few minutes;
 * the home page rotates through the picks.
 */

/** `today`: a channel slate announcing an event later today ("Hoje a partir das 19:30 - ..."). */
export type SpotlightReason = 'now' | 'today' | 'trending' | 'new';

export interface SpotlightItem {
    title: string;
    /** Sport or show label pulled off the title ("Boxe: A x B" -> "Boxe"). */
    kicker?: string;
    /** "19:30" for `today` items. */
    startsAt?: string;
    /** Channel name for live, year/genre for VOD. */
    subtitle?: string;
    /** Wide image for the card background, when one is known. */
    image?: string;
    /** Portrait art, laid out beside the text when there is no wide image. */
    poster?: string;
    /** Channel logo (live), shown when there is no programme image. */
    logo?: string;
    /** Programme bounds, epoch seconds (live only). */
    start?: number;
    end?: number;
    /** "Team A x Team B" split, so the card can lay a match out without a photo. */
    matchup?: [string, string];
    href: string;
    reason: SpotlightReason;
}

export interface Spotlight {
    live: SpotlightItem[];
    movie: SpotlightItem[];
    series: SpotlightItem[];
    generatedAt: number;
}

const TMDB_CONFIG = path.join(dataDir(), 'tmdb-config.json');
const TMDB_API = 'https://api.themoviedb.org/3';
const TMDB_IMAGE = 'https://image.tmdb.org/t/p/w1280';

const LIVE_TTL_MS = 4 * 60 * 1000;
const VOD_TTL_MS = 30 * 60 * 1000;
const MAX_ITEMS = 5;
const MAX_LIVE_CANDIDATES = 18;
const FETCH_TIMEOUT_MS = 6000;
/**
 * Provider requests in flight at once. Xtream accounts commonly allow a single
 * connection (max_connections: 1) and reset the extras; the picks rebuild in the
 * background (stale-while-revalidate), so sequential costs nobody a wait.
 */
const PROVIDER_CONCURRENCY = 1;

/**
 * Channels probed for "what's on", in priority order. Sports first (a live match
 * is the strongest pull), then the open networks that carry the big shows.
 */
const LIVE_SOURCES: { query: string; weight: number }[] = [
    { query: 'premiere', weight: 30 },
    { query: 'sportv', weight: 28 },
    { query: 'caze', weight: 27 },
    { query: 'espn', weight: 26 },
    { query: 'tnt sports', weight: 24 },
    { query: 'globo', weight: 25 },
    { query: 'combate', weight: 20 },
    { query: 'record', weight: 16 },
    { query: 'sbt', weight: 15 },
    { query: 'band', weight: 14 },
    { query: 'dazn', weight: 14 },
    { query: 'hbo', weight: 8 },
];

const EXCLUDED_CHANNEL = /\b(24h|24 horas|r[aá]dio|radio|xxx|adult|ppv\s*\d)\b/i;
const MATCHUP = /^(.{2,40}?)\s+(?:x|vs\.?|versus|×)\s+(.{2,40}?)(?:\s*[-–|:(].*)?$/i;
const SPORTS = /(futebol|brasileir|libertadores|sul-?americana|copa|champions|premier league|la liga|campeonato|cl[aá]ssico|final|semifinal|nba|nfl|ufc|f[oó]rmula ?1|\bf1\b|grande pr[eê]mio|grand prix|t[eê]nis|v[oô]lei|basquete|luta)/i;
const PRIME = /(novela|fant[aá]stico|jornal nacional|big brother|\bbbb\b|doming|the voice|masterchef|reality|especial|estreia|show|filme|cinema|sess[aã]o)/i;
const LIVE_WORD = /\b(ao vivo|live)\b/i;
const FILLER = /(programa[çc][aã]o|sem programa|encerramento|intervalo|reprise|telecompras|igreja|programa pago|informe publicit|off ?air|em breve)/i;
/** "Hoje a partir das 19:30 - ", "Hoje às 21h - ", "Today at 8:00 PM - " */
const LATER_TODAY = /^(?:hoje|today)\s+(?:a partir d[aeo]s?|[àa]s|at|from)\s+(\d{1,2}(?:[:h]\d{2})?)(?:\s*h)?\s*(?:[ap]m)?\s*[-–:|]\s*/i;
/** "Boxe: ", "UFC 310 - " ahead of a matchup. */
const KICKER = /^([^:–-]{2,24}?)\s*[:–-]\s+(?=.{2,40}\s+(?:x|vs\.?|versus|×)\s)/i;

const RELEASE_CATEGORY = /(lan[çc]amento|cinema|estreia|novidade|new release|in theaters|recentes?)/i;

interface ParsedTitle {
    title: string;
    kicker?: string;
    startsAt?: string;
    matchup?: [string, string];
}

/** Splits EPG noise off a programme title so the card can show the event itself. */
function parseProgrammeTitle(raw: string): ParsedTitle {
    let title = raw.trim();
    let startsAt: string | undefined;
    const later = LATER_TODAY.exec(title);
    if (later) {
        startsAt = later[1].replace('h', ':').replace(/^(\d{1,2})$/, '$1:00');
        title = title.slice(later[0].length).trim();
    }
    let kicker: string | undefined;
    const label = KICKER.exec(title);
    if (label) {
        kicker = label[1].trim();
        title = title.slice(label[0].length).trim();
    }
    // "... - Ao Vivo" / "(Ao Vivo)" repeats what the card's "on now" label says.
    title = title.replace(/\s*(?:[-–|]\s*|\()\s*(?:ao vivo|live)\)?\s*$/i, '').trim() || title;
    const match = MATCHUP.exec(title);
    return {
        title,
        kicker,
        startsAt,
        matchup: match ? [match[1].trim(), match[2].trim()] : undefined,
    };
}

interface CachedEntry {
    at: number;
    value: Promise<SpotlightItem[]>;
}

const cache = new Map<string, CachedEntry>();

const settled = new Map<string, SpotlightItem[]>();

/**
 * Stale-while-revalidate: once a key has been built, an expired entry still
 * answers immediately with the last result while the rebuild runs in the
 * background, so no visitor ever waits on the EPG/XMLTV round trips again.
 */
function cached(key: string, ttl: number, load: () => Promise<SpotlightItem[]>): Promise<SpotlightItem[]> {
    const hit = cache.get(key);
    if (hit && Date.now() - hit.at < ttl) return hit.value;
    const value = load()
        .then((items) => {
            settled.set(key, items);
            return items;
        })
        .catch((error: unknown) => {
            console.error('[Spotlight] Failed to build', key, error);
            cache.delete(key);
            return settled.get(key) ?? [] as SpotlightItem[];
        });
    cache.set(key, { at: Date.now(), value });
    const stale = settled.get(key);
    return stale ? Promise.resolve(stale) : value;
}

/** Drops built picks (after a catalog sync) and rebuilds them in the background. */
export function refreshSpotlight(language: string): void {
    cache.clear();
    void getSpotlight(language);
}

async function fetchJson<T>(url: string): Promise<T | null> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
    try {
        const response = await fetch(url, { signal: controller.signal });
        if (!response.ok) return null;
        return await response.json() as T;
    } catch {
        return null;
    } finally {
        clearTimeout(timer);
    }
}

async function tmdbKey(): Promise<string | null> {
    try {
        const parsed = JSON.parse(await fs.readFile(TMDB_CONFIG, 'utf-8')) as { apiKey?: unknown };
        return typeof parsed.apiKey === 'string' && parsed.apiKey ? parsed.apiKey : null;
    } catch {
        return null;
    }
}

function httpUrl(value: string | undefined): string | undefined {
    return value && /^https?:\/\//i.test(value) ? value : undefined;
}

function wideImage(stream: CachedStream): string | undefined {
    const backdrop = (stream.backdrop_path ?? []).map(httpUrl).find(Boolean);
    return backdrop || httpUrl(stream.cover) || httpUrl(stream.icon);
}

function decode(value: unknown): string {
    if (typeof value !== 'string') return '';
    const trimmed = value.trim();
    if (!/^[A-Za-z0-9+/]+={0,2}$/.test(trimmed) || trimmed.length % 4 !== 0) return trimmed;
    const decoded = Buffer.from(trimmed, 'base64').toString('utf-8').trim();
    return decoded && decoded.indexOf('�') === -1 ? decoded : trimmed;
}

// ---------------------------------------------------------------- live

interface Programme {
    title: string;
    start: number;
    end: number;
}

async function nowPlaying(base: string, user: string, pass: string, streamId: string): Promise<Programme | null> {
    const params = new URLSearchParams({ username: user, password: pass, action: 'get_short_epg', stream_id: streamId, limit: '2' });
    const payload = await fetchJson<{ epg_listings?: Record<string, unknown>[] }>(`${base}/player_api.php?${params.toString()}`);
    const nowSec = Math.floor(Date.now() / 1000);
    for (const row of payload?.epg_listings ?? []) {
        const start = Number(row.start_timestamp);
        const end = Number(row.stop_timestamp);
        if (!Number.isFinite(start) || !Number.isFinite(end) || start > nowSec || end <= nowSec) continue;
        const title = decode(row.title);
        if (title) return { title, start, end };
    }
    return null;
}

// Many panels answer get_short_epg with an empty list but still serve the full
// XMLTV guide. It can be tens of MB, so it is streamed and only the probed
// channels' upcoming programmes are kept.
const XMLTV_TTL_MS = 3 * 60 * 60 * 1000;
const XMLTV_MAX_BYTES = 120 * 1024 * 1024;
const XMLTV_WINDOW_SEC = 8 * 60 * 60;
const XMLTV_TIMEOUT_MS = 20 * 1000;

interface XmltvCache {
    account: string;
    at: number;
    channels: string;
    byChannel: Promise<Map<string, Programme[]>>;
}

let xmltvCache: XmltvCache | null = null;

/** "20261028153000 -0300" -> epoch seconds. */
function parseXmltvTime(value: string): number {
    const match = /^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})\s*([+-]\d{4})?/.exec(value.trim());
    if (!match) return 0;
    const [, y, mo, d, h, mi, s, tz] = match;
    const utc = Date.UTC(Number(y), Number(mo) - 1, Number(d), Number(h), Number(mi), Number(s)) / 1000;
    if (!tz) return utc;
    const sign = tz.charAt(0) === '-' ? -1 : 1;
    const offset = sign * (Number(tz.slice(1, 3)) * 3600 + Number(tz.slice(3, 5)) * 60);
    return utc - offset;
}

function unescapeXml(value: string): string {
    return value
        .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&quot;/g, '"')
        .replace(/&apos;/g, "'")
        .replace(/&#(\d+);/g, (_, code: string) => String.fromCharCode(Number(code)))
        .replace(/&amp;/g, '&')
        .trim();
}

async function downloadXmltv(url: string, wanted: Set<string>): Promise<Map<string, Programme[]>> {
    const byChannel = new Map<string, Programme[]>();
    // Bounded: a panel that never answers must not pin the rebuild forever.
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), XMLTV_TIMEOUT_MS);
    let response: Response;
    try {
        response = await fetch(url, { signal: controller.signal });
    } finally {
        clearTimeout(timer);
    }
    if (!response.ok || !response.body) return byChannel;

    const nowSec = Math.floor(Date.now() / 1000);
    const reader = response.body.getReader();
    const decoder = new TextDecoder('utf-8');
    let buffer = '';
    let received = 0;
    const programme = /<programme\b([^>]*)>([\s\S]*?)<\/programme>/g;

    while (true) {
        const { done, value } = await reader.read();
        if (value) {
            received += value.byteLength;
            buffer += decoder.decode(value, { stream: true });
        }
        const lastClose = buffer.lastIndexOf('</programme>');
        if (lastClose !== -1) {
            const chunk = buffer.slice(0, lastClose + '</programme>'.length);
            buffer = buffer.slice(lastClose + '</programme>'.length);
            programme.lastIndex = 0;
            let match: RegExpExecArray | null;
            while ((match = programme.exec(chunk)) !== null) {
                const attrs = match[1];
                const channel = (/channel="([^"]*)"/.exec(attrs)?.[1] ?? '').toLowerCase();
                if (!wanted.has(channel)) continue;
                const start = parseXmltvTime(/start="([^"]*)"/.exec(attrs)?.[1] ?? '');
                const end = parseXmltvTime(/stop="([^"]*)"/.exec(attrs)?.[1] ?? '');
                if (!start || !end || end <= nowSec || start > nowSec + XMLTV_WINDOW_SEC) continue;
                const title = unescapeXml(/<title\b[^>]*>([\s\S]*?)<\/title>/.exec(match[2])?.[1] ?? '');
                if (!title) continue;
                const list = byChannel.get(channel) ?? [];
                list.push({ title, start, end });
                byChannel.set(channel, list);
            }
        }
        if (done || received > XMLTV_MAX_BYTES) {
            if (!done) await reader.cancel().catch(() => undefined);
            break;
        }
    }
    return byChannel;
}

function xmltvGuide(base: string, user: string, pass: string, channelIds: string[]): Promise<Map<string, Programme[]>> {
    const account = `${base}|${user}`;
    const channels = channelIds.slice().sort().join(',');
    if (xmltvCache && xmltvCache.account === account && xmltvCache.channels === channels && Date.now() - xmltvCache.at < XMLTV_TTL_MS) {
        return xmltvCache.byChannel;
    }
    const params = new URLSearchParams({ username: user, password: pass });
    const byChannel = downloadXmltv(`${base}/xmltv.php?${params.toString()}`, new Set(channelIds)).catch((error: unknown) => {
        console.error('[Spotlight] XMLTV guide unavailable', error);
        xmltvCache = null;
        return new Map<string, Programme[]>();
    });
    xmltvCache = { account, at: Date.now(), channels, byChannel };
    return byChannel;
}

function currentProgramme(list: Programme[] | undefined): Programme | null {
    const nowSec = Math.floor(Date.now() / 1000);
    return list?.find((entry) => entry.start <= nowSec && nowSec < entry.end) ?? null;
}

function scoreProgramme(raw: string, parsed: ParsedTitle, weight: number): number {
    if (parsed.title.length < 3 || FILLER.test(raw)) return -100;
    let score = weight;
    if (parsed.matchup) score += 60;
    if (SPORTS.test(raw)) score += 35;
    if (PRIME.test(raw)) score += 25;
    if (LIVE_WORD.test(raw)) score += 10;
    // Something actually on air beats a slate announcing it for later.
    if (parsed.startsAt) score -= 30;
    return score;
}

function liveCandidates(): { stream: CachedStream; weight: number }[] {
    const picked: { stream: CachedStream; weight: number }[] = [];
    // Variants of one channel (SD/HD/FHD) share an EPG id: probe it once.
    const seenEpg = new Set<string>();
    for (const source of LIVE_SOURCES) {
        let taken = 0;
        for (const stream of sqlite.searchStreams(source.query, 'live', 12)) {
            if (taken >= 2 || picked.length >= MAX_LIVE_CANDIDATES) break;
            if (EXCLUDED_CHANNEL.test(stream.name)) continue;
            const epgKey = (stream.epg_channel_id || stream.name).toLowerCase();
            if (seenEpg.has(epgKey)) continue;
            seenEpg.add(epgKey);
            picked.push({ stream, weight: source.weight });
            taken++;
        }
    }
    return picked;
}

/** Best-effort picture for a programme: the same title in the VOD catalog, then TMDB. */
async function programmeImage(title: string, key: string | null, language: string): Promise<string | undefined> {
    const query = cleanSearchQuery(title);
    if (!query) return undefined;
    const local = sqlite.searchStreams(query, 'series', 8).concat(sqlite.searchStreams(query, 'movie', 8));
    const match = findBestMatch(title, local, 0.85);
    const fromCatalog = match ? wideImage(match.item) : undefined;
    if (fromCatalog) return fromCatalog;

    if (!key) return undefined;
    const params = new URLSearchParams({ api_key: key, query, language, include_adult: 'false' });
    const result = await fetchJson<{ results?: { backdrop_path?: string | null; name?: string; title?: string }[] }>(
        `${TMDB_API}/search/multi?${params.toString()}`,
    );
    const hit = (result?.results ?? []).find((entry) => entry.backdrop_path && findBestMatch(title, [{ name: entry.name || entry.title || '' }], 0.85));
    return hit?.backdrop_path ? `${TMDB_IMAGE}${hit.backdrop_path}` : undefined;
}

export interface SpotlightCredentials {
    hostUrl: string;
    username: string;
    password: string;
}

async function buildLive(language: string, creds: SpotlightCredentials | null): Promise<SpotlightItem[]> {
    if (!creds) return [];
    const base = creds.hostUrl.replace(/\/$/, '');
    const candidates = liveCandidates();

    const found: (Programme | null)[] = [];
    // One at a time: many accounts allow a single provider connection.
    for (let i = 0; i < candidates.length; i += PROVIDER_CONCURRENCY) {
        const batch = candidates.slice(i, i + PROVIDER_CONCURRENCY);
        found.push(...await Promise.all(batch.map(({ stream }) => nowPlaying(base, creds.username, creds.password, String(stream.id)))));
    }

    // Nothing from the API: fall back to the panel's XMLTV guide.
    if (!found.some((programme) => programme !== null)) {
        const ids = candidates
            .map(({ stream }) => (stream.epg_channel_id ?? '').toLowerCase())
            .filter(Boolean);
        if (ids.length) {
            const guide = await xmltvGuide(base, creds.username, creds.password, ids);
            candidates.forEach(({ stream }, index) => {
                found[index] = currentProgramme(guide.get((stream.epg_channel_id ?? '').toLowerCase()));
            });
        }
    }

    const scored: { stream: CachedStream; programme: Programme; parsed: ParsedTitle; score: number }[] = [];
    found.forEach((programme, index) => {
        if (!programme) return;
        const parsed = parseProgrammeTitle(programme.title);
        const score = scoreProgramme(programme.title, parsed, candidates[index].weight);
        if (score > 0) scored.push({ stream: candidates[index].stream, programme, parsed, score });
    });

    scored.sort((a, b) => b.score - a.score);
    const key = await tmdbKey();
    const items: SpotlightItem[] = [];
    const seenTitles = new Set<string>();
    const picked: typeof scored = [];
    for (const entry of scored) {
        if (picked.length >= 3) break;
        const titleKey = entry.parsed.title.toLowerCase();
        if (seenTitles.has(titleKey)) continue;
        seenTitles.add(titleKey);
        picked.push(entry);
    }

    // Image lookups (catalog, then TMDB) run side by side, not one after another.
    // A matchup has no trustworthy photo; the card lays out the teams instead.
    const images = await Promise.all(picked.map(({ parsed }) =>
        parsed.matchup ? Promise.resolve(undefined) : programmeImage(parsed.title, key, language)));

    picked.forEach(({ stream, programme, parsed }, index) => {
        items.push({
            title: parsed.title,
            kicker: parsed.kicker,
            startsAt: parsed.startsAt,
            subtitle: stream.name,
            image: images[index],
            logo: httpUrl(stream.icon),
            start: programme.start,
            end: programme.end,
            matchup: parsed.matchup,
            href: `/garratv/live?channel=${encodeURIComponent(String(stream.id))}`,
            reason: parsed.startsAt ? 'today' : 'now',
        });
    });
    return items;
}

// ---------------------------------------------------------------- movies / series

interface TmdbTrending {
    results?: {
        title?: string;
        name?: string;
        original_title?: string;
        original_name?: string;
        backdrop_path?: string | null;
        release_date?: string;
        first_air_date?: string;
    }[];
}

function yearOf(stream: CachedStream): number | null {
    const fromDate = stream.release_date?.match(/\b(19|20)\d{2}\b/)?.[0];
    return fromDate ? Number(fromDate) : extractYear(stream.name);
}

function vodSubtitle(stream: CachedStream): string | undefined {
    const year = yearOf(stream);
    const genre = stream.genre ? stream.genre.split(/[,/]/)[0].trim() : '';
    return [year ? String(year) : '', genre].filter(Boolean).join(' · ') || undefined;
}

async function trending(type: 'movie' | 'series', key: string, language: string): Promise<SpotlightItem[]> {
    const params = new URLSearchParams({ api_key: key, language });
    const payload = await fetchJson<TmdbTrending>(`${TMDB_API}/trending/${type === 'movie' ? 'movie' : 'tv'}/day?${params.toString()}`);
    const items: SpotlightItem[] = [];
    for (const entry of payload?.results ?? []) {
        if (items.length >= MAX_ITEMS) break;
        const names = [entry.title || entry.name, entry.original_title || entry.original_name].filter((name): name is string => Boolean(name));
        const year = Number((entry.release_date || entry.first_air_date || '').slice(0, 4)) || null;
        let match: CachedStream | null = null;
        for (const name of names) {
            const found = findBestMatch(name, sqlite.searchStreams(cleanSearchQuery(name), type, 10), 0.85, year);
            if (found) {
                match = found.item;
                break;
            }
        }
        if (!match) continue;
        items.push({
            title: cleanSearchQuery(match.name) || match.name,
            subtitle: vodSubtitle(match),
            image: entry.backdrop_path ? `${TMDB_IMAGE}${entry.backdrop_path}` : wideImage(match),
            href: `/garratv/title/${type}/${encodeURIComponent(String(match.id))}`,
            reason: 'trending',
        });
    }
    return items;
}

/** Newest additions, recent releases first, only ones with a usable picture. */
const DETAIL_PROBES = 12;

interface VodInfoPayload {
    info?: { backdrop_path?: unknown; releasedate?: string; genre?: string };
}

/**
 * The provider's movie list carries no backdrop (series lists do), so the newest
 * movies get theirs from get_vod_info, through the same SQLite detail cache the
 * detail screen fills.
 */
async function withMovieDetails(streams: CachedStream[], creds: SpotlightCredentials | null): Promise<CachedStream[]> {
    const enriched: CachedStream[] = [];
    const base = creds ? creds.hostUrl.replace(/\/$/, '') : '';
    const probe = streams.slice(0, DETAIL_PROBES);
    for (let i = 0; i < probe.length; i += PROVIDER_CONCURRENCY) {
        const batch = probe.slice(i, i + PROVIDER_CONCURRENCY);
        const details = await Promise.all(batch.map(async (stream) => {
            const cachedDetail = sqlite.getDetail('movie', stream.id) as VodInfoPayload | undefined;
            if (cachedDetail?.info || !creds) return cachedDetail ?? null;
            const params = new URLSearchParams({ username: creds.username, password: creds.password, action: 'get_vod_info', vod_id: String(stream.id) });
            const fetched = await fetchJson<VodInfoPayload>(`${base}/player_api.php?${params.toString()}`);
            if (fetched?.info) sqlite.saveDetail('movie', stream.id, fetched);
            return fetched;
        }));
        batch.forEach((stream, index) => {
            const info = details[index]?.info;
            const backdrops = Array.isArray(info?.backdrop_path) ? (info?.backdrop_path as unknown[]).filter((url): url is string => typeof url === 'string') : [];
            enriched.push({
                ...stream,
                backdrop_path: backdrops.length ? backdrops : stream.backdrop_path,
                release_date: stream.release_date || info?.releasedate,
                genre: stream.genre || info?.genre,
            });
        });
    }
    return enriched;
}

/**
 * The provider's own curation first: titles in its "Lançamentos"/"Cinema"-style
 * categories, newest first. The catalog's latest additions are often obscure
 * back-catalog uploads, so they are only the fallback.
 */
function releaseCandidates(type: 'movie' | 'series'): CachedStream[] {
    const curated = sqlite.getCategories(type)
        .filter((category) => RELEASE_CATEGORY.test(category.category_name))
        .flatMap((category) => sqlite.getStreams(category.category_id, type));
    if (!curated.length) return sqlite.getRecentStreams(type, 80);

    const seen = new Set<string>();
    return curated
        .filter((stream) => {
            const id = String(stream.id);
            if (seen.has(id)) return false;
            seen.add(id);
            return true;
        })
        .sort((a, b) => parseAddedAt(b.last_modified ?? b.added) - parseAddedAt(a.last_modified ?? a.added))
        .slice(0, 80);
}

async function newest(type: 'movie' | 'series', exclude: Set<string>, limit: number, creds: SpotlightCredentials | null): Promise<SpotlightItem[]> {
    if (limit <= 0) return [];
    const thisYear = new Date().getFullYear();
    let recent = releaseCandidates(type).filter((stream) => !exclude.has(String(stream.id)));
    if (type === 'movie') recent = await withMovieDetails(recent, creds);
    const hasBackdrop = (stream: CachedStream) => (stream.backdrop_path ?? []).some((url) => Boolean(httpUrl(url)));
    recent = recent.filter((stream) => hasBackdrop(stream) || httpUrl(stream.cover) || httpUrl(stream.icon));
    // Same title in several qualities ("Moana", "Moana [L]", "Moana 4K"): show it once.
    const seenTitles = new Set<string>();
    recent = recent.filter((stream) => {
        const key = (cleanSearchQuery(stream.name) || stream.name).replace(/\s+4k$/i, '').toLowerCase();
        if (seenTitles.has(key)) return false;
        seenTitles.add(key);
        return true;
    });
    // Fresh releases beat old titles that were merely re-uploaded; a real
    // backdrop beats a poster at the same freshness.
    const ranked = recent
        .map((stream, index) => {
            const year = yearOf(stream);
            const freshness = year && year >= thisYear - 1 ? 0 : 1;
            return { stream, rank: freshness * 1000 + (hasBackdrop(stream) ? 0 : 500) + index };
        })
        .sort((a, b) => a.rank - b.rank)
        .slice(0, limit);

    return ranked.map(({ stream }) => ({
        // "NCIS: New York (2026) [L]" -> "NCIS: New York"; the year is in the subtitle.
        title: cleanSearchQuery(stream.name) || stream.name,
        subtitle: vodSubtitle(stream),
        image: hasBackdrop(stream) ? wideImage(stream) : undefined,
        poster: httpUrl(stream.cover) || httpUrl(stream.icon),
        href: `/garratv/title/${type}/${encodeURIComponent(String(stream.id))}`,
        reason: 'new' as const,
    }));
}

async function buildVod(type: 'movie' | 'series', language: string, creds: SpotlightCredentials | null): Promise<SpotlightItem[]> {
    const key = await tmdbKey();
    const hot = key ? await trending(type, key, language) : [];
    const seen = new Set(hot.map((item) => decodeURIComponent(item.href.split('/').pop() ?? '')));
    return hot.concat(await newest(type, seen, MAX_ITEMS - hot.length, creds)).slice(0, MAX_ITEMS);
}

export async function getSpotlight(language: string): Promise<Spotlight> {
    const creds = await readCredentials();
    const account = creds ? `${creds.hostUrl}|${creds.username}` : 'none';
    const [live, movie, series] = await Promise.all([
        cached(`live:${language}:${account}`, LIVE_TTL_MS, () => buildLive(language, creds)),
        cached(`movie:${language}:${account}`, VOD_TTL_MS, () => buildVod('movie', language, creds)),
        cached(`series:${language}:${account}`, VOD_TTL_MS, () => buildVod('series', language, creds)),
    ]);
    return { live, movie, series, generatedAt: Date.now() };
}
