#!/usr/bin/env node
/**
 * TV compatibility matrix: every engine in engines.mjs runs every flow in flows.mjs
 * against an isolated production server and the mock Xtream provider.
 *
 *   npm run build && node scripts/tv-matrix/fetch-browsers.mjs
 *   node scripts/tv-matrix/run.mjs              # all engines
 *   node scripts/tv-matrix/run.mjs c53 c79      # some
 *
 * Output: test-results/tv/<engine>/*.jpg, results.json and report.md.
 */

import fs from 'node:fs';
import path from 'node:path';
import { ENGINES } from './engines.mjs';
import { TvBrowser } from './driver.mjs';
import { runFlows } from './flows.mjs';
import { startMockProvider } from './mock-provider.mjs';
import { prepareServer, startServer, stopServer } from './server.mjs';
import { OUT, loadResults, saveResults, writeReport } from './report.mjs';

const ROOT = process.cwd();
const RESULTS_FILE = 'results.json';

async function main() {
    const wanted = process.argv.slice(2);
    fs.mkdirSync(OUT, { recursive: true });
    prepareServer();
    const mock = await startMockProvider();

    for (const engine of ENGINES) {
        if (wanted.length && !wanted.includes(engine.id)) continue;
        const manifestFile = path.join(ROOT, '.tv-browsers', engine.id, 'engine.json');
        if (!fs.existsSync(manifestFile)) {
            console.warn(`[matrix] ${engine.id}: not downloaded, skipping`);
            continue;
        }
        const manifest = JSON.parse(fs.readFileSync(manifestFile, 'utf-8'));
        const outDir = path.join(OUT, engine.id);
        fs.rmSync(outDir, { recursive: true, force: true });

        console.log(`\n[matrix] ${engine.id} (${engine.tvs})`);
        const server = await startServer();
        const tv = new TvBrowser(engine, manifest.exe, outDir);
        const results = [];
        try {
            await tv.launch();
            console.log(`[matrix]   ${tv.version}`);
            await runFlows(tv, results);
        } catch (error) {
            results.push({ flow: 'setup', check: 'browser launch', status: 'fail', note: error.message, shot: '' });
        } finally {
            await tv.close();
            await stopServer(server);
        }
        for (const result of results) {
            if (result.status !== 'pass') console.log(`[matrix]   ${result.status.toUpperCase()} ${result.flow} / ${result.check}: ${result.note}`);
        }
        const pass = results.filter((r) => r.status === 'pass').length;
        console.log(`[matrix]   ${pass}/${results.length} passed`);

        const all = loadResults(RESULTS_FILE);
        all.engines[engine.id] = { kind: 'engine', tvs: engine.tvs, version: tv.version || 'n/a', results, at: new Date().toISOString() };
        saveResults(RESULTS_FILE, all);
        writeReport();
    }

    mock.close();
    console.log(`\n[matrix] report: ${path.relative(ROOT, writeReport())}`);
}

main().catch((error) => {
    console.error(error);
    process.exit(1);
});
