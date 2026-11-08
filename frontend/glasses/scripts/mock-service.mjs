#!/usr/bin/env node
// Dev mock of the glasses service, so the plugin and the fallback page run with no real service or SpacetimeDB.
// It speaks the CONTRACTS.md glasses protocol on ws://0.0.0.0:8787/glasses (plugin) and /view (mirror),
// answers GET /healthz, and logs every message it receives.
//
// Views cycle on tap: idle -> ack (tap sends ack) -> arrow -> map -> released -> idle.
// HTTP helpers: GET /mock/view/<idle|ack|arrow|map|released>, GET /mock/exit (sends {"type":"exit"}).
// Usage: npm run mock   (PORT=8787 by default)
import { createServer } from 'node:http';
import { deflateSync, crc32 } from 'node:zlib';
import { WebSocketServer } from 'ws';

const PORT = Number(process.env.PORT ?? 8787);

// ---------- tiny greyscale PNG encoder (8-bit, colour type 0) ----------
function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(td) >>> 0);
  return Buffer.concat([len, td, crc]);
}
function png(w, h, pixel) {
  const raw = Buffer.alloc((w + 1) * h);
  for (let y = 0; y < h; y++) {
    raw[y * (w + 1)] = 0;
    for (let x = 0; x < w; x++) raw[y * (w + 1) + 1 + x] = pixel(x, y);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8;
  ihdr[9] = 0;
  const sig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  return Buffer.concat([sig, chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]).toString('base64');
}

// Arrow pointing at `deg` (0 = up), 144x144.
function arrowPng(deg) {
  const r = (deg * Math.PI) / 180;
  const c = 72;
  return png(144, 144, (x, y) => {
    // rotate the point into arrow space
    const dx = x - c;
    const dy = y - c;
    const ax = dx * Math.cos(r) + dy * Math.sin(r);
    const ay = -dx * Math.sin(r) + dy * Math.cos(r);
    const head = ay >= -60 && ay <= -10 && Math.abs(ax) <= ((ay + 60) / 50) * 36;
    const shaft = ay > -10 && ay <= 50 && Math.abs(ax) <= 12;
    return head || shaft ? 255 : 0;
  });
}

// Fake map half: grid lines plus a few markers. `half` 0 = top rows, 1 = bottom rows.
function mapPng(half) {
  const markers = [
    [60, 80, 10, true],
    [200, 190, 8, false],
    [150, 230, 10, true],
  ];
  return png(288, 144, (x, y0) => {
    const y = y0 + half * 144;
    if (Math.abs(x - 144) <= 3 && Math.abs(y - 144) <= 3) return 255; // rescuer dot
    for (const [mx, my, mr, filled] of markers) {
      const d = Math.hypot(x - mx, y - my);
      if (filled ? d <= mr : Math.abs(d - mr) < 1.5) return 230;
    }
    if (x % 48 === 0 || y % 48 === 0) return 70; // streets
    return 0;
  });
}

const IMAGES = {
  arrow: arrowPng(45),
  map_top: mapPng(0),
  map_bot: mapPng(1),
};

// ---------- layouts (glasses.md section 4) ----------
const capture = { kind: 'text', id: 1, name: 'capture', x: 0, y: 0, w: 576, h: 288, z: 1, content: ' ', capture: true };
const t = (id, name, x, y, w, h, z, content, text_color = 4) => ({ kind: 'text', id, name, x, y, w, h, z, content, text_color });
const img = (id, name, x, y, w, h, z) => ({ kind: 'image', id, name, x, y, w, h, z });

const ACK_ID = 42;
const LAYOUTS = {
  idle: () => ({
    containers: [
      capture,
      img(2, 'map_top', 0, 0, 288, 144, 2),
      img(3, 'map_bot', 0, 144, 288, 144, 3),
      t(4, 'head', 296, 0, 280, 56, 4, 'NO ASSIGNMENT\nstand by'),
      t(5, 'count', 296, 58, 280, 84, 5, '2 CRITICAL\n3 unassigned\nwithin 0.3 mi', 3),
      t(6, 'brief', 296, 144, 280, 84, 6, 'MOCK SERVICE\ntap: next view', 3),
      t(8, 'status', 296, 232, 280, 28, 7, 'scroll: browse  hold: ask', 2),
      t(7, 'attrib', 296, 260, 280, 28, 8, 'mock map', 1),
    ],
    images: { 2: IMAGES.map_top, 3: IMAGES.map_bot },
  }),
  ack: () => ({
    ack_assignment_id: ACK_ID,
    containers: [
      capture,
      img(2, 'arrow', 16, 40, 144, 144, 2),
      t(4, 'head', 184, 0, 384, 56, 3, 'NEW TASK - IMMEDIATE\nhouse 3, 120 m NE'),
      t(5, 'detail', 184, 60, 384, 84, 4, 'breathing 34/min (conf 0.7)\n8 m in from front door', 3),
      t(6, 'brief', 184, 148, 384, 80, 5, 'Coordinator: you are closest.', 3),
      t(8, 'status', 8, 232, 560, 28, 6, `TAP TO ACCEPT - ${ackLeft()}s left`, 2),
    ],
    images: { 2: IMAGES.arrow },
  }),
  arrow: () => ({
    containers: [
      capture,
      img(2, 'arrow', 16, 40, 144, 144, 2),
      t(4, 'primary', 184, 8, 384, 56, 3, 'NE  32 m\nhouse 3 - CRITICAL'),
      t(5, 'detail', 184, 72, 384, 84, 4, '8 m in from front door\nbreathing 14/min\nconf 0.7', 3),
      t(6, 'brief', 184, 164, 384, 56, 5, '> Enter by front door,\nground ahead: debris', 3),
      t(8, 'status', 8, 232, 560, 28, 6, '2 CRITICAL in area - arrow is N-up - upd 1s', 2),
    ],
    images: { 2: IMAGES.arrow },
  }),
  map: () => ({
    containers: [
      capture,
      img(2, 'map_top', 0, 0, 288, 144, 2),
      img(3, 'map_bot', 0, 144, 288, 144, 3),
      t(4, 'count', 296, 0, 280, 56, 4, '2 CRITICAL\nwithin 0.3 mi'),
      t(5, 'target', 296, 58, 280, 56, 5, 'NEXT: house 3\n340 m NE'),
      t(6, 'brief', 296, 116, 280, 112, 6, 'IMMEDIATE house 3:\nbreathing 14/min,\n8 m in, front door', 3),
      t(8, 'status', 296, 232, 280, 28, 7, 'tap: back  upd 2s', 2),
      t(7, 'attrib', 296, 260, 280, 28, 8, 'mock map', 1),
    ],
    images: { 2: IMAGES.map_top, 3: IMAGES.map_bot },
  }),
  released: () => ({
    containers: [
      capture,
      t(4, 'head', 8, 0, 560, 56, 2, 'ASSIGNMENT RELEASED\nhouse 3 - IMMEDIATE'),
      t(5, 'why', 8, 60, 560, 84, 3, 'Link to glasses was lost.\nSurvivor is back on the board for\nthe next rescuer.', 3),
      t(6, 'next', 8, 148, 560, 80, 4, 'If you are still going, tell the\ncoordinator.', 3),
      t(8, 'status', 8, 232, 560, 28, 5, 'tap: ok', 2),
    ],
    images: {},
  }),
};
const ORDER = ['idle', 'ack', 'arrow', 'map', 'released'];

// ---------- one shared mock session ----------
let view = 'idle';
let ackDeadline = 0;
const sockets = new Set();
function ackLeft() {
  return Math.max(0, Math.ceil((ackDeadline - Date.now()) / 1000));
}
function broadcast(msg) {
  const s = JSON.stringify(msg);
  for (const ws of sockets) if (ws.readyState === ws.OPEN) ws.send(s);
}
function sendView(target) {
  const l = LAYOUTS[view]();
  const page = { type: 'page', layout: view, containers: l.containers };
  if (l.ack_assignment_id !== undefined) page.ack_assignment_id = l.ack_assignment_id;
  const out = (m) => (target ? target.send(JSON.stringify(m)) : broadcast(m));
  out(page);
  for (const [id, b64] of Object.entries(l.images)) out({ type: 'image', id: Number(id), png_b64: b64 });
}
function setView(next) {
  view = next;
  if (view === 'ack') ackDeadline = Date.now() + 30_000;
  console.log(`[mock] view -> ${view}`);
  sendView();
}
function status(text) {
  broadcast({ type: 'text', id: 8, content: text });
}

let tick = 0;
setInterval(() => {
  tick++;
  if (view === 'ack') {
    if (ackLeft() === 0) {
      status('TOO LATE - task released');
      setTimeout(() => setView('released'), 1000);
      ackDeadline = Infinity;
    } else status(`TAP TO ACCEPT - ${ackLeft()}s left`);
  } else if (tick % 5 === 0) {
    // keepalive every 5 s, as the real service resends the status line
    const line = LAYOUTS[view]().containers.find((c) => c.id === 8);
    const base = line.content.replace(/ +upd \d+s$/, '');
    status(`upd ${tick % 60}s ${base}`.slice(0, Math.floor(line.w / 13))); // 13 px per character budget
  }
}, 1000);

function onMessage(ws, raw, path) {
  let msg;
  try {
    msg = JSON.parse(String(raw));
  } catch {
    console.log(`[mock] ${path} bad json`, String(raw).slice(0, 80));
    return;
  }
  if (msg.type === 'heartbeat') {
    console.log(`[mock] ${path} heartbeat`);
    return;
  }
  if (msg.type !== 'audio') console.log(`[mock] ${path} <-`, JSON.stringify(msg));
  switch (msg.type) {
    case 'hello':
      sendView(ws);
      break;
    case 'ack':
      if (view === 'ack' && msg.assignment_id === ACK_ID) {
        status('ACCEPTED');
        setTimeout(() => setView('arrow'), 2000);
      } else console.log('[mock] ack for a foreign id, dropped');
      break;
    case 'input':
      if (msg.event === 'tap') setView(ORDER[(ORDER.indexOf(view) + 1) % ORDER.length]);
      else if (msg.event === 'double_tap') console.log('[mock] double tap: the plugin exits on its own');
      else status(`input: ${msg.event} (${msg.source})`);
      break;
    default:
      break;
  }
}

const server = createServer((req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  const url = new URL(req.url ?? '/', 'http://x');
  if (url.pathname === '/healthz') {
    res.end(JSON.stringify({ ok: true, mock: true, view, sockets: sockets.size }));
  } else if (url.pathname.startsWith('/mock/view/')) {
    const next = url.pathname.slice('/mock/view/'.length);
    if (!LAYOUTS[next]) {
      res.statusCode = 404;
      res.end(`unknown view; use one of ${ORDER.join(', ')}`);
      return;
    }
    setView(next);
    res.end(`view ${next}\n`);
  } else if (url.pathname === '/mock/exit') {
    broadcast({ type: 'exit' });
    res.end('exit sent\n');
  } else {
    res.statusCode = 404;
    res.end('not found\n');
  }
});

const wss = new WebSocketServer({ noServer: true });
server.on('upgrade', (req, sock, head) => {
  const path = new URL(req.url ?? '/', 'http://x').pathname;
  if (path !== '/glasses' && path !== '/view') {
    sock.destroy();
    return;
  }
  wss.handleUpgrade(req, sock, head, (ws) => {
    sockets.add(ws);
    console.log(`[mock] ${path} connected (${sockets.size} open)`);
    if (path === '/view') sendView(ws); // mirror pages get the full state at once
    ws.on('message', (raw) => onMessage(ws, raw, path));
    ws.on('close', () => {
      sockets.delete(ws);
      console.log(`[mock] ${path} closed (${sockets.size} open)`);
    });
  });
});

server.listen(PORT, '0.0.0.0', () => console.log(`[mock] glasses service mock on http://0.0.0.0:${PORT} (ws /glasses, /view)`));
