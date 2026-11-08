import type { WebSocket } from 'ws';
import type { ContainerMsg, PluginMsg, ServiceMsg } from './protocol.js';
import { makeLayout, validateLayout, type LayoutName } from './layouts.js';
import { bearingDeg, destinationPoint, distanceM, octant, type Point } from './geo.js';
import { makeDemoState, moveDemo, stepDemo, type DemoState } from './demo.js';
import { renderOfflineMap, renderArrows } from './render/arrows.js';
import { enumTag, type DbSnapshot } from './db.js';

function timestampMillis(value:unknown):number|undefined{if(value instanceof Date)return value.getTime();if(typeof value==='number')return value;if(typeof value==='string'){const parsed=Date.parse(value);return Number.isNaN(parsed)?undefined:parsed;}if(value&&typeof value==='object'&&'toDate'in value&&typeof (value as {toDate?:unknown}).toDate==='function')return (value as {toDate:()=>Date}).toDate().getTime();return undefined;}
function finiteOne(value:number|undefined):string{return value!==undefined&&Number.isFinite(value)?value.toFixed(1):'0.0';}
export function hasLevelTwoEscalation(briefings:Record<string,unknown>[],now=Date.now()):boolean {
  const counts=new Map<string,number>();
  for(const briefing of briefings){
    if(briefing.audience!=='all'||enumTag(briefing.kind)!=='escalation'||typeof briefing.text!=='string')continue;
    const createdAt=timestampMillis(briefing.createdAt);
    if(createdAt===undefined||now-createdAt<0||now-createdAt>600_000)continue;
    const survivorId=String(briefing.survivorId??briefing.chainId??'');
    if(!survivorId)continue;
    const next=(counts.get(survivorId)??0)+1;
    counts.set(survivorId,next);
    if(next>=2)return true;
  }
  return false;
}
export function idleNotice(status:string,isFree:boolean,briefings:Record<string,unknown>[],now=Date.now()):string {
  return isFree&&hasLevelTwoEscalation(briefings,now)?'hold: ask  phone: take it':status;
}

export interface FakeSurvivor {id:number|string;lat:number;lon:number;critical_level:'immediate'|'delayed'|'minor'|'unknown';critical_score:number;score_confidence?:number;status:'unassigned'|'assigned'|'en_route'|'reached'|'resolved'|'unknown';house_label:string;location_note:string;breathing:'detected'|'not_detected'|'unknown';breathing_rate_bpm?:number|null;breathing_confidence?:number;visibility_pct?:number|null;}
export class FakeSession {
  readonly site={center:{lat:32.9857,lon:-96.7502},radius_m:483,demo_mode:true};
  readonly survivors:FakeSurvivor[]=[
    {id:1,lat:32.9857,lon:-96.7492,critical_level:'immediate',critical_score:86,status:'assigned',house_label:'house 3',location_note:'8 m in from front door',breathing:'detected'},
    {id:2,lat:32.9861,lon:-96.7495,critical_level:'delayed',critical_score:53,status:'unassigned',house_label:'house 4',location_note:'near east wall',breathing:'unknown'},
    {id:3,lat:32.9853,lon:-96.7503,critical_level:'minor',critical_score:24,status:'unassigned',house_label:'house 2',location_note:'by the doorway',breathing:'detected'}];
  readonly assignment={id:1 as number|string,survivor_id:1 as number|string,status:'active' as 'active'|'proposed'|'released'|'idle'};
  private demo:DemoState; private view:LayoutName='map';private arrows:string[]=[];private maps:[string,string]=['',''];private mapAttribution='(c) Esri, OSM';private listeners=new Set<WebSocket>();private lastPositionAt=Date.now();private inputAt=Date.now();private rescuerStart:Point;private liveMode=false;private realPosition=false;private liveSiteId='';private onPosition?:(point:Point)=>void;private demoSpeedMps=3;private demoStartBearingDeg=225;private demoStartDistanceM=250;
  constructor(options:{demoSpeedMps?:number;demoStartBearingDeg?:number;demoStartDistanceM?:number}={}){this.demoSpeedMps=options.demoSpeedMps??3;this.demoStartBearingDeg=options.demoStartBearingDeg??225;this.demoStartDistanceM=options.demoStartDistanceM??250;this.demo=makeDemoState(this.site.center,this.survivors[0]!,this.demoStartBearingDeg,this.demoStartDistanceM);this.rescuerStart=this.demo.position;}
  enableLiveMode(){this.liveMode=true;this.survivors.splice(0);this.assignment.status='idle';}
  setPositionHandler(handler:(point:Point)=>void){this.onPosition=handler;}
  async init(){this.arrows=await renderArrows();this.maps=await renderOfflineMap();}
  setMapImages(top:string|undefined,bottom:string|undefined,lensText:string){const topChanged=Boolean(top&&top!==this.maps[0]);const bottomChanged=Boolean(bottom&&bottom!==this.maps[1]);const attributionChanged=lensText!==this.mapAttribution;if(topChanged)this.maps[0]=top!;if(bottomChanged)this.maps[1]=bottom!;this.mapAttribution=lensText;if(this.view==='map'||this.view==='idle')for(const ws of this.listeners){if(topChanged)this.sendImage(ws,2,top!);if(bottomChanged)this.sendImage(ws,3,bottom!);if(attributionChanged)this.send(ws,{type:'text',id:7,content:lensText,text_color:4});}}
  applyDbSnapshot(snapshot:DbSnapshot){
    this.liveSnapshot=snapshot;
    const site=snapshot.sites[0];
    if(site){this.site.center.lat=Number(site.centerLat);this.site.center.lon=Number(site.centerLon);this.site.radius_m=Number(site.radiusM);this.site.demo_mode=Boolean(site.demoMode);if(this.liveMode){const id=String(site.id);if(site.demoMode&&id!==this.liveSiteId){this.demo=makeDemoState(this.site.center,this.survivors[0]??this.site.center,this.demoStartBearingDeg,this.demoStartDistanceM);this.rescuerStart={...this.demo.origin};this.liveSiteId=id;}else if(!site.demoMode&&!this.realPosition){this.demo.position={...this.site.center};}}}
    const survivors=snapshot.survivors.map(row=>({id:String(row.id),lat:Number(row.lat),lon:Number(row.lon),critical_level:enumTag(row.criticalLevel) as FakeSurvivor['critical_level'],critical_score:Number(row.criticalScore),score_confidence:Number(row.scoreConfidence),status:enumTag(row.status) as FakeSurvivor['status'],house_label:typeof row.houseLabel==='string'?row.houseLabel:'',location_note:String(row.locationNote??''),breathing:enumTag(row.breathing) as FakeSurvivor['breathing'],breathing_rate_bpm:typeof row.breathingRateBpm==='number'?row.breathingRateBpm:null,breathing_confidence:Number(row.breathingConfidence),visibility_pct:typeof row.visibilityPct==='number'?row.visibilityPct:null})).filter(row=>Number.isFinite(row.lat)&&Number.isFinite(row.lon));
    this.survivors.splice(0,this.survivors.length,...survivors);
    const assignment=snapshot.assignments.find(row=>['proposed','active','released'].includes(enumTag(row.status)));
    if(assignment){const nextStatus=enumTag(assignment.status) as 'proposed'|'active'|'released';if(nextStatus==='released'&&this.assignment.status!=='released'){this.releasedUntil=Date.now()+10_000;setTimeout(()=>void this.broadcast(),10_000);}else if(nextStatus!=='released')this.releasedUntil=0;this.assignment.id=String(assignment.id);this.assignment.survivor_id=String(assignment.survivorId);this.assignment.status=nextStatus;if(this.site.demo_mode){const target=this.survivors.find(row=>String(row.id)===String(assignment.survivorId));if(target)this.demo.target={lat:target.lat,lon:target.lon};}}
    else this.assignment.status='idle';
    if(snapshot.sites.length||snapshot.assignments.length||snapshot.survivors.length===0||survivors.length)void this.broadcast();
  }
  attach(ws:WebSocket){this.listeners.add(ws);ws.on('close',()=>this.listeners.delete(ws));void this.sendPage(ws);}
  handle(ws:WebSocket,raw:string){let m:PluginMsg|{type:'demo';cmd:'walk'|'reset'|'move';dn?:number;de?:number};try{m=JSON.parse(raw) as typeof m;}catch{return;}
    if(m.type==='demo'){this.demoCommand(m.cmd,m.dn,m.de);return;}
    if(m.type==='heartbeat')return;
    if(m.type==='position'){this.demo.position={lat:m.lat,lon:m.lon};this.realPosition=true;this.lastPositionAt=Date.now();void this.broadcast();return;}
    if(m.type==='ack'&&String(m.assignment_id)==String(this.assignment.id)){this.assignment.status='active';void this.broadcast();return;}
    if(m.type==='input'){this.inputAt=Date.now();if(m.event==='tap'&&this.view==='map')this.peekUntil=Date.now()+10000;if(m.event==='tap'&&this.view==='released'){this.assignment.status='idle';this.releasedUntil=0;}if(m.event==='scroll_up')this.mode=this.mode==='robot'?'survivor':'robot';void this.broadcast();}
  }
  demoCommand(cmd:'walk'|'reset'|'move',dn=0,de=0){if(cmd==='walk')this.demo.walking=!this.demo.walking;else if(cmd==='reset'){this.demo.position={...this.rescuerStart};this.demo.walking=false;}else moveDemo(this.demo,dn,de);this.lastPositionAt=Date.now();if(this.liveMode)this.onPosition?.(this.demo.position);void this.broadcast();}
  currentLayout():LayoutName{return this.layout();}
  currentSurvivorId():number|string|undefined{return this.targetSurvivor()?.id;}
  currentPosition():Point{return {...this.demo.position};}
  beginAsk(){this.view='ask';this.askTranscript='';this.askAnswer='';this.askUntil=Date.now()+30_000;void this.broadcast();}
  showAskTranscript(transcript:string,answer:string){this.view='ask';this.askTranscript=transcript;this.askAnswer=answer;this.askUntil=Date.now()+30_000;void this.broadcast();}
  phoneState():Record<string,unknown>{const assignment=this.liveSnapshot?.assignments.find(row=>String(row.id)===String(this.assignment.id));const survivor=this.targetSurvivor();const expires=assignment?timestampMillis(assignment.leaseExpiresAt):undefined;return {type:'phone_state',assignment:assignment?{id:this.assignment.id,status:this.assignment.status,lease_seconds:expires===undefined?null:Math.max(0,Math.ceil((expires-Date.now())/1000))}:null,target:survivor?{id:survivor.id,lat:survivor.lat,lon:survivor.lon,critical_level:survivor.critical_level,critical_score:survivor.critical_score,house_label:survivor.house_label,location_note:survivor.location_note}:null,rescuer_position:this.currentPosition(),demo_mode:this.site.demo_mode};}
  showNotice(content:string,durationMs:number){for(const ws of this.listeners)this.send(ws,{type:'text',id:8,content,text_color:2});setTimeout(()=>{for(const ws of this.listeners)this.sendStatus(ws);},durationMs);}
  private peekUntil=0;private mode:'survivor'|'robot'='survivor';private liveSnapshot:DbSnapshot|undefined;private releasedUntil=0;private askUntil=0;private askTranscript='';private askAnswer='';
  startWalker(speedMps=this.demoSpeedMps){setInterval(()=>{if(this.site.demo_mode&&stepDemo(this.demo,.5,speedMps)){this.lastPositionAt=Date.now();this.onPosition?.(this.demo.position);void this.broadcast();}},500);setInterval(()=>{for(const ws of this.listeners)this.sendStatus(ws);},5000);}
  private async sendPage(ws:WebSocket){const layout=this.layout();this.view=layout;const data=this.data(layout);const containers=makeLayout(layout,data);const errors=validateLayout(containers);if(errors.length)throw new Error(errors.join('; '));const msg:ServiceMsg={type:'page',layout,containers,...(layout==='ack'?{ack_assignment_id:this.assignment.id}:{})};this.send(ws,msg);if(layout==='map'||layout==='idle'){this.sendImage(ws,2,this.maps[0]);this.sendImage(ws,3,this.maps[1]);}if(layout==='arrow'||layout==='ack')this.sendImage(ws,2,this.arrows[1]!);}
  private layout():LayoutName {if(this.assignment.status==='released')return Date.now()<this.releasedUntil?'released':'idle';if(this.assignment.status==='proposed')return'ack';if(this.view==='ask'&&Date.now()<this.askUntil)return'ask';if(this.assignment.status==='idle')return'idle';const survivor=this.targetSurvivor();if(!survivor)return'idle';const distance=distanceM(this.demo.position,survivor);if(this.assignment.status==='active'){if(distance<=5)return'arrived';if(this.view==='arrived'&&distance<=8)return'arrived';if(distance<40)return'arrow';if(distance>60)return'map';return this.view==='arrow'?'arrow':'map';}return'idle';}
  private data(layout:LayoutName):Record<string,string>{const criticalRows=this.criticalInRange();const unassigned=criticalRows.filter(row=>enumTag(row.status)==='unassigned').length;const criticalLine=`${criticalRows.length} CRITICAL\n${unassigned} available`;const briefing=this.newestBriefing();const optionalBrief:Record<string,string>=briefing?{brief:briefing}:{};const survivor=this.targetSurvivor();if(layout==='ask')return {head:'ASK - speak now\ntap to send',heard:this.askTranscript?`You: "${this.askTranscript}"`:'',answer:this.askAnswer,status:'ASKING - see answer in brief'};if(layout==='idle'||!survivor)return {target:'NO ASSIGNMENT',count:criticalLine,attrib:this.mapAttribution,...optionalBrief};const d=distanceM(this.demo.position,survivor);const direction=octant(bearingDeg(this.demo.position,survivor));const dist=Math.round(d<100?d:d/10)* (d<100?1:10);const leaseSeconds=this.proposedSecondsLeft();if(layout==='arrow'||layout==='ack')return {primary:`${direction}  ${dist} m\n${survivor.house_label||`survivor ${survivor.id}`} - ${survivor.critical_level.toUpperCase()}`,status:layout==='ack'?`TAP TO ACCEPT - ${leaseSeconds}s left`:'CRITICAL - arrow is N-up',...optionalBrief};if(layout==='arrived')return {head:`ARRIVED - ${survivor.house_label||`survivor ${survivor.id}`}\n${survivor.critical_level.toUpperCase()} score ${survivor.critical_score.toFixed(0)} (conf ${finiteOne(survivor.score_confidence)})`,where:`Where: ${survivor.location_note}`,life:survivor.breathing_rate_bpm===null||survivor.breathing_rate_bpm===undefined?`Breathing ${survivor.breathing}`:`Breathing ${survivor.breathing_rate_bpm.toFixed(0)}/min (conf ${finiteOne(survivor.breathing_confidence)})`,...optionalBrief};if(layout==='released')return {why:this.releaseReason()};return {target:`NEXT: ${survivor.house_label||`survivor ${survivor.id}`}\n${dist} m ${direction}`,count:criticalLine,attrib:this.mapAttribution,...optionalBrief};}
  private targetSurvivor():FakeSurvivor|undefined{return this.survivors.find(row=>String(row.id)===String(this.assignment.survivor_id))??(this.assignment.status==='idle'?undefined:this.survivors[0]);}
  private criticalInRange():Record<string,unknown>[] {const rows=this.liveSnapshot?.criticalOpen??[];const origin=this.demo.position??this.site.center;return rows.filter(row=>typeof row.lat==='number'&&typeof row.lon==='number'&&distanceM(origin,{lat:row.lat,lon:row.lon})<=this.site.radius_m);}
  private newestBriefing():string {const now=Date.now();const rows=this.liveSnapshot?.briefings??[];const briefing=rows.map(row=>({row,createdAt:timestampMillis(row.createdAt)})).filter(value=>value.createdAt!==undefined&&now-value.createdAt<=600_000).sort((a,b)=>(b.createdAt??0)-(a.createdAt??0))[0]?.row;if(!briefing||typeof briefing.text!=='string')return '';const priority=enumTag(briefing.priority);const prefix=priority==='critical'?'!! ':priority==='warning'?'! ':'';return `${prefix}${briefing.text}`.slice(0,180);}
  private proposedSecondsLeft():number {const assignment=this.liveSnapshot?.assignments.find(row=>enumTag(row.status)==='proposed');const expires=assignment?timestampMillis(assignment.leaseExpiresAt):undefined;return expires===undefined?0:Math.max(0,Math.ceil((expires-Date.now())/1000));}
  private releaseReason():string {const assignment=this.liveSnapshot?.assignments.find(row=>enumTag(row.status)==='released');const cause=enumTag(assignment?.releaseCause);if(cause==='disconnected')return 'Link to glasses was lost.\nSurvivor is back on the board for\nthe next rescuer.';if(cause==='heartbeat')return 'Glasses heartbeat stopped.\nSurvivor is back on the board for\nthe next rescuer.';if(cause==='declined')return 'You released it.\nSurvivor is back on the board for\nthe next rescuer.';if(cause==='expired'&&assignment?.acceptedAt==null)return 'Not accepted in time.\nSurvivor is back on the board for\nthe next rescuer.';return 'Lease expired or a coordinator\nreassigned it. The survivor is back\non the board for the next rescuer.';}
  private async broadcast(){for(const ws of this.listeners)await this.sendPage(ws);}
  private send(ws:WebSocket,msg:ServiceMsg){if(ws.readyState===ws.OPEN)ws.send(JSON.stringify(msg));}
  private sendImage(ws:WebSocket,id:number,png_b64:string){this.send(ws,{type:'image',id,png_b64});}
  private sendStatus(ws:WebSocket){const snapshot=this.liveSnapshot;const offline=snapshot&&snapshot.status!=='connected';const age=snapshot?.lastMessageAt===null||snapshot?.lastMessageAt===undefined?0:Math.max(0,Math.floor((Date.now()-snapshot.lastMessageAt)/1000));const base=offline?`DB OFFLINE - data ${age}s old`:Date.now()-this.lastPositionAt>5000?'NO GPS FIX':'tap: back  upd 1s';const isFree=this.assignment.status==='idle'||this.assignment.status==='released'&&Date.now()>=this.releasedUntil;const content=idleNotice(base,isFree,snapshot?.briefings??[]);this.send(ws,{type:'text',id:8,content,text_color:2});}
}
