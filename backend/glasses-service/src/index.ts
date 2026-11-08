import { createServer, type IncomingMessage } from 'node:http';
import { WebSocket, WebSocketServer } from 'ws';
import { loadConfig } from './config.js';
import { ReadOnlyDbSession, enumTag, safeRescuerName, type DbSnapshot } from './db.js';
import { FakeSession } from './session.js';
import { readRescuerMap, resolveRescuer } from './rescuers.js';
import { RescuerActions, type RescuerAction } from './actions.js';
import { createTileSource } from './tiles/source.js';
import { TileCache } from './tiles/cache.js';
import { MapImageDiff, SiteMapRenderer, type MapMarker } from './render/map.js';
import { followFrame, loadSiteGeometry } from './render/vector.js';
import { processQuestionAudio } from './ask.js';
import { validateQuestionWav } from './wav.js';
import { AudioQuestionBuffer } from './audio.js';

const config = loadConfig();
const siteGeometry = loadSiteGeometry(config.siteGeometryFile);
const sessions = new Map<string, RuntimeSession>();
let rescuerMap: Awaited<ReturnType<typeof readRescuerMap>> | undefined;

const server = createServer(async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return; }
  const url = new URL(req.url ?? '/', 'http://localhost');
  if (url.pathname === '/healthz') {
    const connected = [...sessions.values()].some(runtime => runtime.db?.isConnected);
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ ok: true, db: config.fakeDb ? 'fake' : connected ? 'connected' : 'offline' }));
    return;
  }
  const actionMatch = /^\/rescuer\/([^/]+)\/action$/.exec(url.pathname);
  if (req.method === 'POST' && actionMatch) {
    try {
      const rescuer = safeRescuerName(decodeURIComponent(actionMatch[1]!));
      const runtime = sessions.get(rescuer);
      if (!runtime) { res.writeHead(404); res.end('rescuer session not found'); return; }
      const body = await readJsonBody(req);
      if (!isRescuerAction(body)) { res.writeHead(400); res.end('invalid action'); return; }
      const result = await runtime.actions.action(body);
      res.writeHead(result.ok ? 200 : result.error.startsWith('No primary') ? 409 : 400, { 'content-type': 'application/json' });
      res.end(JSON.stringify(result));
    } catch (error) { res.writeHead(400); res.end(asError(error).message); }
    return;
  }
  const askAudioMatch = /^\/rescuer\/([^/]+)\/ask_audio$/.exec(url.pathname);
  if (req.method === 'POST' && askAudioMatch) {
    try {
      const rescuer = safeRescuerName(decodeURIComponent(askAudioMatch[1]!));
      const runtime = sessions.get(rescuer);
      if (!runtime) { res.writeHead(404); res.end('rescuer session not found'); return; }
      if (runtime.primarySockets.size === 0) { res.writeHead(409); res.end('primary rescuer session required'); return; }
      const wav = await readRawBody(req, 44 + 16_000 * 2 * config.askMaxSeconds);
      validateQuestionWav(wav, config.askMaxSeconds);
      const result = await processQuestionAudio({ wav, rescuer, perceptionUrl: config.perceptionUrl });
      if (!result.transcript) {
        runtime.service.showAskTranscript('', 'Did not catch that - hold to ask again');
        res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify({ ok: false, transcript: '' })); return;
      }
      const submitted = await runtime.actions.submitQuestion(result.transcript, result.audioUrl, true);
      if (!submitted) { res.writeHead(502); res.end('question could not be submitted'); return; }
      runtime.service.showAskTranscript(result.transcript, 'Waiting for comms agent answer');
      res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify({ ok: true, transcript: result.transcript }));
    } catch (error) { res.writeHead(400); res.end(asError(error).message); }
    return;
  }
  // Demo walker controls (demo_mode sites only): walk toggles it, start always walks, reset returns to the start point,
  // and move nudges by dn/de meters.
  const demoMatch = /^\/demo\/([^/]+)\/(walk|start|move|reset)$/.exec(url.pathname);
  if (req.method === 'POST' && demoMatch) {
    try {
      const rescuer = safeRescuerName(decodeURIComponent(demoMatch[1]!));
      const runtime = sessions.get(rescuer);
      if (!runtime) { res.writeHead(404); res.end('rescuer session not found'); return; }
      if (!runtime.snapshot || !runtime.service.site.demo_mode) { res.writeHead(409); res.end('demo controls require an active site with demo_mode'); return; }
      const command = demoMatch[2] as 'walk' | 'start' | 'move' | 'reset';
      const body = req.headers['content-length'] ? await readJsonBody(req) : {};
      runtime.service.demoCommand(command, typeof body.dn === 'number' ? body.dn : 0, typeof body.de === 'number' ? body.de : 0);
      if (runtime.snapshot) updateMap(runtime, runtime.snapshot);
      res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify({ ok: true }));
    } catch (error) { res.writeHead(400); res.end(asError(error).message); }
    return;
  }
  res.writeHead(404); res.end('not found');
});

const wss = new WebSocketServer({ noServer: true });
if (config.fakeDb) {
  const fixture = new FakeSession({ demoSpeedMps: config.demoSpeedMps, demoStartBearingDeg: config.demoStartBearingDeg, demoStartDistanceM: config.demoStartDistanceM, ...(siteGeometry ? { geometry: siteGeometry } : {}) });
  await fixture.init();
  server.on('upgrade', (req, socket, head) => {
    const path = new URL(req.url ?? '/', `http://${req.headers.host}`).pathname;
    if (path !== '/view' && path !== '/glasses') { socket.destroy(); return; }
    wss.handleUpgrade(req, socket, head, ws => {
      fixture.attach(ws);
      ws.on('message', data => fixture.handle(ws, data.toString()));
    });
  });
  server.listen(config.port, config.host, () => console.log(`glasses FAKE_DB service listening on ${config.host}:${config.port}`));
  fixture.startWalker();
} else {
  rescuerMap = await readRescuerMap(config.rescuersFile);
  server.on('upgrade', (req, socket, head) => {
    const url = new URL(req.url ?? '/', `http://${req.headers.host}`);
    if (url.pathname !== '/view' && url.pathname !== '/glasses' && url.pathname !== '/phone') { socket.destroy(); return; }
    const explicitlyPrimary = url.pathname === '/glasses' || url.searchParams.get('primary') === '1';
    // The phone page and the glasses view page (fallback.html, embedded by the dashboard) name their rescuer in the URL
    // and send no hello, so they attach at once; the plugin names itself in its hello message.
    const rescuerInUrl = url.pathname === '/phone' || (url.pathname === '/view' && url.searchParams.has('rescuer'));
    wss.handleUpgrade(req, socket, head, ws => {
      let runtime: RuntimeSession | undefined;
      let attached = false;
      const pendingMessages: string[] = [];
      const attach = (target: RuntimeSession, rescuer: string) => {
        if (ws.readyState !== WebSocket.OPEN) return;
        runtime = target;
        runtime.sockets.add(ws);
        if (url.pathname === '/glasses') runtime.pluginSockets.add(ws);
        if (url.pathname === '/phone') {
          runtime.phoneSockets.add(ws);
          ws.send(phoneStateMessage(runtime));
        } else runtime.service.attach(ws);
        attached = true;
        if (explicitlyPrimary) {
          runtime.primarySockets.add(ws);
          if (url.pathname === '/glasses') for (const phone of runtime.phonePrimarySockets) runtime.primarySockets.delete(phone);
        } else if (url.pathname === '/phone' && runtime.pluginSockets.size === 0 && runtime.primarySockets.size === 0) {
          runtime.primarySockets.add(ws);
          runtime.phonePrimarySockets.add(ws);
        }
        if (runtime.primarySockets.has(ws)) {
          if (runtime.releaseTimer) clearTimeout(runtime.releaseTimer);
          runtime.releaseTimer = undefined;
          if (!runtime.db) openDb(runtime, rescuer);
        }
        if (url.pathname === '/glasses') broadcastPhoneState(runtime);
        for (const queued of pendingMessages.splice(0)) dispatchRuntimeMessage(runtime, ws, explicitlyPrimary || runtime.primarySockets.has(ws), queued);
      };
      ws.on('message', async data => {
        const raw = data.toString();
        if (!runtime) {
          const input = rescuerInUrl
            ? { requested: url.searchParams.get('rescuer') ?? undefined }
            : parseHello(raw);
          if (!input) return;
          const rescuer = resolveRescuer(rescuerMap!, input);
          runtime = getRuntime(rescuer);
          await runtime.ready;
          attach(runtime, rescuer);
          return;
        }
        if (!attached) { pendingMessages.push(raw); return; }
        dispatchRuntimeMessage(runtime, ws, explicitlyPrimary || runtime.primarySockets.has(ws), raw);
      });
      if (rescuerInUrl) {
        const rescuer = resolveRescuer(rescuerMap!, { requested: url.searchParams.get('rescuer') ?? undefined });
        runtime = getRuntime(rescuer);
        void runtime.ready.then(() => attach(runtime!, rescuer));
      }
      ws.on('close', () => {
        if (!runtime) return;
        const wasPlugin = runtime.pluginSockets.has(ws);
        if (wasPlugin && runtime.audioQuestion) void finishPluginQuestion(runtime, true);
        runtime.sockets.delete(ws);
        runtime.pluginSockets.delete(ws);
        runtime.phoneSockets.delete(ws);
        const wasPrimary = runtime.primarySockets.delete(ws);
        runtime.phonePrimarySockets.delete(ws);
        if (wasPlugin && runtime.pluginSockets.size === 0 && runtime.primarySockets.size === 0) {
          for (const phone of runtime.phoneSockets) {
            runtime.primarySockets.add(phone);
            runtime.phonePrimarySockets.add(phone);
          }
        }
        if (wasPlugin) broadcastPhoneState(runtime);
        if (!attached || !wasPrimary) return;
        if (runtime.primarySockets.size === 0) {
          runtime.releaseTimer = setTimeout(() => {
            if (runtime?.primarySockets.size !== 0) return;
            runtime.db?.disconnect();
            runtime.db = undefined;
            runtime.releaseTimer = undefined;
          }, config.primaryGraceMs);
        }
      });
    });
  });
  server.listen(config.port, config.host, () => console.log(`glasses SpacetimeDB service listening on ${config.host}:${config.port}`));
}

interface RuntimeSession {
  service: FakeSession;
  ready: Promise<void>;
  primarySockets: Set<WebSocket>;
  pluginSockets: Set<WebSocket>;
  phoneSockets: Set<WebSocket>;
  phonePrimarySockets: Set<WebSocket>;
  sockets: Set<WebSocket>;
  actions: RescuerActions;
  mapRenderer: SiteMapRenderer;
  mapDiff: MapImageDiff;
  snapshot?: DbSnapshot;
  db?: ReadOnlyDbSession;
  releaseTimer?: ReturnType<typeof setTimeout>;
  audioQuestion?: AudioQuestionBuffer;
  audioSilenceTimer?: ReturnType<typeof setInterval>;
  audioMaxTimer?: ReturnType<typeof setTimeout>;
}

function getRuntime(rescuer: string): RuntimeSession {
  const existing = sessions.get(rescuer);
  if (existing) return existing;
  const service = new FakeSession({ demoSpeedMps: config.demoSpeedMps, demoStartBearingDeg: config.demoStartBearingDeg, demoStartDistanceM: config.demoStartDistanceM, ...(siteGeometry ? { geometry: siteGeometry } : {}) });
  service.enableLiveMode();
  const runtime: RuntimeSession = {
    service,
    ready: service.init(),
    primarySockets: new Set<WebSocket>(),
    pluginSockets: new Set<WebSocket>(),
    phoneSockets: new Set<WebSocket>(),
    phonePrimarySockets: new Set<WebSocket>(),
    sockets: new Set<WebSocket>(),
    actions: undefined as unknown as RescuerActions,
    mapRenderer: new SiteMapRenderer(new TileCache({ directory: config.tileCacheDirectory, source: createTileSource(config.tileSource, config.cartoKey) }), createTileSource(config.tileSource, config.cartoKey), siteGeometry),
    mapDiff: new MapImageDiff(),
  };
  runtime.actions = new RescuerActions({
    getReducers: () => runtime.db?.reducers,
    hasPrimary: () => runtime.primarySockets.size > 0,
    onNotice: (message, durationMs) => runtime.service.showNotice(message, durationMs),
    onAsk: () => { beginPluginQuestion(runtime); },
  });
  service.setPositionHandler(point => {
    void runtime.actions.position(point, true);
    if (runtime.snapshot) updateMap(runtime, runtime.snapshot);
  });
  service.startWalker(config.demoSpeedMps);
  sessions.set(rescuer, runtime);
  return runtime;
}

function openDb(runtime: RuntimeSession, rescuer: string): void {
  runtime.db = new ReadOnlyDbSession({
    config: { uri: config.stdbUri!, database: config.stdbDatabase!, tokenDirectory: config.tokenDirectory },
    rescuer,
    onChange: snapshot => { runtime.snapshot = snapshot; runtime.actions.updateSnapshot(snapshot); runtime.service.applyDbSnapshot(snapshot); broadcastPhoneState(runtime); updateMap(runtime, snapshot); },
    onError: error => console.error(`SpacetimeDB session ${rescuer}: ${error.message}`),
  });
  void runtime.db.connect().catch(error => console.error(`SpacetimeDB session ${rescuer}: ${asError(error).message}`));
}

function updateMap(runtime: RuntimeSession, snapshot: DbSnapshot): void {
  const site = snapshot.sites[0];
  if (!site || typeof site.centerLat !== 'number' || typeof site.centerLon !== 'number' || typeof site.radiusM !== 'number') return;
  const target = snapshot.assignments.find(row => ['active', 'proposed'].includes(enumTag(row.status)));
  const targetId = target ? String(target.survivorId) : '';
  const markers: MapMarker[] = snapshot.survivors.filter(row => enumTag(row.status) !== 'resolved').map(row => ({
    kind: 'survivor' as const, lat: Number(row.lat), lon: Number(row.lon), criticalLevel: enumTag(row.criticalLevel), target: String(row.id) === targetId,
  })).filter(marker => Number.isFinite(marker.lat) && Number.isFinite(marker.lon));
  for (const row of snapshot.robots) if (typeof row.lat === 'number' && typeof row.lon === 'number') markers.push({ kind: 'robot', lat: row.lat, lon: row.lon, online: row.online === true, headingDeg: typeof row.headingDeg === 'number' ? row.headingDeg : null });
  const position = runtime.service.currentPosition();
  markers.push({ kind: 'rescuer', lat: position.lat, lon: position.lon, headingDeg: runtime.service.currentHeading() });
  const targetRow = target ? snapshot.survivors.find(row => String(row.id) === targetId) : undefined;
  const frame = siteGeometry && config.tileSource === 'vector'
    ? followFrame(position, targetRow ? { lat: Number(targetRow.lat), lon: Number(targetRow.lon) } : undefined)
    : { center: { lat: site.centerLat, lon: site.centerLon }, radiusM: site.radiusM };
  const route = siteGeometry && config.tileSource === 'vector' ? runtime.service.currentRoute() : [];
  runtime.mapRenderer.request({ center: frame.center, radiusM: frame.radiusM, markers, ...(route.length > 1 ? { route } : {}), onImages: images => {
    const changed = runtime.mapDiff.changed(images);
    if (changed) runtime.service.setMapImages(changed.top, changed.bottom, images.lensText);
  } });
}

function parseHello(raw: string): { requested?: string; serial?: string } | null {
  try {
    const value: unknown = JSON.parse(raw);
    if (!value || typeof value !== 'object' || (value as { type?: unknown }).type !== 'hello') return null;
    const hello = value as { serial?: unknown; rescuer?: unknown };
    return {
      ...(typeof hello.rescuer === 'string' ? { requested: hello.rescuer } : {}),
      ...(typeof hello.serial === 'string' ? { serial: hello.serial } : {}),
    };
  } catch { return null; }
}

function dispatchRuntimeMessage(runtime: RuntimeSession, ws: WebSocket, primary: boolean, raw: string): void {
  let value: unknown;
  try { value = JSON.parse(raw); } catch { return; }
  if (!value || typeof value !== 'object') return;
  const message = value as Record<string, unknown>;
  if (message.type === 'audio') {
    if (!primary || !runtime.pluginSockets.has(ws) || !runtime.audioQuestion || !Number.isSafeInteger(message.seq) || typeof message.pcm_b64 !== 'string') return;
    if (message.source !== 'glasses' && message.source !== 'phone') return;
    try { runtime.audioQuestion.append(message.seq as number, message.pcm_b64); }
    catch (error) { runtime.service.showNotice(asError(error).message, 5000); void finishPluginQuestion(runtime, false); }
    return;
  }
  if (message.type === 'audio_end') {
    if (primary && runtime.pluginSockets.has(ws) && runtime.audioQuestion && Number.isSafeInteger(message.seq) && message.seq === runtime.audioQuestion.lastSequence) void finishPluginQuestion(runtime, true);
    return;
  }
  if (message.type === 'audio_error') {
    if (primary && runtime.pluginSockets.has(ws)) runtime.service.showNotice(typeof message.detail === 'string' ? message.detail.slice(0, 56) : 'Microphone unavailable.', 5000);
    return;
  }
  if (message.type === 'heartbeat') { void runtime.actions.heartbeat(primary); return; }
  if (message.type === 'position' && typeof message.lat === 'number' && typeof message.lon === 'number') {
    const phone = runtime.phoneSockets.has(ws);
    if (phone && runtime.service.site.demo_mode) { broadcastPhoneState(runtime); return; }
    void runtime.actions.position({ lat: message.lat, lon: message.lon }, primary);
    if (primary) runtime.service.handle(ws, raw);
    if (phone) broadcastPhoneState(runtime);
    if (runtime.snapshot) updateMap(runtime, runtime.snapshot);
    return;
  }
  if (message.type === 'ack' && (typeof message.assignment_id === 'number' || typeof message.assignment_id === 'string')) {
    void runtime.actions.acknowledge(message.assignment_id, primary);
    return;
  }
  if (message.type === 'input' && typeof message.event === 'string') {
    if (message.event === 'long_press') { void runtime.actions.action({ action: 'ask' }); return; }
    if (message.event === 'tap' && runtime.service.currentLayout() === 'ask') { void finishPluginQuestion(runtime, true); return; }
    if (message.event === 'scroll_up' && runtime.service.currentLayout() === 'ask') { void finishPluginQuestion(runtime, false); return; }
    if (message.event === 'tap' && runtime.service.currentLayout() === 'arrived') {
      const survivorId = runtime.service.currentSurvivorId();
      if (survivorId !== undefined) void runtime.actions.action({ action: 'reached', survivor_id: survivorId });
    }
  }
  runtime.service.handle(ws, raw);
  if (message.type === 'demo' && runtime.snapshot) updateMap(runtime, runtime.snapshot);
}

function beginPluginQuestion(runtime: RuntimeSession): void {
  if (runtime.audioQuestion) return;
  runtime.service.beginAsk();
  runtime.audioQuestion = new AudioQuestionBuffer();
  for (const ws of runtime.pluginSockets) if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: 'mic', on: true, max_s: config.askMaxSeconds }));
  runtime.audioSilenceTimer = setInterval(() => {
    if (runtime.audioQuestion?.shouldStopForSilence()) void finishPluginQuestion(runtime, true);
  }, 250);
  runtime.audioMaxTimer = setTimeout(() => { void finishPluginQuestion(runtime, true); }, config.askMaxSeconds * 1000);
}

async function finishPluginQuestion(runtime: RuntimeSession, submit: boolean): Promise<void> {
  const audio = runtime.audioQuestion;
  if (!audio) return;
  runtime.audioQuestion = undefined;
  if (runtime.audioSilenceTimer) clearInterval(runtime.audioSilenceTimer);
  if (runtime.audioMaxTimer) clearTimeout(runtime.audioMaxTimer);
  runtime.audioSilenceTimer = undefined;
  runtime.audioMaxTimer = undefined;
  for (const ws of runtime.pluginSockets) if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: 'mic', on: false }));
  if (!submit) { runtime.service.showNotice('Question canceled.', 3000); return; }
  if (audio.length < 2) {
    runtime.service.showAskTranscript('', 'Did not catch that - hold to ask again');
    return;
  }
  try {
    const wav = audio.toWav();
    validateQuestionWav(wav, config.askMaxSeconds);
    const result = await processQuestionAudio({ wav, rescuer: [...sessions.entries()].find(([, item]) => item === runtime)?.[0] ?? 'default', perceptionUrl: config.perceptionUrl });
    if (!result.transcript) {
      runtime.service.showAskTranscript('', 'Did not catch that - hold to ask again');
      return;
    }
    const submitted = await runtime.actions.submitQuestion(result.transcript, result.audioUrl, true);
    if (!submitted) { runtime.service.showAskTranscript(result.transcript, 'Rephrase - hold to ask again'); return; }
    runtime.service.showAskTranscript(result.transcript, 'Waiting for comms agent answer');
  } catch (error) {
    runtime.service.showAskTranscript('', 'Rephrase - hold to ask again');
    console.error(`voice question failed: ${asError(error).message}`);
  }
}

function broadcastPhoneState(runtime: RuntimeSession): void {
  const message = phoneStateMessage(runtime);
  for (const ws of runtime.phoneSockets) if (ws.readyState === WebSocket.OPEN) ws.send(message);
}

function phoneStateMessage(runtime: RuntimeSession): string {
  return JSON.stringify({ ...runtime.service.phoneState(), plugin_connected: runtime.pluginSockets.size > 0 });
}

function isRescuerAction(value: Record<string, unknown>): value is Record<string, unknown> & RescuerAction {
  if (value.action === 'ask') return true;
  if (value.action === 'accept' || value.action === 'decline' || value.action === 'release') return validId(value.assignment_id);
  if (value.action === 'reached') return validId(value.survivor_id);
  if (value.action === 'resolve') return validId(value.survivor_id)
    && ['rescued', 'handed_off', 'false_alarm', 'duplicate'].includes(String(value.resolution))
    && (value.note === undefined || typeof value.note === 'string');
  return false;
}

function validId(value: unknown): value is number | string | bigint {
  if (typeof value === 'number') return Number.isSafeInteger(value) && value >= 0;
  if (typeof value !== 'string' || !/^[0-9]{1,20}$/.test(value)) return false;
  try { return BigInt(value) <= 18_446_744_073_709_551_615n; } catch { return false; }
}

async function readJsonBody(request: IncomingMessage): Promise<Record<string, unknown>> {
  let body = '';
  for await (const chunk of request) {
    body += chunk.toString();
    if (body.length > 16_384) throw new Error('Request body is too large.');
  }
  const parsed: unknown = JSON.parse(body || '{}');
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('Request body must be a JSON object.');
  return parsed as Record<string, unknown>;
}

async function readRawBody(request: IncomingMessage, maxBytes: number): Promise<Buffer> {
  const chunks: Buffer[] = [];
  let length = 0;
  for await (const chunk of request) {
    const value = Buffer.from(chunk);
    length += value.length;
    if (length > maxBytes) throw new Error('Audio request is too large.');
    chunks.push(value);
  }
  return Buffer.concat(chunks, length);
}

function asError(error: unknown): Error { return error instanceof Error ? error : new Error(String(error)); }
