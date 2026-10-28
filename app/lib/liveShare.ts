import fs from 'fs/promises';
import path from 'path';
import { dataDir } from './dataDir';

const DATA_DIR = dataDir();
const CONFIG_PATH = path.join(DATA_DIR, 'config.json');

interface StoredCredentials {
    hostUrl: string;
    username: string;
    password: string;
}

/** The Xtream account saved on the server, or null when none is configured. */
export async function readCredentials(): Promise<StoredCredentials | null> {
    try {
        const raw = await fs.readFile(CONFIG_PATH, 'utf-8');
        const parsed = JSON.parse(raw);
        const creds = parsed?.credentials;
        if (creds?.hostUrl && creds?.username && creds?.password) {
            return creds;
        }
        return null;
    } catch {
        return null;
    }
}

/** Xtream's `user_info` echoes the password; this is the copy that may reach a browser. */
export function publicUserInfo(userInfo: unknown): Record<string, unknown> | null {
    if (!userInfo || typeof userInfo !== 'object') return null;
    const copy: Record<string, unknown> = { ...(userInfo as Record<string, unknown>) };
    delete copy.password;
    return copy;
}

/** URL upstream real de um canal ao vivo (HLS), montada a partir da conta salva no servidor. */
export async function buildUpstreamLiveUrl(streamId: string): Promise<string | null> {
    const creds = await readCredentials();
    if (!creds) return null;
    const base = creds.hostUrl.replace(/\/$/, '');
    return `${base}/live/${creds.username}/${creds.password}/${streamId}.m3u8`;
}

/** Real upstream URL of a VOD (movie or series episode), from the account saved on the server. */
export async function buildUpstreamVodUrl(
    type: 'movie' | 'series',
    streamId: string,
    ext: string
): Promise<string | null> {
    const creds = await readCredentials();
    if (!creds) return null;
    const base = creds.hostUrl.replace(/\/$/, '');
    const segment = type === 'series' ? 'series' : 'movie';
    return `${base}/${segment}/${creds.username}/${creds.password}/${streamId}.${ext}`;
}

/** Origem (protocolo+host+porta) da conta configurada, usada para barrar proxy aberto no relay. */
export async function getAllowedOrigin(): Promise<string | null> {
    const creds = await readCredentials();
    if (!creds) return null;
    try {
        return new URL(creds.hostUrl).origin;
    } catch {
        return null;
    }
}
