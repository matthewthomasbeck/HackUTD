// The slim night-purple top bar: the Assess name, the two pages, the system chips (collapsed to one summary
// chip until opened), Play demo (demo sites only), and the run recorder.
import { useState } from 'react';

export type Page = 'board' | 'agents';
export interface SystemChip { label: string; detail: string; ok: boolean }

type Props = {
  page: Page;
  onPage: (page: Page) => void;
  chips: readonly SystemChip[];
  demo: { label: string; busy: boolean; disabled: boolean; onClick: () => void } | null;
  run: { active: boolean; disabled: boolean; onClick: () => void } | null;
};

export function AppBar({ page, onPage, chips, demo, run }: Props) {
  const [open, setOpen] = useState(false);
  const issues = chips.filter((chip) => !chip.ok).length;
  return <header className="bar">
    <div className="wordmark">
      <img className="wordmark-logo" src={`${import.meta.env.BASE_URL}brand/assess-dog.png`} alt="" width={40} height={40} />
      <span className="wordmark-name">Assess</span>
    </div>
    <span className="site">Worthing St block, Dallas</span>
    <nav className="tabs" role="tablist" aria-label="Pages">
      <button role="tab" aria-selected={page === 'board'} onClick={() => onPage('board')}>Dashboard</button>
      <button role="tab" aria-selected={page === 'agents'} onClick={() => onPage('agents')}>Agents</button>
    </nav>
    <div className={`chips ${open ? 'open' : ''}`}>
      {open && chips.map((chip) => <span key={chip.label} className={`chip ${chip.ok ? '' : 'bad'}`}><i className="sdot" /><b>{chip.label}</b> {chip.detail}</span>)}
      <button className={`chip toggle ${issues ? 'bad' : ''}`} aria-expanded={open} onClick={() => setOpen(!open)}>
        <i className="sdot" /><b>System</b> {issues ? `${issues} issue${issues > 1 ? 's' : ''}` : 'all OK'}
      </button>
    </div>
    {demo && <button className={`demo-btn ${demo.busy ? 'busy' : ''}`} disabled={demo.disabled} aria-busy={demo.busy} onClick={demo.onClick}><i aria-hidden="true" />{demo.label}</button>}
    {run && <button className={`rec ${run.active ? 'on' : ''}`} disabled={run.disabled} onClick={run.onClick}><i />{run.active ? 'Stop recording' : 'Record run'}</button>}
  </header>;
}
