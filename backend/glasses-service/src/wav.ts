const SAMPLE_RATE = 16_000;
const CHANNELS = 1;
const BITS_PER_SAMPLE = 16;

export function wrapPcmAsWav(pcm: Uint8Array): Buffer {
  const data = Buffer.from(pcm);
  if (data.length % 2 !== 0) throw new Error('PCM byte count must be even for 16-bit samples.');
  const header = Buffer.alloc(44);
  header.write('RIFF', 0); header.writeUInt32LE(36 + data.length, 4); header.write('WAVE', 8);
  header.write('fmt ', 12); header.writeUInt32LE(16, 16); header.writeUInt16LE(1, 20);
  header.writeUInt16LE(CHANNELS, 22); header.writeUInt32LE(SAMPLE_RATE, 24);
  header.writeUInt32LE(SAMPLE_RATE * CHANNELS * BITS_PER_SAMPLE / 8, 28);
  header.writeUInt16LE(CHANNELS * BITS_PER_SAMPLE / 8, 32); header.writeUInt16LE(BITS_PER_SAMPLE, 34);
  header.write('data', 36); header.writeUInt32LE(data.length, 40);
  return Buffer.concat([header, data]);
}

export function validateQuestionWav(wav: Uint8Array, maxSeconds = 8): void {
  const data = Buffer.from(wav);
  if (data.length < 44 || data.toString('ascii', 0, 4) !== 'RIFF' || data.toString('ascii', 8, 12) !== 'WAVE') throw new Error('Expected a WAV file.');
  if (data.toString('ascii', 12, 16) !== 'fmt ' || data.readUInt32LE(16) < 16 || data.readUInt16LE(20) !== 1 || data.readUInt16LE(22) !== CHANNELS || data.readUInt32LE(24) !== SAMPLE_RATE || data.readUInt16LE(34) !== BITS_PER_SAMPLE) {
    throw new Error('Voice WAV must be 16 kHz, mono, signed 16-bit PCM.');
  }
  const dataOffset = data.indexOf('data', 36, 'ascii');
  if (dataOffset < 0 || dataOffset + 8 > data.length) throw new Error('WAV data chunk is missing.');
  const length = data.readUInt32LE(dataOffset + 4);
  if (length > data.length - dataOffset - 8 || length > SAMPLE_RATE * CHANNELS * (BITS_PER_SAMPLE / 8) * maxSeconds) throw new Error('Voice WAV is too large.');
}
