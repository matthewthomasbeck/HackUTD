export type TaggedEnum = string | { tag: string };

export function enumTagToContract(value: TaggedEnum): string {
  if (typeof value === 'string') return value;
  const tag = value.tag;
  return tag.replace(/([a-z0-9])([A-Z])/g, '$1_$2').toLowerCase();
}
