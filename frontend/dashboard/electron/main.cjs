// Assess desktop app: the coordinator dashboard in its own window (Electron).
// The page is the same Vite build as the web dashboard. This file only opens the window, passes the run-time
// settings as URL parameters (the dashboard reads them in src/stdb/connection.ts and src/App.tsx), and adds a
// Server menu to switch between Maincloud and a local SpacetimeDB server without rebuilding (venue Wi-Fi down).
//
// Settings, in order of precedence:
//   1. Command-line flags: --db=cloud|local --local-uri=ws://HOST:3000 --glasses-page=URL --glasses-ws=URL --screen=A
//   2. The saved file <userData>/assess-settings.json (written by the Server menu)
//   3. Defaults: Maincloud (the address baked in at build time from .env), local server ws://127.0.0.1:3000
const { app, BrowserWindow, Menu, shell } = require('electron');
const fs = require('node:fs');
const path = require('node:path');

const DEFAULTS = { db: 'cloud', localUri: 'ws://127.0.0.1:3000', glassesPage: '', glassesWs: '', screen: 'A' };
const FLAG_NAMES = { db: 'db', localUri: 'local-uri', glassesPage: 'glasses-page', glassesWs: 'glasses-ws', screen: 'screen' };
const settingsFile = () => path.join(app.getPath('userData'), 'assess-settings.json');

function readSaved() {
  try { return JSON.parse(fs.readFileSync(settingsFile(), 'utf8')); } catch { return {}; }
}

function save(settings) {
  const { db, localUri, glassesPage, glassesWs } = settings;
  fs.mkdirSync(path.dirname(settingsFile()), { recursive: true });
  fs.writeFileSync(settingsFile(), JSON.stringify({ db, localUri, glassesPage, glassesWs }, null, 2));
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

// The dashboard's URL parameters for the current settings.
function query() {
  const params = new URLSearchParams({ screen: settings.screen });
  if (settings.db === 'local') { params.set('db', 'local'); params.set('uri', settings.localUri); }
  if (settings.glassesPage) params.set('glassesPage', settings.glassesPage);
  if (settings.glassesWs) params.set('glassesWs', settings.glassesWs);
  return params.toString();
}

function load() {
  const devUrl = process.env.ASSESS_DEV_URL;
  if (devUrl) window.loadURL(`${devUrl}?${query()}`);
  else window.loadFile(path.join(__dirname, '..', 'dist', 'index.html'), { search: query() });
  window.setTitle(settings.db === 'local' ? `Assess · local server ${settings.localUri}` : 'Assess');
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
    title: 'Assess',
    backgroundColor: '#0A0718', // --night, the launch animation's backdrop, so the window does not flash before it paints
    icon: path.join(__dirname, 'icon.png'),
    webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true },
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
  load();
}

app.whenReady().then(() => {
  settings = { ...DEFAULTS, ...readSaved(), ...readFlags(process.argv) };
  buildMenu();
  createWindow();
  app.on('activate', () => { if (!window) createWindow(); });
});

app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
