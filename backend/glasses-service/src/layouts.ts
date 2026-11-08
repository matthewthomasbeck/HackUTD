import type { ContainerMsg } from './protocol.js';

export type LayoutName='map'|'arrow'|'arrived'|'idle'|'ack'|'released'|'ask';
export interface LayoutData { [key:string]: string | undefined }
const frame=(id:number,kind:'text'|'image',name:string,x:number,y:number,w:number,h:number,z:number,content?:string):ContainerMsg => kind==='text'
  ? {kind,id,name,x,y,w,h,z,content:id===1?toAscii(content ?? ''):fitText(toAscii(content ?? ''),w,h,2),text_color:id===8?2:4,padding:2,...(id===1?{capture:true}:{})}
  : {kind,id,name,x,y,w,h,z};
// G2 font metrics, the same numbers as frontend/glasses/src/fallback/text.ts (CHAR_W, LINE_H, GLYPH_H).
const CHAR_W=13, LINE_H=27, GLYPH_H=22;
// Text that would run past its container (a long briefing in a two-line box) keeps the lines that fit and ends in "...",
// instead of showing a half-cut last line. Text that fits is returned unchanged.
export function fitText(content:string,w:number,h:number,padding=0):string {
  const perLine=Math.max(1,Math.floor((w-2*padding)/CHAR_W)); const capacity=Math.max(1,Math.floor((h-2*padding+LINE_H-GLYPH_H)/LINE_H));
  const lines:string[]=[];
  for(const para of content.split('\n')){let line='';for(const word of para.split(' ').filter(Boolean)){let rest=word;while(rest.length>perLine){if(line){lines.push(line);line='';}lines.push(rest.slice(0,perLine));rest=rest.slice(perLine);}if(!line)line=rest;else if(line.length+1+rest.length<=perLine)line+=` ${rest}`;else{lines.push(line);line=rest;}}lines.push(line);}
  while(lines.length&&lines[lines.length-1]==='')lines.pop();
  if(lines.length<=capacity)return content;
  const kept=lines.slice(0,capacity); const last=kept[capacity-1]!;
  // Cut at a word boundary, so "survivor 13" never shows as the misleading "survivor 1...".
  let cut=last; while(cut.length+3>perLine&&cut.includes(' '))cut=cut.slice(0,cut.lastIndexOf(' ')).trimEnd();
  kept[capacity-1]=`${cut.length+3<=perLine?cut:cut.slice(0,Math.max(0,perLine-3))}...`;
  return kept.join('\n');
}
export function toAscii(value:string):string {
  return value.replace(/°/g,' deg').replace(/[·•]/g,'-').replace(/©/g,'(c)').replace(/[–—−]/g,'-').replace(/[“”]/g,'"').replace(/[‘’]/g,"'").replace(/[^\x20-\x7E\n]/g,'');
}
const specs:Record<LayoutName,(d:LayoutData)=>ContainerMsg[]>={
  map:d=>[frame(1,'text','capture',0,0,576,288,1,' '),frame(2,'image','map_top',0,0,288,144,2),frame(3,'image','map_bot',0,144,288,144,3),frame(4,'text','count',296,0,280,56,4,d.count??'2 CRITICAL\nwithin 0.3 mi'),frame(5,'text','target',296,58,280,56,5,d.target??'NEXT: house 3\n340 m NE'),frame(6,'text','brief',296,116,280,112,6,d.brief??''),frame(8,'text','status',296,232,280,28,7,d.status??'tap: back  upd 2s'),frame(7,'text','attrib',296,260,280,28,8,d.attrib??'(c) Esri, OSM')],
  // Guide: a thin top band (two-line label, small chevron with distance, two-line detail) and one status line;
  // the rest stays black so the street is the view (Bluebook style).
  arrow:d=>[frame(1,'text','capture',0,0,576,288,1,' '),frame(2,'image','guide',196,0,184,80,2),frame(4,'text','label',8,4,184,60,4,d.label??'CRITICAL\n7716 Worthing'),frame(5,'text','brief',384,4,184,60,5,d.brief??''),frame(8,'text','status',8,250,560,30,6,d.status??'')],
  // Arrived: the target house's real outline with the survivor's spot, details on the right.
  arrived:d=>[frame(1,'text','capture',0,0,576,288,1,' '),frame(2,'image','plan',8,84,288,144,2),frame(4,'text','head',8,8,560,72,3,d.head??'ARRIVED - 7716 Worthing St\nIMMEDIATE score 86 (conf 0.7)'),frame(5,'text','where',312,84,256,56,4,d.where??'8 m in from the\nfront door'),frame(6,'text','life',312,142,256,56,5,d.life??'Breathing 14/min'),frame(7,'text','brief',312,200,256,46,6,d.brief??''),frame(8,'text','status',8,250,560,30,7,d.status??'tap: mark reached - confirm on phone')],
  idle:d=>[frame(1,'text','capture',0,0,576,288,1,' '),frame(2,'image','map_top',0,0,288,144,2),frame(3,'image','map_bot',0,144,288,144,3),frame(4,'text','head',296,0,280,56,4,d.head??'NO ASSIGNMENT\nstand by'),frame(5,'text','count',296,58,280,84,5,d.count??'2 CRITICAL\n3 unassigned\nwithin 0.3 mi'),frame(6,'text','brief',296,144,280,84,6,d.brief??''),frame(8,'text','status',296,232,280,28,7,d.status??'hold:ask  scroll:next'),frame(7,'text','attrib',296,260,280,28,8,d.attrib??'(c) Esri, OSM')],
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
