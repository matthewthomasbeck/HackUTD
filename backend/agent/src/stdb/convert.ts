// Live binding rows to contract rows, and contract values back to reducer arguments.
// Generated bindings use camelCase fields and PascalCase enum variant names; the contract uses
// snake_case fields and the module's own variant spellings (the module sets
// CaseConversionPolicy.None, so SQL and the server keep en_route, comms_agent, SAFE_STOP, OK).
// The client SDK serializes and deserializes enums by the binding variant name, so every enum value
// crossing the SDK boundary goes through toBindingTag or toContractTag.
// This file and stdb/connect.ts are the only places that know the binding shapes.

export function snakeKey(k: string): string {
  return k.replace(/([a-z0-9])([A-Z])/g, "$1_$2").toLowerCase();
}

export function camelKey(k: string): string {
  return k.replace(/_([a-z0-9])/g, (_m, c: string) => c.toUpperCase());
}

/**
 * Contract enum spelling to the generated binding variant name:
 * comms_agent -> CommsAgent, agent -> Agent, SAFE_STOP -> SafeStop, OK -> Ok.
 * This is the rule spacetime generate uses for every enum in the module.
 */
export function toBindingTag(contract: string): string {
  return contract
    .toLowerCase()
    .split("_")
    .map((p) => p.charAt(0).toUpperCase() + p.slice(1))
    .join("");
}

/**
 * Binding variant name to the contract spelling: CommsAgent -> comms_agent, EnRoute -> en_route.
 * The tag alone cannot tell READY from ready (RobotState Active and AssignmentStatus Active share a
 * binding name), so the caller says when the enum is one of the ALL_CAPS contract enums.
 */
export function toContractTag(binding: string, upper = false): string {
  const snake = /^[A-Z0-9_]+$/.test(binding) ? binding.toLowerCase() : snakeKey(binding);
  return upper ? snake.toUpperCase() : snake;
}

/** Row columns whose enum uses ALL_CAPS contract spellings (RobotState, DeviceHealth). */
export const UPPER_ENUM_COLUMNS: Readonly<Record<string, readonly string[]>> = {
  robot: ["state"],
  device_status: ["status"],
};

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
 * and object keys to snake_case. Pass the table name so ALL_CAPS enum columns decode to READY, OK.
 * Iterative, so deep rows never recurse.
 */
export function fromBinding(input: unknown, table?: string): unknown {
  const upperCols = new Set(table ? UPPER_ENUM_COLUMNS[table] ?? [] : []);
  const isUnit = (v: any) => v.value === undefined || (typeof v.value === "object" && v.value !== null && !Array.isArray(v.value) && Object.keys(v.value).length === 0);
  // A tagged enum with a payload (for example an Option some-value) becomes its payload.
  const unwrap = (v: any): any => {
    let x = v;
    while (isTaggedEnum(x) && !isUnit(x)) x = x.value;
    return x;
  };
  const leaf = (raw: any, upper = false): { done: true; value: unknown } | { done: false; value: any } => {
    const v = unwrap(raw);
    if (v === undefined || v === null) return { done: true, value: null };
    if (typeof v === "bigint") return { done: true, value: Number(v) };
    if (typeof v !== "object") return { done: true, value: v };
    if (isTimestamp(v)) return { done: true, value: Number(BigInt(v.microsSinceUnixEpoch) / 1000n) };
    if (isIdentity(v)) return { done: true, value: String(v.toHexString()).replace(/^0x/, "").toLowerCase() };
    if (isTaggedEnum(v)) return { done: true, value: toContractTag(v.tag, upper) };
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
      const l = leaf(v, src === root.value && typeof key === "string" && upperCols.has(key));
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

/** A contract enum string as a tagged enum argument for the generated reducer serializers. */
export function toEnum(value: string): { tag: string } {
  return { tag: toBindingTag(value) };
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
