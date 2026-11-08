export const EARTH_RADIUS_M = 6371008.8;
const rad = (n: number) => n * Math.PI / 180;
const deg = (n: number) => n * 180 / Math.PI;
export interface Point { lat: number; lon: number }
export function distanceM(a: Point, b: Point): number {
  const p1=rad(a.lat), p2=rad(b.lat), dp=p2-p1, dl=rad(b.lon-a.lon);
  const h=Math.sin(dp/2)**2 + Math.cos(p1)*Math.cos(p2)*Math.sin(dl/2)**2;
  return 2*EARTH_RADIUS_M*Math.atan2(Math.sqrt(h),Math.sqrt(1-h));
}
export function bearingDeg(a: Point,b: Point): number {
  const p1=rad(a.lat), p2=rad(b.lat), dl=rad(b.lon-a.lon);
  return (deg(Math.atan2(Math.sin(dl)*Math.cos(p2),Math.cos(p1)*Math.sin(p2)-Math.sin(p1)*Math.cos(p2)*Math.cos(dl)))+360)%360;
}
export const OCTANTS=['N','NE','E','SE','S','SW','W','NW'] as const;
export type Octant=typeof OCTANTS[number];
export function octant(angle: number): Octant { return OCTANTS[Math.floor(((angle+22.5)%360)/45)]; }
export function octantWithHysteresis(angle: number,current: Octant): Octant {
  const idx=OCTANTS.indexOf(current), center=idx*45;
  const delta=((angle-center+540)%360)-180;
  if (Math.abs(delta)<=27.5) return current;
  return octant(angle);
}
export function destinationPoint(start: Point,bearing: number,distance: number): Point {
  const p1=rad(start.lat), l1=rad(start.lon), t=rad(bearing), d=distance/EARTH_RADIUS_M;
  const p2=Math.asin(Math.sin(p1)*Math.cos(d)+Math.cos(p1)*Math.sin(d)*Math.cos(t));
  const l2=l1+Math.atan2(Math.sin(t)*Math.sin(d)*Math.cos(p1),Math.cos(d)-Math.sin(p1)*Math.sin(p2));
  return {lat:deg(p2),lon:((deg(l2)+540)%360)-180};
}
export function mercator(lat:number,lon:number,z:number) {
  const phi=rad(Math.max(-85.05112878,Math.min(85.05112878,lat))), scale=256*2**z;
  return {px:scale*(lon+180)/360,py:scale*(1-Math.log(Math.tan(phi)+1/Math.cos(phi))/Math.PI)/2,mpp:156543.03392*Math.cos(phi)/2**z};
}
