const QUESTION_SAMPLE_RATE = 16_000;
const QUESTION_MAX_SECONDS = 8;

export function encodeQuestionWav(chunks: readonly Float32Array[], sourceRate: number, maxSeconds = QUESTION_MAX_SECONDS): Uint8Array {
  if (!Number.isFinite(sourceRate) || sourceRate < QUESTION_SAMPLE_RATE) throw new Error('Phone audio sample rate is unsupported.');
  const inputLength = chunks.reduce((total, chunk) => total + chunk.length, 0);
  const input = new Float32Array(inputLength);
  let offset = 0;
  for (const chunk of chunks) { input.set(chunk, offset); offset += chunk.length; }
  const sampleCount = Math.min(Math.floor(inputLength * QUESTION_SAMPLE_RATE / sourceRate), QUESTION_SAMPLE_RATE * maxSeconds);
  const pcmBytes = new Uint8Array(sampleCount * 2);
  const view = new DataView(pcmBytes.buffer);
  for (let i = 0; i < sampleCount; i += 1) {
    const position = i * sourceRate / QUESTION_SAMPLE_RATE;
    const before = Math.floor(position);
    const fraction = position - before;
    const a = input[before] ?? 0;
    const b = input[Math.min(before + 1, input.length - 1)] ?? a;
    const sample = Math.max(-1, Math.min(1, a + (b - a) * fraction));
    view.setInt16(i * 2, Math.round(sample < 0 ? sample * 0x8000 : sample * 0x7fff), true);
  }
  const wav = new Uint8Array(44 + pcmBytes.length);
  const header = new DataView(wav.buffer);
  writeAscii(wav, 0, 'RIFF'); header.setUint32(4, 36 + pcmBytes.length, true); writeAscii(wav, 8, 'WAVE');
  writeAscii(wav, 12, 'fmt '); header.setUint32(16, 16, true); header.setUint16(20, 1, true);
  header.setUint16(22, 1, true); header.setUint32(24, QUESTION_SAMPLE_RATE, true); header.setUint32(28, QUESTION_SAMPLE_RATE * 2, true);
  header.setUint16(32, 2, true); header.setUint16(34, 16, true); writeAscii(wav, 36, 'data'); header.setUint32(40, pcmBytes.length, true);
  wav.set(pcmBytes, 44);
  return wav;
}

export interface PhoneRecorderOptions {
  maxSeconds?: number;
  getUserMedia?: () => Promise<MediaStream>;
  makeAudioContext?: () => AudioContext;
  onComplete(wav: Uint8Array): void;
  onError?(error: Error): void;
}

export class PhoneQuestionRecorder {
  private readonly maxSeconds: number;
  private stream: MediaStream | undefined;
  private context: AudioContext | undefined;
  private processor: ScriptProcessorNode | undefined;
  private chunks: Float32Array[] = [];
  private timer: ReturnType<typeof setTimeout> | undefined;
  private active = false;
  private finishing: Promise<Uint8Array> | undefined;
  private startedAtRate = QUESTION_SAMPLE_RATE;

  constructor(private readonly options: PhoneRecorderOptions) { this.maxSeconds = Math.max(1, Math.min(QUESTION_MAX_SECONDS, options.maxSeconds ?? QUESTION_MAX_SECONDS)); }

  async start(): Promise<void> {
    if (this.active) return;
    this.chunks = [];
    this.finishing = undefined;
    const getUserMedia = this.options.getUserMedia ?? (() => navigator.mediaDevices.getUserMedia({ audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true, autoGainControl: true } }));
    const makeAudioContext = this.options.makeAudioContext ?? (() => new AudioContext());
    this.stream = await getUserMedia();
    try {
      this.context = makeAudioContext();
      this.startedAtRate = this.context.sampleRate;
      const source = this.context.createMediaStreamSource(this.stream);
      this.processor = this.context.createScriptProcessor(4096, 1, 1);
      const mute = this.context.createGain();
      mute.gain.value = 0;
      this.processor.onaudioprocess = event => {
        if (!this.active) return;
        const sourceSamples = event.inputBuffer.getChannelData(0);
        const maxSamples = this.startedAtRate * this.maxSeconds;
        const samplesSoFar = this.chunks.reduce((total, chunk) => total + chunk.length, 0);
        const remaining = Math.max(0, Math.ceil(maxSamples - samplesSoFar));
        if (remaining > 0) this.chunks.push(sourceSamples.slice(0, remaining));
        if (samplesSoFar + sourceSamples.length >= maxSamples) void this.finish();
      };
      source.connect(this.processor);
      this.processor.connect(mute);
      mute.connect(this.context.destination);
      this.active = true;
      this.timer = setTimeout(() => { void this.finish(); }, this.maxSeconds * 1000);
    } catch (error) {
      this.stopTracks();
      await this.context?.close().catch(() => undefined);
      this.context = undefined;
      throw error;
    }
  }

  async finish(): Promise<Uint8Array> {
    if (this.finishing) return this.finishing;
    if (!this.active) throw new Error('Phone recording is not active.');
    this.active = false;
    clearTimeout(this.timer);
    this.timer = undefined;
    if (this.processor) { this.processor.onaudioprocess = null; this.processor.disconnect(); }
    this.stopTracks();
    this.finishing = (async () => {
      await this.context?.close();
      this.context = undefined;
      const wav = encodeQuestionWav(this.chunks, this.startedAtRate, this.maxSeconds);
      this.chunks = [];
      this.options.onComplete(wav);
      return wav;
    })().catch(error => {
      const value = error instanceof Error ? error : new Error(String(error));
      this.options.onError?.(value);
      throw value;
    });
    return this.finishing;
  }

  isRecording(): boolean { return this.active; }

  private stopTracks(): void { for (const track of this.stream?.getTracks() ?? []) track.stop(); this.stream = undefined; }
}

function writeAscii(target: Uint8Array, offset: number, value: string): void { for (let i = 0; i < value.length; i += 1) target[offset + i] = value.charCodeAt(i); }
