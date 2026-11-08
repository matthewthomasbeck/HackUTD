// The right-hand floating cards: the database's headline, who is moving (rescuers and robots), and the houses.
import type { HouseCounts } from '../site/houses';
import { CardHeader, useCollapsed } from './CardHeader';
import { Mascot } from './Mascot';

export function HeadlineCard({ unattended }: { unattended: number }) {
  const ok = unattended === 0;
  return <section className={`fcard headline ${ok ? 'ok' : 'alarm'}`} aria-live="polite">
    <Mascot kind="main" size={58} worried={!ok} />
    <span className="bignum">{unattended}</span>
    <div className="txt">critical unattended over 60 s<span>enforced by the database</span></div>
  </section>;
}

export interface PersonRow { id: string; name: string; initials: string; robot: boolean; where: string; status: { text: string; tone: 'ok' | 'warn' | 'muted' } }

export function PeopleCard({ rows }: { rows: readonly PersonRow[] }) {
  const { collapsed, toggle } = useCollapsed();
  return <section className={`fcard ${collapsed ? 'collapsed' : ''}`} aria-label="Rescuers and robot">
    <CardHeader title="Rescuers and robot" count={rows.length} collapsed={collapsed} onToggle={toggle} />
    {!collapsed && <div className="people">
      {rows.length === 0 && <p className="empty">No rescuer is on a task and no robot is online.</p>}
      {rows.map((row) => <div key={row.id} className="person">
        {row.robot ? <span className="av robot" aria-hidden="true"><Mascot kind="robot" size={28} /></span> : <span className="av">{row.initials}</span>}
        <span className="who"><b>{row.name}</b><small>{row.where}</small></span>
        <span className={`st tone-${row.status.tone}`}>{row.status.text}</span>
      </div>)}
    </div>}
  </section>;
}

// What the map's colors and shapes mean, so every mark on the map has a label somewhere.
export function MapKey() {
  const { collapsed, toggle } = useCollapsed();
  return <section className={`fcard map-key ${collapsed ? 'collapsed' : ''}`} aria-label="Map key">
    <CardHeader title="Map key" count="?" collapsed={collapsed} onToggle={toggle} />
    {!collapsed && <div className="key-grid">
      <span><i className="kh kh-critical" />critical survivor inside</span>
      <span><i className="kh kh-open" />open, people unaccounted</span>
      <span><i className="kh kh-clear" />searched, clear</span>
      <span><i className="kh kh-todo" />not searched yet</span>
      <span><svg width="12" height="12" viewBox="0 0 12 12"><path d="M6 1 L11 11 H1 Z" className="glyph-immediate" /></svg>immediate</span>
      <span><svg width="12" height="12" viewBox="0 0 12 12"><rect x="1.5" y="1.5" width="9" height="9" className="glyph-delayed" /></svg>delayed</span>
      <span><svg width="12" height="12" viewBox="0 0 12 12"><circle cx="6" cy="6" r="4.5" className="glyph-minor" /></svg>minor</span>
      <span><svg width="12" height="12" viewBox="0 0 12 12"><path d="M6 1 L11 6 L6 11 L1 6 Z" className="glyph-unknown" /></svg>not scored</span>
      <span><i className="km km-rescuer" />rescuer (glasses)</span>
      <span><i className="km km-robot" />robot dog</span>
      <span><i className="km km-route" />rescuer route</span>
    </div>}
  </section>;
}

export interface MissionRow { id: bigint; text: string }

export function HousesCard({ counts, missions, readOnly, onApprove, onCancel }: {
  counts: HouseCounts; missions: readonly MissionRow[]; readOnly: boolean;
  onApprove: (id: bigint) => void; onCancel: (id: bigint) => void;
}) {
  const { collapsed, toggle } = useCollapsed();
  return <section className={`fcard ${collapsed ? 'collapsed' : ''}`} aria-label="Houses in the block">
    <CardHeader title="Houses in the block" count={counts.total} collapsed={collapsed} onToggle={toggle} />
    {!collapsed && <>
    <div className="seg" aria-hidden="true">
      <i className="seg-clear" style={{ flex: counts.clear }} /><i className="seg-open" style={{ flex: counts.open }} /><i className="seg-todo" style={{ flex: counts.toSearch }} />
    </div>
    <div className="trio">
      <div><div className="bignum">{counts.clear}</div><small><i className="seg-clear" />searched, clear</small></div>
      <div><div className="bignum">{counts.open}</div><small><i className="seg-open" />open</small></div>
      <div><div className="bignum">{counts.toSearch}</div><small><i className="seg-todo" />to search</small></div>
    </div>
    {missions.length > 0 && <div className="missions">
      {missions.map((mission) => <div key={String(mission.id)} className="mission">
        <span>{mission.text}</span>
        {!readOnly && <span className="mission-actions"><button className="btn small" onClick={() => onApprove(mission.id)}>Approve</button><button className="btn small ghost" onClick={() => onCancel(mission.id)}>Cancel</button></span>}
      </div>)}
    </div>}
    </>}
  </section>;
}
