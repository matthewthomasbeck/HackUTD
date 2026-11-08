import type { Reply } from '../types.js';
export function stripThinking(text: string) { return text.replace(/<think>[\s\S]*?<\/think>/gi, '').replace(/```(?:json)?/gi, '').replace(/```/g, '').trim(); }
export function parse(text: string): Reply {
  const clean = stripThinking(text), start = clean.indexOf('{');
  if (start < 0) throw new Error('Reply must contain one JSON object');
  let depth = 0, quoted = false, escaped = false, end = -1;
  for (let i = start; i < clean.length; i++) {
    const c = clean[i];
    if (quoted) { if (escaped) escaped = false; else if (c === '\\') escaped = true; else if (c === '"') quoted = false; }
    else if (c === '"') quoted = true;
    else if (c === '{') depth++;
    else if (c === '}' && --depth === 0) { end = i + 1; break; }
  }
  if (end < 0) throw new Error('Unbalanced JSON');
  const value = JSON.parse(clean.slice(start, end));
  if (value.done === true && typeof value.summary === 'string' && Object.keys(value).every(k => ['done','summary'].includes(k))) return { done: true, summary: value.summary, actions: [] };
  const actions = value.name && value.arguments ? [{ tool: value.name, args: typeof value.arguments === 'string' ? JSON.parse(value.arguments) : value.arguments }] : value.actions;
  if (!Array.isArray(actions) || actions.length < 1 || actions.length > 3) throw new Error('Expected 1 to 3 actions');
  for (const action of actions) {
    if (!action || typeof action.tool !== 'string' || !action.args || typeof action.args !== 'object' || Array.isArray(action.args) || typeof action.args.reason !== 'string') throw new Error('Every action requires a tool and args.reason');
    if (Object.keys(action).some(k => !['tool','args'].includes(k))) throw new Error('Unknown action field');
  }
  return { actions };
}
