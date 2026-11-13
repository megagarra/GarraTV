#!/usr/bin/env node
/**
 * Packages the server-less Android app (phone + Android TV / Google TV).
 *
 *   node scripts/package-android.mjs          → dist/android/GarraTV-<version>.apk (sideload)
 *                                               + dist/android/GarraTV-<version>.aab (Google Play)
 *   node scripts/package-android.mjs --web    → only the static web bundle (no Gradle)
 *
 * The app is the same Next.js UI, exported as static files, with the project's
 * own API route handlers bundled into the page and run in the WebView (see
 * android/web/). Nothing in the web/Windows sources changes for this: the
 * project is copied to .android-pkg/, where a few server-only pieces are
 * swapped for their Android versions (android/web/overlay/) before building.
 */

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';

const root = process.cwd();
const staging = path.join(root, '.android-pkg');
const androidDir = path.join(root, 'android');
const webSrc = path.join(androidDir, 'web');
const assetsDir = path.join(androidDir, 'app', 'src', 'main', 'assets', 'web');
const distDir = path.join(root, 'dist', 'android');
const webOnly = process.argv.includes('--web');

const { version } = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf-8'));

/** What the Next build needs; everything else (data/, desktop/, tv/, dist/) stays out. */
const PROJECT_ENTRIES = [
    'app', 'components', 'public', 'postcss', 'postcss.config.mjs',
    'tailwind.config.ts', 'tsconfig.json', 'package.json', 'next-env.d.ts',
];

/** API routes the Kotlin shell serves (streaming) or that need a server to exist at all. */
const EXCLUDED_API = [/^relay(\/|$)/, /^vod(\/|$)/, /^devices(\/|$)/, /^remote-access(\/|$)/];

function log(message) {
    console.log(`[package:android] ${message}`);
}

function fail(message) {
    console.error(`[package:android] ${message}`);
    process.exit(1);
}

function run(command, args, options = {}) {
    const result = spawnSync(command, args, { stdio: 'inherit', shell: process.platform === 'win32', ...options });
    // Arguments stay out of the message: the keytool call carries the key password.
    if (result.status !== 0) fail(`${path.basename(command)} failed (${result.status})`);
}

function walk(dir, visit, rel = '') {
    for (const entry of fs.readdirSync(path.join(dir, rel), { withFileTypes: true })) {
        const child = rel ? `${rel}/${entry.name}` : entry.name;
        if (entry.isDirectory()) walk(dir, visit, child);
        else visit(child);
    }
}

/** `[id]` → one capture, `(group)` folders vanish from the URL. */
function routePattern(segments) {
    const keys = [];
    const parts = [];
    for (const segment of segments) {
        if (/^\(.*\)$/.test(segment)) continue;
        const dynamic = /^\[(\.\.\.)?(.+)\]$/.exec(segment);
        if (dynamic) {
            keys.push(dynamic[2]);
            parts.push(dynamic[1] ? '(.+)' : '([^/]+)');
        } else {
            parts.push(segment.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
        }
    }
    return { keys, source: `^/${parts.join('/')}$` };
}

function stage() {
    log('staging project');
    fs.rmSync(staging, { recursive: true, force: true });
    fs.mkdirSync(staging, { recursive: true });
    for (const entry of PROJECT_ENTRIES) {
        const from = path.join(root, entry);
        if (fs.existsSync(from)) fs.cpSync(from, path.join(staging, entry), { recursive: true });
    }
    fs.symlinkSync(path.join(root, 'node_modules'), path.join(staging, 'node_modules'), 'junction');

    // The Android pieces: overlays replace server-only modules, the rest is new code.
    fs.cpSync(path.join(webSrc, 'overlay'), staging, { recursive: true });
    fs.cpSync(webSrc, path.join(staging, 'android-web'), {
        recursive: true,
        filter: (source) => !source.startsWith(path.join(webSrc, 'overlay')),
    });

    // Route handlers move out of app/ (a static export cannot have any) into the bundle.
    fs.renameSync(path.join(staging, 'app', 'api'), path.join(staging, 'localapi'));

    // Here the server code IS client code; Next rejects the marker at compile time,
    // before any alias could neutralize it, so the import line itself goes.
    for (const dir of ['app', 'localapi']) {
        walk(path.join(staging, dir), (file) => {
            if (!/\.(ts|tsx)$/.test(file)) return;
            const full = path.join(staging, dir, file);
            const source = fs.readFileSync(full, 'utf-8');
            const stripped = source.replace(/^import ['"]server-only['"];?\r?\n/m, '');
            if (stripped !== source) fs.writeFileSync(full, stripped);
        });
    }
}

function generateApiRoutes() {
    const routes = [];
    walk(path.join(staging, 'localapi'), (file) => {
        if (!file.endsWith('/route.ts') && file !== 'route.ts') return;
        const dir = file.replace(/\/?route\.ts$/, '');
        if (EXCLUDED_API.some(rule => rule.test(dir))) return;
        const { keys, source } = routePattern(['api', ...dir.split('/').filter(Boolean)]);
        routes.push({ dir, keys, source });
    });
    // Static paths before dynamic ones, so /api/subtitles/config never matches a [param].
    routes.sort((a, b) => a.keys.length - b.keys.length || b.dir.length - a.dir.length);

    const lines = ['/* Generated by scripts/package-android.mjs. */'];
    routes.forEach((route, index) => lines.push(`import * as route${index} from '@/localapi/${route.dir ? `${route.dir}/` : ''}route';`));
    lines.push('', 'export const API_ROUTES = [');
    routes.forEach((route, index) => {
        lines.push(`    { pattern: new RegExp(${JSON.stringify(route.source)}), keys: ${JSON.stringify(route.keys)}, module: route${index} as unknown as Record<string, unknown> },`);
    });
    lines.push('];', '');
    fs.writeFileSync(path.join(staging, 'android-web', 'routes.generated.ts'), lines.join('\n'));
    log(`${routes.length} API routes bundled`);
}

/**
 * Every dynamic page is exported once under the placeholder `_` (the Kotlin shell
 * serves it for any id) and reads its real params from the URL instead.
 */
function prepareDynamicPages() {
    const pages = [];
    walk(path.join(staging, 'app'), (file) => {
        if (!/(^|\/)page\.tsx$/.test(file) || !file.includes('[')) return;
        pages.push(file.replace(/\/?page\.tsx$/, ''));
    });

    for (const dir of pages) {
        const pageDir = path.join(staging, 'app', dir);
        const clientFile = path.join(pageDir, 'ClientPage.tsx');
        fs.renameSync(path.join(pageDir, 'page.tsx'), clientFile);

        let source = fs.readFileSync(clientFile, 'utf-8');
        source = source.replace(/import\s*\{([^}]*)\}\s*from\s*['"]next\/navigation['"];?/, (match, names) => {
            const kept = names.split(',').map(name => name.trim()).filter(name => name && name !== 'useParams');
            const nav = kept.length ? `import { ${kept.join(', ')} } from 'next/navigation';` : '';
            return `${nav}\nimport { useParams } from '@/android-web/useParams';`;
        });
        fs.writeFileSync(clientFile, source);

        const keys = [...dir.matchAll(/\[(?:\.\.\.)?([^\]]+)\]/g)].map(match => match[1]);
        const placeholder = Object.fromEntries(keys.map(key => [key, '_']));
        fs.writeFileSync(path.join(pageDir, 'page.tsx'), [
            `import ClientPage from './ClientPage';`,
            '',
            `export function generateStaticParams() {`,
            `    return [${JSON.stringify(placeholder)}];`,
            `}`,
            '',
            `export const dynamicParams = false;`,
            '',
            `export default function Page() {`,
            `    return <ClientPage />;`,
            `}`,
            '',
        ].join('\n'));
    }

    const lines = ['/* Generated by scripts/package-android.mjs. */', 'export const PAGE_ROUTES = ['];
    for (const dir of pages) {
        const { keys, source } = routePattern(dir.split('/'));
        lines.push(`    { pattern: new RegExp(${JSON.stringify(source)}), keys: ${JSON.stringify(keys)} },`);
    }
    lines.push('];', '');
    fs.writeFileSync(path.join(staging, 'android-web', 'pageRoutes.generated.ts'), lines.join('\n'));
    log(`${pages.length} dynamic pages prepared`);
    return pages.map(dir => dir.split('/').filter(segment => !/^\(.*\)$/.test(segment)).join('/'));
}

/** The root layout asks the request for cookies/headers; an export has no request. */
function patchRootLayout() {
    const file = path.join(staging, 'app', 'layout.tsx');
    let source = fs.readFileSync(file, 'utf-8');
    const replace = (pattern, value, what) => {
        if (!pattern.test(source)) fail(`app/layout.tsx changed: cannot find ${what} — update patchRootLayout()`);
        source = source.replace(pattern, value);
    };
    replace(/import \{ cookies, headers \} from "next\/headers";\n/, '', 'the next/headers import');
    replace(
        /  const headersList = await headers\(\);[\s\S]*?localeFromAcceptLanguage\(headersList\.get\("accept-language"\)\);\n/,
        '  const remoteAccess = { configured: false };\n  const shouldGateRemoteAccess = false;\n  const locale = DEFAULT_LOCALE;\n',
        'the request-dependent locale/remote-access block',
    );
    replace(/(\s*)<I18nProvider initialLocale=\{locale\}>/, '$1<AndroidBoot />$1<I18nProvider initialLocale={locale}>', 'the I18nProvider');
    source = `import AndroidBoot from "@/android-web/AndroidBoot";\nimport { DEFAULT_LOCALE } from "@/app/lib/i18n";\n${source}`;
    fs.writeFileSync(file, source);
}

function writeNextConfig() {
    fs.rmSync(path.join(staging, 'next.config.ts'), { force: true });
    fs.rmSync(path.join(staging, 'middleware.ts'), { force: true });
    fs.writeFileSync(path.join(staging, 'next.config.mjs'), `// Generated by scripts/package-android.mjs.
import path from 'node:path';

const shims = path.join(process.cwd(), 'android-web', 'shims');
const shim = (name) => path.join(shims, name);

export default {
    output: 'export',
    trailingSlash: true,
    images: { unoptimized: true },
    transpilePackages: ['lucide-react', 'framer-motion', 'next'],
    // The same sources are type-checked by the regular build.
    typescript: { ignoreBuildErrors: true },
    webpack(config, { isServer, webpack }) {
        config.resolve.alias = { ...config.resolve.alias, 'server-only$': shim('empty.ts') };
        if (!isServer) {
            Object.assign(config.resolve.alias, {
                'better-sqlite3$': shim('better-sqlite3.ts'),
                'fs$': shim('fs.ts'),
                'node:fs$': shim('fs.ts'),
                'fs/promises$': shim('fs-promises.ts'),
                'node:fs/promises$': shim('fs-promises.ts'),
                'path$': shim('path.ts'),
                'node:path$': shim('path.ts'),
                'crypto$': shim('crypto.ts'),
                'node:crypto$': shim('crypto.ts'),
                'next/server$': shim('next-server.ts'),
            });
            config.plugins.push(new webpack.ProvidePlugin({ Buffer: ['buffer', 'Buffer'] }));
        }
        return config;
    },
};
`);
}

function buildWeb(dynamicPages) {
    log('building static export');
    run(process.execPath, [path.join(root, 'node_modules', 'next', 'dist', 'bin', 'next'), 'build', '--webpack'], {
        cwd: staging,
        shell: false,
        env: { ...process.env, NEXT_TELEMETRY_DISABLED: '1' },
    });
    const out = path.join(staging, 'out');
    if (!fs.existsSync(path.join(out, 'index.html'))) fail('static export produced no index.html');

    fs.rmSync(assetsDir, { recursive: true, force: true });
    fs.mkdirSync(path.dirname(assetsDir), { recursive: true });
    fs.cpSync(out, assetsDir, { recursive: true });
    fs.writeFileSync(path.join(assetsDir, '__dynamic-routes.json'), JSON.stringify(dynamicPages, null, 2));
    log(`web bundle → ${path.relative(root, assetsDir)}`);
}

function findJava17() {
    const candidates = [process.env.JAVA17_HOME, process.env.JAVA_HOME];
    const adoptium = 'C:\\Program Files\\Eclipse Adoptium';
    if (fs.existsSync(adoptium)) {
        for (const name of fs.readdirSync(adoptium)) {
            if (/^jdk-(17|21)\./.test(name)) candidates.push(path.join(adoptium, name));
        }
    }
    return candidates.find(home => home && fs.existsSync(path.join(home, 'bin', process.platform === 'win32' ? 'java.exe' : 'java')));
}

function findAndroidSdk() {
    const candidates = [
        process.env.ANDROID_HOME,
        process.env.ANDROID_SDK_ROOT,
        process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA, 'Android', 'Sdk'),
        process.env.HOME && path.join(process.env.HOME, 'Android', 'Sdk'),
    ];
    return candidates.find(dir => dir && fs.existsSync(path.join(dir, 'platforms')));
}

/** A local release key, created once and never committed (see android/.gitignore). */
function ensureKeystore(javaHome) {
    const keyDir = path.join(androidDir, 'keystore');
    const props = path.join(keyDir, 'keystore.properties');
    if (fs.existsSync(props)) return;
    fs.mkdirSync(keyDir, { recursive: true });
    const password = crypto.randomBytes(18).toString('base64url');
    run(path.join(javaHome, 'bin', 'keytool'), [
        '-genkeypair', '-noprompt', '-keystore', path.join(keyDir, 'release.jks'),
        '-alias', 'garratv', '-keyalg', 'RSA', '-keysize', '2048', '-validity', '10000',
        '-storepass', password, '-keypass', password, '-dname', 'CN=GarraTV',
    ], { shell: false });
    fs.writeFileSync(props, `storeFile=release.jks\nstorePassword=${password}\nkeyAlias=garratv\nkeyPassword=${password}\n`);
    log('release keystore created in android/keystore/ (back it up: updates need the same key)');
}

function buildApk() {
    const javaHome = findJava17();
    if (!javaHome) fail('JDK 17 not found (set JAVA17_HOME)');
    const sdk = findAndroidSdk();
    if (!sdk) fail('Android SDK not found (set ANDROID_HOME)');
    fs.writeFileSync(path.join(androidDir, 'local.properties'), `sdk.dir=${sdk.replace(/\\/g, '\\\\')}\n`);
    ensureKeystore(javaHome);

    log('building APK and Play bundle');
    const gradlew = path.join(androidDir, process.platform === 'win32' ? 'gradlew.bat' : 'gradlew');
    run(gradlew, ['assembleRelease', 'bundleRelease', `-PappVersionName=${version}`, '--console=plain'], {
        cwd: androidDir,
        env: { ...process.env, JAVA_HOME: javaHome },
    });

    const apk = path.join(androidDir, 'app', 'build', 'outputs', 'apk', 'release', 'app-release.apk');
    if (!fs.existsSync(apk)) fail('Gradle finished but no APK was produced');
    fs.mkdirSync(distDir, { recursive: true });
    const target = path.join(distDir, `GarraTV-${version}.apk`);
    fs.copyFileSync(apk, target);

    // Google Play only takes App Bundles; it builds the per-device APKs itself.
    const aab = path.join(androidDir, 'app', 'build', 'outputs', 'bundle', 'release', 'app-release.aab');
    if (!fs.existsSync(aab)) fail('Gradle finished but no App Bundle was produced');
    const bundleTarget = path.join(distDir, `GarraTV-${version}.aab`);
    fs.copyFileSync(aab, bundleTarget);
    log(`done → ${path.relative(root, target)} and ${path.relative(root, bundleTarget)}`);
}

stage();
generateApiRoutes();
const dynamicPages = prepareDynamicPages();
patchRootLayout();
writeNextConfig();
buildWeb(dynamicPages);
if (!webOnly) buildApk();
