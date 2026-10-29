const { app, BrowserWindow, dialog, shell } = require('electron');
const { spawn } = require('child_process');
const fs = require('fs');
const http = require('http');
const net = require('net');
const path = require('path');

app.setName('GarraTV');
app.setAppUserModelId('com.garratv.desktop');
app.setPath('userData', path.join(app.getPath('appData'), 'GarraTV'));

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
    app.quit();
}

let mainWindow = null;
let serverProcess = null;
let stopping = false;
let serverReady = false;

// Shown the moment Electron is ready, while the player server boots behind it,
// instead of a window that only appears once the server answers.
const SPLASH_HTML = `<!doctype html><html><head><meta charset="utf-8"><style>
html,body{margin:0;height:100%;background:#000;color:#fff;font-family:Segoe UI,Arial,sans-serif;overflow:hidden}
body{display:flex;flex-direction:column;align-items:center;justify-content:center}
.logo{font-weight:900;font-size:44px;letter-spacing:.02em;color:#E50914;text-transform:uppercase}
.bar{margin-top:28px;width:220px;height:3px;background:#333;border-radius:2px;overflow:hidden}
.bar i{display:block;width:40%;height:100%;background:#E50914;animation:slide 1.1s ease-in-out infinite}
@keyframes slide{0%{transform:translateX(-100%)}100%{transform:translateX(250%)}}
</style></head><body><div class="logo">GarraTV</div><div class="bar"><i></i></div></body></html>`;

function serverDirectory() {
    if (app.isPackaged) return path.join(process.resourcesPath, 'server');
    return path.join(__dirname, 'staging', 'server');
}

function nodeExecutable() {
    if (app.isPackaged) return path.join(process.resourcesPath, 'node', 'node.exe');
    return path.join(__dirname, 'staging', 'node', 'node.exe');
}

function findPort() {
    return new Promise((resolve, reject) => {
        const probe = net.createServer();
        probe.once('error', reject);
        probe.listen(0, '127.0.0.1', () => {
            const address = probe.address();
            const port = address && typeof address === 'object' ? address.port : 0;
            probe.close(() => resolve(port));
        });
    });
}

function waitForServer(port) {
    const deadline = Date.now() + 60000;
    // A static file answers as soon as the server listens; polling a page made
    // every probe pay for a full server render.
    return new Promise((resolve, reject) => {
        const attempt = () => {
            if (stopping) {
                reject(new Error('stopped'));
                return;
            }
            const request = http.get(
                { hostname: '127.0.0.1', port, path: '/polyfills-legacy.js', timeout: 2000 },
                (response) => {
                    response.resume();
                    if (response.statusCode && response.statusCode < 500) {
                        resolve();
                        return;
                    }
                    retry();
                },
            );
            request.on('error', retry);
            request.on('timeout', () => {
                request.destroy();
                retry();
            });
        };
        const retry = () => {
            if (Date.now() > deadline) {
                reject(new Error('The local player did not start.'));
                return;
            }
            setTimeout(attempt, 100);
        };
        attempt();
    });
}

function stopServer() {
    stopping = true;
    if (!serverProcess || !serverProcess.pid) return;
    const pid = serverProcess.pid;
    if (process.platform === 'win32') {
        spawn('taskkill', ['/pid', String(pid), '/t', '/f'], { windowsHide: true });
        return;
    }
    serverProcess.kill();
}

async function startServer() {
    const serverDir = serverDirectory();
    const nodeExe = nodeExecutable();
    if (!fs.existsSync(path.join(serverDir, 'server.js')) || !fs.existsSync(nodeExe)) {
        throw new Error('The Windows package is missing its player files.');
    }

    const port = await findPort();
    const dataDir = path.join(app.getPath('userData'), 'data');
    fs.mkdirSync(dataDir, { recursive: true });

    // V8 keeps the compiled server code between launches (see compile-cache.cjs,
    // written by scripts/package-windows.mjs), so every start after the first
    // skips most of the JavaScript parse/compile work.
    const compileCache = path.join(app.getPath('userData'), 'compile-cache');
    fs.mkdirSync(compileCache, { recursive: true });

    const logPath = path.join(app.getPath('userData'), 'server.log');
    const log = fs.createWriteStream(logPath, { flags: 'a' });
    log.write(`\n--- ${new Date().toISOString()} port ${port} ---\n`);

    const preload = path.join(serverDir, 'compile-cache.cjs');
    const args = fs.existsSync(preload) ? ['--require', preload, 'server.js'] : ['server.js'];
    serverProcess = spawn(nodeExe, args, {
        cwd: serverDir,
        windowsHide: true,
        env: {
            ...process.env,
            NODE_ENV: 'production',
            HOSTNAME: '127.0.0.1',
            PORT: String(port),
            GARRATV_DATA_DIR: dataDir,
            NEXT_TELEMETRY_DISABLED: '1',
            GARRATV_COMPILE_CACHE: compileCache,
        },
    });
    if (serverProcess.stdout) serverProcess.stdout.pipe(log);
    if (serverProcess.stderr) serverProcess.stderr.pipe(log);
    serverProcess.on('exit', (code) => {
        if (!serverReady || stopping || code === 0 || code === null) return;
        dialog.showErrorBox(
            'GarraTV',
            `The player stopped (code ${code}). Details: ${logPath}`,
        );
    });

    try {
        await waitForServer(port);
        serverReady = true;
    } catch (error) {
        log.write(`startup failed: ${error instanceof Error ? error.message : String(error)}\n`);
        throw error;
    }
    return port;
}

function createWindow() {
    const icon = path.join(__dirname, 'icon.png');
    mainWindow = new BrowserWindow({
        width: 1440,
        height: 900,
        minWidth: 1100,
        minHeight: 700,
        backgroundColor: '#000000',
        autoHideMenuBar: true,
        title: 'GarraTV',
        show: false,
        icon: fs.existsSync(icon) ? icon : undefined,
        webPreferences: {
            contextIsolation: true,
            nodeIntegration: false,
            sandbox: true,
            // The preview and the player start with sound. Chromium would
            // otherwise block that until a click.
            autoplayPolicy: 'no-user-gesture-required',
            spellcheck: false,
        },
    });
    mainWindow.setMenuBarVisibility(false);
    mainWindow.once('ready-to-show', () => {
        if (mainWindow) mainWindow.show();
    });
    mainWindow.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(SPLASH_HTML)}`);
}

function openPlayer(port) {
    if (!mainWindow) return;
    const localPrefix = `http://127.0.0.1:${port}/`;
    mainWindow.webContents.on('will-navigate', (event, url) => {
        if (url.startsWith(localPrefix)) return;
        event.preventDefault();
        shell.openExternal(url);
    });
    mainWindow.webContents.setWindowOpenHandler(({ url }) => {
        if (!url.startsWith(localPrefix)) shell.openExternal(url);
        return { action: 'deny' };
    });

    mainWindow.loadURL(`${localPrefix}garratv`);
}

app.on('second-instance', () => {
    if (!mainWindow) return;
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.show();
    mainWindow.focus();
});

app.on('before-quit', stopServer);
app.on('window-all-closed', () => {
    stopServer();
    app.quit();
});

if (gotLock) {
    // The server boot (node + Next.js) is the slow part, so it starts right away,
    // in parallel with Electron's own startup, not after the app is ready.
    const serverStart = startServer();
    serverStart.catch(() => undefined);

    app.whenReady().then(async () => {
        try {
            createWindow();
            const port = await serverStart;
            openPlayer(port);
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            dialog.showErrorBox('GarraTV', message);
            stopServer();
            app.quit();
        }
    });
}
