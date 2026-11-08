import { describe, expect, it } from 'vitest';
import { encodeQuestionWav } from '../src/phone/audio';

describe('phone voice question WAV', () => {
  it('resamples mono audio to 16 kHz signed PCM and wraps a WAV header', () => {
    const samples = new Float32Array(48_000).fill(0.25);
    const wav = encodeQuestionWav([samples], 48_000);
    const view = new DataView(wav.buffer, wav.byteOffset, wav.byteLength);
    expect(new TextDecoder().decode(wav.slice(0, 4))).toBe('RIFF');
    expect(new TextDecoder().decode(wav.slice(8, 12))).toBe('WAVE');
    expect(view.getUint32(24, true)).toBe(16_000);
    expect(view.getUint16(22, true)).toBe(1);
    expect(view.getUint16(34, true)).toBe(16);
    expect(wav.byteLength).toBe(44 + 16_000 * 2);
    expect(view.getInt16(44, true)).toBe(Math.round(0.25 * 0x7fff));
  });

  it('caps encoded audio at the configured maximum question duration', () => {
    const samples = new Float32Array(48_000 * 10);
    const wav = encodeQuestionWav([samples], 48_000, 8);
    expect(wav.byteLength).toBe(44 + 16_000 * 8 * 2);
  });
});
