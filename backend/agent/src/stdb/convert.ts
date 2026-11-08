// Live binding rows to contract rows, and contract values back to reducer arguments.
// Generated bindings use camelCase fields and PascalCase enum keys; the contract uses snake_case.
// This file and stdb/connect.ts are the only places that know the binding shapes.
// UNCONFIRMED until checked against a live row: whether enum tags arrive as contract spellings
// (the module sets CaseConversionPolicy.None) or PascalCase; both map to the same string here.

export function snakeKey(k: string): string {
  return k.replace(/([a-z0-9])([A-Z])/g, "$1_$2").toLowerCase();
}

export function camelKey(k: string): string {
  return k.replace(/_([a-z0-9])/g, (_m, c: string) => c.toUpperCase());
}

/** PascalCase or camelCase enum tag to the contract spelling; ALL_CAPS (RobotState) stays. */
export function enumTag(tag: string): string {
  if (/^[A-Z0-9_]+$/.test(tag)) return tag;
  if (/^[a-z0-9_]+$/.test(tag)) return tag;
  return snakeKey(tag);
}

function isIdentity(v: any): boolean {
  return v != null && typeof v === "object" && typeof v.toHexString === "function" && !("microsSinceUnixEpoch" in v);
}
function isTimestamp(v: any): boolean {
  return v != null && typeof v === "object" && "microsSinceUnixEpoch" in v;
}
function isTaggedEnum(v: any): boolean {
  if (v == null || typeof v !== "object" || Array.isArray(v)) return false;
  const keys = Object.keys(v);
  return typeof v.tag === "string" && keys.every((k) => k === "tag" || k === "value");
}

/**
 * Convert one value from the bindings: bigint to number, Identity to lowercase hex, Timestamp to
 * epoch ms, tagged enum to its contract string (a unit enum) or its value, undefined to null,
 * and object keys to snake_case. Iterative, so deep rows never recurse.
 */
export function fromBinding(input: unknown): unknown {
  const isUnit = (v: any) => v.value === undefined || (typeof v.value === "object" && v.value !== null && !Array.isArray(v.value) && Object.keys(v.value).length === 0);
  // A tagged enum with a payload (for example an Option some-value) becomes its payload.
  const unwrap = (v: any): any => {
    let x = v;
    while (isTaggedEnum(x) && !isUnit(x)) x = x.value;
    return x;
  };
  const leaf = (raw: any): { done: true; value: unknown } | { done: false; value: any } => {
    const v = unwrap(raw);
    if (v === undefined || v === null) return { done: true, value: null };
    if (typeof v === "bigint") return { done: true, value: Number(v) };
    if (typeof v !== "object") return { done: true, value: v };
    if (isTimestamp(v)) return { done: true, value: Number(BigInt(v.microsSinceUnixEpoch) / 1000n) };
    if (isIdentity(v)) return { done: true, value: String(v.toHexString()).replace(/^0x/, "").toLowerCase() };
    if (isTaggedEnum(v)) return { done: true, value: enumTag(v.tag) };
    return { done: false, value: v };
  };
  const root = leaf(input);
  if (root.done) return root.value;
  const out: any = Array.isArray(root.value) ? [] : {};
  const stack: Array<{ src: any; dst: any }> = [{ src: root.value, dst: out }];
  while (stack.length) {
    const { src, dst } = stack.pop()!;
    const entries: Array<[string | number, any]> = Array.isArray(src) ? src.map((x, i) => [i, x]) : Object.entries(src);
    for (const [k, v] of entries) {
      const key = typeof k === "number" ? k : snakeKey(k);
      const l = leaf(v);
      if (l.done) dst[key] = l.value;
      else {
        const child: any = Array.isArray(l.value) ? [] : {};
        dst[key] = child;
        stack.push({ src: l.value, dst: child });
      }
    }
  }
  return out;
}

/** A contract enum string as a tagged enum argument. */
export function toEnum(value: string): { tag: string } {
  return { tag: value };
}

/**
 * Reducer argument object with both snake_case and camelCase keys. The generated serializer reads
 * the keys it knows and ignores the rest, which hedges the UNCONFIRMED argument key spelling.
 */
export function reducerArgs(o: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(o)) {
    out[k] = v;
    out[camelKey(k)] = v;
  }
  return out;
}
