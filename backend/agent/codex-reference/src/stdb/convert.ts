export function snake(key: string) { return key.replace(/[A-Z]/g, c => '_' + c.toLowerCase()); }
export function camel(key: string) { return key.replace(/_([a-z])/g, (_, c: string) => c.toUpperCase()); }
export function plain(value: any): any {
  if (typeof value === 'bigint') {
    if (value > BigInt(Number.MAX_SAFE_INTEGER) || value < BigInt(Number.MIN_SAFE_INTEGER)) throw new Error('ID exceeds safe JSON integer range');
    return Number(value);
  }
  if (value === null || value === undefined || typeof value !== 'object') return value;
  if (typeof value.toHexString === 'function') return value.toHexString().replace(/^0x/, '').toLowerCase();
  if (typeof value.toDate === 'function') return value.toDate().toISOString();
  if (Array.isArray(value)) return value.map(plain);
  if (typeof value.tag === 'string') {
    if (value.tag === 'Some') return plain(value.value);
    if (value.tag === 'None') return undefined;
    if (/^[A-Z_]+$/.test(value.tag)) return value.tag;
    return snake(value.tag).replace(/^_/, '');
  }
  return Object.fromEntries(Object.entries(value).map(([key, entry]) => [snake(key), plain(entry)]));
}
