// Roles and per-agent write rules (docs/specs/spacetimedb.md sections 5.1 and 5.2).

import { SenderError } from 'spacetimedb/server';
import type { Ctx, ParticipantRow, RoleTag, SiteRow } from '../schema';

export type AgentNameStr = 'orchestrator' | 'comms_agent' | 'auditor';
const HUMAN_ROLES: RoleTag[] = ['rescuer', 'coordinator', 'commander'];

export interface Allow {
  // Roles that may call. commander passes coordinator checks; coordinator and commander pass rescuer checks.
  roles?: RoleTag[];
  // Agents (by participant.name) that may call.
  agents?: AgentNameStr[];
  // Human-only reducers reject agent, auditor, robot, perception, and sim, even in demo mode.
  human?: boolean;
  // Set to false when the sim identity must not call this reducer even in demo mode.
  sim?: boolean;
}

// True while any site is in demo mode.
export function isDemo(ctx: Ctx): boolean {
  for (const s of ctx.db.site.iter()) if (s.demo_mode) return true;
  return false;
}

export function anySite(ctx: Ctx): boolean {
  for (const _s of ctx.db.site.iter()) return true;
  return false;
}

// The active run's site, else the site with the lowest id.
export function activeSite(ctx: Ctx): SiteRow | undefined {
  for (const r of ctx.db.run.iter()) {
    if (r.ended_at === undefined) {
      const s = ctx.db.site.id.find(r.site_id);
      if (s) return s;
    }
  }
  let best: SiteRow | undefined;
  for (const s of ctx.db.site.iter()) if (!best || s.id < best.id) best = s;
  return best;
}

export function callerParticipant(ctx: Ctx): ParticipantRow | undefined {
  return ctx.db.participant.identity.find(ctx.sender) ?? undefined;
}

export function isHumanRole(role: RoleTag): boolean {
  return HUMAN_ROLES.includes(role);
}

// Roles a human role counts as, by the rule in section 5.1.
function effectiveRoles(role: RoleTag): RoleTag[] {
  if (role === 'commander') return ['commander', 'coordinator', 'rescuer'];
  if (role === 'coordinator') return ['coordinator', 'rescuer'];
  return [role];
}

// True if the participant is a coordinator or commander.
export function isCoordinator(p: ParticipantRow): boolean {
  return p.role.tag === 'coordinator' || p.role.tag === 'commander';
}

// Check the caller against an Allow rule and return the caller's participant row.
export function authorize(ctx: Ctx, allow: Allow): ParticipantRow {
  const p = callerParticipant(ctx);
  if (!p) throw new SenderError('not registered');
  const role = p.role.tag;

  if (role === 'sim') {
    if (allow.human) throw new SenderError('human only');
    if (allow.sim === false) throw new SenderError('not allowed for sim');
    if (!isDemo(ctx)) throw new SenderError('sim role only in demo mode');
    return p;
  }

  if (role === 'agent' || role === 'auditor') {
    const names = allow.agents ?? [];
    const nameOk = names.includes(p.name as AgentNameStr);
    // The auditor name only counts with the auditor role, and the agent names only with the agent role.
    const roleOk = (p.name === 'auditor') === (role === 'auditor');
    if (!allow.human && nameOk && roleOk) return p;
    throw new SenderError(`not allowed for ${p.name}`);
  }

  if (allow.human && !isHumanRole(role)) throw new SenderError('human only');
  const roles = allow.roles ?? [];
  for (const r of effectiveRoles(role)) if (roles.includes(r)) return p;
  throw new SenderError(`not allowed for role ${role}`);
}

// Any agent or the auditor (the shared agent calls).
export function requireAnyAgent(ctx: Ctx): ParticipantRow {
  return authorize(ctx, { agents: ['orchestrator', 'comms_agent', 'auditor'] });
}

// Role robot with participant.name equal to robot_id, or sim in demo mode with a robot_id starting with "sim".
export function requireRobot(ctx: Ctx, robot_id: string): ParticipantRow {
  const p = callerParticipant(ctx);
  if (!p) throw new SenderError('not registered');
  if (p.role.tag === 'robot') {
    if (p.name !== robot_id) throw new SenderError('robot may only write for its own robot_id');
    return p;
  }
  if (p.role.tag === 'sim') {
    if (!isDemo(ctx)) throw new SenderError('sim role only in demo mode');
    if (!robot_id.startsWith('sim')) throw new SenderError('sim robots must start with "sim"');
    return p;
  }
  throw new SenderError(`not allowed for role ${p.role.tag}`);
}

// The caller's display name, used for created_by, reported_by, and similar columns.
export function actorName(p: ParticipantRow): string {
  return p.name;
}
