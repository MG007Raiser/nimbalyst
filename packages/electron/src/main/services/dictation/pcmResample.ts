/**
 * Linear-interpolation resampler for mono PCM16. The renderer captures
 * dictation at DICTATION_SAMPLE_RATE (24 kHz) for the streaming engines, while
 * Handy's `--transcribe-file` only accepts 16 kHz mono WAV. Speech recognizers
 * are indifferent to the mild aliasing a linear downsample leaves, and this
 * keeps the engine free of native dependencies.
 */

export function resamplePcm16(input: Int16Array, fromRate: number, toRate: number): Int16Array {
  if (!Number.isInteger(fromRate) || !Number.isInteger(toRate) || fromRate <= 0 || toRate <= 0) {
    throw new Error(`[Dictation] invalid sample rates ${fromRate} -> ${toRate}`);
  }
  if (fromRate === toRate || input.length === 0) return input;
  const ratio = fromRate / toRate;
  const outLength = Math.max(1, Math.floor(input.length / ratio));
  const out = new Int16Array(outLength);
  const last = input.length - 1;
  for (let i = 0; i < outLength; i += 1) {
    const position = i * ratio;
    const index = Math.min(last, Math.floor(position));
    const next = Math.min(last, index + 1);
    const fraction = position - index;
    const sample = input[index] * (1 - fraction) + input[next] * fraction;
    out[i] = Math.max(-32768, Math.min(32767, Math.round(sample)));
  }
  return out;
}

/** Interpret a byte buffer of little-endian PCM16 as samples (drops a trailing odd byte). */
export function pcm16BytesToSamples(bytes: Uint8Array): Int16Array {
  const length = bytes.byteLength - (bytes.byteLength % 2);
  const copy = new Uint8Array(length);
  copy.set(bytes.subarray(0, length));
  return new Int16Array(copy.buffer, 0, length / 2);
}
