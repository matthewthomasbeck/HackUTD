import type { ContainerMsg } from './protocol.js';

export type LayoutName='map'|'arrow'|'arrived'|'idle'|'ack'|'released'|'ask';
export interface LayoutData { [key:string]: string | undefined }
const frame=(id:number,kind:'text'|'image',name:string,x:number,y:number,w:number,h:number,z:number,content?:string):ContainerMsg => kind==='text'
  ? {kind,id,name,x,y,w,h,z,content:toAscii(content ?? ''),text_color:id===8?2:4,padding:2,...(id===1?{capture:true}:{})}
  : {kind,id,name,x,y,w,h,z};
export function toAscii(value:string):string {
  return value.replace(/°/g,' deg').replace(/[·•]/g,'-').replace(/©/g,'(c)').replace(/[–—−]/g,'-').replace(/[“”]/g,'"').replace(/[‘’]/g,"'").replace(/[^\x20-\x7E\n]/g,'');
}
const specs:Record<LayoutName,(d:LayoutData)=>ContainerMsg[]>={
  map:d=>[frame(1,'text','capture',0,0,576,288,1,' '),frame(2,'image','map_top',0,0,288,144,2),frame(3,'image','map_bot',0,144,288,144,3),frame(4,'text','count',296,0,280,56,4,d.count??'2 CRITICAL\nwithin 0.3 mi'),frame(5,'text','target',296,58,280,56,5,d.target??'NEXT: house 3\n340 m NE'),frame(6,'text','brief',296,116,280,112,6,d.brief??'IMMEDIATE house 3:\nbreathing 14/min,\n8 m in, front door'),frame(8,'text','status',296,232,280,28,7,d.status??'tap: back  upd 2s'),frame(7,'text','attrib',296,260,280,28,8,d.attrib??'(c) Esri, OSM')],
  arrow:d=>[frame(1,'text','capture',0,0,576,288,1,' '),frame(2,'image','arrow',16,40,144,144,2),frame(4,'text','primary',184,8,384,56,3,d.primary??'NE  32 m\nhouse 3 - CRITICAL'),frame(5,'text','detail',184,72,384,84,4,d.detail??'8 m in from front door\nbreathing 14/min\nconf 0.7'),frame(6,'text','brief',184,164,384,56,5,d.brief??'> Enter by front door,\nground ahead: debris'),frame(8,'text','status',8,232,560,28,6,d.status??'2 CRITICAL - arrow is N-up - upd 1s')],
  arrived:d=>[frame(1,'text','capture',0,0,576,288,1,' '),frame(4,'text','head',8,0,560,56,2,d.head??'ARRIVED - house 3\nCRITICAL score 86 (conf 0.7)'),frame(5,'text','where',8,60,560,56,3,d.where??'Where: 8 m in from the front door,\nunder boxes'),frame(6,'text','life',8,120,560,56,4,d.life??'Breathing 14/min (conf 0.7)\nAbout 20% of body visible'),frame(7,'text','brief',8,180,560,48,5,d.brief??'Coordinator: 2nd rescuer 3 min out'),frame(8,'text','status',8,232,560,28,6,d.status??'tap: mark reached - confirm on phone')],
  idle:d=>[frame(1,'text','capture',0,0,576,288,1,' '),frame(2,'image','map_top',0,0,288,144,2),frame(3,'image','map_bot',0,144,288,144,3),frame(4,'text','head',296,0,280,56,4,d.head??'NO ASSIGNMENT\nstand by'),frame(5,'text','count',296,58,280,84,5,d.count??'2 CRITICAL\n3 unassigned\nwithin 0.3 mi'),frame(6,'text','brief',296,144,280,84,6,d.brief??''),frame(8,'text','status',296,232,280,28,7,d.status??'scroll: browse  hold: ask'),frame(7,'text','attrib',296,260,280,28,8,d.attrib??'(c) Esri, OSM')],
  ack:d=>[frame(1,'text','capture',0,0,576,288,1,' '),frame(2,'image','arrow',16,40,144,144,2),frame(4,'text','head',184,0,384,56,3,d.head??'NEW TASK - IMMEDIATE\nhouse 3, 120 m NE'),frame(5,'text','detail',184,60,384,84,4,d.detail??'breathing 34/min (conf 0.7)\n8 m in from front door'),frame(6,'text','brief',184,148,384,80,5,d.brief??''),frame(8,'text','status',8,232,560,28,6,d.status??'TAP TO ACCEPT - 24s left')],
  released:d=>[frame(1,'text','capture',0,0,576,288,1,' '),frame(4,'text','head',8,0,560,56,2,d.head??'ASSIGNMENT RELEASED\nhouse 3 - IMMEDIATE'),frame(5,'text','why',8,60,560,84,3,d.why??'Link to glasses was lost.\nSurvivor is back on the board for\nthe next rescuer.'),frame(6,'text','next',8,148,560,80,4,d.next??'If you are still going, tell the\ncoordinator.'),frame(8,'text','status',8,232,560,28,5,d.status??'tap: ok')],
  ask:d=>[frame(1,'text','capture',0,0,576,288,1,' '),frame(4,'text','head',8,0,560,56,2,d.head??'ASK - speak now\ntap to send'),frame(5,'text','heard',8,60,560,84,3,d.heard??''),frame(6,'text','answer',8,148,560,80,4,d.answer??''),frame(8,'text','status',8,232,560,28,5,d.status??'ASKING - speak now 6s')]
};
export function makeLayout(name:LayoutName,data:LayoutData={}):ContainerMsg[]{return specs[name](data);}
export function validateLayout(containers:ContainerMsg[]):string[] {
  const errors:string[]=[]; const ids=new Set<number>(),zs=new Set<number>(); let captures=0,images=0,texts=0,total=0;
  for(const c of containers){ if(ids.has(c.id))errors.push(`duplicate id ${c.id}`); ids.add(c.id); if(zs.has(c.z))errors.push(`duplicate z ${c.z}`); zs.add(c.z); if(c.kind==='image')images++;else {texts++;total+=(c.content??'').length;if(c.id===1&&c.capture!==false)captures++;} if(c.x<0||c.y<0||c.x+c.w>576||c.y+c.h>288)errors.push(`container ${c.id} outside screen`); if(c.kind==='image'&&(c.w>288||c.h>144))errors.push(`image ${c.id} exceeds image limit`); if(c.kind==='text'&&/[^ -~\n]/.test(c.content??''))errors.push(`container ${c.id} is not ASCII`); }
  if(images>4||texts>8||containers.length>12)errors.push('container count exceeds limit'); if(captures!==1)errors.push('expected one capture layer');if(total>1000)errors.push('page text exceeds limit');
  const capture=containers.find(c=>c.kind==='text'&&c.id===1);
  if(capture?.kind==='text'&&(capture.x!==0||capture.y!==0||capture.w!==576||capture.h!==288||capture.z!==1||(capture.content??'')!==' '))errors.push('capture layer must cover the screen at z 1');
  const visible=containers.filter(c=>!(c.kind==='text'&&c.id===1));
  for(let i=0;i<visible.length;i++)for(let j=i+1;j<visible.length;j++){const a=visible[i]!,b=visible[j]!;if(a.x<b.x+b.w&&a.x+a.w>b.x&&a.y<b.y+b.h&&a.y+a.h>b.y)errors.push(`containers ${a.id} and ${b.id} overlap`);}
  return errors;
}
export function toAsciiLayout(containers:ContainerMsg[]):ContainerMsg[]{return containers.map(c=>c.kind==='text'?{...c,content:toAscii(c.content??'')}:c);}
export function toAsciiText(containers:ContainerMsg[]):string{return containers.map(c=>c.kind==='text'?`${c.name}: ${c.content??''}`:c.name).join('\n');}
