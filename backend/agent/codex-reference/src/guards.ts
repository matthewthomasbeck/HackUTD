import type { AgentName, Row, Wake } from './types.js';
import type { WorldView } from './world.js';
import { tier } from './priority.js';
import { geo } from './geo.js';
export const forbidden = /\b(dead|deceased|died|death|expectant|fatal|corpse|body recovery|no pulse|lifeless)\b/i;
export function safeText(value: unknown) { if (forbidden.test(JSON.stringify(value))) throw new Error('Forbidden wording'); }
export function briefing(text: string) {
  safeText(text);
  if (text.length > 120) throw new Error(`Briefing length ${text.length} exceeds 120`);
  if (!/^[\x20-\x7E]+$/.test(text)) throw new Error('Briefing must be one line of plain ASCII');
  if (/\brescued\b|\bsafe now\b/i.test(text)) throw new Error('Only a human confirms resolution');
}
export function guard(w: WorldView, agent: AgentName, tool: string, a: Row, wake: Wake) {
  if (!w.activeRun()) throw new Error('No active run');
  safeText(a);
  if (a.survivor_id && !w.survivor(a.survivor_id)) throw new Error('Survivor outside active run');
  if (a.near_survivor_id && !w.survivor(a.near_survivor_id)) throw new Error('Survivor outside active run');
  if (tool === 'propose_assignment') {
    if (agent !== 'orchestrator') throw new Error('unknown tool');
    const s = w.survivor(a.survivor_id)!;
    const prior = w.active('assignment').find(x => x.survivor_id === s.id && ['proposed','active'].includes(x.status));
    if (prior) throw new Error(prior.created_by !== 'orchestrator' ? 'already proposed by watchdog' : 'Survivor already has an assignment');
    if (s.status !== 'unassigned') throw new Error('Survivor is not unassigned');
    const higher = w.pending().find(x => tier(x) < tier(s));
    if (higher) throw new Error(`Higher-tier survivor #${higher.id} waits`);
    const options = w.rescuers(s).filter(r => r.available);
    const rescuer = options.find(r => r.identity === a.rescuer_identity);
    if (!rescuer) throw new Error('Rescuer unavailable or stale');
    const lapsed = w.active('assignment').some(x => x.survivor_id === s.id && x.rescuer_identity === rescuer.identity && x.status === 'released' && ['expired','heartbeat_lost','disconnected'].includes(x.release_cause) && w.now() - Date.parse(x.updated_at) < 300000);
    if (lapsed && options.some(r => r.identity !== rescuer.identity)) throw new Error('Choose a different available rescuer after a lapsed proposal');
    const closer = options.find(r => r.identity !== rescuer.identity && r.distance_m! < rescuer.distance_m! * 0.5);
    const lighter = options.find(r => r.identity !== rescuer.identity && r.active_assignments < rescuer.active_assignments && r.distance_m! <= rescuer.distance_m! * 1.5);
    if ((closer || lighter) && !/because|despite|however|tradeoff|closer|load|about to|free soon/i.test(a.reason)) throw new Error('Reason must explain the closer rescuer or load tradeoff');
  }
  if (tool === 'delegate') {
    const assignment = w.assignment(a.assignment_id);
    if (!assignment || assignment.survivor_id !== a.survivor_id || !['proposed','active'].includes(assignment.status)) throw new Error('No matching open assignment');
    if (w.active('agent_task').some(t => t.kind === 'brief_rescuer' && ['open','claimed'].includes(t.status) && JSON.parse(t.payload_json).assignment_id === a.assignment_id)) throw new Error('Briefing task already open');
  }
  if (tool === 'set_flag_status' && !w.active('audit_flag').some(f => f.id === a.flag_id && f.status === 'open')) throw new Error('Flag is not open');
  if (tool === 'get_robot' && !w.robot(a.robot_id)) throw new Error('Robot outside active site');
  if (tool === 'create_mission') {
    const robot = w.robot(a.robot_id);
    if (!robot?.online) throw new Error('Robot is offline');
    if (robot.missions.some((m: Row) => ['proposed','queued','leased'].includes(m.status))) throw new Error('Robot already has an open mission');
    if (a.kind === 'search_cells') {
      if (!a.target_cell_ids?.length) throw new Error('search_cells requires target_cell_ids');
      for (const id of a.target_cell_ids) if (!w.cells().some(c => c.id === id && c.status !== 'searched' && !c.targeted_by_mission_id)) throw new Error('Cell searched, targeted, or outside active site');
    }
    const site = w.rows('site').find(s => s.id === w.activeRun()!.site_id)!;
    const targets = a.kind === 'search_cells' ? w.cells().filter(c => a.target_cell_ids.includes(c.id)).map(c => [c.lat,c.lon]) : [[a.target_lat,a.target_lon]];
    if (a.kind === 'inspect' && (a.target_lat == null || a.target_lon == null)) throw new Error('inspect requires target coordinates');
    for (const [lat,lon] of targets) if (lat != null && lon != null && geo(site.center_lat, site.center_lon, lat, lon).distance_m > site.radius_m + 50) throw new Error('Target outside site');
    if (['hold','return_home'].includes(a.kind)) {
      const failed = robot.devices.filter((d: Row) => d.status === 'FAILED');
      if (!(robot.battery < 20 || robot.battery_pct < 20 || failed.length)) throw new Error('hold/return_home requires low battery or failed device');
      if (!/battery|\bFAILED\b/i.test(a.reason) && !failed.some((d: Row) => a.reason.includes(d.device_id))) throw new Error('Name the battery or failed device');
    }
  }
  if (tool === 'cancel_own_mission' && !w.active('mission').some(m => m.id === a.mission_id && m.created_by === 'orchestrator' && ['proposed','queued'].includes(m.status))) throw new Error('Cannot cancel another creator or leased mission');
  if (tool === 'send_briefing') {
    briefing(a.text);
    const special = ['all','coordinators','commander'].includes(a.audience);
    if (!special) {
      if (!w.rescuers().some(r => r.identity === a.audience && r.fresh)) throw new Error('Audience is not a fresh rescuer');
      const task = w.active('agent_task').find(t => t.id === wake.task_id);
      const payload = task ? JSON.parse(task.payload_json) : {};
      const answer = wake.kind === 'answer_rescuer' && payload.rescuer_identity === a.audience;
      if (!answer && a.survivor_id && !w.active('assignment').some(x => x.survivor_id === a.survivor_id && x.rescuer_identity === a.audience && ['proposed','active'].includes(x.status))) throw new Error('Rescuer does not hold this assignment');
    }
    if (w.active('briefing').some(b => b.audience === a.audience && b.text === a.text && w.now() - Date.parse(b.created_at) < 60000)) throw new Error('Duplicate briefing within 60 seconds');
  }
  if (tool === 'submit_review') {
    const task = w.active('agent_task').find(t => t.id === wake.task_id);
    if (!task || task.kind !== 'review' || task.to_agent !== agent || task.status !== 'claimed') throw new Error('No claimed review task');
    if (!/\d|tier|load|distance|immediate|delayed/i.test(a.reason)) throw new Error('Review reason must cite a fact');
    if (a.verdict === 'agree' && a.flag_kind) throw new Error('flag_kind only with disagree');
    if (a.verdict === 'disagree' && !a.suggested_action) throw new Error('A disagreement must name a better action');
  }
}
