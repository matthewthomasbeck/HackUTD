import type { Row } from './types.js';
function ascii(text: string) { return text.replace(/[^\x20-\x7E]/g,' ').replace(/ +/g,' ').trim(); }
export function short(parts: string[]) {
  let result='';
  for(const part of parts.map(ascii)) if(part && `${result}${result ? ' ' : ''}${part}`.length <= 120) result += (result ? ' ' : '') + part;
  return result || 'Board update unavailable. Ask coordinator.';
}
export function breathingPart(s: Row) { return s.breathing === 'detected' && Number.isFinite(s.breathing_rate) ? `breathing ${s.breathing_rate}/min (conf ${Number(s.confidence ?? s.breathing_confidence ?? 0).toFixed(2)}).` : 'breathing not seen, low confidence.'; }
export function briefingTemplate(s: Row, cell?: Row, location = '') { return short([`${String(s.critical_level).toUpperCase()} ${cell?.label || 'location pending'}:`,breathingPart(s),location]); }
export function answerTemplate(cell?: Row) { return short([`Board: ${cell?.label || 'place unknown'} ${cell?.found ?? 0} found, ${cell?.unaccounted ?? 0} unaccounted.`, 'Ask coordinator for more.']); }
export function nudgeTemplate(cell?: Row) { return short([`Please acknowledge assignment at ${cell?.label || 'assigned location'}.`]); }
export function navigationTemplate(cell?: Row, note = '', terrain = 'unknown') { return short([`Go to ${cell?.label || 'assigned location'}.`, note, `Ground ahead: ${terrain}.`]); }
