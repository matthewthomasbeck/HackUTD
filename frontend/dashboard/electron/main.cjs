// Underdog desktop app: the coordinator dashboard in its own window (Electron).
// The page is the same Vite build as the web dashboard. This file only opens the window, passes the run-time
// settings as URL parameters (the dashboard reads them in src/stdb/connection.ts and src/App.tsx), and adds a
// Server menu to switch between Maincloud and a local SpacetimeDB server without rebuilding (venue Wi-Fi down).
//
// Settings, in order of precedence:
//   1. Command-line flags: --db=cloud|local --local-uri=ws://HOST:3000 --glasses-page=URL --glasses-ws=URL --screen=A
//   2. The saved file <userData>/assess-settings.json (written by the Server menu)
//   3. Defaults: Maincloud (the address baked in at build time from .env), local server ws://127.0.0.1:3000
const { app, BrowserWindow, Menu, shell, ipcMain } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const { PreviewWorker } = require('./preview-worker.cjs');

// Preserve existing camera settings, identity and sessions across the display-name change.
const legacyData = path.join(app.getPath('appData'), 'Assess');
if (fs.existsSync(legacyData)) app.setPath('userData', legacyData);
app.setName('Underdog');

const DEFAULTS = { db: 'cloud', localUri: 'ws://127.0.0.1:3000', glassesPage: '', glassesWs: '', screen: 'A',
  robotPreviewUrl: process.env.ASSESS_ROBOT_PREVIEW_URL || '', visionPython: process.env.ASSESS_VISION_PYTHON || '' };
const FLAG_NAMES = { db: 'db', localUri: 'local-uri', glassesPage: 'glasses-page', glassesWs: 'glasses-ws', screen: 'screen',
  robotPreviewUrl: 'robot-preview-url', visionPython: 'vision-python' };
const previewWorker = new PreviewWorker();
const settingsFile = () => path.join(app.getPath('userData'), 'assess-settings.json');

function readSaved() {
  try { return JSON.parse(fs.readFileSync(settingsFile(), 'utf8')); } catch { return {}; }
}

function save(settings) {
  const { db, localUri, glassesPage, glassesWs, robotPreviewUrl, visionPython } = settings;
  fs.mkdirSync(path.dirname(settingsFile()), { recursive: true });
  fs.writeFileSync(settingsFile(), JSON.stringify({ db, localUri, glassesPage, glassesWs, robotPreviewUrl, visionPython }, null, 2));
}

function readFlags(argv) {
  const flags = {};
  for (const [key, name] of Object.entries(FLAG_NAMES)) {
    const match = argv.find((arg) => arg.startsWith(`--${name}=`));
    if (match) flags[key] = match.slice(name.length + 3);
  }
  return flags;
}

let settings = { ...DEFAULTS };
let window = null;
let splashWindow = null;
let dashboardReady = false;
let splashAnimationFinished = false;
let handoffStarted = false;

const APP_READY_FALLBACK_MS = 10000;
const SPLASH_FADE_MS = 260;

function revealDashboard() {
  if (!dashboardReady || !splashAnimationFinished || handoffStarted || !window) return;
  handoffStarted = true;
  window.show();
  window.focus();
  if (!splashWindow || splashWindow.isDestroyed()) return;
  void splashWindow.webContents.executeJavaScript('window.fadeSplash()').catch(() => {});
  const finishingSplash = splashWindow;
  splashWindow = null;
  setTimeout(() => { if (!finishingSplash.isDestroyed()) finishingSplash.destroy(); }, SPLASH_FADE_MS);
}

ipcMain.on('assess:dashboard-ready', (event) => {
  if (window && event.sender === window.webContents) {
    dashboardReady = true;
    revealDashboard();
  }
});

ipcMain.on('assess:splash-animation-finished', (event) => {
  if (splashWindow && event.sender === splashWindow.webContents) {
    splashAnimationFinished = true;
    revealDashboard();
  }
});

// The dashboard's URL parameters for the current settings.
function query() {
  const params = new URLSearchParams({ screen: settings.screen });
  if (settings.db === 'local') { params.set('db', 'local'); params.set('uri', settings.localUri); }
  if (settings.glassesPage) params.set('glassesPage', settings.glassesPage);
  if (settings.glassesWs) params.set('glassesWs', settings.glassesWs);
  if (settings.robotPreviewUrl) {
    params.set('robotPreview', settings.robotPreviewUrl);
    params.set('visionPreview', 'http://127.0.0.1:8082');
  }
  return params.toString();
}

function load() {
  const devUrl = process.env.ASSESS_DEV_URL;
  if (devUrl) window.loadURL(`${devUrl}?${query()}`);
  else window.loadFile(path.join(__dirname, '..', 'dist', 'index.html'), { search: query() });
  window.setTitle(settings.db === 'local' ? `Underdog · local server ${settings.localUri}` : 'Underdog');
}

function switchServer(db) {
  settings = { ...settings, db };
  save(settings);
  buildMenu();
  load();
}

function buildMenu() {
  const isMac = process.platform === 'darwin';
  const template = [
    ...(isMac ? [{ role: 'appMenu' }] : []),
    { role: 'editMenu' },
    {
      label: 'Server',
      submenu: [
        { label: 'Maincloud (judging)', type: 'radio', checked: settings.db === 'cloud', click: () => switchServer('cloud') },
        { label: `Local server (${settings.localUri})`, type: 'radio', checked: settings.db === 'local', click: () => switchServer('local') },
        { type: 'separator' },
        { label: 'Open settings file…', click: () => { save(settings); shell.showItemInFolder(settingsFile()); } },
      ],
    },
    { label: 'View', submenu: [{ role: 'reload' }, { role: 'forceReload' }, { type: 'separator' }, { role: 'resetZoom' }, { role: 'zoomIn' }, { role: 'zoomOut' }, { type: 'separator' }, { role: 'togglefullscreen' }, ...(app.isPackaged ? [] : [{ role: 'toggleDevTools' }])] },
    { role: 'windowMenu' },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

function createWindow() {
  window = new BrowserWindow({
    width: 1600,
    height: 960,
    minWidth: 1200,
    minHeight: 760,
    title: 'Underdog',
    backgroundColor: '#0A0718', // --night, the launch animation's backdrop, so the window does not flash before it paints
    show: false,
    icon: path.join(__dirname, 'icon.png'),
    webPreferences: { preload: path.join(__dirname, 'preload.cjs'), contextIsolation: true, nodeIntegration: false, sandbox: true },
  });
  // Links (OpenStreetMap credits, media) open in the browser; the window never navigates away from the dashboard.
  window.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/.test(url)) void shell.openExternal(url);
    return { action: 'deny' };
  });
  window.webContents.on('will-navigate', (event, url) => {
    const devUrl = process.env.ASSESS_DEV_URL;
    if (!(devUrl && url.startsWith(devUrl)) && !url.startsWith('file:')) event.preventDefault();
  });
  window.on('closed', () => { window = null; });
  window.webContents.once('did-finish-load', () => {
    setTimeout(() => {
      if (!dashboardReady) {
        dashboardReady = true;
        revealDashboard();
      }
    }, APP_READY_FALLBACK_MS);
  });
  load();
}

function createSplashWindow() {
  splashAnimationFinished = false;
  dashboardReady = false;
  handoffStarted = false;
  splashWindow = new BrowserWindow({
    width: 520,
    height: 420,
    center: true,
    frame: false,
    transparent: true,
    backgroundColor: '#00000000',
    hasShadow: false,
    resizable: false,
    movable: false,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    alwaysOnTop: true,
    skipTaskbar: true,
    show: false,
    // A transparent, unfocused window can count as hidden, which would throttle the frame timer and freeze the flip.
    webPreferences: { preload: path.join(__dirname, 'preload.cjs'), contextIsolation: true, nodeIntegration: false, sandbox: true, backgroundThrottling: false },
  });
  const splash = splashWindow;
  splash.once('ready-to-show', () => {
    if (splash.isDestroyed()) return;
    splash.show();
    splash.webContents.executeJavaScript('window.startSplash()').catch(() => {});
  });
  splash.webContents.once('did-fail-load', () => {
    splashAnimationFinished = true;
    revealDashboard();
  });
  void splash.loadFile(path.join(__dirname, 'splash.html')).catch(() => {
    splashAnimationFinished = true;
    revealDashboard();
  });
}

app.whenReady().then(() => {
  settings = { ...DEFAULTS, ...readSaved(), ...readFlags(process.argv) };
  if (settings.robotPreviewUrl) {
    try {
      const url = new URL(settings.robotPreviewUrl);
      if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) throw new Error('Expected an HTTP preview URL without credentials');
      settings.robotPreviewUrl = url.origin;
      save(settings);
      const runtime = app.isPackaged ? path.join(process.resourcesPath, 'preview-runtime') : path.resolve(__dirname, '../../..');
      const python = settings.visionPython || path.join(runtime, 'raspberrypi/preview/.venv', process.platform === 'win32' ? 'Scripts/python.exe' : 'bin/python');
      previewWorker.start(python, path.join(runtime, 'raspberrypi/preview/server.py'), settings.robotPreviewUrl, path.join(app.getPath('userData'), 'preview-data'));
    } catch (error) { console.error(`Preview setup: ${error.message}`); }
  }
  buildMenu();
  createSplashWindow();
  createWindow();
  app.on('activate', () => {
    if (!window) {
      createSplashWindow();
      createWindow();
    }
  });
});

app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
app.on('before-quit', () => previewWorker.stop());
