// Contract enum spellings and the generated binding tags, in one table per enum.
// The module sets CaseConversionPolicy.None, so the contract spelling (SAFE_STOP, search_cells,
// OK) is what the server stores; the TypeScript SDK sends and receives the PascalCase binding tag
// (SafeStop, SearchCells, Ok). This file is the one place that knows both.

export const ENUMS = {
  robot_state: {
    BOOT: 'Boot', INIT: 'Init', READY: 'Ready', ACTIVE: 'Active',
    SAFE_STOP: 'SafeStop', FAULT: 'Fault', SHUTDOWN: 'Shutdown',
  },
  device_health: { OK: 'Ok', DEGRADED: 'Degraded', FAILED: 'Failed' },
  cell_status: {
    unsearched: 'Unsearched', searching: 'Searching',
    partially_searched: 'PartiallySearched', searched: 'Searched',
  },
  mission_status: {
    proposed: 'Proposed', queued: 'Queued', leased: 'Leased', active: 'Active',
    done: 'Done', failed: 'Failed', cancelled: 'Cancelled',
  },
  mission_kind: { search_cells: 'SearchCells', inspect: 'Inspect', return_home: 'ReturnHome', hold: 'Hold', teleop: 'Teleop' },
  detection_source: { thermal: 'Thermal', camera: 'Camera' },
  terrain_class: {
    flat: 'Flat', debris: 'Debris', step: 'Step', gap: 'Gap', blocked: 'Blocked', unknown: 'Unknown',
  },
  terrain_action: { continue: 'Continue', slow: 'Slow', steer: 'Steer', stop: 'Stop' },
} as const;

export type EnumName = keyof typeof ENUMS;
export type ContractValue<E extends EnumName> = keyof (typeof ENUMS)[E] & string;
export type BindingTag<E extends EnumName> = (typeof ENUMS)[E][ContractValue<E>];

/** Contract spelling to the binding tag object the SDK expects, or undefined if not a value of the enum. */
export function toBindingEnum<E extends EnumName>(name: E, value: unknown): { tag: BindingTag<E> } | undefined {
  if (typeof value !== 'string') return undefined;
  const table = ENUMS[name] as Record<string, string>;
  if (!Object.prototype.hasOwnProperty.call(table, value)) return undefined;
  return { tag: table[value] as BindingTag<E> };
}

/** Binding tag (from a live row) back to the contract spelling. Throws on an unknown tag. */
export function toContractEnum<E extends EnumName>(name: E, tag: string): ContractValue<E> {
  const table = ENUMS[name] as Record<string, string>;
  for (const [contract, binding] of Object.entries(table)) {
    if (binding === tag) return contract as ContractValue<E>;
  }
  throw new Error(`unknown ${name} tag ${tag}`);
}
