import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

export interface Offset {
  east_m: number;
  north_m: number;
}

export interface DemoSiteConfig {
  site: {
    name: string;
    center_lat: number;
    center_lon: number;
    radius_m: number;
    demo_mode: boolean;
    require_mission_approval: boolean;
  };
  cell_size_m: number;
  houses: Array<{ label: string; east_m: number; north_m: number; demo_pile?: boolean; view_blocked?: boolean }>;
  scale_lots: { file: string; label_prefix: string; exclude_within_m: number };
  demo_anchor: Offset & { label: string };
  robots: {
    real: { robot_id: string };
    sim: { robot_id: string; home: Offset };
    fleet_size: number;
  };
  rescuers: Array<{ key: string; name: string; real?: boolean; start?: Offset }>;
  extra_sim_rescuers: number;
  hidden_survivors: Array<{
    house: string;
    east_m: number;
    north_m: number;
    note: string;
    level: 'immediate' | 'delayed' | 'minor' | 'unknown';
    breathing: 'detected' | 'not_detected' | 'unknown';
    rate_bpm?: number;
    visibility_pct?: number;
  }>;
  family_report: { house: string; kind: string; count: number; name_or_unit: string; source: string; note: string };
  scale: {
    count: number;
    rate_per_s: number;
    seed: number;
    mix: { immediate: number; delayed: number; minor: number; unknown: number };
    not_detected_share_of_immediate: number;
    min_spacing_m: number;
    duplicate_pairs: number;
  };
  timing: {
    speedup: number;
    robot_heartbeat_ms: number;
    rescuer_heartbeat_ms: number;
    position_ms: number;
    accept_delay_s: [number, number];
    on_scene_s: number;
    auto_resolve_sim_rescues: boolean;
  };
  media: Record<string, string>;
}

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function requireRecord(value: unknown, path: string): Record<string, unknown> {
  if (!record(value)) throw new Error(`${path} must be an object`);
  return value;
}

// The module's checkName accepts 1 to 40 characters for site names and cell labels.
const MODULE_NAME_MAX = 40;
function requireName(value: unknown, path: string): string {
  const name = requireString(value, path);
  if (name.length > MODULE_NAME_MAX) throw new Error(`${path} must be at most ${MODULE_NAME_MAX} characters (module limit)`);
  return name;
}

function requireNumber(value: unknown, path: string, min = -Infinity): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < min) {
    throw new Error(`${path} must be a finite number${Number.isFinite(min) ? ` >= ${min}` : ''}`);
  }
  return value;
}

function requireString(value: unknown, path: string): string {
  if (typeof value !== 'string' || value.length === 0) throw new Error(`${path} must be a non-empty string`);
  return value;
}

function validateOffset(value: unknown, path: string): void {
  const offset = requireRecord(value, path);
  requireNumber(offset.east_m, `${path}.east_m`);
  requireNumber(offset.north_m, `${path}.north_m`);
}

// Extra sim rescuers continue the numbering after the named sim rescuers (R1, R2, then R3 on); real rescuers are not numbered.
export function extraRescuerNumber(config: DemoSiteConfig, index: number): number {
  return config.rescuers.filter((rescuer) => !rescuer.real).length + index + 1;
}

export function validateDemoConfig(value: unknown): asserts value is DemoSiteConfig {
  const root = requireRecord(value, 'config');
  const site = requireRecord(root.site, 'site');
  requireNumber(site.center_lat, 'site.center_lat', -90);
  if ((site.center_lat as number) > 90) throw new Error('site.center_lat must be between -90 and 90');
  requireNumber(site.center_lon, 'site.center_lon', -180);
  if ((site.center_lon as number) > 180) throw new Error('site.center_lon must be between -180 and 180');
  requireNumber(site.radius_m, 'site.radius_m', 0);
  requireName(site.name, 'site.name');
  if (typeof site.demo_mode !== 'boolean') throw new Error('site.demo_mode must be a boolean');
  if (typeof site.require_mission_approval !== 'boolean') throw new Error('site.require_mission_approval must be a boolean');
  requireNumber(root.cell_size_m, 'cell_size_m', 0);
  if (!Array.isArray(root.houses) || root.houses.length === 0) throw new Error('houses must be a non-empty array');
  root.houses.forEach((item, index) => {
    const house = requireRecord(item, `houses[${index}]`);
    requireName(house.label, `houses[${index}].label`);
    requireNumber(house.east_m, `houses[${index}].east_m`);
    requireNumber(house.north_m, `houses[${index}].north_m`);
  });
  const lots = requireRecord(root.scale_lots, 'scale_lots');
  requireString(lots.file, 'scale_lots.file');
  requireString(lots.label_prefix, 'scale_lots.label_prefix');
  requireNumber(lots.exclude_within_m, 'scale_lots.exclude_within_m', 0);
  const anchor = requireRecord(root.demo_anchor, 'demo_anchor');
  requireString(anchor.label, 'demo_anchor.label');
  validateOffset(anchor, 'demo_anchor');
  const robots = requireRecord(root.robots, 'robots');
  const realRobot = requireRecord(robots.real, 'robots.real');
  requireString(realRobot.robot_id, 'robots.real.robot_id');
  const simRobot = requireRecord(robots.sim, 'robots.sim');
  requireString(simRobot.robot_id, 'robots.sim.robot_id');
  validateOffset(simRobot.home, 'robots.sim.home');
  requireNumber(robots.fleet_size, 'robots.fleet_size', 1);
  if (!Array.isArray(root.rescuers)) throw new Error('rescuers must be an array');
  root.rescuers.forEach((item, index) => {
    const rescuer = requireRecord(item, `rescuers[${index}]`);
    requireString(rescuer.key, `rescuers[${index}].key`);
    requireString(rescuer.name, `rescuers[${index}].name`);
    if (rescuer.real !== undefined && typeof rescuer.real !== 'boolean') throw new Error(`rescuers[${index}].real must be a boolean`);
    if (rescuer.start !== undefined) validateOffset(rescuer.start, `rescuers[${index}].start`);
  });
  requireNumber(root.extra_sim_rescuers, 'extra_sim_rescuers', 0);
  if (!Array.isArray(root.hidden_survivors)) throw new Error('hidden_survivors must be an array');
  root.hidden_survivors.forEach((item, index) => {
    const survivor = requireRecord(item, `hidden_survivors[${index}]`);
    for (const key of ['house', 'note', 'level', 'breathing']) requireString(survivor[key], `hidden_survivors[${index}].${key}`);
    requireNumber(survivor.east_m, `hidden_survivors[${index}].east_m`);
    requireNumber(survivor.north_m, `hidden_survivors[${index}].north_m`);
    if (survivor.rate_bpm !== undefined) requireNumber(survivor.rate_bpm, `hidden_survivors[${index}].rate_bpm`, 0);
    if (survivor.visibility_pct !== undefined) {
      const visibility = requireNumber(survivor.visibility_pct, `hidden_survivors[${index}].visibility_pct`, 0);
      if (visibility > 100) throw new Error(`hidden_survivors[${index}].visibility_pct must be <= 100`);
    }
  });
  const report = requireRecord(root.family_report, 'family_report');
  for (const key of ['house', 'kind', 'name_or_unit', 'source', 'note']) requireString(report[key], `family_report.${key}`);
  requireNumber(report.count, 'family_report.count', 1);
  const scale = requireRecord(root.scale, 'scale');
  requireNumber(scale.count, 'scale.count', 0);
  requireNumber(scale.rate_per_s, 'scale.rate_per_s', 0);
  requireNumber(scale.seed, 'scale.seed', 0);
  requireNumber(scale.min_spacing_m, 'scale.min_spacing_m', 0);
  requireNumber(scale.duplicate_pairs, 'scale.duplicate_pairs', 0);
  requireNumber(scale.not_detected_share_of_immediate, 'scale.not_detected_share_of_immediate', 0);
  if ((scale.not_detected_share_of_immediate as number) > 1) throw new Error('scale.not_detected_share_of_immediate must be <= 1');
  const mix = requireRecord(scale.mix, 'scale.mix');
  const mixSum = ['immediate', 'delayed', 'minor', 'unknown'].reduce((sum, key) => sum + requireNumber(mix[key], `scale.mix.${key}`, 0), 0);
  if (Math.abs(mixSum - 1) > 1e-9) throw new Error('scale.mix values must sum to 1');
  const timing = requireRecord(root.timing, 'timing');
  for (const key of ['speedup', 'robot_heartbeat_ms', 'rescuer_heartbeat_ms', 'position_ms', 'on_scene_s']) {
    requireNumber(timing[key], `timing.${key}`, 0);
  }
  if (!Array.isArray(timing.accept_delay_s) || timing.accept_delay_s.length !== 2) {
    throw new Error('timing.accept_delay_s must contain [min, max]');
  }
  requireNumber(timing.accept_delay_s[0], 'timing.accept_delay_s[0]', 0);
  requireNumber(timing.accept_delay_s[1], 'timing.accept_delay_s[1]', timing.accept_delay_s[0] as number);
  if (typeof timing.auto_resolve_sim_rescues !== 'boolean') throw new Error('timing.auto_resolve_sim_rescues must be a boolean');
  const media = requireRecord(root.media, 'media');
  for (const [key, item] of Object.entries(media)) requireString(item, `media.${key}`);
}

export function loadDemoConfig(path = fileURLToPath(new URL('../demo-site.json', import.meta.url))): DemoSiteConfig {
  const parsed: unknown = JSON.parse(readFileSync(path, 'utf8'));
  validateDemoConfig(parsed);
  return parsed;
}
