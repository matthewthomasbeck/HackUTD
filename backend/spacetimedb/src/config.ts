// Module constants (docs/specs/spacetimedb.md section 2.2).
// Per-site timings (leases, escalation) live on the site row instead (section 2.1).

export const SITE_TIMINGS_NORMAL = {
  mission_lease_s: 30,
  assignment_lease_s: 120,
  proposal_lease_s: 60,
  escalate_after_s: 180,
};
export const SITE_TIMINGS_DEMO = {
  mission_lease_s: 15,
  assignment_lease_s: 30,
  proposal_lease_s: 30,
  escalate_after_s: 45,
};
export const DEFAULT_SITE_RADIUS_M = 483;

export const RESCUER_HEARTBEAT_S = 15;
export const ROBOT_HEARTBEAT_S = 5;
export const DISCONNECT_GRACE_S = 2;
export const ROBOT_DISCONNECT_GRACE_S = 5;
// A connection that closes sooner than this after opening is treated as one HTTP request,
// not a session, so it never starts a disconnect grace (see lib/presence.ts).
export const SESSION_MIN_S = 1;
export const AGENT_WATCHDOG_S = 30;
export const AGENT_WATCHDOG_DEMO_S = 15;
// Backstop: an immediate survivor with no open proposal for this long gets a module proposal even while agents are alive.
export const UNPROPOSED_BACKSTOP_S = 30;
export const UNPROPOSED_BACKSTOP_DEMO_S = 15;
export const AGENT_TASK_LEASE_S = 30;
export const AGENT_TASK_MAX_ATTEMPTS = 3;
export const SWEEP_INTERVAL_S = 10;
export const UNATTENDED_HEADLINE_S = 60;
export const MERGE_RADIUS_M = 4.0;
export const DUPLICATE_RADIUS_M = 10.0;
export const MIN_THERMAL_CONFIDENCE = 0.3;
export const MAX_OPEN_AGENT_PROPOSALS = 5;
export const MAX_OPEN_TASKS_PER_AGENT = 50;
export const BRIEFING_MIN_GAP_US = 3_000_000n;
export const MAX_GRID_CELLS = 2500;
// observed_at may be at most this far in the future.
export const OBSERVED_AT_MAX_FUTURE_US = 5_000_000n;

// Death words are rejected in stored free text (section 5.4).
export const FORBIDDEN_PATTERN = /\b(dead|deceased|deceas\w*|expectant|corpse)\b|\bbody\s+recovery\b/i;

// created_by, from_agent, or agent for rows the module writes itself.
export const MODULE_ACTOR = 'module';

export const US_PER_S = 1_000_000n;
