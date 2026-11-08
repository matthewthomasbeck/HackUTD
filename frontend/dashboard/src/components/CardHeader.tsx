// A floating card's header whose count doubles as the collapse control: click the title or the count to fold
// the card down to this one line, and again to open it. No arrow; the count is the handle.
import { useState, type ReactNode } from 'react';

export function useCollapsed(initial = false) {
  const [collapsed, setCollapsed] = useState(initial);
  return { collapsed, toggle: () => setCollapsed((value) => !value) };
}

export function CardHeader({ title, count, collapsed, onToggle, display = false }: { title: string; count: ReactNode; collapsed: boolean; onToggle: () => void; display?: boolean }) {
  return <header>
    <button className="card-toggle" aria-expanded={!collapsed} title={collapsed ? `Show ${title.toLowerCase()}` : `Hide ${title.toLowerCase()}`} onClick={onToggle}>
      {display ? <h2 className="display">{title}</h2> : <h3>{title}</h3>}
      <span className={`n ${collapsed ? 'folded' : ''}`}>{count}</span>
    </button>
  </header>;
}
