// Robot bridge entry point: the C++ program on one side (Unix socket, NDJSON), SpacetimeDB on the
// other (TypeScript SDK), the media server for files, and a spool file for network drops.
// robot.md section 9 is the spec; CONTRACTS.md "Robot bridge local protocol" is the contract.

import 'dotenv/config';
import { openAsBlob } from 'node:fs';
import { setTimeout as sleep } from 'node:timers/promises';
import { loadConfig } from './config.ts';
import { LocalSocket } from './local_socket.ts';
import { mapMessage, MappingError, type LocalMessage } from './mapping.ts';
import { DetectionPipeline, MediaClient } from './media.ts';
import { MissionLink } from './missions.ts';
import { Router } from './router.ts';
import { Spool, type SendOutcome } from './spool.ts';
import { StdbLink } from './stdb.ts';
import { currentSite, siteMessage, teleopForward } from './to_wire.ts';

const config = loadConfig();
const log = (line: string) => console.log(`${new Date().toISOString()} ${line}`);

const spool = new Spool({ path: config.spoolFile, maxBytes: config.spoolMaxBytes, log });
spool.open();

let lastSiteLine: string | undefined;
function sendSite(force = false): void {
  const site = currentSite(stdb.sites());
  if (!site || !socket.clientConnected) return;
  const message = siteMessage(site);
  const line = JSON.stringify(message);
  if (!force && line === lastSiteLine) return;
  if (socket.send(message)) {
    lastSiteLine = line;
    log(`site: sent site ${message.site.id} (demo_mode ${message.demo_mode})`);
  }
}

const stdb: StdbLink = new StdbLink(config, {
  onReady: () => {
    log('stdb: ready');
    router.startKick();
    sendSite();
  },
  onLost: () => log('stdb: not ready; messages go to the spool'),
  onMissionInsert: (row) => missions.onMissionInsert(row),
  onMissionUpdate: (oldRow, newRow) => missions.onMissionUpdate(oldRow, newRow),
  onMissionDelete: (row) => missions.onMissionDelete(row),
  onSiteChange: () => sendSite(),
  onRobotRow: () => router.startKick(),
  // Remote driving goes straight to the robot or is dropped: never spooled, because a late command is dangerous.
  onTeleop: (row, live) => {
    const message = teleopForward(row, live, config.robotId);
    if (!message) return;
    const sent = socket.send(message);
    if (!sent && teleopSent) log('teleop: no robot program connected; dropping driving commands');
    teleopSent = sent;
  },
}, log);
let teleopSent = true;

const socket: LocalSocket = new LocalSocket(config.bridgeSocket, {
  onMessage: (msg) => {
    if (msg.type === 'heartbeat') {
      missions.onHeartbeat(msg.state);
      if (msg.robot_id !== config.robotId) log(`warning: heartbeat robot_id ${String(msg.robot_id)} is not ROBOT_ID ${config.robotId}`);
    }
    router.handle(msg);
  },
  onClientConnected: () => {
    missions.onClientConnected();
    sendSite(true);
  },
  onClientDisconnected: () => missions.onClientDisconnected(),
  log,
});

const missions = new MissionLink({
  robotId: config.robotId,
  sendToRobot: (message) => socket.send(message),
  claim: () => stdb.claim(),
  isReady: () => stdb.ready,
  isClientConnected: () => socket.clientConnected,
  missions: () => stdb.missions(),
  log,
});

const media = new MediaClient(
  { mediaUrl: config.mediaUrl, robotId: config.robotId, attempts: config.mediaRetries },
  { fetch: globalThis.fetch, openAsBlob, sleep: (ms) => sleep(ms), log },
);

const detections = new DetectionPipeline({
  media,
  call: (call) => stdb.call(call),
  findDetection: (clientRef) => stdb.findDetection(clientRef),
  sleep: (ms) => sleep(ms),
  now: () => Date.now(),
  log,
});

async function processMessage(msg: LocalMessage): Promise<SendOutcome> {
  if (msg.type === 'detection') return detections.handle(msg);
  let terrainImageUrl: string | undefined;
  if (msg.type === 'terrain' && typeof msg.image_path === 'string' && msg.image_path !== '') {
    // One attempt only: terrain is current state, and the next report comes within a second.
    terrainImageUrl = await media.upload(msg.image_path, 'terrain', false);
  }
  let mapped;
  try {
    mapped = mapMessage(msg, { terrain_image_url: terrainImageUrl });
  } catch (error) {
    if (error instanceof MappingError) {
      log(`skipped: ${error.message}`);
      return 'rejected';
    }
    throw error;
  }
  if (mapped.kind !== 'call') return 'ok';
  for (const warning of mapped.warnings) log(warning);
  if (msg.type === 'cell' && typeof msg.note === 'string' && msg.note !== '') log(`cell ${String(msg.cell_id)} ${String(msg.status)}: ${msg.note}`);
  return stdb.call(mapped.call);
}

const router: Router = new Router({ isReady: () => stdb.ready, hasRobotRow: () => stdb.hasRobotRow(), spool, process: processMessage, log });

async function main(): Promise<void> {
  log(`bridge: robot ${config.robotId}, socket ${config.bridgeSocket}, media ${config.mediaUrl}, spool ${config.spoolFile}`);
  await socket.listen();
  stdb.start();
  const claimTimer = setInterval(() => void missions.tick(), config.claimIntervalMs);
  const replayTimer = setInterval(() => router.startKick(), 2000);
  const shutdown = async (signal: string) => {
    log(`bridge: ${signal}, shutting down`);
    clearInterval(claimTimer);
    clearInterval(replayTimer);
    stdb.stop();
    await socket.close();
    spool.close();
    process.exit(0);
  };
  process.once('SIGINT', () => void shutdown('SIGINT'));
  process.once('SIGTERM', () => void shutdown('SIGTERM'));
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
