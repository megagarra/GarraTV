/**
 * Runs the production build in an isolated copy (`.tv-browsers/server`), so the tests
 * get a throwaway `data/` and never touch the real account, catalog or profiles.
 */

import fs from 'node:fs';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { setTimeout as sleep } from 'node:timers/promises';
import { MOCK_PASS, MOCK_PORT, MOCK_USER } from './mock-provider.mjs';

const MOCK_URL = `http://127.0.0.1:${MOCK_PORT}`;

const ROOT = process.cwd();
const SERVER_DIR = path.join(ROOT, '.tv-browsers', process.env.TV_SERVER_DIR || 'server');
export const APP_PORT = Number(process.env.APP_PORT || 3100);
export const APP_URL = `http://127.0.0.1:${APP_PORT}`;

function mirror(from, to) {
    // robocopy exit codes below 8 mean success.
    const result = spawnSync('robocopy', [from, to, '/MIR', '/NFL', '/NDL', '/NJH', '/NJS', '/NP', '/XD', 'data'], { stdio: 'ignore' });
    if (result.status === null || result.status >= 8) throw new Error(`robocopy ${from} failed (${result.status})`);
}

export function prepareServer() {
    const standalone = path.join(ROOT, '.next', 'standalone');
    if (!fs.existsSync(path.join(standalone, 'server.js'))) throw new Error('Run npm run build first');
    mirror(standalone, SERVER_DIR);
    mirror(path.join(ROOT, '.next', 'static'), path.join(SERVER_DIR, '.next', 'static'));
    mirror(path.join(ROOT, 'public'), path.join(SERVER_DIR, 'public'));
}

/** Fresh data dir; the iptv-org playlist cache is reused so runs don't hammer GitHub. */
function resetData() {
    const data = path.join(SERVER_DIR, 'data');
    fs.rmSync(data, { recursive: true, force: true });
    fs.mkdirSync(data, { recursive: true });
    const freeCache = path.join(ROOT, 'data', 'free-channels');
    if (fs.existsSync(freeCache)) fs.cpSync(freeCache, path.join(data, 'free-channels'), { recursive: true });
    pinTestFreeChannel(path.join(data, 'free-channels', 'br.json'));
}

/** First Brazilian free channel served by the mock, so free playback doesn't depend on a public stream. */
function pinTestFreeChannel(file) {
    if (!fs.existsSync(file)) return;
    const list = JSON.parse(fs.readFileSync(file, 'utf-8'));
    list.channels.unshift({
        id: 'br-matrix-test',
        name: '000 Canal Teste',
        logo: `${MOCK_URL}/img/poster0.png`,
        groups: ['General'],
        url: `${MOCK_URL}/live/${MOCK_USER}/${MOCK_PASS}/100.m3u8`,
    });
    fs.writeFileSync(file, JSON.stringify(list));
}

export async function startServer() {
    resetData();
    const log = fs.openSync(path.join(ROOT, 'test-results', 'tv', 'server.log'), 'a');
    const child = spawn(process.execPath, ['server.js'], {
        cwd: SERVER_DIR,
        env: { ...process.env, PORT: String(APP_PORT), HOSTNAME: '127.0.0.1', NODE_ENV: 'production' },
        stdio: ['ignore', log, log],
    });
    for (let i = 0; i < 60; i++) {
        await sleep(500);
        try {
            const response = await fetch(`${APP_URL}/api/remote-access`);
            if (response.ok) return child;
        } catch { /* booting */ }
    }
    child.kill();
    throw new Error('app server did not start');
}

export async function stopServer(child) {
    if (!child) return;
    child.kill();
    await sleep(800);
}
