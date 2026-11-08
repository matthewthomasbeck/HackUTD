import 'dotenv/config';
import { spawn } from 'node:child_process';
import { resolve } from 'node:path';
import { loadDemoConfig } from './config.ts';
import { SimPool } from './pool.ts';
import { setupSite } from './setup.ts';

const uri = process.env.STDB_URI;
const database = process.env.STDB_DATABASE;
const modulePath = resolve(process.env.MODULE_PATH ?? '../spacetimedb');

if (!uri || !database) throw new Error('STDB_URI and STDB_DATABASE are required');
if (/maincloud/i.test(uri)) throw new Error('Reset refuses Maincloud because it deletes all module data. Use a local server.');

await publishAndWipe(database, modulePath, uri);
const pool = new SimPool();
try {
  const result = await setupSite(loadDemoConfig(), pool);
  console.log(`Reset done, ${result.cellCount} cells, ${result.rescuerNames.length} rescuers`);
} finally {
  pool.disconnectAll();
}

function publishAndWipe(databaseName: string, path: string, server: string): Promise<void> {
  return new Promise((resolvePromise, reject) => {
    const child = spawn('spacetime', [
      'publish', databaseName,
      '-p', path,
      '--server', server,
      '--delete-data=always',
      '--yes',
    ], { stdio: 'inherit' });
    child.once('error', reject);
    child.once('exit', (code, signal) => {
      if (code === 0) resolvePromise();
      else reject(new Error(`spacetime publish failed (exit ${code ?? 'null'}, signal ${signal ?? 'none'})`));
    });
  });
}
