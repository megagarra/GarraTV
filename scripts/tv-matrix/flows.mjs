/**
 * The flows every engine runs. Each check returns pass / fail / warn with a note and
 * the screenshot it took; a thrown error is a fail for that check only.
 */

import path from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import { APP_URL } from './server.mjs';
import { MOCK_PASS, MOCK_PORT, MOCK_USER } from './mock-provider.mjs';

const FLOW_TIMEOUT_MS = 420000;
const MOCK_HOST = `http://127.0.0.1:${MOCK_PORT}`;
const BOOTSTRAP = `file:///${path.join(process.cwd(), 'tv', 'bootstrap', 'index.html').replace(/\\/g, '/')}`;

/** True on engines that can decode H.264/AAC (open-source snapshots cannot). */
const decodesH264 = (engine) => engine.hasH264 === true;

function verdict(results, flow, check, status, note, shot) {
    results.push({ flow, check, status, note: note || '', shot: shot || '' });
}

/** Health of the current screen as a check: blank screen, fatal errors, broken overlays. */
async function screenCheck(tv, results, flow, label) {
    const shot = await tv.screenshot(label);
    const h = await tv.health();
    const events = tv.drainEvents().filter((e) => !/Failed to load resource|favicon|status of 40[13]/i.test(e.text || ''));
    const fatal = h.errors.filter((e) => e.indexOf('ERROR:') === 0 || e.indexOf('REJECT:') === 0);
    const problems = [];
    if (h.textLength < 20 || h.visibleBlocks < 3) problems.push(`blank screen (text ${h.textLength}, blocks ${h.visibleBlocks})`);
    if (fatal.length) problems.push(`JS errors: ${fatal.join(' | ').slice(0, 300)}`);
    if (h.errorBoundary) problems.push('error boundary shown');
    if (h.insetUnparsed) problems.push(`${h.insetUnparsed} inset-0 elements without top/left (inset not downleveled)`);
    if (h.collapsed.length) problems.push(`collapsed overlays: ${h.collapsed.join(', ')}`);
    const exceptions = events.filter((e) => e.kind === 'exception');
    if (exceptions.length) problems.push(`uncaught: ${exceptions.map((e) => e.text).join(' | ').slice(0, 300)}`);
    verdict(results, flow, `${label}: renders`, problems.length ? 'fail' : 'pass', problems.join('; ') || `${h.url} - ${h.textSample.slice(0, 80)}`, shot);
    return h;
}

/** Arrow keys must keep a focused, focusable element and actually move it. */
async function focusCheck(tv, results, flow, label, keys) {
    const start = await tv.health();
    const seen = new Set();
    let lost = 0;
    if (start.focus) seen.add(start.focus.rect.join(','));
    for (const key of keys) {
        await tv.press(key);
        const h = await tv.health();
        if (!h.focus) lost++;
        else seen.add(h.focus.rect.join(','));
    }
    const shot = await tv.screenshot(`${label}-focus`);
    const end = await tv.health();
    const moved = seen.size > 1;
    const status = lost === keys.length ? 'fail' : (!moved ? 'fail' : lost ? 'warn' : 'pass');
    verdict(results, flow, `${label}: remote navigation`, status,
        `${seen.size} focus positions over ${keys.length} keys, focus lost ${lost}x; last: ${end.focus ? `${end.focus.tag} "${end.focus.label}"` : 'none'}`, shot);
}

async function flowVisitor(tv, results) {
    const flow = '1. Visitor / free channels';
    await tv.goto(`${APP_URL}/`, { settleMs: 1500 });
    const ok = await tv.waitFor(`location.pathname === '/garratv/free' && document.querySelectorAll('[data-focusable="true"]').length > 5`, 30000);
    verdict(results, flow, 'redirects to free channels', ok ? 'pass' : 'fail', (await tv.health()).url);
    await sleep(1500);
    await screenCheck(tv, results, flow, 'free');
    await focusCheck(tv, results, flow, 'free', ['down', 'down', 'right', 'up', 'left']);

    // The first channel autoplays; the matrix pins a mock-backed one there (server.mjs).
    await tv.goto(`${APP_URL}/garratv/free`, { settleMs: 500 });
    const playlist = await tv.waitForRequest(/\/api\/relay\?free=br-matrix-test/, 20000);
    const segments = playlist && await tv.waitForRequest(/\/api\/relay\?src=/, 20000);
    const playing = await tv.waitFor(`(function(){var v=document.querySelector('video');return v&&v.currentTime>0.5;})()`, decodesH264(tv.engine) ? 20000 : 3000);
    const shot = await tv.screenshot('free-playing');
    const status = playlist && segments && (playing || !decodesH264(tv.engine)) ? 'pass' : 'fail';
    let note = `playlist via relay: ${playlist}, segments: ${segments}, video advancing: ${playing}`;
    if (!decodesH264(tv.engine)) note += ' (H.264 decode not in this open-source build; network path verified)';
    verdict(results, flow, 'free channel plays through /api/relay?free=', status, note, shot);
}

async function flowSecurity(tv, results) {
    const flow = '2. Visitor security';
    await tv.goto(`${APP_URL}/garratv/free`, { settleMs: 500 });
    const save = await tv.pageFetch('/api/free-channels', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'saveConfig', contactLabel: 'attacker@example.com', contactUrl: 'mailto:attacker@example.com' }),
    });
    verdict(results, flow, 'visitor cannot change free-tier contact', save.status === 401 ? 'pass' : 'fail', `HTTP ${save.status}`);
    const config = await tv.pageFetch('/api/config');
    verdict(results, flow, '/api/config exposes no credentials', config.status === 200 && config.body.indexOf('password') === -1 && config.body.indexOf('credentials') === -1 ? 'pass' : 'fail', config.body.slice(0, 120));
    return config;
}

/** With an account saved, a second client with no session (a visitor) probes the account routes. */
async function flowSecurityWithAccount(results) {
    const flow = '2. Visitor security';
    const probe = (url, init) => fetch(`${APP_URL}${url}`, init).then((r) => r.status).catch(() => -1);
    const post = (body) => ({ method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    const checks = [
        ['visitor cannot open paid live channel', await probe('/api/relay?type=live&streamId=100'), 401],
        ['visitor cannot open VOD', await probe('/api/vod/movie/200.webm'), 401],
        ['visitor cannot call the provider proxy', await probe('/api/proxy', post({ action: '' })), 401],
        ['visitor cannot replace the account', await probe('/api/auth/login', post({ hostUrl: 'http://127.0.0.1:9', username: 'intruder', password: 'x' })), 403],
        ['visitor cannot sign the account out', await probe('/api/config', post({})), 401],
        ['visitor cannot approve a TV pairing', await probe('/api/devices/pair/approve', post({ code: 'ABCDEF' })), 401],
        ['visitor cannot list paired TVs', await probe('/api/devices'), 401],
        ['visitor cannot read TMDB/OpenSubtitles keys', await probe('/api/tmdb/config'), 401],
    ];
    for (const [check, status, expected] of checks) {
        verdict(results, flow, check, status === expected ? 'pass' : 'fail', `HTTP ${status} (expected ${expected})`);
    }
}

async function typeInto(tv, selector, text) {
    await tv.eval(`(function(){var el=document.querySelector(${JSON.stringify(selector)});el.focus();el.select&&el.select();})()`);
    await tv.type(text);
}

async function login(tv) {
    await tv.goto(`${APP_URL}/garratv`, { settleMs: 1500 });
    await tv.waitFor(`document.querySelectorAll('form input').length >= 3`, 20000);
    await typeInto(tv, 'form input[type="url"]', MOCK_HOST);
    await typeInto(tv, 'form input[autocomplete="username"]', MOCK_USER);
    await typeInto(tv, 'form input[autocomplete="current-password"]', MOCK_PASS);
    await tv.eval(`document.querySelector('form button[type="submit"]').click()`);
    return tv.waitFor(`location.pathname === '/garratv/home'`, 30000);
}

async function waitForSync(tv) {
    for (let i = 0; i < 60; i++) {
        const job = await tv.pageFetch('/api/sync');
        if (job.status === 200 && job.body.indexOf('"running"') === -1) {
            const count = await tv.pageFetch('/api/library', {
                method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ action: 'getStreamCount' }),
            });
            if (/"data":\s*[1-9]/.test(count.body)) return true;
        }
        await sleep(1000);
    }
    return false;
}

async function flowLogin(tv, results) {
    const flow = '3. Login';
    const ok = await login(tv);
    const shot = await tv.screenshot('login-done');
    verdict(results, flow, 'login reaches home', ok ? 'pass' : 'fail', (await tv.health()).url, shot);
    if (!ok) return false;
    const synced = await waitForSync(tv);
    verdict(results, flow, 'catalog syncs from the provider', synced ? 'pass' : 'fail', synced ? 'mock catalog in SQLite' : 'no streams after 60s');
    const storage = await tv.eval(`JSON.stringify({ cookie: document.cookie, auth: localStorage.getItem('garratv_auth') || '' })`);
    const leaks = storage.indexOf(MOCK_PASS) !== -1 || /password/i.test(storage);
    verdict(results, flow, 'password not in localStorage or readable cookies', leaks ? 'fail' : 'pass', leaks ? 'password found' : 'clean');
    const cookies = await tv.cdp.send('Network.getCookies', { urls: [APP_URL] }).catch(() => ({ cookies: [] }));
    const session = (cookies.cookies || []).find((c) => c.name === 'garratv_session');
    verdict(results, flow, 'session cookie is httpOnly', session && session.httpOnly ? 'pass' : session ? 'fail' : 'warn', session ? `httpOnly=${session.httpOnly}` : 'cookie not visible to CDP');
    return true;
}

async function flowCatalog(tv, results) {
    const flow = '4. Catalog';
    const screens = [
        ['home', '/garratv/home', ['down', 'right', 'right', 'down', 'left']],
        ['live', '/garratv/live', ['down', 'down', 'right', 'up']],
        ['movies', '/garratv/movies', ['down', 'right', 'right', 'down']],
        ['series', '/garratv/series', ['down', 'right', 'down']],
        ['title', '/garratv/title/movie/200', ['down', 'right', 'up']],
        ['favorites', '/garratv/favorites', ['down', 'right']],
        ['dashboard', '/dashboard', ['down', 'right', 'down']],
    ];
    for (const [label, url, keys] of screens) {
        await tv.goto(`${APP_URL}${url}`, { settleMs: 3000 });
        await screenCheck(tv, results, flow, label);
        await focusCheck(tv, results, flow, label, keys);
        if (label === 'live') {
            const epg = await tv.waitFor(`document.body.innerText.indexOf('Programa') !== -1`, 8000);
            verdict(results, flow, 'live: EPG shown (via proxy, no client credentials)', epg ? 'pass' : 'fail', epg ? 'guide rendered' : 'no programme text');
        }
    }
    await tv.goto(`${APP_URL}/garratv/title/movie/200`, { settleMs: 2500 });
    const before = await tv.eval('location.pathname');
    await tv.goto(`${APP_URL}/garratv/movies`, { settleMs: 1500 });
    await tv.press('back', { delayMs: 2500 });
    const after = await tv.eval('location.pathname');
    verdict(results, flow, `remote Back key (${tv.engine.platform})`, after === before ? 'pass' : 'fail', `after Back: ${after} (expected ${before})`);
}

async function flowVod(tv, results) {
    const flow = '5. Playback';
    const range = await tv.pageFetch('/api/vod/movie/200.webm', { headers: { Range: 'bytes=0-1023' } });
    verdict(results, flow, '/api/vod honours Range', range.status === 206 && /bytes 0-1023\//.test(range.headers['content-range'] || '') ? 'pass' : 'fail',
        `HTTP ${range.status} ${range.headers['content-range'] || ''}`);

    for (const [id, ext, canDecode] of [['200', 'webm', true], ['201', 'mp4', decodesH264(tv.engine)]]) {
        await tv.goto(`${APP_URL}/dashboard/watch/movie/${id}?autoplay=true`, { settleMs: 2000 });
        const started = await tv.waitFor(`(function(){var v=document.querySelector('video');return v&&v.currentTime>1;})()`, canDecode ? 20000 : 6000);
        const src = await tv.eval(`(function(){var v=document.querySelector('video');return v?(v.currentSrc||v.src):'';})()`);
        let seeked = false;
        if (started) {
            await tv.eval(`document.querySelector('video').currentTime = 30`);
            seeked = await tv.waitFor(`(function(){var v=document.querySelector('video');return v.currentTime>=29&&!v.seeking;})()`, 10000);
        }
        const shot = await tv.screenshot(`vod-${ext}`);
        const leak = src.indexOf(MOCK_PASS) !== -1;
        const viaServer = src.indexOf('/api/vod/movie/') !== -1;
        let status;
        if (leak || !viaServer) status = 'fail';
        else if (canDecode) status = started && seeked ? 'pass' : 'fail';
        else status = 'pass';
        verdict(results, flow, `movie ${ext}: plays and seeks via /api/vod`, status,
            `src=${src.replace(APP_URL, '')} started=${started} seeked=${seeked}${canDecode ? '' : ' (codec not in this build; URL path verified)'}`, shot);
    }

    await tv.goto(`${APP_URL}/dashboard/watch/live/100`, { settleMs: 2000 });
    const playlist = await tv.waitForRequest(/\/api\/relay\?.*streamId=100|\/api\/relay\?type=live/, 15000);
    const segments = playlist && await tv.waitForRequest(/\/api\/relay\?src=/, 15000);
    const live = await tv.waitFor(`(function(){var v=document.querySelector('video');return v&&v.currentTime>0.5;})()`, decodesH264(tv.engine) ? 15000 : 3000);
    const shot = await tv.screenshot('live-account');
    const nativeSrc = await tv.eval(`(function(){var v=document.querySelector('video');return !!v&&/\\/api\\/relay\\?type=live/.test(v.currentSrc||v.src);})()`);
    let status = playlist && segments && (live || !decodesH264(tv.engine)) ? 'pass' : 'fail';
    let note = `playlist ${playlist}, segments ${segments}, advancing ${live}`;
    if (status === 'fail' && playlist && nativeSrc && tv.engine.platform === 'webos') {
        // Low-tier webOS hands the relay playlist to the TV's own media pipeline, which desktop Chromium lacks.
        status = 'warn';
        note += ' (native webOS HLS path chosen by design; needs the real TV pipeline)';
    }
    verdict(results, flow, 'account live channel through relay', status, note, shot);
}

async function flowSettings(tv, results) {
    const flow = '6. Settings';
    await tv.goto(`${APP_URL}/dashboard/settings`, { settleMs: 3000 });
    await screenCheck(tv, results, flow, 'settings');
    await focusCheck(tv, results, flow, 'settings', ['down', 'down', 'down', 'up']);
    const save = await tv.pageFetch('/api/free-channels', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'saveConfig', defaultCountry: 'br', contactLabel: 'thegarra@gmail.com', contactUrl: 'mailto:thegarra@gmail.com' }),
    });
    verdict(results, flow, 'signed-in owner can save free-tier contact', save.status === 200 ? 'pass' : 'fail', `HTTP ${save.status}`);
}

async function flowPairing(tv, results) {
    const flow = '7. TV client';
    await tv.goto(BOOTSTRAP, { settleMs: 1500 });
    await tv.eval(`localStorage.clear()`);
    await tv.goto(BOOTSTRAP, { settleMs: 1500 });
    const ready = await tv.waitFor(`!document.getElementById('screen-login').classList.contains('hidden')`, 10000);
    const fields = ready ? await tv.eval(`!!(document.getElementById('portal-input') && document.getElementById('user-input') && document.getElementById('pass-input'))`) : false;
    const shot = await tv.screenshot('xtream-login');
    verdict(results, flow, 'packaged client asks for the IPTV provider, not a home server', ready && fields ? 'pass' : 'fail', ready ? 'Xtream login' : 'login screen missing', shot);
}

async function flowSignOut(tv, results) {
    const flow = '8. Sign out';
    await tv.goto(`${APP_URL}/garratv/home`, { settleMs: 1500 });
    const out = await tv.pageFetch('/api/config', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
    verdict(results, flow, 'sign out succeeds', out.status === 200 ? 'pass' : 'fail', `HTTP ${out.status}`);
    const after = await tv.pageFetch('/api/proxy', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: '' }) });
    verdict(results, flow, 'old session no longer opens the account', after.status === 401 ? 'pass' : 'fail', `HTTP ${after.status}`);
    await tv.goto(`${APP_URL}/`, { settleMs: 2500 });
    const visitor = await tv.waitFor(`location.pathname === '/garratv/free'`, 15000);
    const shot = await tv.screenshot('signed-out');
    verdict(results, flow, 'back to visitor mode', visitor ? 'pass' : 'fail', await tv.eval('location.pathname'), shot);
}

export async function runFlows(tv, results) {
    const steps = [
        ['visitor', () => flowVisitor(tv, results)],
        ['security', () => flowSecurity(tv, results)],
        ['login', async () => { tv.loggedIn = await flowLogin(tv, results); }],
        ['security-account', () => tv.loggedIn && flowSecurityWithAccount(results)],
        ['catalog', () => tv.loggedIn && flowCatalog(tv, results)],
        ['vod', () => tv.loggedIn && flowVod(tv, results)],
        ['settings', () => tv.loggedIn && flowSettings(tv, results)],
        ['pairing', () => tv.loggedIn && flowPairing(tv, results)],
        ['signout', () => tv.loggedIn && flowSignOut(tv, results)],
    ];
    for (const [name, step] of steps) {
        try {
            await Promise.race([
                step(),
                sleep(FLOW_TIMEOUT_MS).then(() => { throw new Error(`flow timed out after ${FLOW_TIMEOUT_MS / 1000}s`); }),
            ]);
        } catch (error) {
            const shot = await tv.screenshot(`${name}-error`).catch(() => '');
            verdict(results, name, 'flow completed', 'fail', error.message.slice(0, 300), shot);
        }
    }
}
