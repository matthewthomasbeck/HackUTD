import type { SimActor } from './pool.ts';

export async function startRun(actor: SimActor, siteId: bigint, name?: string): Promise<bigint> {
  const active = Array.from(actor.connection.db.run.iter()).find((row) => row.endedAt === undefined);
  if (active) throw new Error(`Run ${active.id} is already active`);
  const runName = name?.trim() || `Judging ${new Date().toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: false })}`;
  await actor.connection.reducers.startRun({ siteId, name: runName });
  return waitForValue(actor, () => Array.from(actor.connection.db.run.iter()).find((row) => row.siteId === siteId && row.name === runName)?.id);
}

export async function endRun(actor: SimActor, notes = ''): Promise<void> {
  const active = Array.from(actor.connection.db.run.iter()).filter((row) => row.endedAt === undefined).sort((a, b) => Number(b.id - a.id))[0];
  if (!active) throw new Error('No active run');
  await actor.connection.reducers.endRun({ runId: active.id, notes });
}

async function waitForValue<T>(actor: SimActor, read: () => T | undefined, timeoutMs = 5_000): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const value = read();
    if (value !== undefined) return value;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error(`Timed out waiting for SpacetimeDB state after ${timeoutMs} ms`);
}
