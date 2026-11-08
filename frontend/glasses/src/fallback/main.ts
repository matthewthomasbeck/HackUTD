// Glasses fallback page (glasses.md section 6).
// URL: fallback.html?rescuer=alex&ws=ws://<laptop-ip>:8787/view[&record=1][&primary=1][&tiles=esri-dark][&res=2]

import type { InputEventName, ServiceMsg } from '../plugin/protocol.js';
import { DISPLAY_W, GlassesRenderer, makeTint, readTheme, type FitIssue } from './render.js';
import { ReconnectingSocket, type LinkState } from './socket.js';
import { GlassesState } from './state.js';

const LINK_LOST_TEXT = 'LINK LOST - retrying';
const HEARTBEAT_MS = 5000;
const DEMO_STEP_M = 5;
/** Normal mode shows the display at 2x (glasses.md section 6). */
const NORMAL_SCALE = 2;

/** Full attribution per tile source (glasses.md 5.11), shown under the canvas in normal mode. */
const ATTRIBUTION: Record<string, string> = {
  'esri-dark': 'Map: Esri, HERE, Garmin, (c) OpenStreetMap contributors',
  'carto-dark': 'Map: (c) OpenStreetMap contributors, (c) CARTO',
  'osm-inverted': 'Map: (c) OpenStreetMap contributors',
  none: 'Map: none (offline grid)',
};

const params = new URLSearchParams(location.search);
const rescuer = params.get('rescuer') ?? 'default';
const record = params.get('record') === '1';
const primary = params.get('primary') === '1';
const tiles = params.get('tiles') ?? 'esri-dark';
const res = Math.max(1, Math.min(4, Number(params.get('res') ?? 2) || 2));
const wsBase = params.get('ws') ?? `ws://${location.hostname || 'localhost'}:8787/view`;

const wsUrl = new URL(wsBase);
wsUrl.searchParams.set('rescuer', rescuer);
if (primary) wsUrl.searchParams.set('primary', '1');

document.body.classList.toggle('record', record);

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const canvas = $<HTMLCanvasElement>('display');
const theme = readTheme();
const renderer = new GlassesRenderer(canvas, theme, res);
if (!record) canvas.style.width = `${DISPLAY_W * NORMAL_SCALE}px`;
const state = new GlassesState(makeTint(theme));

let issues: FitIssue[] = [];
let link: LinkState = { kind: 'connecting' };

function redraw(): void {
  issues = renderer.draw(state.snapshot());
  if (issues.length) console.warn('[fallback] layout issues', issues);
  renderPanel();
}

// Serialize message handling so an image that decodes slowly never lands after a newer page.
let chain = Promise.resolve();
function onMessage(raw: string): void {
  let msg: ServiceMsg;
  try {
    msg = JSON.parse(raw);
  } catch {
    console.warn('[fallback] non-JSON message ignored');
    return;
  }
  chain = chain
    .then(() => state.apply(msg))
    .then((changed) => {
      if (changed) redraw();
    })
    .catch((err) => console.warn('[fallback] message failed', err));
}

let heartbeat: number | undefined;
const socket = new ReconnectingSocket(
  wsUrl.toString(),
  onMessage,
  (s) => {
    link = s;
    if (s.kind !== 'open') {
      clearInterval(heartbeat);
      if (s.kind === 'retrying') {
        state.setStatus(LINK_LOST_TEXT);
        redraw();
      }
    }
    renderPanel();
  },
  () => {
    if (primary) {
      socket.send({ type: 'heartbeat' });
      heartbeat = window.setInterval(() => socket.send({ type: 'heartbeat' }), HEARTBEAT_MS);
    }
  },
);

function sendInput(event: InputEventName): void {
  const snap = state.snapshot();
  // A primary page stands in for the plugin, so its tap in the acknowledge view is an ack (glasses.md 3.5, 6).
  if (event === 'tap' && primary && snap.layout === 'ack' && snap.ackAssignmentId !== null) {
    socket.send({ type: 'ack', assignment_id: snap.ackAssignmentId });
  } else {
    socket.send({ type: 'input', source: 'unknown', event });
  }
  flash(event);
}

function sendDemo(cmd: 'walk' | 'reset' | 'move', dn = 0, de = 0): void {
  socket.send(cmd === 'move' ? { type: 'demo', cmd, dn, de } : { type: 'demo', cmd });
  flash(cmd === 'move' ? `move ${dn ? `${dn > 0 ? 'N' : 'S'}` : `${de > 0 ? 'E' : 'W'}`}` : cmd);
}

// Panel

for (const btn of document.querySelectorAll<HTMLButtonElement>('[data-input]')) {
  btn.addEventListener('click', () => sendInput(btn.dataset.input as InputEventName));
}

document.addEventListener('keydown', (e) => {
  if (e.metaKey || e.ctrlKey || e.altKey || e.repeat) return;
  const key = e.key;
  if (key === 'w' || key === 'W') sendDemo('walk');
  else if (key === 'r' || key === 'R') sendDemo('reset');
  else if (key === 'ArrowUp') sendDemo('move', DEMO_STEP_M, 0);
  else if (key === 'ArrowDown') sendDemo('move', -DEMO_STEP_M, 0);
  else if (key === 'ArrowRight') sendDemo('move', 0, DEMO_STEP_M);
  else if (key === 'ArrowLeft') sendDemo('move', 0, -DEMO_STEP_M);
  else if (key === ' ' || key === 'Enter') sendInput('tap');
  else return;
  e.preventDefault();
});

let flashTimer: number | undefined;
function flash(what: string): void {
  const el = $('last-input');
  el.textContent = what;
  clearTimeout(flashTimer);
  flashTimer = window.setTimeout(() => (el.textContent = '-'), 1500);
}

function linkText(s: LinkState): string {
  switch (s.kind) {
    case 'connecting':
      return 'connecting';
    case 'open':
      return 'connected';
    case 'retrying':
      return `retrying in ${(s.inMs / 1000).toFixed(1)} s`;
    case 'stopped':
      return 'stopped';
  }
}

function renderPanel(): void {
  if (record) return;
  const snap = state.snapshot();
  const linkEl = $('link');
  linkEl.textContent = state.exited ? 'exit received' : linkText(link);
  linkEl.dataset.state = state.exited ? 'stopped' : link.kind;
  $('layout').textContent = snap.layout || '-';
  $('ack').textContent = snap.layout === 'ack' && snap.ackAssignmentId !== null ? String(snap.ackAssignmentId) : '-';
  const fit = $('fit');
  fit.dataset.ok = String(issues.length === 0);
  fit.textContent = issues.length === 0 ? 'OK' : issues.map((i) => `id ${i.id} ${i.name}: ${i.problem}`).join('\n');
}

function renderAge(): void {
  if (record) return;
  const t = state.lastMessageAt;
  $('age').textContent = t ? `${Math.round((Date.now() - t) / 1000)} s ago` : '-';
}

$('rescuer').textContent = rescuer;
$('mode').textContent = primary ? 'primary (stands in for the glasses)' : 'mirror';
$('ws-url').textContent = wsUrl.toString();
$('attribution').textContent = ATTRIBUTION[tiles] ?? '';
window.setInterval(renderAge, 1000);

// Expose state for debugging and automated screenshot checks.
(window as unknown as { fallbackDebug: unknown }).fallbackDebug = {
  state,
  issues: () => issues,
  link: () => link,
};

redraw();
socket.start();
