// Drone bridge settings from the environment (.env on a laptop, /etc/drone/bridge.env on the drone's Pi).
// Every key is listed in .env.example. The dog's bridge (raspberrypi/bridge) has the same keys plus
// the camera terrain hint, which the drone does not have; robot.md section 9.2 has its Pi defaults.

export type StdbMode = 'sdk' | 'http';

export interface BridgeConfig {
  stdbUri: string;
  stdbDatabase: string;
  stdbToken: string | undefined;
  stdbMode: StdbMode;
  robotId: string;
  bridgeSocket: string;
  mediaUrl: string;
  tokenFile: string;
  spoolFile: string;
  spoolMaxBytes: number;
  mediaRetries: number;
  claimIntervalMs: number;
}

const ROBOT_ID_PATTERN = /^[A-Za-z0-9_-]{1,40}$/;

function positiveNumber(env: NodeJS.ProcessEnv, key: string, fallback: number): number {
  const raw = env[key];
  if (raw === undefined || raw === '') return fallback;
  const value = Number(raw);
  if (!Number.isFinite(value) || value <= 0) throw new Error(`${key} must be a positive number, got ${raw}`);
  return value;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): BridgeConfig {
  const robotId = env.ROBOT_ID || 'drone1';
  // The robot id goes into subscription SQL, so it must be a plain identifier.
  if (!ROBOT_ID_PATTERN.test(robotId)) throw new Error(`ROBOT_ID must match ${ROBOT_ID_PATTERN}, got ${robotId}`);
  const mode = env.STDB_MODE || 'sdk';
  if (mode !== 'sdk' && mode !== 'http') throw new Error(`STDB_MODE must be sdk or http, got ${mode}`);
  return {
    stdbUri: env.STDB_URI || 'ws://localhost:3000',
    stdbDatabase: env.STDB_DATABASE || 'assess-0hw81',
    stdbToken: env.STDB_TOKEN || undefined,
    stdbMode: mode,
    robotId,
    bridgeSocket: env.BRIDGE_SOCKET || '/run/drone/bridge.sock',
    mediaUrl: (env.MEDIA_URL || 'http://localhost:8080').replace(/\/+$/, ''),
    tokenFile: env.BRIDGE_TOKEN_FILE || './.data/token',
    spoolFile: env.SPOOL_FILE || './.data/spool.jsonl',
    spoolMaxBytes: Math.round(positiveNumber(env, 'SPOOL_MAX_MB', 50) * 1024 * 1024),
    mediaRetries: Math.max(1, Math.round(positiveNumber(env, 'MEDIA_RETRIES', 5))),
    claimIntervalMs: positiveNumber(env, 'CLAIM_INTERVAL_MS', 2000),
  };
}

/**
 * Tokens are per server: the same token file used against Maincloud and the local fallback would
 * hand the robot a new identity and lose its role. So the server host is part of the file name:
 * BRIDGE_TOKEN_FILE=./.data/token with STDB_URI=ws://localhost:3000 gives ./.data/token.localhost_3000.
 */
export function tokenPathFor(tokenFile: string, stdbUri: string): string {
  let host: string;
  try {
    host = new URL(stdbUri).host;
  } catch {
    host = stdbUri;
  }
  const slug = host.toLowerCase().replace(/[^a-z0-9.-]+/g, '_') || 'default';
  return `${tokenFile}.${slug}`;
}
