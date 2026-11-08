import { existsSync,readFileSync,writeFileSync,mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import * as SpacetimeDB from 'spacetimedb';
// SDK 2.14 runtime exports Identity; its published NodeNext declarations use extensionless re-exports.
const Identity = (SpacetimeDB as unknown as { Identity: { fromString(value:string): unknown } }).Identity;
import type { Config } from '../config.js';
import type { Actions,AgentName,Row } from '../types.js';
import { WorldView } from '../world.js';
import { camel,plain } from './convert.js';

const tables=['participant','site','run','agent_task','survivor','assignment','event_log','search_cell','robot','device_status','mission','detection','audit_flag','person_report','briefing','agent_action'];
const enumKeys=new Set(['role','kind','priority','status','to_agent']);
const enumTag=(value:string)=>value.split('_').map(s=>s.charAt(0).toUpperCase()+s.slice(1)).join('');
export function encode(name:string,args:Row) {
  const out:Row={};
  for(const [key,value] of Object.entries(args)) {
    if(key==='reason' && name==='cancel_own_mission') continue;
    let v=value;
    if(key==='rescuer_identity') v=Identity.fromString(value);
    else if((key.endsWith('_id') && key!=='robot_id') || key==='chain_id') v=value==null?undefined:BigInt(value);
    else if(key==='target_cell_ids') v=value.map((n:number)=>BigInt(n));
    else if(enumKeys.has(key) && typeof value==='string') {
      // Agent task kind is a string in the shared contract, not a tagged enum.
      if(!(key==='kind' && name==='post_agent_task')) v={tag:enumTag(value)};
    }
    out[camel(key)]=v;
  }
  return out;
}

export async function connect(cfg:Config,name:AgentName,onChange:(w:WorldView,table:string,row?:Row)=>void) {
  if(!cfg.database) throw new Error('Set STDB_DATABASE to the team database');
  const file=resolve('../../spacetimedb-bindings/index.ts');
  if(!existsSync(file)) throw new Error('Generated bindings missing. Cayden must publish the module and generate backend/spacetimedb-bindings/index.ts before live integration.');
  const bindings=await import(pathToFileURL(file).href);
  if(!bindings.DbConnection) throw new Error('Generated bindings must export DbConnection');
  mkdirSync(cfg.tokenDir,{recursive:true,mode:0o700});
  const tokenFile=resolve(cfg.tokenDir,`${name}.token`),token=existsSync(tokenFile)?readFileSync(tokenFile,'utf8'):undefined;
  const world=new WorldView();let ready=false;let connection:any;
  const actions:Actions={async call(reducer,args) {
    if(!ready && reducer!=='register_participant') throw new Error('Subscription not ready');
    const fn=connection.reducers[camel(reducer)];
    if(typeof fn!=='function') throw new Error(`Generated reducer missing: ${reducer}`);
    await fn.call(connection.reducers,encode(reducer,args));
  }};
  await new Promise<void>((done,fail)=>{
    connection=bindings.DbConnection.builder().withUri(cfg.stdbUri).withDatabaseName(cfg.database).withToken(token)
      .onConnect((_ctx:any,_identity:any,newToken:string)=>{
        writeFileSync(tokenFile,newToken,{mode:0o600});
        const snapshot=()=>{for(const table of tables) world.tables[table]=Array.from(connection.db[camel(table)].iter(),plain);};
        for(const table of tables) {
          const cache=connection.db[camel(table)];
          if(!cache) {fail(new Error(`Generated table missing: ${table}`));return;}
          cache.onInsert((_ctx:any,row:any)=>{if(ready){snapshot();onChange(world,table,plain(row));}});
          cache.onUpdate((_ctx:any,_old:any,row:any)=>{if(ready){snapshot();onChange(world,table,plain(row));}});
          cache.onDelete(()=>{if(ready){snapshot();onChange(world,table);}});
        }
        connection.subscriptionBuilder().onApplied(async()=>{
          snapshot();ready=true;
          try {
            if(cfg.dryRun==='0') await actions.call('register_participant',{name,role:name==='auditor'?'auditor':'agent'});
            onChange(world,'ready');done();
          }catch(error){fail(error);}
        }).onError((_ctx:any,error:Error)=>fail(error)).subscribe(tables.map(t=>`SELECT * FROM ${t}`));
      }).onConnectError((_ctx:any,error:Error)=>fail(error))
      .onDisconnect(()=>{ready=false;onChange(world,'disconnected');}).build();
  });
  return {world,actions,disconnect:()=>connection.disconnect()};
}
