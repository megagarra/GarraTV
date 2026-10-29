/**
 * Drives one Chromium build like a TV: 1920x1080 viewport, the TV's user agent and
 * remote-control key codes, over raw DevTools Protocol. Playwright/Puppeteer do not
 * speak Chromium 53's protocol, so only methods that exist there are used.
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { setTimeout as sleep } from 'node:timers/promises';
import { backKeyFor, userAgentFor } from './engines.mjs';

export const VIEWPORT = { width: 1920, height: 1080 };

const KEYS = {
    left: { keyCode: 37, key: 'ArrowLeft', code: 'ArrowLeft' },
    up: { keyCode: 38, key: 'ArrowUp', code: 'ArrowUp' },
    right: { keyCode: 39, key: 'ArrowRight', code: 'ArrowRight' },
    down: { keyCode: 40, key: 'ArrowDown', code: 'ArrowDown' },
    ok: { keyCode: 13, key: 'Enter', code: 'Enter' },
};

class CdpSession {
    constructor(ws) {
        this.ws = ws;
        this.nextId = 1;
        this.pending = new Map();
        this.listeners = new Map();
        ws.addEventListener('message', (event) => {
            const message = JSON.parse(typeof event.data === 'string' ? event.data : Buffer.from(event.data).toString());
            if (message.id && this.pending.has(message.id)) {
                const { resolve, reject } = this.pending.get(message.id);
                this.pending.delete(message.id);
                if (message.error) reject(new Error(`${message.error.message} (${message.error.code})`));
                else resolve(message.result);
            } else if (message.method) {
                for (const fn of this.listeners.get(message.method) || []) fn(message.params);
            }
        });
    }

    static connect(url) {
        return new Promise((resolve, reject) => {
            const ws = new WebSocket(url);
            ws.addEventListener('open', () => resolve(new CdpSession(ws)));
            ws.addEventListener('error', () => reject(new Error(`CDP connect failed: ${url}`)));
        });
    }

    send(method, params = {}, timeoutMs = 30000) {
        const id = this.nextId++;
        this.ws.send(JSON.stringify({ id, method, params }));
        return new Promise((resolve, reject) => {
            const timer = setTimeout(() => {
                this.pending.delete(id);
                reject(new Error(`CDP timeout: ${method}`));
            }, timeoutMs);
            this.pending.set(id, {
                resolve: (value) => { clearTimeout(timer); resolve(value); },
                reject: (error) => { clearTimeout(timer); reject(error); },
            });
        });
    }

    on(method, fn) {
        if (!this.listeners.has(method)) this.listeners.set(method, []);
        this.listeners.get(method).push(fn);
    }

    close() {
        try { this.ws.close(); } catch { /* already gone */ }
    }
}

async function getJson(url) {
    const response = await fetch(url);
    return response.json();
}

export class TvBrowser {
    constructor(engine, exe, outDir) {
        this.engine = engine;
        this.exe = exe;
        this.outDir = outDir;
        this.events = [];
        this.requests = [];
        this.step = 0;
    }

    async launch() {
        this.port = 9300 + Math.floor(Math.random() * 500);
        this.profile = fs.mkdtempSync(path.join(os.tmpdir(), `tvm-${this.engine.id}-`));
        const ua = userAgentFor(this.engine);
        const args = [
            `--remote-debugging-port=${this.port}`,
            '--remote-allow-origins=*',
            `--user-data-dir=${this.profile}`,
            '--no-first-run',
            '--no-default-browser-check',
            '--disable-background-networking',
            '--disable-component-update',
            '--autoplay-policy=no-user-gesture-required',
            // A window behind others stops producing frames (Chromium 68+ on Windows), which hangs
            // Page.captureScreenshot and pauses media. A TV screen is never occluded.
            '--disable-backgrounding-occluded-windows',
            '--disable-renderer-backgrounding',
            '--disable-background-timer-throttling',
            '--disable-features=Translate,MediaRouter,CalculateNativeWinOcclusion',
            '--window-position=0,0',
            `--window-size=${VIEWPORT.width},${VIEWPORT.height}`,
            ...(ua ? [`--user-agent=${ua}`] : []),
            ...(this.engine.extraArgs || []),
            ...(process.env.TVM_EXTRA_ARGS ? process.env.TVM_EXTRA_ARGS.split(' ') : []),
            'about:blank',
        ];
        this.process = spawn(this.exe, args, { stdio: 'ignore' });
        return this.attach(this.port);
    }

    /** Attaches to an already running DevTools endpoint (also used for the webOS simulator). */
    async attach(port, { match = () => true, emulate = true, attempts = 60 } = {}) {
        this.port = port;
        let target;
        for (let attempt = 0; attempt < attempts && !target; attempt++) {
            await sleep(500);
            try {
                const list = await getJson(`http://127.0.0.1:${this.port}/json`);
                target = list.find((item) => item.type === 'page' && item.webSocketDebuggerUrl && match(item));
            } catch { /* not up yet */ }
        }
        if (!target) throw new Error('browser did not expose a page target');
        this.targetUrl = target.url;

        const version = await getJson(`http://127.0.0.1:${this.port}/json/version`).catch(() => ({}));
        this.version = version.Browser || 'unknown';
        this.cdp = await CdpSession.connect(target.webSocketDebuggerUrl);

        // Runtime.exceptionThrown/consoleAPICalled are Chromium 54+; Console.messageAdded covers 53.
        this.cdp.on('Runtime.exceptionThrown', (p) => this.events.push({ kind: 'exception', text: p.exceptionDetails?.exception?.description || p.exceptionDetails?.text }));
        this.cdp.on('Console.messageAdded', (p) => {
            if (p.message?.level === 'error') this.events.push({ kind: 'console', text: `${p.message.text} ${p.message.url || ''}:${p.message.line || ''}` });
        });
        this.cdp.on('Log.entryAdded', (p) => {
            if (p.entry?.level === 'error' && p.entry.source !== 'network') this.events.push({ kind: 'log', text: p.entry.text });
        });
        // Media requests (native HLS, <video src>) never reach performance.getEntries; the network log does.
        this.cdp.on('Network.requestWillBeSent', (p) => { if (p.request?.url) this.requests.push(p.request.url); });
        await this.cdp.send('Runtime.enable');
        await this.cdp.send('Page.enable');
        await this.cdp.send('Console.enable').catch(() => undefined);
        await this.cdp.send('Log.enable').catch(() => undefined);
        await this.cdp.send('Network.enable').catch(() => undefined);
        if (!this.engine.hasH264) {
            // Open-source snapshots ship without H.264/AAC, so hls.js would refuse to start; real TVs
            // have the codec. Claiming support lets hls.js fetch, parse and transmux on the old engine.
            const source = `(function(){ if (!window.MediaSource) return; var native = MediaSource.isTypeSupported.bind(MediaSource);
                MediaSource.isTypeSupported = function (t) { return /avc1|mp4a/.test(t) || native(t); }; })();`;
            await this.cdp.send('Page.addScriptToEvaluateOnNewDocument', { source })
                .catch(() => this.cdp.send('Page.addScriptToEvaluateOnLoad', { scriptSource: source }))
                .catch(() => undefined);
        }
        if (emulate) {
            await this.cdp.send('Emulation.setDeviceMetricsOverride', {
                width: VIEWPORT.width, height: VIEWPORT.height, deviceScaleFactor: 1, mobile: false, fitWindow: false,
                screenWidth: VIEWPORT.width, screenHeight: VIEWPORT.height,
            });
        }
        return this;
    }

    async close() {
        this.cdp?.close();
        try { this.process?.kill(); } catch { /* exited */ }
        await sleep(800);
        try { fs.rmSync(this.profile, { recursive: true, force: true }); } catch { /* locked, temp dir */ }
    }

    /** Runs `expression` in the page; `awaitPromise` lets async snippets return. */
    async eval(expression, { awaitPromise = false } = {}) {
        // Runtime.evaluate awaitPromise is Chromium 54+; older engines park the result on window and get polled.
        if (awaitPromise && this.engine.major < 54) return this.evalPolled(expression);
        const result = await this.cdp.send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise });
        if (result.exceptionDetails) {
            throw new Error(`eval failed: ${result.exceptionDetails.exception?.description || result.exceptionDetails.text}`);
        }
        return result.result?.value;
    }

    async evalPolled(expression, timeoutMs = 30000) {
        const slot = `__matrix${Math.random().toString(36).slice(2)}`;
        await this.eval(`(function(){ window.${slot} = { done: false };
            Promise.resolve(${expression}).then(function (v) { window.${slot} = { done: true, value: v }; },
                function (e) { window.${slot} = { done: true, error: String(e) }; }); })()`);
        const until = Date.now() + timeoutMs;
        while (Date.now() < until) {
            const state = await this.eval(`window.${slot}`);
            if (state && state.done) {
                await this.eval(`delete window.${slot}`);
                if (state.error) throw new Error(`eval failed: ${state.error}`);
                return state.value;
            }
            await sleep(200);
        }
        throw new Error('eval timed out');
    }

    /** fetch() from inside the page, so cookies and origin are the TV's own. */
    async pageFetch(url, init = {}) {
        const expression = `fetch(${JSON.stringify(url)}, Object.assign({ credentials: 'same-origin' }, ${JSON.stringify(init)}))
            .then(function (r) { return r.text().then(function (t) {
                var h = {}; r.headers.forEach(function (v, k) { h[k] = v; });
                return { status: r.status, body: t.slice(0, 4000), headers: h };
            }); })
            .catch(function (e) { return { status: -1, body: String(e) }; })`;
        return this.eval(expression, { awaitPromise: true });
    }

    async goto(url, { settleMs = 2500 } = {}) {
        this.events.length = 0;
        this.requests.length = 0;
        let loaded = false;
        const onLoad = () => { loaded = true; };
        this.cdp.on('Page.loadEventFired', onLoad);
        await this.cdp.send('Page.navigate', { url });
        for (let i = 0; i < 60 && !loaded; i++) await sleep(250);
        await sleep(settleMs);
    }

    async waitFor(expression, timeoutMs = 15000) {
        const until = Date.now() + timeoutMs;
        while (Date.now() < until) {
            try {
                if (await this.eval(`!!(${expression})`)) return true;
            } catch { /* page navigating */ }
            await sleep(300);
        }
        return false;
    }

    async press(name, { delayMs = 450 } = {}) {
        const spec = name === 'back' ? backKeyFor(this.engine) : KEYS[name];
        const base = {
            windowsVirtualKeyCode: spec.keyCode, nativeVirtualKeyCode: spec.keyCode,
            key: spec.key, code: spec.code,
        };
        await this.cdp.send('Input.dispatchKeyEvent', { type: 'rawKeyDown', ...base });
        if (name === 'ok') await this.cdp.send('Input.dispatchKeyEvent', { type: 'char', text: '\r', ...base });
        await this.cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', ...base });
        await sleep(delayMs);
    }

    async type(text) {
        for (const ch of text) {
            await this.cdp.send('Input.dispatchKeyEvent', { type: 'char', text: ch });
        }
    }

    async screenshot(label) {
        this.step++;
        const name = `${String(this.step).padStart(2, '0')}-${label.replace(/[^a-z0-9-]+/gi, '-').toLowerCase()}.jpg`;
        try {
            const { data } = await this.cdp.send('Page.captureScreenshot', { format: 'jpeg', quality: 55 }, 10000);
            fs.mkdirSync(this.outDir, { recursive: true });
            fs.writeFileSync(path.join(this.outDir, name), Buffer.from(data, 'base64'));
            return name;
        } catch (error) {
            return `screenshot failed: ${error.message}`;
        }
    }

    /** Snapshot of page health: blank screen, app error trap, focus, collapsed overlays. */
    async health() {
        return this.eval(`(function () {
            var body = document.body;
            var text = body ? (body.innerText || '').replace(/\\s+/g, ' ').trim() : '';
            var visible = 0;
            var all = body ? body.getElementsByTagName('*') : [];
            for (var i = 0; i < all.length && visible < 5; i++) {
                var r = all[i].getBoundingClientRect();
                if (r.width > 40 && r.height > 20) visible++;
            }
            var active = document.activeElement;
            var focus = active && active !== body ? {
                tag: active.tagName,
                focusable: !!(active.closest && active.closest('[data-focusable="true"]')) || active.getAttribute('data-focusable') === 'true',
                label: (active.getAttribute('aria-label') || active.innerText || active.value || '').replace(/\\s+/g, ' ').trim().slice(0, 60),
                rect: (function (r) { return [Math.round(r.left), Math.round(r.top), Math.round(r.width), Math.round(r.height)]; })(active.getBoundingClientRect())
            } : null;
            var collapsed = [];
            var nodes = body ? body.querySelectorAll('*') : [];
            for (var j = 0; j < nodes.length && collapsed.length < 5; j++) {
                var el = nodes[j];
                var cs = getComputedStyle(el);
                if (cs.position !== 'absolute' && cs.position !== 'fixed') continue;
                if (cs.top !== '0px' || cs.bottom !== '0px' || cs.left !== '0px' || cs.right !== '0px') continue;
                var parent = el.parentElement && el.parentElement.getBoundingClientRect();
                var box = el.getBoundingClientRect();
                if (parent && parent.width > 50 && parent.height > 50 && (box.width < 2 || box.height < 2)) {
                    collapsed.push((el.className && el.className.toString ? el.className.toString() : el.tagName).slice(0, 80));
                }
            }
            var insetUnparsed = 0;
            for (var k = 0; k < nodes.length; k++) {
                var s = nodes[k].getAttribute('class') || '';
                if (/(^|\\s)inset-0(\\s|$)/.test(s)) {
                    var c = getComputedStyle(nodes[k]);
                    if (c.top === 'auto' && c.left === 'auto') insetUnparsed++;
                }
            }
            return {
                url: location.pathname + location.search,
                textLength: text.length,
                textSample: text.slice(0, 160),
                visibleBlocks: visible,
                errors: (window.__GARRATV_ERRORS || []).slice(0, 10),
                focus: focus,
                collapsed: collapsed,
                insetUnparsed: insetUnparsed,
                errorBoundary: !!document.querySelector('[data-error-boundary]')
            };
        })()`);
    }

    async waitForRequest(pattern, timeoutMs = 15000) {
        const until = Date.now() + timeoutMs;
        while (Date.now() < until) {
            if (this.requests.some((url) => pattern.test(url))) return true;
            await sleep(300);
        }
        return false;
    }

    drainEvents() {
        return this.events.splice(0, this.events.length);
    }
}
