#!/usr/bin/env node
// Records what the glasses service sends to Cayden's glasses during the dashboard's Play demo, then stages it as the
// story the plugin replays with no service (src/plugin/demo.ts).
//
// 1. Record: listen on the mirror socket (/view?rescuer=cayden), which gets the same page, text and image messages as
//    the glasses and is never the primary connection. Stops 8 s after the arrived view and writes demo-raw.json
//    (git-ignored).
// 2. Stage: write src/plugin/demo-recording.json: the board as it was just before the task (6 s), the task screen
//    (tap to accept, or it moves on after 12 s), then the recorded walk to the arrived view. Play demo usually accepts
//    the task before the glasses draw it, so when the recording has no task screen, it is drawn by the glasses
//    service's own layout code (scripts/ack-page.ts) from the survivor the recording shows.
//
// Usage: start `npm run demo` in frontend/dashboard, run `npm run record-demo`, press Play demo in the app.
//        `npm run record-demo -- --stage` stages demo-raw.json again without recording.
//        SERVICE=ws://127.0.0.1:8787 RESCUER=cayden npm run record-demo
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import WebSocket from 'ws';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SERVICE_DIR = join(ROOT, '..', '..', 'backend', 'glasses-service');
const RAW = join(ROOT, 'demo-raw.json');
const OUT = join(ROOT, 'src', 'plugin', 'demo-recording.json');
const SERVICE = process.env.SERVICE ?? 'ws://127.0.0.1:8787';
const RESCUER = process.env.RESCUER ?? 'cayden';
const TAIL_MS = 8_000;
const MAX_MS = 30 * 60_000;
const IDLE_MS = 6_000;
const ACK_MS = 12_000;
const ACK_SECONDS = 30;
const OCTANT_DEG = { N: 0, NE: 45, E: 90, SE: 135, S: 180, SW: 225, W: 270, NW: 315 };

const isPage = (msg, layout) => msg.type === 'page' && (layout === undefined || msg.layout === layout);
// Start-up noise from a freshly reset board, never part of the story.
const isNoise = (msg) => msg.type === 'text' && /not ready|DB OFFLINE/i.test(msg.content);
const textOf = (page, name) => page?.containers.find((c) => c.name === name)?.content ?? '';

function stage(raw) {
  // The story is the last run that reaches the arrived view; anything before its task is the board at rest.
  const frames = raw.frames.filter((f) => !isNoise(f.msg));
  const arrivedAt = frames.findIndex((f) => isPage(f.msg, 'arrived'));
  if (arrivedAt < 0) throw new Error('The recording stops before the arrived view.');
  let firstView = -1;
  for (let i = arrivedAt; i >= 0; i--) {
    if (isPage(frames[i].msg, 'idle')) break;
    if (isPage(frames[i].msg) && frames[i].msg.layout !== 'ack') firstView = i;
  }
  if (firstView < 0) throw new Error('The recording has no task: press Play demo while recording.');
  let ackAt = -1;
  for (let i = firstView; i >= 0 && !isPage(frames[i].msg, 'idle'); i--) if (isPage(frames[i].msg, 'ack')) ackAt = i;
  const storyAt = ackAt >= 0 ? ackAt : firstView;

  // The board just before the task: the last idle page with every later text and image update applied.
  let idle;
  const images = new Map();
  for (const { msg } of frames.slice(0, storyAt)) {
    if (isPage(msg, 'idle')) {
      idle = structuredClone(msg);
      images.clear();
    } else if (idle && msg.type === 'text') {
      const box = idle.containers.find((c) => c.id === msg.id);
      if (box) box.content = msg.content;
    } else if (idle && msg.type === 'image') images.set(msg.id, msg);
  }
  const opening = idle ? [idle, ...images.values()].map((msg) => ({ t: 0, msg })) : [];
  const story = frames.slice(storyAt, arrivedAt).concat(frames.slice(arrivedAt).filter((f) => f.t - frames[arrivedAt].t <= TAIL_MS));
  const shift = (start) => story.map((f) => ({ t: f.t - story[0].t + start, msg: f.msg }));

  if (ackAt >= 0) return [...opening, ...shift(opening.length ? IDLE_MS : 0)];

  // No task screen in the recording: draw it from the first view's target and the arrived view's survivor details.
  const view = story[0].msg;
  const arrived = frames[arrivedAt].msg;
  const [, house, distance, octant] = /NEXT: (.+)\n(\d+ m) ([NESW]{1,2})/.exec(textOf(view, 'target')) ?? [];
  const [, level] = /\n(\w+) score/.exec(textOf(arrived, 'head')) ?? [];
  if (!house || !level) throw new Error(`Cannot read the target from the first view: ${JSON.stringify(textOf(view, 'target'))}`);
  const breathing = /Breathing ([^(]+)/.exec(textOf(arrived, 'life'))?.[1]?.trim().toLowerCase();
  const where = textOf(arrived, 'where').replace(/^Where: /, '');
  const input = {
    // The map line may shorten the label to fit its column; the arrived view has it whole.
    head: `NEW TASK - ${level.toUpperCase()}\n${/^ARRIVED - (.+)\n/.exec(textOf(arrived, 'head'))?.[1] ?? house}, ${distance} ${octant}`,
    detail: [breathing && `breathing ${breathing}`, where].filter(Boolean).join('\n'),
    bearing_deg: OCTANT_DEG[octant] ?? 0,
    seconds: ACK_SECONDS,
    assignment_id: 'demo',
  };
  const tsx = join(SERVICE_DIR, 'node_modules', '.bin', 'tsx');
  const ack = JSON.parse(execFileSync(tsx, ['scripts/ack-page.ts', JSON.stringify(input)], { cwd: SERVICE_DIR, encoding: 'utf8' }));
  const ackFrames = ack.messages.map((msg) => ({ t: IDLE_MS, msg }));
  for (let s = 1; s * 1000 < ACK_MS; s++) ackFrames.push({ t: IDLE_MS + s * 1000, msg: { type: 'text', id: 8, content: ack.countdown[s - 1] } });
  return [...opening, ...ackFrames, ...shift(IDLE_MS + ACK_MS)];
}

function save(raw) {
  const frames = stage(raw);
  writeFileSync(OUT, JSON.stringify({ recorded_at: raw.recorded_at, rescuer: raw.rescuer, frames }) + '\n');
  const layouts = frames.filter((f) => isPage(f.msg)).map((f) => f.msg.layout);
  console.log(`[record] staged ${frames.length} messages, ${(frames.at(-1).t / 1000).toFixed(1)} s, layouts: ${layouts.join(' > ')}`);
  console.log(`[record] ${OUT}`);
}

if (process.argv.includes('--stage')) {
  save(JSON.parse(readFileSync(RAW, 'utf8')));
  process.exit(0);
}

const frames = [];
let start = 0;
let lastLayout = '';
let arrived = false;

function finish(code) {
  const raw = { recorded_at: new Date().toISOString(), rescuer: RESCUER, frames };
  writeFileSync(RAW, JSON.stringify(raw) + '\n');
  console.log(`[record] wrote ${frames.length} raw messages to ${RAW}`);
  try {
    save(raw);
  } catch (err) {
    console.error(`[record] ${err.message}`);
    code = 1;
  }
  process.exit(code);
}

// The service may restart while we wait for Play; reconnect quietly and keep what was recorded.
function connect() {
  const ws = new WebSocket(`${SERVICE}/view?rescuer=${encodeURIComponent(RESCUER)}`);
  ws.on('open', () => {
    if (!start) start = Date.now();
    console.log(`[record] listening as a mirror of ${RESCUER}; press Play demo in the app`);
  });
  ws.on('message', (data) => {
    const msg = JSON.parse(String(data));
    if (msg.type !== 'page' && msg.type !== 'text' && msg.type !== 'image') return;
    frames.push({ t: Date.now() - start, msg });
    if (msg.type === 'page' && msg.layout !== lastLayout) {
      lastLayout = msg.layout;
      console.log(`[record] ${((Date.now() - start) / 1000).toFixed(1)} s  page ${msg.layout}`);
      if (msg.layout === 'arrived' && !arrived) {
        arrived = true;
        setTimeout(() => finish(0), TAIL_MS);
      }
    }
  });
  ws.on('close', () => {
    lastLayout = '';
    setTimeout(connect, 1000);
  });
  ws.on('error', () => {});
}
connect();
setTimeout(() => {
  console.error('[record] no arrived view after 30 minutes');
  finish(1);
}, MAX_MS);
process.on('SIGINT', () => finish(0));
