// Text and number checks (docs/specs/spacetimedb.md section 5.4).
// Every check throws SenderError, so the reducer rolls back and the caller sees the message.

import { SenderError } from 'spacetimedb/server';
import { FORBIDDEN_PATTERN } from '../config';

// Reject stored free text that labels a person as dead.
export function assertNoDeadLabel(text: string, field = 'text'): void {
  if (FORBIDDEN_PATTERN.test(text)) throw new SenderError(`forbidden label in ${field}`);
}

// Length check; returns the text so calls can be inlined.
export function checkLen(text: string, min: number, max: number, field: string): string {
  if (text.length < min || text.length > max) {
    throw new SenderError(`${field} must be ${min} to ${max} characters`);
  }
  return text;
}

// Free text that is stored: length plus the death-word check.
export function freeText(text: string, max: number, field: string, min = 0): string {
  checkLen(text, min, max, field);
  assertNoDeadLabel(text, field);
  return text;
}

export function checkName(name: string, field = 'name'): string {
  return checkLen(name, 1, 40, field);
}

const KIND_RE = /^[a-z_]{1,32}$/;
export function checkKind(kind: string, field = 'kind'): string {
  if (!KIND_RE.test(kind)) throw new SenderError(`${field} must match ^[a-z_]{1,32}$`);
  return kind;
}

// JSON strings: must parse, at most 4000 characters, death-word check on the raw text.
export function checkJson(json: string, field: string, max = 4000): unknown {
  checkLen(json, 0, max, field);
  assertNoDeadLabel(json, field);
  try {
    return JSON.parse(json);
  } catch {
    throw new SenderError(`bad json in ${field}`);
  }
}

export function checkNumber(value: number, min: number, max: number, field: string, maxExclusive = false): number {
  if (!Number.isFinite(value)) throw new SenderError(`${field} must be a finite number`);
  const tooHigh = maxExclusive ? value >= max : value > max;
  if (value < min || tooHigh) throw new SenderError(`${field} out of range`);
  return value;
}

export function checkOptNumber(
  value: number | undefined,
  min: number,
  max: number,
  field: string,
  maxExclusive = false
): number | undefined {
  if (value === undefined) return undefined;
  return checkNumber(value, min, max, field, maxExclusive);
}

export function checkLatLon(lat: number, lon: number): void {
  checkNumber(lat, -90, 90, 'lat');
  checkNumber(lon, -180, 180, 'lon');
}

export function checkConfidence(value: number, field = 'confidence'): number {
  return checkNumber(value, 0, 1, field);
}

// Media URLs: at most 500 characters, http or https only.
export function checkUrl(url: string | undefined, field: string): string | undefined {
  if (url === undefined) return undefined;
  if (url.length > 500 || !/^https?:\/\//.test(url)) {
    throw new SenderError(`${field} must be an http(s) URL of at most 500 characters`);
  }
  return url;
}

export function checkPattern(value: string, re: RegExp, field: string): string {
  if (!re.test(value)) throw new SenderError(`${field} has an invalid format`);
  return value;
}
