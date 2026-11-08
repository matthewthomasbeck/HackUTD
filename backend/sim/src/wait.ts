import type { SimActor } from './pool.ts';

export async function waitForValue<T>(actor: SimActor, read: () => T | undefined, timeoutMs = 5_000): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const value = read();
    if (value !== undefined) return value;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error(`Timed out waiting for SpacetimeDB state after ${timeoutMs} ms`);
}
