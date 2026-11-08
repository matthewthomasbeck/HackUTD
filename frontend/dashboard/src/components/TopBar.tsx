import { useBoard } from '../data/LiveSource';
import { countUnattendedImmediate } from '../model/headline';
import { enumTagToContract } from '../stdb/enums';
import type { DashboardConfig } from '../stdb/connection';

function initials(name: string): string {
  return name.split(/[-_\s]+/).filter(Boolean).slice(0, 2).map((part) => part[0]?.toUpperCase()).join('');
}

export function TopBar({ config, isConnected, identity, connectionError }: {
  config: DashboardConfig;
  isConnected: boolean;
  identity?: string;
  connectionError?: string;
}) {
  const board = useBoard();
  const unattended = board.site
    ? countUnattendedImmediate(board.survivors, board.timers.escalations, board.now, board.site.id, board.events)
    : 0;
  const activeRun = board.run;
  const presence = board.participants.filter((participant) => participant.online);

  return (
    <header className="topbar">
      <div className="topbar-brand">
        <div className="brand-mark" aria-hidden="true">R</div>
        <div className="topbar-site">
          <strong>{board.site?.name ?? 'Rubble Search'}</strong>
          <div className="topbar-badges">
            {board.site?.demoMode && <span className="demo-badge">DEMO MODE</span>}
            <span className="screen-badge">SCREEN {config.screen}</span>
            {activeRun && <span className="record-badge"><span className="record-dot" /> REC {activeRun.name}</span>}
          </div>
        </div>
      </div>

      <div className={`headline-banner ${unattended > 0 ? 'has-critical' : ''}`}>
        <span className="headline-title">Critical survivors unattended over 60 s: {unattended}</span>
        <span className="headline-subtitle">{board.survivors.filter((s) => s.siteId === board.site?.id && enumTagToContract(s.status) === 'unassigned').length} still on the board</span>
      </div>

      <div className="topbar-presence">
        <div className={`connection-badge ${isConnected ? 'online' : ''}`} title={connectionError ?? identity ?? 'Connecting'}>
          <span className="connection-dot" />
          <span>{connectionError ? 'READ ONLY' : isConnected ? 'LIVE' : 'CONNECTING'}</span>
        </div>
        <div className="presence-stack" aria-label={`${presence.length} participants online`}>
          {presence.slice(0, 7).map((participant) => (
            <span key={participant.identity.toHexString()} className={`presence-avatar role-${enumTagToContract(participant.role)}`} title={`${participant.name} · ${enumTagToContract(participant.role)}`}>
              {initials(participant.name)}
            </span>
          ))}
          {presence.length > 7 && <span className="presence-overflow">+{presence.length - 7}</span>}
        </div>
        {presence.some((participant) => enumTagToContract(participant.role) === 'commander') && <span className="commander-online">COMMANDER ONLINE</span>}
      </div>
    </header>
  );
}
