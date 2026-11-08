import { describe, expect, it } from 'vitest';
import { cellStatusText, TERRAIN_GLYPHS } from '../../src/model/map';

describe('map labels', () => {
  it('never labels a partially searched cell as clear or searched', () => {
    expect(cellStatusText('partially_searched')).toBe('PARTIAL, still in queue');
    expect(cellStatusText('partially_searched')).not.toMatch(/clear|searched/i);
  });

  it('gives terrain classes a letter glyph', () => {
    expect(TERRAIN_GLYPHS).toEqual({ debris: 'D', step: 'S', gap: 'G', blocked: 'X', unknown: '?' });
    expect(TERRAIN_GLYPHS.flat).toBeUndefined();
  });
});
