import { describe, expect, it } from 'vitest';
import { enumTagToContract } from '../../src/stdb/enums';

describe('enumTagToContract', () => {
  it('converts generated tagged enum names to contract strings', () => {
    expect(enumTagToContract({ tag: 'PartiallySearched' })).toBe('partially_searched');
    expect(enumTagToContract({ tag: 'NotDetected' })).toBe('not_detected');
  });
});
