import { describe, expect, it } from 'vitest';
import { AudioQuestionBuffer } from '../src/audio.js';

const pcm = (sample: number, count = 1600) => {
  const data = Buffer.alloc(count * 2);
  for (let offset = 0; offset < data.length; offset += 2) data.writeInt16LE(sample, offset);
  return data;
};

describe('plugin audio question buffer', () => {
  it('accepts ordered PCM frames and produces the service WAV format', () => {
    const buffer = new AudioQuestionBuffer(1000);
    buffer.append(0, pcm(0).toString('base64'), 1100);
    buffer.append(1, pcm(100).toString('base64'), 1200);
    const wav = buffer.toWav();
    expect(buffer.lastSequence).toBe(1);
    expect(buffer.length).toBe(6400);
    expect(wav.toString('ascii', 0, 4)).toBe('RIFF');
    expect(wav.readUInt32LE(24)).toBe(16_000);
    expect(wav.readUInt16LE(22)).toBe(1);
    expect(wav.readUInt16LE(34)).toBe(16);
  });

  it('rejects out-of-order and oversized audio frames', () => {
    const buffer = new AudioQuestionBuffer(0, 4);
    expect(() => buffer.append(1, pcm(1, 2).toString('base64'), 100)).toThrow('out of order');
    buffer.append(0, pcm(1, 2).toString('base64'), 100);
    expect(() => buffer.append(1, pcm(1, 2).toString('base64'), 200)).toThrow('exceeds 8 seconds');
  });

  it('stops after 1.5 seconds below the speech threshold following speech', () => {
    const buffer = new AudioQuestionBuffer(0);
    buffer.append(0, pcm(0).toString('base64'), 100);
    buffer.append(1, pcm(0).toString('base64'), 200);
    buffer.append(2, pcm(0).toString('base64'), 300);
    buffer.append(3, pcm(12_000).toString('base64'), 400);
    buffer.append(4, pcm(0).toString('base64'), 500);
    expect(buffer.shouldStopForSilence(1899)).toBe(false);
    expect(buffer.shouldStopForSilence(1900)).toBe(true);
  });
});
