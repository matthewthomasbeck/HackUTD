import { DbConnection } from '@bindings/index';
import { readToken, saveToken, type DashboardConfig, type TokenStorage } from './connection';

function safeLocalStorage(): TokenStorage | undefined {
  try {
    return window.localStorage;
  } catch {
    return undefined;
  }
}

export function createConnectionBuilder(config: DashboardConfig, storage = safeLocalStorage()) {
  if (!config.uri) throw new Error(`No SpacetimeDB URI configured for ${config.db}`);
  return DbConnection.builder()
    .withUri(config.uri)
    .withDatabaseName(config.database)
    .withToken(readToken(storage, config.tokenKey))
    .withAutomaticReconnect()
    .onConnect((_connection, _identity, token) => {
      saveToken(storage, config.tokenKey, token);
    });
}
