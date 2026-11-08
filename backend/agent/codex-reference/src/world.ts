import type { Row } from './types.js';
import { geo } from './geo.js';
import { ranked } from './priority.js';

export class WorldView {
  constructor(public tables: Record<string, Row[]> = {}, public now: () => number = Date.now) {}
  rows(table: string): Row[] { return this.tables[table] || []; }
  activeRun(): Row | undefined { return this.rows('run').filter(r => !r.ended_at).sort((a,b) => Date.parse(b.started_at) - Date.parse(a.started_at))[0]; }
  active(table: string) {
    const run = this.activeRun();
    if (!run) return [];
    const survivors = this.rows('survivor').filter(s => s.site_id === run.site_id && Date.parse(s.created_at) >= Date.parse(run.started_at));
    if (table === 'survivor') return survivors;
    if (table === 'assignment') return this.rows(table).filter(a => survivors.some(s => s.id === a.survivor_id));
    return this.rows(table).filter(r => r.run_id !== undefined ? r.run_id === run.id : r.site_id !== undefined ? r.site_id === run.site_id : true);
  }
  survivor(id: number) { return this.active('survivor').find(s => s.id === id); }
  assignment(id: number) { return this.active('assignment').find(a => a.id === id); }
  pending() { return ranked(this.active('survivor').filter(s => s.status === 'unassigned' && !this.active('assignment').some(a => a.survivor_id === s.id && ['proposed','active'].includes(a.status)))); }
  rescuers(near?: Row) {
    return this.rows('participant').filter(p => p.role === 'rescuer').map((p, i) => {
      const assignments = this.active('assignment').filter(a => a.rescuer_identity === p.identity);
      const fresh = p.online && p.lat != null && p.lon != null && this.now() - Date.parse(p.last_heartbeat) <= 15000;
      const available = fresh && !assignments.some(a => a.status === 'proposed');
      const active_assignments = assignments.filter(a => a.status === 'active').length;
      return { identity: p.identity, callsign: `Rescuer ${String.fromCharCode(65 + i)}`, fresh: Boolean(fresh), available: Boolean(available), free: available && active_assignments === 0, active_assignments, ...(near && p.lat != null && p.lon != null ? geo(p.lat, p.lon, near.lat, near.lon) : {}) };
    });
  }
  cells(robotId?: string): Row[] {
    const robot = this.active('robot').find(r => r.robot_id === robotId);
    const site = this.rows('site').find(s => s.id === this.activeRun()?.site_id);
    const lat = robot?.lat ?? site?.center_lat, lon = robot?.lon ?? site?.center_lon;
    return this.active('search_cell').map(c => ({ ...c,
      distance_m: lat != null && lon != null ? geo(lat, lon, c.lat, c.lon).distance_m : 0,
      targeted_by_mission_id: this.active('mission').find(m => ['proposed','queued','leased'].includes(m.status) && m.target_cell_ids?.includes(c.id))?.id ?? 0,
    } as Row)).sort((a,b) => Number(b.unaccounted > 0) - Number(a.unaccounted > 0) || a.distance_m - b.distance_m);
  }
  robot(id: string): Row | undefined {
    const robot = this.active('robot').find(r => r.robot_id === id);
    if (!robot) return undefined;
    const missions = this.active('mission').filter(m => m.robot_id === id && ['proposed','queued','leased'].includes(m.status));
    return { ...robot, idle: robot.online && robot.state === 'READY' && !robot.current_mission_id && !missions.length, missions,
      devices: this.active('device_status').filter(d => d.robot_id === id) };
  }
  board() { return { run: this.activeRun(), survivors: this.pending().slice(0,5), rescuers: this.rescuers(), cells: this.cells(), robots: this.active('robot'), flags: this.active('audit_flag').filter(f => f.status === 'open') }; }
  // Model packets contain only callsigns. Reducer identities remain local.
  modelPacket(value: unknown): unknown {
    const map = new Map(this.rescuers().map(r => [r.identity, r.callsign]));
    const names = this.rows('participant').map(p => p.name).filter((n): n is string => typeof n === 'string' && n.length > 1);
    const clean = (v: any): any => {
      if (typeof v === 'string') {
        let text = v;
        for (const [identity, callsign] of map) text = text.split(identity).join(callsign);
        for (const name of names) text = text.split(name).join('[participant]');
        return text.replace(/\b[0-9a-fA-F]{64}\b/g, '[identity]').replace(/[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}/g, '[email]').replace(/\+?\d[\d ()-]{8,}\d/g, '[phone]');
      }
      if (Array.isArray(v)) return v.map(clean);
      if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v).filter(([k]) => !['name','rescuer_name','audio_url','camera_image_url','breathing_clip_url'].includes(k)).map(([k,x]) => [k,clean(x)]));
      return v;
    };
    return clean(value);
  }
}
export class FakeWorld extends WorldView {}
