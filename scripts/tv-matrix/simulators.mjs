#!/usr/bin/env node
/**
 * Runs the flows inside LG's official webOS TV Simulators (Electron builds of the
 * TV's web engine, with H.264). The packaged client is staged like `ares-package`
 * does, launched in the simulator, and driven over the simulator's DevTools port.
 *
 *   node scripts/tv-matrix/simulators.mjs            # every simulator in .tv-browsers/webos-sim
 *   node scripts/tv-matrix/simulators.mjs 6.0 26     # some
 *
 * Simulators: https://webostv.developer.lge.com/develop/tools/simulator-installation
 * (unzip into .tv-browsers/webos-sim/). Uses ports 3110/3210 so run.mjs can run alongside.
 */

import fs from 'node:fs';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { setTimeout as sleep } from 'node:timers/promises';

process.env.APP_PORT ||= '3110';
process.env.MOCK_PORT ||= '3210';
process.env.TV_SERVER_DIR ||= 'server-sim';

const { TvBrowser } = await import('./driver.mjs');
const { runFlows } = await import('./flows.mjs');
const { startMockProvider } = await import('./mock-provider.mjs');
const { prepareServer, startServer, stopServer } = await import('./server.mjs');
const { OUT, loadResults, saveResults, writeReport } = await import('./report.mjs');

const ROOT = process.cwd();
const SIM_ROOT = path.join(ROOT, '.tv-browsers', 'webos-sim');
const APP_DIR = path.join(ROOT, '.tv-browsers', 'webos-app');
const RESULTS_FILE = 'results-simulators.json';
const DEBUG_PORT = 9555;

/** What each simulator release stands in for (webOS TV version -> model years). */
const TV_YEARS = {
    '6.0': 'webOS 6 (2021) - official LG simulator',
    22: 'webOS 22 (2022) - official LG simulator',
    23: 'webOS 23 (2023) - official LG simulator',
    24: 'webOS 24 (2024) - official LG simulator',
    25: 'webOS 25 (2025) - official LG simulator',
    26: 'webOS 26 (2026) - official LG simulator',
};

function findSimulators() {
    if (!fs.existsSync(SIM_ROOT)) return [];
    const found = [];
    const walk = (dir, depth) => {
        for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
            const full = path.join(dir, entry.name);
            const match = /^webOS_TV_([\d.]+)_Simulator_[\d.]+\.exe$/.exec(entry.name);
            if (entry.isFile() && match) found.push({ version: match[1], exe: full });
            else if (entry.isDirectory() && depth < 3) walk(full, depth + 1);
        }
    };
    walk(SIM_ROOT, 0);
    return found.sort((a, b) => parseFloat(a.version) - parseFloat(b.version));
}

/** Same payload as scripts/package-tv.mjs webos dev, unpacked (the simulator takes a directory). */
function stageApp() {
    const { version } = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf-8'));
    fs.rmSync(APP_DIR, { recursive: true, force: true });
    fs.cpSync(path.join(ROOT, 'tv', 'bootstrap'), APP_DIR, { recursive: true });
    fs.copyFileSync(path.join(ROOT, 'tv', 'assets', 'icon-dev.png'), path.join(APP_DIR, 'icon.png'));
    fs.copyFileSync(path.join(ROOT, 'tv', 'assets', 'splash.png'), path.join(APP_DIR, 'splash.png'));
    const appinfo = JSON.parse(fs.readFileSync(path.join(ROOT, 'tv', 'webos', 'appinfo.json'), 'utf-8'));
    Object.assign(appinfo, { id: 'com.xstreamplayer.tv.dev', title: 'XStream Player (Dev)', version });
    fs.writeFileSync(path.join(APP_DIR, 'appinfo.json'), JSON.stringify(appinfo, null, 4));
}

function killSimulators() {
    spawnSync('powershell', ['-NoProfile', '-Command', "Get-Process | Where-Object { $_.Path -like '*webOS_TV_*Simulator*' } | Stop-Process -Force"], { stdio: 'ignore' });
}

async function main() {
    const wanted = process.argv.slice(2);
    const simulators = findSimulators().filter((s) => !wanted.length || wanted.includes(s.version));
    if (!simulators.length) throw new Error(`No simulators in ${SIM_ROOT}`);
    fs.mkdirSync(OUT, { recursive: true });
    stageApp();
    prepareServer();
    const mock = await startMockProvider();

    for (const sim of simulators) {
        const id = `webos-sim-${sim.version}`;
        const engine = { id, major: 0, platform: 'webos', hasH264: true, tvs: TV_YEARS[sim.version] || `webOS ${sim.version} simulator` };
        const outDir = path.join(OUT, id);
        fs.rmSync(outDir, { recursive: true, force: true });
        console.log(`\n[sim] ${id}`);

        killSimulators();
        const server = await startServer();
        const child = spawn(sim.exe, [APP_DIR, `--remote-debugging-port=${DEBUG_PORT}`], { stdio: 'ignore', detached: false });
        const tv = new TvBrowser(engine, sim.exe, outDir);
        const results = [];
        try {
            // The simulator loads its own chrome (remote, keyboard...) as pages too; the app is the file:// one.
            await tv.attach(DEBUG_PORT, {
                match: (t) => /webos-app[\\/]+index\.html|webos-app\/index\.html/i.test(decodeURIComponent(t.url)),
                emulate: false,
                attempts: 120,
            });
            const version = await fetch(`http://127.0.0.1:${DEBUG_PORT}/json/version`).then((r) => r.json()).catch(() => ({}));
            tv.version = version.Browser ? `${version.Browser} (${(version['User-Agent'] || '').match(/webOSTV[\w.]+Simulator\/[\d.]+/)?.[0] || 'simulator'})` : 'unknown';
            console.log(`[sim]   ${tv.version}`);
            await sleep(3000);
            await tv.screenshot('client-boot');
            await runFlows(tv, results);
        } catch (error) {
            results.push({ flow: 'setup', check: 'simulator launch', status: 'fail', note: error.message, shot: '' });
        } finally {
            tv.cdp?.close();
            child.kill();
            killSimulators();
            await stopServer(server);
            await sleep(1000);
        }
        for (const result of results) {
            if (result.status !== 'pass') console.log(`[sim]   ${result.status.toUpperCase()} ${result.flow} / ${result.check}: ${result.note}`);
        }
        console.log(`[sim]   ${results.filter((r) => r.status === 'pass').length}/${results.length} passed`);
        const all = loadResults(RESULTS_FILE);
        all.engines[id] = { kind: 'simulator', tvs: engine.tvs, version: tv.version || 'n/a', results, at: new Date().toISOString() };
        saveResults(RESULTS_FILE, all);
        writeReport();
    }
    mock.close();
    console.log(`\n[sim] report: ${path.relative(ROOT, writeReport())}`);
}

main().catch((error) => {
    console.error(error);
    killSimulators();
    process.exit(1);
});
