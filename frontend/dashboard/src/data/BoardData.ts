import type {
  AgentAction,
  AgentTask,
  AgentWatchdog,
  Assignment,
  AuditFlag,
  Briefing,
  Detection,
  DeviceStatus,
  EscalationTimer,
  EventLog,
  HeartbeatTimer,
  LeaseTimer,
  Mission,
  Participant,
  PersonReport,
  Robot,
  Run,
  SearchCell,
  Site,
  Survivor,
} from '@bindings/types';

export interface BoardState {
  mode: 'live' | 'replay';
  now: number;
  site: Site | null;
  run: Run | null;
  runs: readonly Run[];
  allRuns: readonly Run[];
  sites: readonly Site[];
  survivors: readonly Survivor[];
  detections: readonly Detection[];
  missions: readonly Mission[];
  assignments: readonly Assignment[];
  cells: readonly SearchCell[];
  robots: readonly Robot[];
  devices: readonly DeviceStatus[];
  participants: readonly Participant[];
  briefings: readonly Briefing[];
  agentActions: readonly AgentAction[];
  agentTasks: readonly AgentTask[];
  auditFlags: readonly AuditFlag[];
  personReports: readonly PersonReport[];
  events: readonly EventLog[];
  timers: {
    leases: readonly LeaseTimer[];
    heartbeats: readonly HeartbeatTimer[];
    escalations: readonly EscalationTimer[];
    agentWatchdogs: readonly AgentWatchdog[];
  };
  ready: boolean;
  registrationError: string | null;
}
