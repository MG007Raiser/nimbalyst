/**
 * Dictation IPC: the composer's microphone button records in the renderer,
 * main writes the take to a temp WAV, runs Handy headlessly and returns the
 * text. See `services/dictation/handyCli.ts` for the Handy contract.
 */

import { app } from 'electron';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { ChildProcess } from 'node:child_process';
import { safeHandle } from '../utils/ipcRegistry';
import { getSettingsService } from '../services/SettingsService';
import {
  listHandyModels,
  resolveHandyBinary,
  transcribeFileWithHandy,
  type HandyModel,
  type HandyTranscription,
} from '../services/dictation/handyCli';
import { encodePcm16MonoWav } from '../services/dictation/wavEncoder';

export interface DictationStatus {
  available: boolean;
  binaryPath?: string;
  configuredPath: string;
  model: string;
  reason?: string;
}

export interface DictationTranscribeRequest {
  pcm16: Uint8Array;
  sampleRate: number;
}

export type DictationTranscribeResult =
  | { success: true; text: string; timings: Pick<HandyTranscription, 'audioSeconds' | 'loadMs' | 'transcribeMs'>; model?: string }
  | { success: false; error: string; cancelled?: boolean };

const MAX_TAKE_BYTES = 16_000 * 2 * 60 * 10; // ten minutes of 16 kHz PCM16

let activeChild: ChildProcess | null = null;
let activeCancelled = false;

function readConfig(): { configuredPath: string; model: string } {
  const settings = getSettingsService();
  return {
    configuredPath: settings.get('dictation.handyPath'),
    model: settings.get('dictation.model'),
  };
}

export function getDictationStatus(): DictationStatus {
  const { configuredPath, model } = readConfig();
  const binaryPath = resolveHandyBinary(configuredPath);
  if (!binaryPath) {
    return {
      available: false,
      configuredPath,
      model,
      reason: configuredPath
        ? `Handy was not found at ${configuredPath}`
        : 'Handy is not installed (looked in the per-user install folder and PATH)',
    };
  }
  return { available: true, binaryPath, configuredPath, model };
}

async function tempWavPath(): Promise<string> {
  const dir = path.join(app.getPath('temp'), 'nimbalyst-dictation');
  await fs.mkdir(dir, { recursive: true });
  const stamp = `${Date.now()}-${process.pid}-${Math.random().toString(36).slice(2, 8)}`;
  return path.join(dir, `take-${stamp}.wav`);
}

export async function transcribeTake(request: DictationTranscribeRequest): Promise<DictationTranscribeResult> {
  if (!request || !(request.pcm16 instanceof Uint8Array) || request.pcm16.byteLength === 0) {
    throw new Error('[Dictation] transcribe called without audio');
  }
  if (!Number.isInteger(request.sampleRate) || request.sampleRate <= 0) {
    throw new Error('[Dictation] transcribe called without a sample rate');
  }
  if (request.pcm16.byteLength > MAX_TAKE_BYTES) {
    return { success: false, error: 'The recording is longer than ten minutes; split it into shorter takes.' };
  }
  const status = getDictationStatus();
  if (!status.available || !status.binaryPath) {
    return { success: false, error: status.reason ?? 'Handy is not available' };
  }
  if (activeChild) {
    return { success: false, error: 'A transcription is already running' };
  }

  const wavPath = await tempWavPath();
  activeCancelled = false;
  try {
    await fs.writeFile(wavPath, encodePcm16MonoWav(request.pcm16, request.sampleRate));
    const result = await transcribeFileWithHandy(
      status.binaryPath,
      wavPath,
      {
        model: status.model || undefined,
        onChild: (child) => { activeChild = child; },
      },
    );
    return {
      success: true,
      text: result.text,
      timings: { audioSeconds: result.audioSeconds, loadMs: result.loadMs, transcribeMs: result.transcribeMs },
      ...(result.model ? { model: result.model } : {}),
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.warn('[Dictation] transcription failed:', message);
    return { success: false, error: message, ...(activeCancelled ? { cancelled: true } : {}) };
  } finally {
    activeChild = null;
    fs.rm(wavPath, { force: true }).catch(() => {});
  }
}

export function cancelTranscription(): boolean {
  if (!activeChild) return false;
  activeCancelled = true;
  try {
    activeChild.kill();
  } catch {
    // Already gone.
  }
  return true;
}

export async function listDictationModels(): Promise<{ success: true; models: HandyModel[] } | { success: false; error: string }> {
  const status = getDictationStatus();
  if (!status.available || !status.binaryPath) {
    return { success: false, error: status.reason ?? 'Handy is not available' };
  }
  try {
    return { success: true, models: await listHandyModels(status.binaryPath) };
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : String(error) };
  }
}

export function registerDictationHandlers(): void {
  safeHandle('dictation:status', async () => getDictationStatus());
  safeHandle('dictation:list-models', async () => listDictationModels());
  safeHandle('dictation:transcribe', async (_event, request: DictationTranscribeRequest) => transcribeTake(request));
  safeHandle('dictation:cancel', async () => ({ cancelled: cancelTranscription() }));
  safeHandle('dictation:detect', async () => {
    // The auto-detected path, ignoring the configured override, for the settings panel.
    const detected = resolveHandyBinary('');
    return { path: detected ?? '', hostname: os.hostname() };
  });
}
