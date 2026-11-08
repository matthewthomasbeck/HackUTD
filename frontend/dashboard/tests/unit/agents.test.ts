import { describe, expect, it } from 'vitest';
import { listAgents } from '../../src/model/agents';

describe('listAgents', () => {
  it('includes agents known only from tasks and identifies claimed work', () => {
    const agents = listAgents(
      [{ name: 'orchestrator', role: 'agent', online: true, lastHeartbeat: 95_000 }],
      [{ toAgent: 'auditor', status: 'claimed' }, { toAgent: 'comms_agent', status: 'done' }, { toAgent: 'orchestrator', status: 'claimed' }],
      [{ agent: 'comms_agent', createdAt: 98_000 }],
      100_000,
    );

    expect(agents).toEqual([
      { name: 'auditor', status: 'never_connected', currentTask: true, lastActionAt: null },
      { name: 'comms_agent', status: 'never_connected', currentTask: false, lastActionAt: 98_000 },
      { name: 'orchestrator', status: 'working', currentTask: true, lastActionAt: null },
    ]);
  });
});
