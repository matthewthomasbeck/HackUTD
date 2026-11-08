import { appendFileSync, mkdirSync } from 'node:fs';
import type { Trace } from './types.js';
export function trace(entry: Trace) {
  mkdirSync('logs',{recursive:true});
  const row = {at:new Date().toISOString(),...entry};
  appendFileSync(`logs/trace-${row.at.slice(0,10)}.jsonl`, JSON.stringify(row)+'\n');
  console.log(JSON.stringify(row));
}
