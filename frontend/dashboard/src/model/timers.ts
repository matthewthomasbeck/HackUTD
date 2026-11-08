import type { BoardState } from '../data/BoardData';
import { enumTagToContract } from '../stdb/enums';
import { formatCountdown, timestampToMs } from '../stdb/time';

export interface Countdown {
  source: 'SCHEDULE TABLE' | 'DERIVED';
  remainingMs: number;
  state: 'running' | 'expiring' | 'expired';
}
export interface TimerItem extends Countdown { id: string; dueAt: number; label: string }

export function countdownForDueAt(dueAt: number | Date | { microsSinceUnixEpoch: bigint }, nowMs: number, source: Countdown['source'] = 'SCHEDULE TABLE'): Countdown {
  const remainingMs = Math.max(0, timestampToMs(dueAt) - nowMs);
  return { source, remainingMs, state: remainingMs === 0 ? 'expired' : remainingMs < 5_000 ? 'expiring' : 'running' };
}

export function buildTimerItems(board: BoardState): TimerItem[] {
  const timers: TimerItem[] = [];
  const dueTimer = (kind: string, id: bigint) => board.timers.leases.find((row) => enumTagToContract(row.kind) === kind && row.entityId === id);
  const dueAt = (value: number | Date | { microsSinceUnixEpoch: bigint }, source: TimerItem['source'], id: string, label: string) => {
    const dueAtMs = timestampToMs(value);
    timers.push({ id, label, dueAt: dueAtMs, ...countdownForDueAt(value, board.now, source) });
  };

  for (const assignment of board.assignments) {
    const status = enumTagToContract(assignment.status);
    if (status !== 'proposed' && status !== 'active') continue;
    const kind = status === 'proposed' ? 'proposal' : 'assignment';
    const schedule = dueTimer(kind, assignment.id);
    const survivor = board.survivors.find((row) => row.id === assignment.survivorId);
    if (board.site && survivor?.siteId !== board.site.id) continue;
    const rescuer = board.participants.find((row) => row.identity.toHexString() === assignment.rescuerIdentity.toHexString());
    dueAt(schedule?.dueAt ?? assignment.leaseExpiresAt, schedule ? 'SCHEDULE TABLE' : 'DERIVED', `assignment:${assignment.id}`, `${status === 'proposed' ? 'proposal' : 'lease'}, survivor #${assignment.survivorId}${rescuer ? ` / ${rescuer.name}` : ''}${survivor?.houseLabel ? ` · ${survivor.houseLabel}` : ''}`);
  }

  for (const mission of board.missions) {
    const status = enumTagToContract(mission.status);
    if ((status !== 'leased' && status !== 'active') || !mission.leaseExpiresAt) continue;
    const schedule = dueTimer('mission', mission.id);
    dueAt(schedule?.dueAt ?? mission.leaseExpiresAt, schedule ? 'SCHEDULE TABLE' : 'DERIVED', `mission:${mission.id}`, `mission #${mission.id} lease, ${mission.robotId}`);
  }

  for (const task of board.agentTasks.filter((row) => !board.run || row.runId === board.run.id)) {
    if (enumTagToContract(task.status) !== 'claimed' || !task.leaseExpiresAt) continue;
    const schedule = dueTimer('agent_task', task.id);
    dueAt(schedule?.dueAt ?? task.leaseExpiresAt, schedule ? 'SCHEDULE TABLE' : 'DERIVED', `task:${task.id}`, `task #${task.id} ${task.kind}, ${enumTagToContract(task.toAgent)}`);
  }

  const activeAssignments = board.assignments.filter((row) => enumTagToContract(row.status) === 'active');
  for (const heartbeat of board.timers.heartbeats) {
    const kind = enumTagToContract(heartbeat.kind);
    if (kind === 'robot') {
      const robot = board.robots.find((row) => row.robotId === heartbeat.robotId && row.online);
      if (robot) dueAt(heartbeat.dueAt, 'SCHEDULE TABLE', `robot-heartbeat:${robot.robotId}`, `heartbeat, ${robot.name}`);
    } else if (kind === 'rescuer') {
      const person = board.participants.find((row) => row.identity.toHexString() === heartbeat.identity.toHexString() && row.online);
      if (person && activeAssignments.some((row) => row.rescuerIdentity.toHexString() === heartbeat.identity.toHexString())) {
        dueAt(heartbeat.dueAt, 'SCHEDULE TABLE', `rescuer-heartbeat:${heartbeat.identity.toHexString()}`, `heartbeat, ${person.name}`);
      }
    }
  }
  for (const robot of board.robots.filter((row) => row.online && !board.timers.heartbeats.some((timer) => enumTagToContract(timer.kind) === 'robot' && timer.robotId === row.robotId))) {
    dueAt(timestampToMs(robot.lastHeartbeat) + 5_000, 'DERIVED', `robot-heartbeat:${robot.robotId}`, `heartbeat, ${robot.name}`);
  }
  for (const person of board.participants.filter((row) => row.online && activeAssignments.some((assignment) => assignment.rescuerIdentity.toHexString() === row.identity.toHexString()) && !board.timers.heartbeats.some((timer) => enumTagToContract(timer.kind) === 'rescuer' && timer.identity.toHexString() === row.identity.toHexString()))) {
    dueAt(timestampToMs(person.lastHeartbeat) + 15_000, 'DERIVED', `rescuer-heartbeat:${person.identity.toHexString()}`, `heartbeat, ${person.name}`);
  }

  const urgent = board.survivors.some((row) => row.siteId === board.site?.id && enumTagToContract(row.criticalLevel) === 'immediate' && enumTagToContract(row.status) === 'unassigned');
  if (urgent) for (const watchdog of board.timers.agentWatchdogs) {
    dueAt(watchdog.dueAt, 'SCHEDULE TABLE', `watchdog:${watchdog.agentName}`, 'watchdog: module assigns if the orchestrator stays silent');
  }
  const escalations = new Map(board.timers.escalations.map((timer) => [timer.survivorId, timer]));
  for (const survivor of board.survivors.filter((row) => row.siteId === board.site?.id && enumTagToContract(row.status) === 'unassigned')) {
    const schedule = escalations.get(survivor.id);
    const fallback = timestampToMs(survivor.createdAt) + (board.site?.escalateAfterS ?? 60) * 1000;
    const when = schedule?.dueAt ?? fallback;
    const phase = schedule?.level && schedule.level > 1 ? 'to commander and everyone' : 'to everyone';
    dueAt(when, schedule ? 'SCHEDULE TABLE' : 'DERIVED', `escalation:${survivor.id}`, `escalate #${survivor.id} ${phase}`);
  }
  return timers.sort((a, b) => a.remainingMs - b.remainingMs || a.label.localeCompare(b.label));
}

export function timerText(timer: TimerItem): string {
  const state = timer.state === 'expiring' ? 'EXPIRING · ' : timer.state === 'expired' ? 'EXPIRED · ' : '';
  return `${state}${timer.label}, ${formatCountdown(timer.remainingMs)}`;
}
