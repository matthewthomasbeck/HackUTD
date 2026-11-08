import type { SimActor } from './pool.ts';

export function requireDemoMode(actor: SimActor): void {
  const sites = Array.from(actor.connection.db.site.iter());
  const newest = sites.sort((a, b) => Number(b.id - a.id))[0];
  if (!newest?.demoMode) {
    throw new Error('Site is not in demo mode, refusing');
  }
}
