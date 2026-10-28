const { app, BrowserWindow, dialog, shell } = require('electron');
const { spawn } = require('child_process');
const fs = require('fs');
const http = require('http');
const net = require('net');
const path = require('path');

app.setName('Xstream Player');
app.setAppUserModelId('com.xstreamplayer.desktop');
app.setPath('userData', path.join(app.getPath('appData'), 'Xstream Player'));

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
    app.quit();
}

let mainWindow = null;
let serverProcess = null;
let stopping = false;
let serverReady = false;

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
    return new Promise((resolve, reject) => {
        const attempt = () => {
            if (stopping) {
                reject(new Error('stopped'));
                return;
            }
            const request = http.get(
                { hostname: '127.0.0.1', port, path: '/streamflix', timeout: 2000 },
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
            setTimeout(attempt, 300);
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

    const logPath = path.join(app.getPath('userData'), 'server.log');
    const log = fs.createWriteStream(logPath, { flags: 'a' });
    log.write(`\n--- ${new Date().toISOString()} port ${port} ---\n`);

    serverProcess = spawn(nodeExe, ['server.js'], {
        cwd: serverDir,
        windowsHide: true,
        env: {
            ...process.env,
            NODE_ENV: 'production',
            HOSTNAME: '127.0.0.1',
            PORT: String(port),
            XSTREAM_DATA_DIR: dataDir,
            NEXT_TELEMETRY_DISABLED: '1',
        },
    });
    if (serverProcess.stdout) serverProcess.stdout.pipe(log);
    if (serverProcess.stderr) serverProcess.stderr.pipe(log);
    serverProcess.on('exit', (code) => {
        if (!serverReady || stopping || code === 0 || code === null) return;
        dialog.showErrorBox(
            'Xstream Player',
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

function createWindow(port) {
    const icon = path.join(__dirname, 'icon.png');
    mainWindow = new BrowserWindow({
        width: 1440,
        height: 900,
        minWidth: 1100,
        minHeight: 700,
        backgroundColor: '#0b0b0b',
        autoHideMenuBar: true,
        title: 'Xstream Player',
        show: false,
        icon: fs.existsSync(icon) ? icon : undefined,
        webPreferences: {
            contextIsolation: true,
            nodeIntegration: false,
            sandbox: true,
            // The preview and the player start with sound. Chromium would
            // otherwise block that until a click.
            autoplayPolicy: 'no-user-gesture-required',
        },
    });
    mainWindow.setMenuBarVisibility(false);

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

    mainWindow.once('ready-to-show', () => {
        if (mainWindow) mainWindow.show();
    });
    mainWindow.loadURL(`${localPrefix}streamflix`);
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
    app.whenReady().then(async () => {
        try {
            const port = await startServer();
            createWindow(port);
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            dialog.showErrorBox('Xstream Player', message);
            stopServer();
            app.quit();
        }
    });
}
