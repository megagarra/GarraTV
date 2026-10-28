#!/usr/bin/env node
/**
 * Downloads the Chromium builds that stand in for each TV engine, plus ffmpeg for
 * the mock provider's test media, into `.tv-browsers/` (gitignored).
 *
 *   node scripts/tv-matrix/fetch-browsers.mjs            # all engines
 *   node scripts/tv-matrix/fetch-browsers.mjs c53 c79    # some
 */

import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { ENGINES } from './engines.mjs';

const ROOT = path.join(process.cwd(), '.tv-browsers');
const BUCKET = 'https://www.googleapis.com/storage/v1/b/chromium-browser-snapshots/o';
const DOWNLOAD = 'https://commondatastorage.googleapis.com/chromium-browser-snapshots';
const FFMPEG_URL = 'https://github.com/BtbN/FFmpeg-Builds/releases/download/latest/ffmpeg-master-latest-win64-gpl.zip';

async function listJson(url) {
    const response = await fetch(url);
    if (!response.ok) throw new Error(`${response.status} ${url}`);
    return response.json();
}

/** Newest Win_x64 snapshot at or below `base` that ships a chrome zip. */
async function findRevision(base) {
    const digits = String(base);
    for (let cut = digits.length - 2; cut >= digits.length - 4; cut--) {
        const prefix = digits.slice(0, cut);
        const listing = await listJson(`${BUCKET}?prefix=Win_x64/${prefix}&delimiter=/`);
        const revisions = (listing.prefixes || [])
            .map((p) => Number(p.split('/')[1]))
            .filter((rev) => rev <= base)
            .sort((a, b) => b - a);
        for (const rev of revisions.slice(0, 8)) {
            const files = await listJson(`${BUCKET}?prefix=Win_x64/${rev}/chrome-win`);
            const zip = (files.items || []).find((item) => /\/chrome-win(32)?\.zip$/.test(item.name));
            if (zip) return { rev, zipName: zip.name.split('/').pop() };
        }
    }
    throw new Error(`No snapshot found near ${base}`);
}

async function download(url, file) {
    const response = await fetch(url, { redirect: 'follow' });
    if (!response.ok || !response.body) throw new Error(`${response.status} ${url}`);
    await pipeline(Readable.fromWeb(response.body), fs.createWriteStream(file));
}

function unzip(zip, dir) {
    fs.mkdirSync(dir, { recursive: true });
    const result = spawnSync('tar', ['-xf', zip, '-C', dir], { stdio: 'inherit' });
    if (result.status !== 0) throw new Error(`tar failed for ${zip}`);
}

function findFile(dir, name) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isFile() && entry.name.toLowerCase() === name) return full;
        if (entry.isDirectory()) {
            const found = findFile(full, name);
            if (found) return found;
        }
    }
    return null;
}

async function fetchEngine(engine) {
    const dir = path.join(ROOT, engine.id);
    const manifest = path.join(dir, 'engine.json');
    if (fs.existsSync(manifest)) {
        console.log(`[fetch] ${engine.id}: already present`);
        return;
    }
    const { rev, zipName } = await findRevision(engine.base);
    console.log(`[fetch] ${engine.id}: Chromium ${engine.major} -> snapshot r${rev}`);
    const zip = path.join(ROOT, `${engine.id}.zip`);
    await download(`${DOWNLOAD}/Win_x64/${rev}/${zipName}`, zip);
    unzip(zip, dir);
    fs.rmSync(zip);
    const exe = findFile(dir, 'chrome.exe');
    if (!exe) throw new Error(`chrome.exe missing in ${dir}`);
    fs.writeFileSync(manifest, JSON.stringify({ id: engine.id, major: engine.major, revision: rev, exe }, null, 2));
}

/** Stable Chrome already installed on the machine stands in for Android TV's WebView. */
function fetchStable(engine) {
    const candidates = [
        path.join(process.env['ProgramFiles'] || '', 'Google/Chrome/Application/chrome.exe'),
        path.join(process.env['ProgramFiles(x86)'] || '', 'Google/Chrome/Application/chrome.exe'),
        path.join(process.env['LOCALAPPDATA'] || '', 'Google/Chrome/Application/chrome.exe'),
        path.join(process.env['ProgramFiles(x86)'] || '', 'Microsoft/Edge/Application/msedge.exe'),
    ];
    const exe = candidates.find((file) => fs.existsSync(file));
    if (!exe) throw new Error('No stable Chrome/Edge installed');
    const dir = path.join(ROOT, engine.id);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'engine.json'), JSON.stringify({ id: engine.id, major: 0, revision: 0, exe }, null, 2));
    console.log(`[fetch] stable: ${exe}`);
}

async function fetchFfmpeg() {
    const dir = path.join(ROOT, 'ffmpeg');
    if (fs.existsSync(dir) && findFile(dir, 'ffmpeg.exe')) {
        console.log('[fetch] ffmpeg: already present');
        return;
    }
    console.log('[fetch] ffmpeg');
    const zip = path.join(ROOT, 'ffmpeg.zip');
    await download(FFMPEG_URL, zip);
    unzip(zip, dir);
    fs.rmSync(zip);
}

const wanted = process.argv.slice(2);
fs.mkdirSync(ROOT, { recursive: true });

// `c76@660000` fetches another snapshot of an engine into .tv-browsers/c76-660000, to tell an
// app bug from a broken trunk build.
for (const arg of wanted) {
    const pin = /^(\w+)@(\d+)$/.exec(arg);
    const engine = pin && ENGINES.find((e) => e.id === pin[1]);
    if (!engine) continue;
    await fetchEngine({ ...engine, id: `${engine.id}-${pin[2]}`, base: Number(pin[2]) })
        .catch((error) => { console.error(`[fetch] ${arg} failed:`, error.message); process.exitCode = 1; });
}

for (const engine of ENGINES) {
    if (wanted.length && !wanted.includes(engine.id)) continue;
    try {
        if (engine.id === 'stable') fetchStable(engine);
        else await fetchEngine(engine);
    } catch (error) {
        console.error(`[fetch] ${engine.id} failed:`, error.message);
        process.exitCode = 1;
    }
}
if (!wanted.length || wanted.includes('ffmpeg')) {
    await fetchFfmpeg().catch((error) => {
        console.error('[fetch] ffmpeg failed:', error.message);
        process.exitCode = 1;
    });
}
