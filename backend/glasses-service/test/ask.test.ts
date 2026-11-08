import { describe, expect, it, vi } from 'vitest';
import { processQuestionAudio } from '../src/ask.js';
import { validateQuestionWav, wrapPcmAsWav } from '../src/wav.js';

describe('voice question service flow', () => {
  it('wraps 16 kHz signed 16-bit mono PCM and validates the WAV contract', () => {
    const wav = wrapPcmAsWav(new Uint8Array([1, 2, 3, 4]));
    expect(wav.readUInt32LE(24)).toBe(16_000);
    expect(wav.readUInt16LE(22)).toBe(1);
    expect(wav.readUInt16LE(34)).toBe(16);
    expect(wav.readUInt32LE(40)).toBe(4);
    expect(() => validateQuestionWav(wav, 8)).not.toThrow();
    expect(() => validateQuestionWav(wav, 0.00001)).toThrow('too large');
  });

  it('uploads voice media and transcribes through mock HTTP responses', async () => {
    const wav = wrapPcmAsWav(new Uint8Array([1, 2, 3, 4]));
    const fetcher = vi.fn(async (_input: string | URL | Request, _init?: RequestInit) => new Response('', { status: 500 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ url: 'http://media.local/media/question.wav' }), { status: 200, headers: { 'content-type': 'application/json' } }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ transcript: 'check house 4', confidence: 0.8 }), { status: 200, headers: { 'content-type': 'application/json' } }));
    const result = await processQuestionAudio({ wav, rescuer: 'alex', perceptionUrl: 'http://perception.local/', fetcher });
    expect(result).toEqual({ audioUrl: 'http://media.local/media/question.wav', transcript: 'check house 4', confidence: 0.8 });
    expect(fetcher).toHaveBeenCalledTimes(2);
    const mediaForm = fetcher.mock.calls[0]![1]!.body as FormData;
    expect(mediaForm.get('kind')).toBe('voice');
    expect((mediaForm.get('file') as File).type).toBe('audio/wav');
    expect(fetcher.mock.calls[1]![0]).toBe('http://perception.local/transcribe');
    expect((fetcher.mock.calls[1]![1]!.body as FormData).get('rescuer')).toBe('alex');
  });

  it('fails closed when either local perception endpoint rejects the upload', async () => {
    const wav = wrapPcmAsWav(new Uint8Array([1, 2]));
    const fetcher = vi.fn(async (_input: string | URL | Request, _init?: RequestInit) => new Response('offline', { status: 503 }));
    await expect(processQuestionAudio({ wav, rescuer: 'alex', perceptionUrl: 'http://perception.local', fetcher })).rejects.toThrow('Media upload failed (503)');
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
});
