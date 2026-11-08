import { readFile } from 'node:fs/promises';

export interface RescuerMap {
  default: string;
  by_serial: Record<string, string>;
}

export async function readRescuerMap(path: string): Promise<RescuerMap> {
  const parsed: unknown = JSON.parse(await readFile(path, 'utf8'));
  if (!parsed || typeof parsed !== 'object') throw new Error('rescuers.json must contain an object.');
  const value = parsed as Record<string, unknown>;
  if (typeof value.default !== 'string' || !/^[a-zA-Z0-9_-]{1,48}$/.test(value.default)) throw new Error('rescuers.json needs a valid default rescuer name.');
  const rawBySerial = value.by_serial ?? {};
  if (!rawBySerial || typeof rawBySerial !== 'object' || Array.isArray(rawBySerial)) throw new Error('rescuers.json by_serial must be an object.');
  const bySerial: Record<string, string> = {};
  for (const [serial, rescuer] of Object.entries(rawBySerial)) {
    if (typeof rescuer !== 'string' || !/^[a-zA-Z0-9_-]{1,48}$/.test(rescuer)) throw new Error(`Invalid rescuer for serial ${serial}.`);
    bySerial[serial] = rescuer;
  }
  return { default: value.default, by_serial: bySerial };
}

export function resolveRescuer(mapping: RescuerMap, input: { requested?: string; serial?: string }): string {
  const listed = new Set([mapping.default, ...Object.values(mapping.by_serial)]);
  if (input.requested && listed.has(input.requested)) return input.requested;
  if (input.serial && mapping.by_serial[input.serial]) return mapping.by_serial[input.serial]!;
  return mapping.default;
}
