// Guide and arrived pictures for the G2 (Bluebook style): a small ground chevron toward the target with the
// distance, and the target house's real outline with the survivor's spot. Text containers have one small font,
// so anything sized or shaped is drawn here as an image. White on black: the SDK maps it to the green levels and
// black stays see-through.
import { createCanvas, type SKRSContext2D } from '@napi-rs/canvas';
import { bearingDeg, distanceM, octant, type Point } from '../geo.js';
import { ringCenter, type SiteBuilding, type SiteRoad } from './vector.js';

export const GUIDE_W = 184, GUIDE_H = 80;
export const PLAN_W = 288, PLAN_H = 144;
const FONT = 'Arial, Helvetica, "DejaVu Sans", sans-serif';
const BEHIND_DEG = 110;

// Signed angle from straight ahead to the target, in (-180, 180]; positive is to the right.
export function relativeBearing(targetBearingDeg: number, headingDeg: number): number {
  const delta = ((targetBearingDeg - headingDeg) % 360 + 540) % 360 - 180;
  return delta === -180 ? 180 : delta;
}

export function turnCue(relativeDeg: number): string {
  if (Math.abs(relativeDeg) > BEHIND_DEG) return 'TURN AROUND';
  if (relativeDeg > 25) return 'BEAR RIGHT';
  if (relativeDeg < -25) return 'BEAR LEFT';
  return 'STRAIGHT AHEAD';
}

// Rounded the way a person reads a distance while walking: metres up close, tens of metres further out.
export function roundDistance(meters: number): number {
  if (meters < 20) return Math.max(1, Math.round(meters));
  if (meters < 100) return Math.round(meters / 5) * 5;
  return Math.round(meters / 10) * 10;
}

/* ---------- Guide: one small chevron and the distance ---------- */

// A small chevron lying on the ground ahead, tilted toward the target: present but quiet, so the street stays the view.
function drawChevron(context: SKRSContext2D, relativeDeg: number): void {
  context.save();
  context.translate(GUIDE_W / 2, 16);
  context.scale(0.72, 0.72 * 0.62); // small, and flattened onto the ground plane
  context.rotate(relativeDeg * Math.PI / 180);
  context.beginPath();
  context.moveTo(0, -30); context.lineTo(24, 16); context.lineTo(0, 4); context.lineTo(-24, 16); context.closePath();
  context.fillStyle = 'rgba(255,255,255,0.35)';
  context.fill();
  context.lineJoin = 'round';
  context.strokeStyle = 'white';
  context.lineWidth = 3.5;
  context.stroke();
  context.restore();
}

// Behind the wearer a ground chevron would point back at them, so show a small U-turn instead.
function drawTurnAround(context: SKRSContext2D, relativeDeg: number): void {
  context.save();
  context.translate(GUIDE_W / 2, 16);
  context.scale(relativeDeg > 0 ? 0.26 : -0.26, 0.26);
  context.strokeStyle = 'white';
  context.lineWidth = 9;
  context.lineCap = 'round';
  context.beginPath();
  context.moveTo(-40, 40); context.lineTo(-40, -6); context.arc(0, -6, 40, Math.PI, 0); context.lineTo(40, 18);
  context.stroke();
  context.fillStyle = 'white';
  context.beginPath();
  context.moveTo(18, 14); context.lineTo(62, 14); context.lineTo(40, 46); context.closePath();
  context.fill();
  context.restore();
}

// Chevron at the top center with the compass direction beside it, the distance and a short cue under it.
export async function guidePng(relativeDeg: number, meters: number, cue: string, compass: string): Promise<string> {
  const canvas = createCanvas(GUIDE_W, GUIDE_H);
  const context = canvas.getContext('2d');
  context.fillStyle = 'black';
  context.fillRect(0, 0, GUIDE_W, GUIDE_H);
  if (Math.abs(relativeDeg) > BEHIND_DEG) drawTurnAround(context, relativeDeg); else drawChevron(context, relativeDeg);
  context.fillStyle = 'white';
  context.textBaseline = 'middle';
  context.textAlign = 'left';
  context.font = `700 16px ${FONT}`;
  context.fillText(compass, GUIDE_W / 2 + 26, 17);
  context.textAlign = 'center';
  context.textBaseline = 'top';
  context.font = `700 26px ${FONT}`;
  context.fillText(`${roundDistance(meters)} m`, GUIDE_W / 2, 32);
  context.fillStyle = 'rgb(150,150,150)';
  context.font = `700 11px ${FONT}`;
  context.fillText(cue, GUIDE_W / 2, 64);
  return (await canvas.encode('png')).toString('base64');
}

function tracePath(context: SKRSContext2D, points: Array<[number, number]>, close: boolean): void {
  context.beginPath();
  points.forEach(([x, y], index) => { if (index) context.lineTo(x, y); else context.moveTo(x, y); });
  if (close) context.closePath();
}

/* ---------- Arrived: the house plan ---------- */

// The front door is guessed as the point of the outline nearest the closest named street, since OSM has no doors here.
export function frontDoor(ring: Point[], roads: SiteRoad[]): Point {
  let best = ring[0]!;
  let bestDistance = Infinity;
  for (let i = 0; i < ring.length - 1; i += 1) {
    const mid = { lat: (ring[i]!.lat + ring[i + 1]!.lat) / 2, lon: (ring[i]!.lon + ring[i + 1]!.lon) / 2 };
    for (const road of roads) {
      if (!road.name) continue;
      for (const point of road.line) {
        const distance = distanceM(mid, point);
        if (distance < bestDistance) { best = mid; bestDistance = distance; }
      }
    }
  }
  return best;
}

export async function housePlanPng(building: SiteBuilding, roads: SiteRoad[], survivor: Point): Promise<string> {
  const canvas = createCanvas(PLAN_W, PLAN_H);
  const context = canvas.getContext('2d');
  context.fillStyle = 'black';
  context.fillRect(0, 0, PLAN_W, PLAN_H);
  const center = ringCenter(building.ring);
  const metersPerLat = 110574, metersPerLon = 111320 * Math.cos(center.lat * Math.PI / 180);
  const local = (point: Point): [number, number] => [(point.lon - center.lon) * metersPerLon, (point.lat - center.lat) * metersPerLat];
  const meters = building.ring.map(local);
  // Frame the survivor too, so someone in the front yard is drawn in front of the house, not off the image.
  const framed = [...meters, local(survivor)];
  const xs = framed.map(([x]) => x), ys = framed.map(([, y]) => y);
  const scale = Math.min((PLAN_W - 110) / (Math.max(...xs) - Math.min(...xs)), (PLAN_H - 18) / (Math.max(...ys) - Math.min(...ys)));
  const midX = (Math.max(...xs) + Math.min(...xs)) / 2, midY = (Math.max(...ys) + Math.min(...ys)) / 2;
  const toPixel = ([x, y]: [number, number]): [number, number] => [PLAN_W / 2 + (x - midX) * scale, PLAN_H / 2 - (y - midY) * scale];
  context.strokeStyle = 'white';
  context.lineWidth = 3;
  context.lineJoin = 'round';
  tracePath(context, meters.map(toPixel), true);
  context.stroke();
  const door = toPixel(local(frontDoor(building.ring, roads)));
  context.fillStyle = 'white';
  context.fillRect(door[0] - 12, door[1] - 4, 24, 8);
  context.font = `700 14px ${FONT}`;
  context.textBaseline = 'middle';
  context.textAlign = 'right';
  context.fillStyle = 'rgb(170,170,170)';
  context.fillText('DOOR', door[0] - 18, door[1]);
  const spot = toPixel(local(survivor));
  context.strokeStyle = 'white';
  context.lineWidth = 4;
  context.beginPath();
  context.moveTo(spot[0] - 9, spot[1] - 9); context.lineTo(spot[0] + 9, spot[1] + 9);
  context.moveTo(spot[0] + 9, spot[1] - 9); context.lineTo(spot[0] - 9, spot[1] + 9);
  context.stroke();
  context.lineWidth = 2;
  context.beginPath();
  context.arc(spot[0], spot[1], 16, 0, Math.PI * 2);
  context.stroke();
  return (await canvas.encode('png')).toString('base64');
}

// Compass bearing and distance from the rescuer to the target, for the guide view.
export function guideFix(from: Point, to: Point, headingDeg: number | null): { distance: number; relative: number; northUp: boolean; compass: string } {
  const bearing = bearingDeg(from, to);
  return { distance: distanceM(from, to), relative: relativeBearing(bearing, headingDeg ?? 0), northUp: headingDeg === null, compass: octant(bearing) };
}
