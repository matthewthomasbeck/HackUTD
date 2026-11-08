import { describe, expect, it, vi } from 'vitest';
import { AudioInputSource } from '@evenrealities/even_hub_sdk';
import type { EvenHubEvent } from '@evenrealities/even_hub_sdk';
import { MicrophoneController } from '../src/plugin/mic';
import type { PluginMsg } from '../src/plugin/protocol';

function fixture(results: boolean[]) {
  const sent: PluginMsg[] = [];
  const audioControl = vi.fn(async (_open: boolean, _source?: AudioInputSource) => results.shift() ?? true);
  const microphone = new MicrophoneController({ audioControl, send: message => { sent.push(message); return true; }, isOpen: () => true });
  return { microphone, audioControl, sent };
}

describe('glasses microphone', () => {
  it('opens glasses audio and streams ordered PCM frames without retaining them', async () => {
    const f = fixture([true]);
    expect(await f.microphone.start(8)).toBe(true);
    f.microphone.handleEvent({ audioEvent: { audioPcm: new Uint8Array([1, 2, 3]), source: AudioInputSource.Glasses } } as EvenHubEvent);
    f.microphone.handleEvent({ audioEvent: { audioPcm: new Uint8Array([4, 5]), source: AudioInputSource.Glasses } } as EvenHubEvent);
    await f.microphone.stop(true);

    expect(f.sent).toEqual([
      { type: 'audio', seq: 0, pcm_b64: 'AQID', source: 'glasses' },
      { type: 'audio', seq: 1, pcm_b64: 'BAU=', source: 'glasses' },
      { type: 'audio_end', seq: 1 },
    ]);
    expect(f.audioControl.mock.calls[0]).toEqual([true, AudioInputSource.Glasses]);
    expect(f.audioControl.mock.calls.at(-1)).toEqual([false]);
  });

  it('falls back to phone audio if the glasses input cannot open', async () => {
    const f = fixture([false, true]);
    expect(await f.microphone.start(3)).toBe(true);
    f.microphone.handleEvent({ audioEvent: { audioPcm: new Uint8Array([1]), source: AudioInputSource.Phone } } as EvenHubEvent);
    await f.microphone.stop(true);

    expect(f.audioControl.mock.calls.slice(0, 2)).toEqual([[true, AudioInputSource.Glasses], [true, AudioInputSource.Phone]]);
    expect(f.sent[0]).toMatchObject({ type: 'audio', seq: 0, source: 'phone' });
  });

  it('reports a failure when both microphone sources fail', async () => {
    const f = fixture([false, false]);
    expect(await f.microphone.start(8)).toBe(false);
    expect(f.sent).toEqual([{ type: 'audio_error', detail: 'Microphone could not be opened.' }]);
  });

  it('closes the microphone after the service supplied maximum duration', async () => {
    vi.useFakeTimers();
    try {
      const f = fixture([true]);
      await f.microphone.start(1);
      await vi.advanceTimersByTimeAsync(1000);
      expect(f.microphone.isListening()).toBe(false);
      expect(f.sent).toEqual([{ type: 'audio_end', seq: -1 }]);
    } finally { vi.useRealTimers(); }
  });
});
