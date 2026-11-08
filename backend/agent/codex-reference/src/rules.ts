import type { Row } from './types.js';
import type { WorldView } from './world.js';
import { tier } from './priority.js';
export function reviewRules(w: WorldView, assignment: Row) {
  const s = w.survivor(assignment.survivor_id);
  if (!s) throw new Error('Review survivor outside active run');
  const options = w.rescuers(s), chosen = options.find(r => r.identity === assignment.rescuer_identity);
  const higher = w.pending().find(r => tier(r) < tier(s));
  if(higher) return {verdict:'disagree',flag_kind:'proposal_disagree',reason:`Higher tier survivor #${higher.id} still unassigned`,suggested_action:`Assign survivor #${higher.id} next`};
  const closer = options.find(r => r.free && r.distance_m! < (chosen?.distance_m ?? Infinity)*0.5);
  if(closer) return {verdict:'disagree',flag_kind:'proposal_disagree',reason:`${closer.callsign} free at ${Math.round(closer.distance_m!)} m, over 50% closer`,suggested_action:'Coordinator should review the nearer free rescuer'};
  const lighter = options.find(r => r.free && r.distance_m! <= (chosen?.distance_m ?? 0)*1.5 && (chosen?.active_assignments ?? 0)>0);
  if(lighter) return {verdict:'disagree',flag_kind:'load_imbalance',reason:`Chosen load ${chosen?.active_assignments}; ${lighter.callsign} load 0 and about as close`,suggested_action:'Give the next survivor to the free rescuer'};
  return {verdict:'agree',reason:`rules check only; tier ${tier(s)}, load ${chosen?.active_assignments ?? 0}, no better free rescuer`};
}
export function continueMission(w: WorldView) {
  for(const row of w.active('robot')) {
    const robot=w.robot(row.robot_id);
    const cells=w.cells(row.robot_id).filter(c => ['unsearched','partially_searched'].includes(c.status) && !c.targeted_by_mission_id).slice(0,3);
    if(robot?.idle && cells.length) return {robot_id:robot.robot_id,kind:'search_cells',target_cell_ids:cells.map(c=>c.id),reason:'[fallback] Continue untargeted cells with unaccounted people first'};
  }
  return undefined;
}
