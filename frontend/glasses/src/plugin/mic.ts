import { AudioInputSource } from '@evenrealities/even_hub_sdk';
import type { EvenAppBridge, EvenHubEvent } from '@evenrealities/even_hub_sdk';
import type { PluginMsg } from './protocol';

export interface MicDeps {
  audioControl(isOpen: boolean, source?: AudioInputSource): Promise<boolean>;
  send(message: PluginMsg): boolean;
  isOpen(): boolean;
  setTimer?: typeof setTimeout;
  clearTimer?: typeof clearTimeout;
}

export class MicrophoneController {
  private listening = false;
  private sequence = 0;
  private source: 'glasses' | 'phone' = 'glasses';
  private stopTimer: ReturnType<typeof setTimeout> | undefined;
  private readonly setTimer: typeof setTimeout;
  private readonly clearTimer: typeof clearTimeout;

  constructor(private readonly deps: MicDeps) {
    this.setTimer = deps.setTimer ?? setTimeout;
    this.clearTimer = deps.clearTimer ?? clearTimeout;
  }

  async handleServiceMessage(message: { type: 'mic'; on: boolean; max_s?: number }): Promise<void> {
    if (message.on) await this.start(message.max_s ?? 8);
    else await this.stop(true);
  }

  async start(maxSeconds: number): Promise<boolean> {
    if (this.listening) return true;
    const duration = Number.isFinite(maxSeconds) ? Math.max(0.1, Math.min(8, maxSeconds)) : 8;
    let opened = false;
    try { opened = await this.deps.audioControl(true, AudioInputSource.Glasses); }
    catch { opened = false; }
    this.source = 'glasses';
    if (!opened) {
      try { opened = await this.deps.audioControl(true, AudioInputSource.Phone); }
      catch { opened = false; }
      this.source = 'phone';
    }
    if (!opened) {
      this.deps.send({ type: 'audio_error', detail: 'Microphone could not be opened.' });
      return false;
    }
    this.listening = true;
    this.sequence = 0;
    this.stopTimer = this.setTimer(() => { void this.stop(true); }, duration * 1000);
    return true;
  }

  handleEvent(event: EvenHubEvent): void {
    if (!this.listening || !event.audioEvent || !event.audioEvent.audioPcm.length) return;
    const pcm = event.audioEvent.audioPcm;
    this.deps.send({
      type: 'audio',
      seq: this.sequence++,
      pcm_b64: bytesToBase64(pcm),
      source: sourceName(event.audioEvent.source) ?? this.source,
    });
  }

  async stop(sendEnd: boolean): Promise<void> {
    this.clearTimer(this.stopTimer);
    this.stopTimer = undefined;
    const wasListening = this.listening;
    this.listening = false;
    try { await this.deps.audioControl(false); }
    catch (error) { console.warn('[mic] failed to close audio input', error); }
    if (wasListening && sendEnd && this.deps.isOpen()) this.deps.send({ type: 'audio_end', seq: this.sequence - 1 });
  }

  isListening(): boolean { return this.listening; }
}

export function createMicrophoneController(bridge: Pick<EvenAppBridge, 'audioControl'>, socket: { send(message: PluginMsg): boolean; isOpen(): boolean }): MicrophoneController {
  return new MicrophoneController({ audioControl: (open, source) => bridge.audioControl(open, source), send: message => socket.send(message), isOpen: () => socket.isOpen() });
}

function sourceName(source: AudioInputSource): 'glasses' | 'phone' | undefined {
  if (source === AudioInputSource.Glasses) return 'glasses';
  if (source === AudioInputSource.Phone) return 'phone';
  return undefined;
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  const chunkSize = 0x8000;
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(offset, Math.min(offset + chunkSize, bytes.length)));
  }
  return btoa(binary);
}
