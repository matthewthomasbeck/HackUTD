import type { SimActor } from './pool.ts';

export async function logInjection(actor: SimActor, command: string, target: string): Promise<void> {
  if (actor.role !== 'sim') throw new Error('Only the sim identity may write simulator injections');
  await actor.connection.reducers.logEvent({
    kind: 'sim_injection',
    message: `sim: ${command}${target ? ` ${target}` : ''}`,
    payloadJson: '{}',
  });
}
