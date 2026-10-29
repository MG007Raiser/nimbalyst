/**
 * Press-to-talk recorder for the composer's dictation button. Captures mono
 * audio and returns 16 kHz PCM16, which is what Handy's headless transcriber
 * expects. Sibling of `audioCapture.ts` (24 kHz streaming for voice mode);
 * kept separate because this one buffers a whole take and never streams.
 */

export const DICTATION_SAMPLE_RATE = 16_000;

export interface DictationTake {
  pcm16: Uint8Array;
  sampleRate: number;
  durationMs: number;
}

/** Linear-interpolation resample; good enough for speech going to an ASR model. */
export function resampleFloat32(input: Float32Array, fromRate: number, toRate: number): Float32Array {
  if (fromRate === toRate || input.length === 0) return input;
  const ratio = fromRate / toRate;
  const outLength = Math.max(1, Math.floor(input.length / ratio));
  const output = new Float32Array(outLength);
  for (let i = 0; i < outLength; i += 1) {
    const position = i * ratio;
    const index = Math.floor(position);
    const next = Math.min(index + 1, input.length - 1);
    const fraction = position - index;
    output[i] = input[index] * (1 - fraction) + input[next] * fraction;
  }
  return output;
}

export function floatToPcm16(input: Float32Array): Int16Array {
  const out = new Int16Array(input.length);
  for (let i = 0; i < input.length; i += 1) {
    const clamped = Math.max(-1, Math.min(1, input[i]));
    out[i] = clamped < 0 ? clamped * 0x8000 : clamped * 0x7fff;
  }
  return out;
}

export class DictationRecorder {
  private mediaStream: MediaStream | null = null;
  private audioContext: AudioContext | null = null;
  private sourceNode: MediaStreamAudioSourceNode | null = null;
  private processorNode: ScriptProcessorNode | null = null;
  private chunks: Float32Array[] = [];
  private startedAt = 0;
  private recording = false;

  get isRecording(): boolean {
    return this.recording;
  }

  async start(): Promise<void> {
    if (this.recording) throw new Error('Dictation already recording');
    try {
      this.mediaStream = await navigator.mediaDevices.getUserMedia({
        audio: { channelCount: 1, sampleRate: DICTATION_SAMPLE_RATE, echoCancellation: true, noiseSuppression: true, autoGainControl: true },
      });
      // Chromium resamples to the requested context rate; if a device refuses,
      // the actual rate is read back and the take is resampled on stop().
      this.audioContext = new AudioContext({ sampleRate: DICTATION_SAMPLE_RATE });
      await this.audioContext.resume();
      this.sourceNode = this.audioContext.createMediaStreamSource(this.mediaStream);
      this.processorNode = this.audioContext.createScriptProcessor(4096, 1, 1);
      this.processorNode.onaudioprocess = (event) => {
        if (!this.recording) return;
        this.chunks.push(new Float32Array(event.inputBuffer.getChannelData(0)));
      };
      this.sourceNode.connect(this.processorNode);
      this.processorNode.connect(this.audioContext.destination);
      this.chunks = [];
      this.startedAt = Date.now();
      this.recording = true;
    } catch (error) {
      this.cleanup();
      throw error;
    }
  }

  /** Stop and return the whole take as 16 kHz PCM16. */
  async stop(): Promise<DictationTake> {
    if (!this.recording) throw new Error('Dictation is not recording');
    this.recording = false;
    const contextRate = this.audioContext?.sampleRate ?? DICTATION_SAMPLE_RATE;
    const durationMs = Date.now() - this.startedAt;
    const chunks = this.chunks;
    this.chunks = [];
    this.cleanup();

    const total = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
    const joined = new Float32Array(total);
    let offset = 0;
    for (const chunk of chunks) {
      joined.set(chunk, offset);
      offset += chunk.length;
    }
    const resampled = resampleFloat32(joined, contextRate, DICTATION_SAMPLE_RATE);
    const pcm16 = floatToPcm16(resampled);
    return { pcm16: new Uint8Array(pcm16.buffer), sampleRate: DICTATION_SAMPLE_RATE, durationMs };
  }

  /** Stop without producing a take. */
  cancel(): void {
    this.recording = false;
    this.chunks = [];
    this.cleanup();
  }

  private cleanup(): void {
    try { this.processorNode?.disconnect(); } catch { /* noop */ }
    try { this.sourceNode?.disconnect(); } catch { /* noop */ }
    this.mediaStream?.getTracks().forEach((track) => track.stop());
    const context = this.audioContext;
    this.processorNode = null;
    this.sourceNode = null;
    this.mediaStream = null;
    this.audioContext = null;
    if (context && context.state !== 'closed') {
      context.close().catch(() => {});
    }
  }
}
