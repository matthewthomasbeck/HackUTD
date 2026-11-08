// Strict JSON fallback parser (agent.md 4.4).
// Removes <think> blocks and code fences, takes the first balanced {...}, and accepts
// {"actions":[...]}, {"done":true,...}, and the {"name","arguments"} tool-call leak from NIM.

export interface ParsedAction {
  tool: string;
  args: Record<string, unknown>;
}

export type ParseResult =
  | { kind: "actions"; actions: ParsedAction[] }
  | { kind: "done"; summary: string }
  | { kind: "error"; error: string };

/** Drop <think>...</think> blocks, and an unclosed <think> up to the end. */
export function stripThink(text: string): string {
  let out = text.replace(/<think>[\s\S]*?<\/think>/gi, "");
  const open = out.search(/<think>/i);
  if (open >= 0) out = out.slice(0, open);
  // Some templates emit only the closing tag after hidden reasoning.
  const close = out.search(/<\/think>/i);
  if (close >= 0) out = out.slice(close + "</think>".length);
  return out.trim();
}

function stripFences(text: string): string {
  return text.replace(/```[a-zA-Z]*\s*/g, "").replace(/```/g, "");
}

/** First balanced {...} that is not inside a string. Iterative scan, no recursion. */
export function firstBalancedObject(text: string): string | null {
  let start = -1;
  let depth = 0;
  let inStr = false;
  let esc = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (start < 0) {
      if (ch === "{") {
        start = i;
        depth = 1;
      }
      continue;
    }
    if (inStr) {
      if (esc) esc = false;
      else if (ch === "\\") esc = true;
      else if (ch === '"') inStr = false;
      continue;
    }
    if (ch === '"') inStr = true;
    else if (ch === "{") depth++;
    else if (ch === "}") {
      depth--;
      if (depth === 0) return text.slice(start, i + 1);
    }
  }
  return null;
}

function asArgs(v: unknown): Record<string, unknown> | null {
  if (typeof v === "string") {
    try {
      const p = JSON.parse(v);
      return p && typeof p === "object" && !Array.isArray(p) ? (p as Record<string, unknown>) : null;
    } catch {
      return null;
    }
  }
  return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
}

export function parseReply(raw: string | null | undefined): ParseResult {
  if (!raw || !raw.trim()) return { kind: "error", error: "empty reply" };
  const cleaned = stripFences(stripThink(raw));
  const objText = firstBalancedObject(cleaned);
  if (!objText) return { kind: "error", error: "no JSON object found" };
  let obj: unknown;
  try {
    obj = JSON.parse(objText);
  } catch (err) {
    return { kind: "error", error: "invalid JSON: " + (err as Error).message };
  }
  if (!obj || typeof obj !== "object" || Array.isArray(obj)) return { kind: "error", error: "not an object" };
  const o = obj as Record<string, unknown>;

  if (Array.isArray(o.actions)) {
    const actions: ParsedAction[] = [];
    for (const a of o.actions) {
      if (!a || typeof a !== "object") return { kind: "error", error: "action is not an object" };
      const rec = a as Record<string, unknown>;
      const tool = typeof rec.tool === "string" ? rec.tool : typeof rec.name === "string" ? rec.name : null;
      const args = asArgs(rec.args ?? rec.arguments ?? {});
      if (!tool || !args) return { kind: "error", error: "action needs tool and args" };
      actions.push({ tool, args });
    }
    if (actions.length === 0) return { kind: "done", summary: typeof o.summary === "string" ? o.summary : "" };
    return { kind: "actions", actions };
  }
  if (o.done === true) return { kind: "done", summary: typeof o.summary === "string" ? o.summary : "" };
  if (typeof o.name === "string" && "arguments" in o) {
    const args = asArgs(o.arguments);
    if (!args) return { kind: "error", error: "arguments are not an object" };
    return { kind: "actions", actions: [{ tool: o.name, args }] };
  }
  if (typeof o.tool === "string" && ("args" in o || "arguments" in o)) {
    const args = asArgs(o.args ?? o.arguments);
    if (!args) return { kind: "error", error: "args are not an object" };
    return { kind: "actions", actions: [{ tool: o.tool, args }] };
  }
  return { kind: "error", error: "unknown JSON shape" };
}
