#!/usr/bin/env node
// Checks every text and status color pair in tokens.css against WCAG 2.2 AA.
// Normal text needs 4.5:1. Bold text of 18.66 px or larger needs 3:1 (marked "large").
// Non-text UI parts (outlines) need 3:1 (marked "ui").
// Reads the values from tokens.css itself, so the file stays the one source.
// Usage: node frontend/design-tokens/check-contrast.mjs   (exits 1 on any failure)

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const css = readFileSync(join(here, 'tokens.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');

function block(selector) {
  const start = css.indexOf(`${selector} {`);
  if (start < 0) throw new Error(`tokens.css has no ${selector} block`);
  const body = css.slice(start, css.indexOf('}', start));
  const vars = {};
  for (const m of body.matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)) vars[m[1]] = m[2].trim();
  return vars;
}

const light = block(':root');
const dark = { ...light, ...block('[data-theme="dark"]') };

function parseColor(value, vars) {
  const ref = value.match(/^var\((--[\w-]+)\)$/);
  if (ref) return parseColor(vars[ref[1]], vars);
  let m = value.match(/^#([0-9a-f]{6})$/i);
  if (m) return [0, 2, 4].map((i) => parseInt(m[1].slice(i, i + 2), 16));
  m = value.match(/^rgb\(\s*(\d+)[\s,]+(\d+)[\s,]+(\d+)\s*\)$/);
  if (m) return [m[1], m[2], m[3]].map(Number);
  throw new Error(`cannot parse color "${value}"`);
}

function luminance([r, g, b]) {
  const lin = (c) => {
    const s = c / 255;
    return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}

function ratio(a, b) {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

function blend(fg, bg, alpha) {
  return fg.map((c, i) => Math.round(c * alpha + bg[i] * (1 - alpha)));
}

const MIN = { text: 4.5, large: 3, ui: 3 };

// [foreground token, background token, kind]
const pairs = [
  ['--text', '--bg', 'text'],
  ['--text', '--panel', 'text'],
  ['--text-muted', '--bg', 'text'],
  ['--text-muted', '--panel', 'text'],
  ['--focus', '--panel', 'ui'],
  ['--crit-immediate-fg', '--crit-immediate', 'large'],
  ['--crit-delayed-fg', '--crit-delayed', 'text'],
  ['--crit-delayed-outline', '--panel', 'ui'],
  ['--crit-minor-fg', '--crit-minor', 'text'],
  ['--crit-unknown-fg', '--crit-unknown', 'text'],
  ['--status-resolved-fg', '--status-resolved', 'text'],
  ...['immediate', 'delayed', 'minor', 'unknown'].flatMap((l) => [
    [`--crit-${l}-ink`, '--panel', 'text'],
    [`--crit-${l}-ink`, '--bg', 'text'],
  ]),
  ['--status-resolved-ink', '--panel', 'text'],
  ['--status-resolved-ink', '--bg', 'text'],
  ...['orchestrator', 'auditor', 'comms'].flatMap((a) => [
    [`--agent-${a}`, `--agent-${a}-bg`, 'text'],
    [`--agent-${a}`, '--panel', 'text'],
    ['--text', `--agent-${a}-bg`, 'text'],
  ]),
];

let failures = 0;
const rows = [];

function check(theme, label, fg, bg, kind) {
  const r = ratio(fg, bg);
  const ok = r >= MIN[kind];
  if (!ok) failures++;
  rows.push(`${ok ? 'pass' : 'FAIL'}  ${theme.padEnd(5)}  ${r.toFixed(2).padStart(5)}:1  (min ${MIN[kind]}, ${kind.padEnd(5)})  ${label}`);
}

for (const [theme, vars] of [['light', light], ['dark', dark]]) {
  for (const [fg, bg, kind] of pairs) {
    check(theme, `${fg} on ${bg}`, parseColor(vars[fg], vars), parseColor(vars[bg], vars), kind);
  }
}

// Glasses text levels 2 to 4 (status, details, main lines) as green with alpha over black.
// Level 1 is the map attribution only (exempt, as on the dashboard) and level 0 is unused for text.
const green = parseColor(light['--glasses-green'], light);
const black = parseColor(light['--glasses-bg'], light);
for (const level of [2, 3, 4]) {
  const alpha = Number(light[`--glasses-level-${level}`]);
  check('glass', `--glasses-green at level ${level} (alpha ${alpha}) on --glasses-bg`, blend(green, black, alpha), black, 'text');
}

console.log(rows.join('\n'));
console.log(failures ? `\n${failures} pair(s) failed.` : `\nAll ${rows.length} pairs pass WCAG 2.2 AA.`);
process.exit(failures ? 1 : 0);
