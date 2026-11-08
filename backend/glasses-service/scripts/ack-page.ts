// Prints the acknowledgement view ("NEW TASK ... TAP TO ACCEPT") as glasses protocol messages, drawn by the same
// layout and arrow code as a live session. The glasses plugin's demo recorder (frontend/glasses/scripts/record-demo.mjs)
// uses it because the dashboard's Play demo accepts the task at once, so a live recording never shows this view.
// Usage: tsx scripts/ack-page.ts '{"head":"...","detail":"...","bearing_deg":90,"seconds":30,"assignment_id":"1"}'
import { makeLayout, validateLayout } from '../src/layouts.js';
import type { ServiceMsg } from '../src/protocol.js';
import { renderArrows } from '../src/render/arrows.js';

const input = JSON.parse(process.argv[2] ?? '{}') as { head: string; detail: string; bearing_deg: number; seconds: number; assignment_id: string };
const status = (seconds: number) => `TAP TO ACCEPT - ${seconds}s left`;
const containers = makeLayout('ack', { head: input.head, detail: input.detail, status: status(input.seconds) });
const errors = validateLayout(containers);
if (errors.length) throw new Error(errors.join('; '));
const arrows = await renderArrows();
const messages: ServiceMsg[] = [
  { type: 'page', layout: 'ack', containers, ack_assignment_id: input.assignment_id },
  { type: 'image', id: 2, png_b64: arrows[Math.round(input.bearing_deg / 45) % 8]! },
];
const countdown = Array.from({ length: input.seconds }, (_, i) => status(input.seconds - 1 - i));
process.stdout.write(JSON.stringify({ messages, countdown }));
