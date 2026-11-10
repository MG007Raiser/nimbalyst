/**
 * Minimal PCM16 mono WAV writer for the dictation bridge. Handy's headless
 * transcriber (`handy --transcribe-file`) takes a 16 kHz mono WAV, so the
 * renderer's recorder hands over raw 16-bit samples and this wraps them in
 * the 44-byte RIFF header. Pure, so the layout is unit-tested byte by byte.
 */

export const WAV_HEADER_BYTES = 44;

export function encodePcm16MonoWav(pcm16: Uint8Array, sampleRate: number): Buffer {
  if (!Number.isInteger(sampleRate) || sampleRate <= 0) {
    throw new Error(`[Dictation] invalid sample rate ${sampleRate}`);
  }
  const channels = 1;
  const bitsPerSample = 16;
  const blockAlign = (channels * bitsPerSample) / 8;
  const byteRate = sampleRate * blockAlign;
  const dataBytes = pcm16.byteLength - (pcm16.byteLength % blockAlign);

  const header = Buffer.alloc(WAV_HEADER_BYTES);
  header.write('RIFF', 0, 'ascii');
  header.writeUInt32LE(36 + dataBytes, 4);
  header.write('WAVE', 8, 'ascii');
  header.write('fmt ', 12, 'ascii');
  header.writeUInt32LE(16, 16);            // PCM fmt chunk size
  header.writeUInt16LE(1, 20);             // audio format: PCM
  header.writeUInt16LE(channels, 22);
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(byteRate, 28);
  header.writeUInt16LE(blockAlign, 32);
  header.writeUInt16LE(bitsPerSample, 34);
  header.write('data', 36, 'ascii');
  header.writeUInt32LE(dataBytes, 40);

  return Buffer.concat([header, Buffer.from(pcm16.buffer, pcm16.byteOffset, dataBytes)]);
}
