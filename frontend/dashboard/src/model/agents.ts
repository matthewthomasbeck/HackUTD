import { enumTagToContract } from '../stdb/enums';
import { timestampToMs, type TimestampLike } from '../stdb/time';

interface ParticipantLike {
  name: string;
  role: string | { tag: string };
  online: boolean;
  lastHeartbeat: TimestampLike;
}

interface AgentTaskLike {
  toAgent: string | { tag: string };
  status: string | { tag: string };
}

interface AgentActionLike {
  agent: string;
  createdAt: TimestampLike;
}

export interface AgentSummary {
  name: string;
  status: 'offline' | 'silent' | 'working' | 'idle' | 'never_connected';
  currentTask: boolean;
  lastActionAt: number | null;
}

export function listAgents(
  participants: readonly ParticipantLike[],
  tasks: readonly AgentTaskLike[],
  actions: readonly AgentActionLike[],
  nowMs: number,
): AgentSummary[] {
  const names = new Set<string>();
  for (const participant of participants) {
    const role = enumTagToContract(participant.role);
    if (role === 'agent' || role === 'auditor') names.add(participant.name);
  }
  for (const task of tasks) {
    names.add(enumTagToContract(task.toAgent));
  }
  for (const action of actions) names.add(action.agent);
  names.delete('module');

  return [...names].sort().map((name) => {
    const participant = participants.find((candidate) => candidate.name === name);
    const currentTask = tasks.some((task) => enumTagToContract(task.toAgent) === name && enumTagToContract(task.status) === 'claimed');
    const lastAction = actions
      .filter((action) => action.agent === name)
      .map((action) => timestampToMs(action.createdAt))
      .sort((a, b) => b - a)[0] ?? null;

    let status: AgentSummary['status'];
    if (!participant) status = 'never_connected';
    else if (!participant.online) status = 'offline';
    else if (nowMs - timestampToMs(participant.lastHeartbeat) > 15_000) status = 'silent';
    else if (currentTask) status = 'working';
    else status = 'idle';

    return { name, status, currentTask, lastActionAt: lastAction };
  });
}
