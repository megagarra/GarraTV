#!/usr/bin/env node
/**
 * Isolated server + mock provider for driving a TV simulator/emulator by hand or by
 * screen automation. Signs the owner in and keeps the session cookie in
 * `.tv-browsers/sim-owner-cookie.txt`, so a pairing code can be approved with:
 *
 *   node scripts/tv-matrix/sim-server.mjs                # leaves both running
 *   node scripts/tv-matrix/sim-server.mjs approve ABC123 # approves a TV's code
 *
 * Ports default to 3110 (app) and 3210 (mock) so it can run beside run.mjs.
 */

import fs from 'node:fs';
import path from 'node:path';

process.env.APP_PORT ||= '3110';
process.env.MOCK_PORT ||= '3210';
process.env.TV_SERVER_DIR ||= 'server-sim';

const { APP_URL, prepareServer, startServer } = await import('./server.mjs');
const { MOCK_PASS, MOCK_PORT, MOCK_USER, startMockProvider } = await import('./mock-provider.mjs');

const COOKIE_FILE = path.join(process.cwd(), '.tv-browsers', 'sim-owner-cookie.txt');

async function approve(code) {
    const cookie = fs.readFileSync(COOKIE_FILE, 'utf-8').trim();
    const response = await fetch(`${APP_URL}/api/devices/pair/approve`, {
        method: 'POST', headers: { 'Content-Type': 'application/json', cookie },
        body: JSON.stringify({ code, name: 'Simulator' }),
    });
    console.log(`[sim] approve ${code}: HTTP ${response.status} ${await response.text()}`);
}

async function serve() {
    fs.mkdirSync(path.join(process.cwd(), 'test-results', 'tv'), { recursive: true });
    prepareServer();
    await startMockProvider();
    await startServer();
    const login = await fetch(`${APP_URL}/api/auth/login`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ hostUrl: `http://127.0.0.1:${MOCK_PORT}`, username: MOCK_USER, password: MOCK_PASS }),
    });
    const cookie = (login.headers.getSetCookie?.() || []).map((c) => c.split(';')[0]).join('; ');
    fs.writeFileSync(COOKIE_FILE, cookie);
    await fetch(`${APP_URL}/api/sync`, { method: 'POST', headers: { cookie } });
    console.log(`[sim] app ${APP_URL} (owner signed in: HTTP ${login.status}), mock on ${MOCK_PORT}`);
}

if (process.argv[2] === 'approve') await approve(process.argv[3]);
else await serve();
