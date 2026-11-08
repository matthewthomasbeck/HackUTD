import type { Row } from '../types.js';
import type { WorldView } from '../world.js';
import { tier } from '../priority.js';
export function readTool(w: WorldView, tool: string,a: Row): unknown {
  if(tool==='get_board') return w.board();
  if(tool==='get_survivor') {
    const survivor=w.survivor(a.survivor_id)!;
    return {survivor,tier:tier(survivor),cell:w.active('search_cell').find(c=>c.id===survivor.cell_id),detections:w.active('detection').filter(d=>d.survivor_id===survivor.id),assignments:w.active('assignment').filter(x=>x.survivor_id===survivor.id)};
  }
  if(tool==='list_rescuers') return w.rescuers(a.near_survivor_id?w.survivor(a.near_survivor_id):undefined).filter(r=>a.only_available===false || r.available);
  if(tool==='list_cells') return w.cells(a.near_robot_id).filter(c=>(a.statuses || ['unsearched','partially_searched']).includes(c.status) && (a.include_targeted || !c.targeted_by_mission_id)).slice(0,a.limit || 10);
  if(tool==='get_robot') return w.robot(a.robot_id);
  return undefined;
}
