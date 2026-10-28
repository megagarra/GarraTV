#!/usr/bin/env node
/**
 * Packages the TV client for a platform.
 *
 *   node scripts/package-tv.mjs webos        → tv/dist/<id>_<version>_all.ipk
 *   node scripts/package-tv.mjs webos dev    → the "(Dev)" variant, own app id
 *   node scripts/package-tv.mjs tizen [dev]  → tv/dist/<name>.wgt
 *
 * The payload is `tv/bootstrap/` plus the generated assets. The client talks to
 * the viewer's IPTV provider directly. Version comes from package.json so the
 * store build and the server release never drift apart.
 *
 * The `dev` variant is a *separate installable app* (distinct id, amber icon,
 * "(Dev)" in the name) so a dev build and a prod build coexist on the same TV
 * instead of overwriting each other. Each remembers its own server address.
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const root = process.cwd();
const staging = path.join(root, '.tv-pkg');
const distDir = path.join(root, 'tv', 'dist');

const platform = process.argv[2];
const variant = process.argv[3];

if (platform !== 'webos' && platform !== 'tizen') {
    console.error('usage: node scripts/package-tv.mjs <webos|tizen> [dev]');
    process.exit(1);
}

if (variant !== undefined && variant !== 'dev') {
    console.error(`unknown variant "${variant}" — the only variant is "dev"`);
    process.exit(1);
}

const isDev = variant === 'dev';

const { version } = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf-8'));

/** webOS app id + display title per variant. */
const WEBOS_APP = isDev
    ? { id: 'com.xstreamplayer.tv.dev', title: 'XStream Player (Dev)' }
    : { id: 'com.xstreamplayer.tv', title: 'XStream Player' };

/** Tizen package id (exactly 10 alnum), application id and name per variant. */
const TIZEN_APP = isDev
    ? { pkg: 'XstrmPlyrD', appId: 'XstrmPlyrD.XStreamPlayerDev', name: 'XStream Player (Dev)' }
    : { pkg: 'XstrmPlyr0', appId: 'XstrmPlyr0.XStreamPlayer', name: 'XStream Player' };

/** `versionArg`: the Tizen CLI rejects `--version` and only knows `tizen version`. */
function has(command, versionArg = '--version') {
    return spawnSync(command, [versionArg], { stdio: 'ignore', shell: true }).status === 0;
}

function run(command, args) {
    const result = spawnSync(command, args, { stdio: 'inherit', shell: true });

    if (result.status !== 0) {
        process.exit(result.status ?? 1);
    }
}

function stagePayload() {
    fs.rmSync(staging, { recursive: true, force: true });
    fs.mkdirSync(staging, { recursive: true });
    fs.mkdirSync(distDir, { recursive: true });

    fs.cpSync(path.join(root, 'tv', 'bootstrap'), staging, { recursive: true });

    const assets = path.join(root, 'tv', 'assets');
    const iconSource = isDev ? 'icon-dev.png' : 'icon.png';

    if (!fs.existsSync(path.join(assets, iconSource))) {
        console.error('[package:tv] missing tv/assets — run: python3 scripts/gen-tv-assets.py');
        process.exit(1);
    }

    // Always staged as `icon.png` so the manifests do not need to know the variant.
    fs.copyFileSync(path.join(assets, iconSource), path.join(staging, 'icon.png'));
    fs.copyFileSync(path.join(assets, 'splash.png'), path.join(staging, 'splash.png'));
    writeServerList();
}

/** Addresses where this machine serves the Streamflix app the TV should open. */
function writeServerList() {
    const port = String(process.env.PORT || process.env.APP_PORT || '3000');
    const urls = [`http://10.0.2.2:${port}`];
    const nets = os.networkInterfaces();

    for (const entries of Object.values(nets)) {
        for (const entry of entries || []) {
            if (entry.family !== 'IPv4' && entry.family !== 4) continue;
            if (entry.internal) continue;
            if (String(entry.address).startsWith('169.254.')) continue;
            urls.push(`http://${entry.address}:${port}`);
        }
    }

    const unique = [...new Set(urls)];
    fs.writeFileSync(
        path.join(staging, 'server.js'),
        `/* Generated at package time. The TV opens the Streamflix app. */\nwindow.XSTREAM_SERVERS = ${JSON.stringify(unique)};\n`,
    );
}

function packageWebos() {
    if (!has('ares-package')) {
        console.error(
            '[package:tv] ares-package not found. Install the webOS CLI first:\n' +
            '  npm install -g @webos-tools/cli',
        );
        process.exit(1);
    }

    const appinfo = JSON.parse(
        fs.readFileSync(path.join(root, 'tv', 'webos', 'appinfo.json'), 'utf-8'),
    );
    appinfo.version = version;
    appinfo.id = WEBOS_APP.id;
    appinfo.title = WEBOS_APP.title;

    fs.writeFileSync(
        path.join(staging, 'appinfo.json'),
        `${JSON.stringify(appinfo, null, 4)}\n`,
    );

    run('ares-package', [staging, '--outdir', distDir, '--no-minify']);
}

function tizenCommand() {
    // The Studio used by the TV emulator lives in the repo checkout, not on PATH.
    const local = path.join(root, '.tv-browsers', 'tizen-studio', 'tools', 'ide', 'bin', 'tizen.bat');
    if (fs.existsSync(local)) return local;
    if (has('tizen', 'version')) return 'tizen';
    return null;
}

function packageTizen() {
    const tizen = tizenCommand();
    if (!tizen) {
        console.error(
            '[package:tv] tizen CLI not found. Install Tizen Studio and put its\n' +
            '  tools/ide/bin on PATH, then create a signing profile with:\n' +
            '  tizen security-profiles add -n xstream -a <author.p12> -p <password>',
        );
        process.exit(1);
    }

    const config = fs
        .readFileSync(path.join(root, 'tv', 'tizen', 'config.xml'), 'utf-8')
        .replace(/version="0\.0\.0"/, `version="${version}"`)
        .replace(/id="XstrmPlyr0\.XStreamPlayer"/, `id="${TIZEN_APP.appId}"`)
        .replace(/package="XstrmPlyr0"/, `package="${TIZEN_APP.pkg}"`)
        .replace(/<name>XStream Player<\/name>/, `<name>${TIZEN_APP.name}</name>`);

    fs.writeFileSync(path.join(staging, 'config.xml'), config);

    // `build-web` only copies the files into .buildResult, and the CLI-only Tizen Studio
    // install crashes on it (missing Eclipse classes), so the staged folder is signed as is.
    const buildResult = path.join(staging, '.buildResult');
    const built = spawnSync(tizen, ['build-web', '--', staging], { stdio: 'inherit', shell: true }).status === 0;
    if (!built) {
        console.warn('[package:tv] tizen build-web failed; packaging the staged files directly');
        fs.rmSync(buildResult, { recursive: true, force: true });
    }
    const packageDir = built ? buildResult : staging;
    run(tizen, ['package', '--type', 'wgt', '--', packageDir]);

    for (const file of fs.readdirSync(packageDir)) {
        if (file.endsWith('.wgt')) {
            fs.copyFileSync(path.join(packageDir, file), path.join(distDir, file));
        }
    }
}

console.log(`[package:tv] packaging ${platform} client v${version}${isDev ? ' (dev)' : ''}`);
stagePayload();

if (platform === 'webos') {
    packageWebos();
} else {
    packageTizen();
}

fs.rmSync(staging, { recursive: true, force: true });
console.log(`[package:tv] done → ${path.relative(root, distDir)}/`);
