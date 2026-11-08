// The UnderDog mascot: a small cartoon tornado, one per agent, each in its agent tint with one prop
// (headset: orchestrator, magnifier: auditor, signal: comms, glasses: rescuer, shield: database fallback).
import { useId } from 'react';

export type MascotKind = 'main' | 'robot' | 'orchestrator' | 'auditor' | 'comms' | 'rescuer' | 'database';

const TINT: Record<MascotKind, string> = {
  main: 'var(--brand)', robot: 'var(--text-muted)', orchestrator: 'var(--agent-orchestrator)', auditor: 'var(--agent-auditor)',
  comms: 'var(--agent-comms)', rescuer: 'var(--rescuer)', database: 'var(--status-resolved)',
};

const BANDS: Array<[number, number, number, number]> = [[61, 102, 7, 4], [58, 91, 13, 6], [62, 78, 20, 7.5], [58, 63, 28, 9], [63, 46, 36, 11], [60, 28, 42, 12]];
const INK = 'var(--night-2)';

export function mascotFor(agentName: string): MascotKind {
  const name = agentName.toLowerCase();
  if (name.includes('orch')) return 'orchestrator';
  if (name.includes('audit')) return 'auditor';
  if (name.includes('comm')) return 'comms';
  if (name.includes('module') || name.includes('watchdog') || name.includes('database')) return 'database';
  if (name.includes('robot') || name.includes('dog')) return 'robot';
  return 'main';
}

export function Mascot({ kind, size = 56, worried = false }: { kind: MascotKind; size?: number; worried?: boolean }) {
  const gradient = useId();
  const tint = TINT[kind];
  return <svg className="mascot" width={size} height={size} viewBox="0 0 120 120" aria-hidden="true">
    <defs>
      <linearGradient id={gradient} x1="0" x2="1">
        <stop offset="0" style={{ stopColor: tint, stopOpacity: 0.55 }} />
        <stop offset="0.45" style={{ stopColor: 'var(--panel)', stopOpacity: 0.95 }} />
        <stop offset="1" style={{ stopColor: tint, stopOpacity: 0.55 }} />
      </linearGradient>
    </defs>
    <ellipse cx="60" cy="112" rx="22" ry="4" style={{ fill: INK, opacity: 0.18 }} />
    {BANDS.map(([x, y, rx, ry]) => <ellipse key={y} cx={x} cy={y} rx={rx} ry={ry} fill={`url(#${gradient})`} style={{ stroke: tint }} strokeWidth="3" />)}
    <path d="M30 26 Q60 34 92 24" fill="none" style={{ stroke: tint }} strokeWidth="2.4" strokeLinecap="round" opacity="0.55" />
    <rect x="16" y="56" width="7" height="7" rx="1.5" transform="rotate(25 19 59)" style={{ fill: tint }} opacity="0.8" />
    <rect x="96" y="70" width="6" height="6" rx="1.5" transform="rotate(-20 99 73)" style={{ fill: tint }} opacity="0.7" />
    <circle cx="100" cy="38" r="3" style={{ fill: 'var(--magenta)' }} opacity="0.8" />
    <circle cx="52" cy="45" r="4.6" style={{ fill: INK }} /><circle cx="73" cy="45" r="4.6" style={{ fill: INK }} />
    <circle cx="53.5" cy="43.5" r="1.4" style={{ fill: 'var(--panel)' }} /><circle cx="74.5" cy="43.5" r="1.4" style={{ fill: 'var(--panel)' }} />
    <path d={worried ? 'M56 56 Q62.5 51 69 56' : 'M56 52 Q62.5 57 69 52'} fill="none" style={{ stroke: INK }} strokeWidth="3" strokeLinecap="round" />
    <ellipse cx="44" cy="52" rx="4.5" ry="2.6" style={{ fill: 'var(--magenta)' }} opacity="0.4" /><ellipse cx="81" cy="52" rx="4.5" ry="2.6" style={{ fill: 'var(--magenta)' }} opacity="0.4" />
    {kind === 'orchestrator' && <g style={{ stroke: INK, fill: 'none' }}>
      <path d="M22 34 A40 32 0 0 1 102 34" strokeWidth="5" />
      <rect x="15" y="30" width="11" height="17" rx="5" style={{ fill: INK }} /><rect x="98" y="30" width="11" height="17" rx="5" style={{ fill: INK }} />
      <path d="M20 47 Q22 62 40 58" strokeWidth="3.5" strokeLinecap="round" /><circle cx="42" cy="58" r="4" style={{ fill: INK }} />
    </g>}
    {kind === 'auditor' && <g>
      <line x1="94" y1="96" x2="108" y2="110" style={{ stroke: INK }} strokeWidth="7" strokeLinecap="round" />
      <circle cx="86" cy="86" r="14" style={{ fill: 'var(--panel)', fillOpacity: 0.55, stroke: INK }} strokeWidth="5" />
    </g>}
    {kind === 'comms' && <g fill="none" style={{ stroke: tint }} strokeWidth="3.5" strokeLinecap="round">
      <path d="M100 14 A12 12 0 0 1 106 28" /><path d="M106 6 A20 20 0 0 1 114 30" opacity="0.6" />
    </g>}
    {kind === 'rescuer' && <g fill="none" style={{ stroke: INK }} strokeWidth="3">
      <rect x="42" y="38" width="20" height="14" rx="5" /><rect x="64" y="38" width="20" height="14" rx="5" /><line x1="62" y1="44" x2="64" y2="44" />
    </g>}
    {kind === 'database' && <g>
      <path d="M88 76 L104 82 L104 94 Q104 104 88 110 Q72 104 72 94 L72 82 Z" style={{ fill: tint, stroke: 'var(--panel)' }} strokeWidth="3" />
      <path d="M81 93 L87 99 L97 87" fill="none" style={{ stroke: 'var(--panel)' }} strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round" />
    </g>}
  </svg>;
}
