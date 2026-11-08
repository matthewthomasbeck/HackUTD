import { destinationPoint, type Point } from './geo.js';
export interface DemoState { position:Point; origin:Point; target:Point; walking:boolean; }
export const DEMO_SPEED_MPS=3;
export const DEMO_START_DISTANCE_M=250;
export const DEMO_START_BEARING_DEG=225;
export function makeDemoState(center:Point,target:Point,bearingDeg=DEMO_START_BEARING_DEG,distanceM=DEMO_START_DISTANCE_M):DemoState {return {position:destinationPoint(center,bearingDeg,distanceM),origin:destinationPoint(center,bearingDeg,distanceM),target,walking:false};}
export function moveDemo(s:DemoState,dn:number,de:number):void {s.position=destinationPoint(destinationPoint(s.position,dn>=0?0:180,Math.abs(dn)),de>=0?90:270,Math.abs(de));}
export function stepDemo(s:DemoState,seconds=.5,speedMps=DEMO_SPEED_MPS):boolean {if(!s.walking)return false;const {distanceM,bearingDeg}=requireGeo();const d=distanceM(s.position,s.target);if(d<=2){s.walking=false;return false;}s.position=destinationPoint(s.position,bearingDeg(s.position,s.target),Math.min(d-2,speedMps*seconds));return true;}
function requireGeo(){return {distanceM:(a:Point,b:Point)=>{const R=6371008.8,p=Math.PI/180,dp=(b.lat-a.lat)*p,dl=(b.lon-a.lon)*p,h=Math.sin(dp/2)**2+Math.cos(a.lat*p)*Math.cos(b.lat*p)*Math.sin(dl/2)**2;return 2*R*Math.atan2(Math.sqrt(h),Math.sqrt(1-h));},bearingDeg:(a:Point,b:Point)=>{const p=Math.PI/180,y=Math.sin((b.lon-a.lon)*p)*Math.cos(b.lat*p),x=Math.cos(a.lat*p)*Math.sin(b.lat*p)-Math.sin(a.lat*p)*Math.cos(b.lat*p)*Math.cos((b.lon-a.lon)*p);return(Math.atan2(y,x)/p+360)%360;}};}
