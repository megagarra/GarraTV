/**
 * Builds the installable Windows app and, when the Windows 10 SDK is present,
 * the Microsoft Store package (.appx).
 *
 * The Store identity comes from Partner Center (Product identity of the
 * reserved "GarraTV" name). Those values are public and are the defaults below;
 * the env vars only override them (e.g. for a test identity):
 *   WINDOWS_STORE_IDENTITY
 *   WINDOWS_STORE_PUBLISHER          (CN=...)
 *   WINDOWS_STORE_PUBLISHER_DISPLAY
 */
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const desktop = path.join(root, 'desktop');
const staging = path.join(desktop, 'staging');
const serverDir = path.join(staging, 'server');
const nodeDir = path.join(staging, 'node');

function run(command, args) {
    return new Promise((resolve, reject) => {
        const child = spawn(command, args, {
            cwd: root,
            stdio: 'inherit',
            shell: false,
            env: process.env,
        });
        child.on('error', reject);
        child.on('exit', (code) => {
            if (code === 0) resolve();
            else reject(new Error(`${command} ${args.join(' ')} exited ${code}`));
        });
    });
}

function windowsSdkRoot() {
    const kits = path.join(process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)', 'Windows Kits', '10', 'bin');
    if (!fs.existsSync(kits)) return null;
    const versions = fs.readdirSync(kits)
        .filter((name) => fs.existsSync(path.join(kits, name, 'x64', 'makeappx.exe')))
        .sort();
    if (!versions.length) return null;
    return path.join(kits, versions[versions.length - 1], 'x64');
}

function copyNode() {
    fs.mkdirSync(nodeDir, { recursive: true });
    const exe = process.execPath;
    fs.copyFileSync(exe, path.join(nodeDir, 'node.exe'));
    const folder = path.dirname(exe);
    for (const name of fs.readdirSync(folder)) {
        if (name.toLowerCase().endsWith('.dll')) {
            fs.copyFileSync(path.join(folder, name), path.join(nodeDir, name));
        }
    }
}

function stageServer() {
    fs.rmSync(staging, { recursive: true, force: true });
    fs.mkdirSync(serverDir, { recursive: true });
    fs.cpSync(path.join(root, '.next', 'standalone'), serverDir, { recursive: true });
    fs.cpSync(path.join(root, 'public'), path.join(serverDir, 'public'), { recursive: true });
    fs.cpSync(path.join(root, '.next', 'static'), path.join(serverDir, '.next', 'static'), { recursive: true });
    fs.rmSync(path.join(serverDir, 'data'), { recursive: true, force: true });
    copyNode();
    fs.copyFileSync(path.join(root, 'tv', 'assets', 'icon.png'), path.join(desktop, 'icon.png'));
    fs.copyFileSync(path.join(root, 'LICENSE'), path.join(desktop, 'LICENSE'));

    pruneServer();

    const native = path.join(serverDir, 'node_modules', 'better-sqlite3', 'build', 'Release', 'better_sqlite3.node');
    if (!fs.existsSync(native)) {
        throw new Error('Standalone build is missing better-sqlite3. Refusing to package a player that cannot open its database.');
    }
    if (!fs.existsSync(path.join(serverDir, 'server.js'))) {
        throw new Error('Standalone build is missing server.js.');
    }
}

/**
 * Packages Next's standalone trace pulls in but the running player never loads:
 * sharp/@img back next/image's optimizer (the app renders plain <img>), and
 * typescript only appears as a config key in server.js. ~29 MB.
 */
const UNUSED_SERVER_MODULES = ['sharp', '@img', 'typescript'];

function pruneServer() {
    for (const name of UNUSED_SERVER_MODULES) {
        fs.rmSync(path.join(serverDir, 'node_modules', name), { recursive: true, force: true });
    }
    fs.writeFileSync(path.join(serverDir, 'compile-cache.cjs'), COMPILE_CACHE_PRELOAD);
}

/**
 * Loaded with --require by desktop/main.cjs. Keeps V8's compiled server code in
 * a cache folder so launches after the first skip most parse/compile work. Node
 * writes that cache at a clean exit, but the desktop app ends the server with a
 * hard kill, so it is flushed once the boot code has been compiled.
 */
const COMPILE_CACHE_PRELOAD = `const mod = require('module');
const dir = process.env.GARRATV_COMPILE_CACHE;
if (dir && typeof mod.enableCompileCache === 'function') {
    mod.enableCompileCache(dir);
    setTimeout(() => {
        try {
            if (typeof mod.flushCompileCache === 'function') mod.flushCompileCache();
        } catch {
            /* a cold start next time is the only cost */
        }
    }, 15000).unref();
}
`;

function syncDesktopPackage() {
    const app = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
    const desktopPackage = JSON.parse(fs.readFileSync(path.join(desktop, 'package.json'), 'utf8'));
    desktopPackage.version = app.version;
    desktopPackage.author = app.author;
    desktopPackage.license = app.license;
    fs.writeFileSync(path.join(desktop, 'package.json'), `${JSON.stringify(desktopPackage, null, 4)}\n`);
}

async function packageApp(sdk) {
    const { build } = await import('electron-builder');
    const targets = ['nsis'];
    if (sdk) targets.push('appx');

    process.env.CSC_IDENTITY_AUTO_DISCOVERY = 'false';

    await build({
        projectDir: root,
        win: targets,
        x64: true,
        config: {
            appId: 'com.garratv.desktop',
            productName: 'GarraTV',
            copyright: `Copyright © ${new Date().getFullYear()} ${JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8')).author}`,
            directories: {
                app: 'desktop',
                output: 'dist/windows',
            },
            files: ['main.cjs', 'package.json', 'icon.png', 'LICENSE', '!staging/**'],
            extraResources: [
                {
                    from: 'desktop/staging/server',
                    to: 'server',
                    // Without an explicit node_modules pattern the packager drops that folder.
                    filter: ['**/*', '**/node_modules/**/*'],
                },
                { from: 'desktop/staging/node', to: 'node' },
            ],
            afterPack: async (context) => {
                const dest = path.join(context.appOutDir, 'resources', 'server', 'node_modules');
                fs.cpSync(path.join(serverDir, 'node_modules'), dest, { recursive: true });
            },
            asar: true,
            // The Electron shell (main.cjs) uses only Electron's own modules; the
            // player server ships its node_modules under resources/server. Left to
            // itself, electron-builder resolves the root project's dependency tree
            // (desktop/package.json shares its name) and packs all of it — next,
            // @next/swc, sharp… ~357 MB nobody loads. `false` = handled externally.
            beforeBuild: async () => false,
            // Chromium ships ~55 UI locales (~49 MB); the app speaks pt-BR and en.
            electronLanguages: ['pt-BR', 'en-US'],
            // Smaller download; only the build gets slower.
            compression: 'maximum',
            win: {
                icon: 'desktop/icon.png',
                target: targets.map((target) => ({ target, arch: ['x64'] })),
            },
            nsis: {
                oneClick: true,
                perMachine: false,
                allowElevation: false,
                shortcutName: 'GarraTV',
                uninstallDisplayName: 'GarraTV',
                artifactName: 'GarraTV-Setup-${version}.${ext}',
                createDesktopShortcut: true,
                createStartMenuShortcut: true,
            },
            appx: {
                identityName: process.env.WINDOWS_STORE_IDENTITY || 'megagarra.GarraTV',
                publisher: process.env.WINDOWS_STORE_PUBLISHER || 'CN=107A335D-5708-4AE2-93AE-41059E96B243',
                publisherDisplayName: process.env.WINDOWS_STORE_PUBLISHER_DISPLAY || 'megagarra',
                applicationId: 'GarraTV',
                languages: ['pt-BR', 'en-US'],
                showNameOnTiles: true,
                artifactName: 'GarraTV-${version}.${ext}',
            },
        },
    });

    if (!sdk) {
        console.log('[package:windows] Windows 10 SDK not found, so the Store package (.appx) was skipped.');
        console.log('[package:windows] Install the SDK, then run npm run package:windows again.');
    }
    console.log(`[package:windows] node ${process.version} on ${os.platform()} ${os.arch()}`);
    console.log('[package:windows] done → dist/windows/');
}

const sdk = windowsSdkRoot();
console.log(`[package:windows] Windows SDK: ${sdk || 'not installed'}`);
if (process.env.GARRATV_SKIP_NEXT_BUILD === '1' && fs.existsSync(path.join(root, '.next', 'standalone', 'server.js'))) {
    console.log('[package:windows] reusing the Next.js build from this session');
} else {
    console.log('[package:windows] building the Next.js app');
    const npmCli = path.join(path.dirname(process.execPath), 'node_modules', 'npm', 'bin', 'npm-cli.js');
    await run(process.execPath, [npmCli, 'run', 'build']);
}
stageServer();
syncDesktopPackage();
await packageApp(sdk);
