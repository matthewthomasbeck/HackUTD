export type DashboardRole = 'coordinator' | 'commander';
export type DashboardView = 'live' | 'agents' | 'commander' | 'replay';
export type DashboardTheme = 'light' | 'dark';
export type DatabaseTarget = 'cloud' | 'local';

export interface DashboardConfig {
  db: DatabaseTarget;
  screen: string;
  role: DashboardRole;
  theme: DashboardTheme;
  view: DashboardView;
  run: string | null;
  uri: string;
  database: string;
  tokenKey: string;
}

export interface DashboardEnvironment {
  VITE_STDB_URI?: string;
  VITE_STDB_URI_LOCAL?: string;
  VITE_STDB_DATABASE?: string;
}

export interface TokenStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

export function tokenStorageKey(db: DatabaseTarget, screen: string): string {
  return `stdb_token_${db}_${screen}`;
}

export function readToken(storage: Pick<TokenStorage, 'getItem'> | undefined, key: string): string | undefined {
  try {
    return storage?.getItem(key) || undefined;
  } catch {
    return undefined;
  }
}

export function saveToken(storage: Pick<TokenStorage, 'setItem'> | undefined, key: string, token: string): boolean {
  try {
    storage?.setItem(key, token);
    return Boolean(storage);
  } catch {
    return false;
  }
}

function isChoice<T extends string>(value: string | null, choices: readonly T[], fallback: T): T {
  return value && choices.includes(value as T) ? value as T : fallback;
}

export function dashboardConfigFromSearch(search: string, env: DashboardEnvironment): DashboardConfig {
  const params = new URLSearchParams(search);
  const db = isChoice(params.get('db'), ['cloud', 'local'] as const, 'cloud');
  const screen = params.get('screen')?.trim() || 'A';
  const role = isChoice(params.get('role'), ['coordinator', 'commander'] as const, 'coordinator');
  const theme = isChoice(params.get('theme'), ['light', 'dark'] as const, 'light');
  const view = isChoice(params.get('view'), ['live', 'agents', 'commander', 'replay'] as const, 'live');
  return {
    db,
    screen,
    role,
    theme,
    view,
    run: params.get('run'),
    uri: db === 'local' ? env.VITE_STDB_URI_LOCAL || '' : env.VITE_STDB_URI || 'https://maincloud.spacetimedb.com',
    database: env.VITE_STDB_DATABASE || 'hackutd-rubble',
    tokenKey: tokenStorageKey(db, screen),
  };
}
