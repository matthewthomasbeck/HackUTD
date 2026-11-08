import { wrapPcmAsWav } from './wav.js';

const MAX_QUESTION_BYTES = 16_000 * 2 * 8;
const NOISE_WINDOW_MS = 300;
const END_SILENCE_MS = 1500;

export class AudioQuestionBuffer {
  private readonly chunks: Buffer[] = [];
  private expectedSequence = 0;
  private bytes = 0;
  private noiseFloor = 0;
  private noiseSamples = 0;
  private speechSeen = false;
  private lastSpeechAt = 0;

  constructor(_startedAt = Date.now(), private readonly maxBytes = MAX_QUESTION_BYTES) {}

  append(sequence: number, pcmBase64: string, now = Date.now()): boolean {
    if (!Number.isSafeInteger(sequence) || sequence !== this.expectedSequence) throw new Error('Audio sequence is out of order.');
    if (!pcmBase64 || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(pcmBase64)) throw new Error('Audio frame is not valid base64.');
    const pcm = Buffer.from(pcmBase64, 'base64');
    if (pcm.length === 0 || pcm.length % 2 !== 0) throw new Error('Audio frame must contain 16-bit PCM samples.');
    if (this.bytes + pcm.length > this.maxBytes) throw new Error('Voice recording exceeds 8 seconds.');
    this.expectedSequence += 1;
    this.bytes += pcm.length;
    this.chunks.push(pcm);
    this.updateSilence(pcm, now);
    return true;
  }

  shouldStopForSilence(now = Date.now()): boolean { return this.speechSeen && now - this.lastSpeechAt >= END_SILENCE_MS; }
  get length(): number { return this.bytes; }
  get lastSequence(): number { return this.expectedSequence - 1; }
  toWav(): Buffer { return wrapPcmAsWav(Buffer.concat(this.chunks, this.bytes)); }

  private updateSilence(pcm: Buffer, now: number): void {
    let squareSum = 0;
    const samples = pcm.length / 2;
    for (let offset = 0; offset < pcm.length; offset += 2) {
      const sample = pcm.readInt16LE(offset) / 32768;
      squareSum += sample * sample;
    }
    const rms = Math.sqrt(squareSum / Math.max(1, samples));
    if (this.noiseSamples < 16_000 * NOISE_WINDOW_MS / 1000) {
      this.noiseFloor = (this.noiseFloor * this.noiseSamples + rms * samples) / (this.noiseSamples + samples);
      this.noiseSamples += samples;
      return;
    }
    if (rms > Math.max(0.02, this.noiseFloor * 2)) {
      this.speechSeen = true;
      this.lastSpeechAt = now;
    }
  }
}
