import { describe, expect, it } from 'vitest';
import { dashboardConfigFromSearch, readToken, saveToken, tokenStorageKey } from '../../src/stdb/connection';

const env = {
  VITE_STDB_URI: 'wss://example.test',
  VITE_STDB_URI_LOCAL: 'ws://192.168.1.20:3000',
  VITE_STDB_DATABASE: 'hackutd-rubble',
};

describe('dashboard connection configuration', () => {
  it('uses safe defaults and routes local database selection to the local URI', () => {
    expect(dashboardConfigFromSearch('', env)).toMatchObject({
      db: 'cloud', screen: 'A', role: 'coordinator', theme: 'light', view: 'live', uri: 'wss://example.test',
    });
    expect(dashboardConfigFromSearch('?db=local&screen=B&role=commander&theme=dark', env)).toMatchObject({
      db: 'local', screen: 'B', role: 'commander', theme: 'dark', uri: 'ws://192.168.1.20:3000',
    });
  });

  it('scopes tokens by database and screen and treats blocked storage as a fresh identity', () => {
    const storage = new Map<string, string>();
    const local = {
      getItem: (key: string) => storage.get(key) ?? null,
      setItem: (key: string, value: string) => storage.set(key, value),
    };
    const key = tokenStorageKey('local', 'B');
    expect(key).toBe('stdb_token_local_B');
    saveToken(local, key, 'secret-token');
    expect(readToken(local, key)).toBe('secret-token');
    const blockedRead = { getItem: () => { throw new Error('blocked'); }, setItem: () => {} };
    const blockedWrite = { getItem: () => null, setItem: () => { throw new Error('blocked'); } };
    expect(readToken(blockedRead, key)).toBeUndefined();
    expect(saveToken(blockedWrite, key, 'ignored')).toBe(false);
  });
});
