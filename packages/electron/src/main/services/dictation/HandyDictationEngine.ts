import type { ChildProcess } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { DICTATION_SAMPLE_RATE } from '../../../shared/dictation';
import type {
  DictationEngine,
  DictationEngineCallbacks,
  DictationEngineSession,
  DictationEngineStartOptions,
  DictationEngineStartResult,
} from './DictationEngine';
import {
  resolveHandyBinary,
  transcribeFileWithHandy,
  type HandyTranscription,
  type TranscribeFileOptions,
} from './handyCli';
import { pcm16BytesToSamples, resamplePcm16 } from './pcmResample';
import { encodePcm16MonoWav } from './wavEncoder';

/**
 * Offline dictation through Handy (https://github.com/cjpais/Handy), the
 * open-source speech-to-text app, on any platform where it is installed.
 *
 * Handy's headless CLI transcribes a finished WAV file rather than a stream,
 * so this engine is a batch engine: it buffers the renderer's audio for the
 * whole dictation, emits no partials, and on stop writes the audio to a
 * temporary 16 kHz WAV, runs `handy --transcribe-file`, and emits the result
 * as a single final. Nothing leaves the machine. The model must already be
 * downloaded inside Handy; the CLI never downloads.
 */
const HANDY_SAMPLE_RATE = 16_000;
/** Below this much audio Handy has nothing to work with (about 0.2 s). */
const MIN_AUDIO_BYTES = (DICTATION_SAMPLE_RATE * 2) / 5;

export interface HandyEngineDeps {
  /** The Settings > Dictation path override; empty means auto-detect. */
  getConfiguredPath(): string | undefined;
  /** The Settings > Dictation model id; empty means the model selected inside Handy. */
  getModel(): string | undefined;
  log(message: string): void;
  /** Test seams. */
  resolveBinary?(configuredPath: string | undefined): string | undefined;
  transcribe?(binary: string, wavPath: string, options: TranscribeFileOptions): Promise<HandyTranscription>;
  writeFile?(filePath: string, data: Buffer): Promise<void>;
  removeFile?(filePath: string): Promise<void>;
  tempDir?: string;
}

export class HandyDictationEngine implements DictationEngine {
  readonly id = 'handy' as const;
  private children = new Set<ChildProcess>();

  constructor(private readonly deps: HandyEngineDeps) {}

  private resolveBinary(): string | undefined {
    const resolve = this.deps.resolveBinary ?? resolveHandyBinary;
    return resolve(this.deps.getConfiguredPath());
  }

  isAvailable(): boolean {
    return this.resolveBinary() !== undefined;
  }

  start(options: DictationEngineStartOptions, callbacks: DictationEngineCallbacks): Promise<DictationEngineStartResult> {
    const binary = this.resolveBinary();
    if (!binary) return Promise.resolve({ ok: false, reason: 'no-engine' });

    const transcribe = this.deps.transcribe ?? transcribeFileWithHandy;
    const writeFile = this.deps.writeFile ?? ((filePath: string, data: Buffer) => fs.writeFile(filePath, data));
    const removeFile = this.deps.removeFile ?? ((filePath: string) => fs.rm(filePath, { force: true }));
    const wavPath = path.join(this.deps.tempDir ?? os.tmpdir(), `nimbalyst-dictation-${options.dictationId}.wav`);
    const model = this.deps.getModel()?.trim() || undefined;

    const chunks: Buffer[] = [];
    let stopping = false;
    let ended = false;
    let child: ChildProcess | null = null;

    const end = () => {
      if (ended) return;
      ended = true;
      if (child) this.children.delete(child);
      callbacks.onEnded();
    };

    const finishTranscription = async () => {
      const pcm24k = Buffer.concat(chunks);
      chunks.length = 0;
      if (pcm24k.length < MIN_AUDIO_BYTES) {
        end();
        return;
      }
      const samples = resamplePcm16(pcm16BytesToSamples(pcm24k), DICTATION_SAMPLE_RATE, HANDY_SAMPLE_RATE);
      const wav = encodePcm16MonoWav(new Uint8Array(samples.buffer, samples.byteOffset, samples.byteLength), HANDY_SAMPLE_RATE);
      const startedAt = Date.now();
      try {
        await writeFile(wavPath, wav);
        const result = await transcribe(binary, wavPath, {
          model,
          onChild: (process) => {
            child = process;
            this.children.add(process);
          },
        });
        this.deps.log(
          `[Dictation] Handy transcribed audio=${result.audioSeconds ?? '?'}s load=${result.loadMs ?? '?'}ms ` +
            `transcribe=${result.transcribeMs ?? '?'}ms total=${Date.now() - startedAt}ms model=${result.model ?? 'default'}`,
        );
        if (result.text) callbacks.onEvent({ type: 'final', text: result.text });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        this.deps.log(`[Dictation] Handy transcription failed: ${message}`);
        callbacks.onEvent({ type: 'error', message });
      } finally {
        await removeFile(wavPath).catch(() => {});
        end();
      }
    };

    const session: DictationEngineSession = {
      pushAudio: (base64Pcm16) => {
        if (ended || stopping) return;
        chunks.push(Buffer.from(base64Pcm16, 'base64'));
      },
      stop: (cancel) => {
        if (ended || stopping) return;
        stopping = true;
        if (cancel) {
          chunks.length = 0;
          end();
          return;
        }
        void finishTranscription();
      },
    };

    this.deps.log(`[Dictation] Handy ready binary=${binary} model=${model ?? 'default'}`);
    // Resolve first so the controller holds the session before 'ready' lands.
    queueMicrotask(() => {
      if (!ended) callbacks.onEvent({ type: 'ready' });
    });
    return Promise.resolve({ ok: true, session });
  }

  dispose(): void {
    for (const child of this.children) {
      try {
        child.kill();
      } catch {
        // already gone
      }
    }
    this.children.clear();
  }
}
