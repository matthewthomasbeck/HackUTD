export function cellStatusText(status: string): string {
  switch (status) {
    case 'searched': return 'SEARCHED ✓';
    case 'partially_searched': return 'PARTIAL, still in queue';
    case 'searching': return 'SEARCHING';
    default: return 'UNSEARCHED';
  }
}

export const TERRAIN_GLYPHS: Readonly<Record<string, string>> = {
  debris: 'D', step: 'S', gap: 'G', blocked: 'X', unknown: '?',
};
