/**
 * Bridge to Handy (https://github.com/cjpais/Handy), the open-source offline
 * speech-to-text app. Handy exposes a headless CLI:
 *
 *   handy --list-models --json                      catalog with is_downloaded
 *   handy --transcribe-file <wav> --json [--model]  one JSON result line
 *
 * Log lines go to stderr; stdout carries the JSON. The model must already be
 * downloaded inside Handy (the CLI never downloads). Measured on Windows with
 * a Parakeet model: about 0.6 s model load plus tens of milliseconds of
 * transcription per call, so a press-to-talk button is comfortable.
 *
 * Nothing here touches the microphone or the composer; the renderer records,
 * main writes the WAV and runs Handy, the text goes back over IPC.
 */

import { execFile as nodeExecFile, type ChildProcess } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

export interface HandyModel {
  id: string;
  name: string;
  engineType: string;
  isDownloaded: boolean;
  sizeMb?: number;
  supportedLanguages?: string[];
  isRecommended?: boolean;
}

export interface HandyTranscription {
  text: string;
  model?: string;
  audioSeconds?: number;
  loadMs?: number;
  transcribeMs?: number;
}

export type ExecFileLike = typeof nodeExecFile;

export interface HandyCliDeps {
  execFile?: ExecFileLike;
  existsSync?: (candidate: string) => boolean;
  env?: NodeJS.ProcessEnv;
  platform?: NodeJS.Platform;
}

export const HANDY_LIST_TIMEOUT_MS = 20_000;
export const HANDY_TRANSCRIBE_TIMEOUT_MS = 90_000;

/**
 * Where Handy's installers put the binary. An explicit setting wins; then the
 * per-user install locations; then a bare `handy` on PATH.
 */
export function resolveHandyBinary(configuredPath: string | undefined, deps: HandyCliDeps = {}): string | undefined {
  const existsSync = deps.existsSync ?? fs.existsSync;
  const env = deps.env ?? process.env;
  const platform = deps.platform ?? process.platform;

  const configured = configuredPath?.trim();
  if (configured) {
    return existsSync(configured) ? configured : undefined;
  }

  const candidates: string[] = [];
  if (platform === 'win32') {
    const localAppData = env.LOCALAPPDATA;
    if (localAppData) {
      candidates.push(path.join(localAppData, 'Handy', 'handy.exe'));
      candidates.push(path.join(localAppData, 'Programs', 'Handy', 'Handy.exe'));
    }
    if (env.ProgramFiles) candidates.push(path.join(env.ProgramFiles, 'Handy', 'Handy.exe'));
  } else if (platform === 'darwin') {
    candidates.push('/Applications/Handy.app/Contents/MacOS/Handy');
    if (env.HOME) candidates.push(path.join(env.HOME, 'Applications', 'Handy.app', 'Contents', 'MacOS', 'Handy'));
  }
  for (const candidate of candidates) {
    if (existsSync(candidate)) return candidate;
  }

  const binName = platform === 'win32' ? 'handy.exe' : 'handy';
  const pathEntries = (env.PATH ?? env.Path ?? '').split(path.delimiter).filter(Boolean);
  for (const entry of pathEntries) {
    const candidate = path.join(entry, binName);
    if (existsSync(candidate)) return candidate;
  }
  return undefined;
}

/** First JSON document on stdout; Handy prints it after its stderr log lines. */
export function parseHandyJsonOutput(stdout: string): unknown {
  const text = stdout.trim();
  if (!text) throw new Error('Handy produced no output');
  // Handy's own log lines go to stderr, but a wrapper or shell may fold them
  // in. Try every `[` / `{` start position in order until one parses as a
  // document that runs to the end of the output (the model list is one
  // pretty-printed array; the transcribe result is one line).
  const MAX_STARTS = 64;
  let tried = 0;
  for (let index = 0; index < text.length && tried < MAX_STARTS; index += 1) {
    const char = text[index];
    if (char !== '[' && char !== '{') continue;
    tried += 1;
    try {
      return JSON.parse(text.slice(index));
    } catch {
      // not the document start
    }
  }
  // Last resort: a single JSON line followed by trailing noise.
  const lines = text.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  for (let index = lines.length - 1; index >= 0; index -= 1) {
    const line = lines[index];
    if (!line.startsWith('{') && !line.startsWith('[')) continue;
    try {
      return JSON.parse(line);
    } catch {
      // keep looking
    }
  }
  throw new Error(`Handy output is not JSON: ${text.slice(0, 200)}`);
}

export function mapHandyModels(raw: unknown): HandyModel[] {
  if (!Array.isArray(raw)) return [];
  const models: HandyModel[] = [];
  for (const entry of raw) {
    if (!entry || typeof entry !== 'object') continue;
    const record = entry as Record<string, unknown>;
    const id = typeof record.id === 'string' ? record.id : undefined;
    if (!id) continue;
    models.push({
      id,
      name: typeof record.name === 'string' && record.name ? record.name : id,
      engineType: typeof record.engine_type === 'string' ? record.engine_type : 'unknown',
      isDownloaded: record.is_downloaded === true,
      ...(typeof record.size_mb === 'number' ? { sizeMb: record.size_mb } : {}),
      ...(Array.isArray(record.supported_languages)
        ? { supportedLanguages: (record.supported_languages as unknown[]).filter((v): v is string => typeof v === 'string') }
        : {}),
      ...(record.is_recommended === true ? { isRecommended: true } : {}),
    });
  }
  return models;
}

export function mapHandyTranscription(raw: unknown): HandyTranscription {
  if (!raw || typeof raw !== 'object') throw new Error('Handy returned no transcription');
  const record = raw as Record<string, unknown>;
  if (typeof record.error === 'string' && record.error) throw new Error(record.error);
  const text = typeof record.text === 'string' ? record.text.trim() : '';
  const transcribeMs = Array.isArray(record.transcribe_ms) && typeof record.transcribe_ms[0] === 'number'
    ? (record.transcribe_ms[0] as number)
    : typeof record.transcribe_ms === 'number' ? record.transcribe_ms : undefined;
  return {
    text,
    ...(typeof record.model === 'string' ? { model: record.model } : {}),
    ...(typeof record.audio_secs === 'number' ? { audioSeconds: record.audio_secs } : {}),
    ...(typeof record.load_ms === 'number' ? { loadMs: record.load_ms } : {}),
    ...(transcribeMs !== undefined ? { transcribeMs } : {}),
  };
}

interface RunResult {
  stdout: string;
  stderr: string;
  error: (Error & { killed?: boolean; code?: number | string }) | null;
}

function run(
  binary: string,
  args: string[],
  timeoutMs: number,
  deps: HandyCliDeps,
  onChild?: (child: ChildProcess) => void,
): Promise<RunResult> {
  const execFile = deps.execFile ?? nodeExecFile;
  return new Promise((resolve) => {
    // Explicit callback rather than promisify so a mocked child_process still
    // sees the call at the test boundary.
    const child = execFile(
      binary,
      args,
      { timeout: timeoutMs, maxBuffer: 8 * 1024 * 1024, encoding: 'utf8', windowsHide: true, env: deps.env ?? process.env },
      (error, stdout, stderr) => {
        resolve({ stdout: String(stdout ?? ''), stderr: String(stderr ?? ''), error: error as RunResult['error'] });
      },
    );
    onChild?.(child);
  });
}

function lastStderrLine(stderr: string): string {
  const lines = stderr.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  return lines[lines.length - 1] ?? '';
}

export async function listHandyModels(binary: string, deps: HandyCliDeps = {}): Promise<HandyModel[]> {
  const result = await run(binary, ['--list-models', '--json'], HANDY_LIST_TIMEOUT_MS, deps);
  if (result.error && !result.stdout.trim()) {
    throw new Error(`Handy could not list models: ${lastStderrLine(result.stderr) || result.error.message}`);
  }
  return mapHandyModels(parseHandyJsonOutput(result.stdout));
}

export interface TranscribeFileOptions {
  model?: string;
  timeoutMs?: number;
  onChild?: (child: ChildProcess) => void;
}

export async function transcribeFileWithHandy(
  binary: string,
  wavPath: string,
  options: TranscribeFileOptions = {},
  deps: HandyCliDeps = {},
): Promise<HandyTranscription> {
  const args = ['--transcribe-file', wavPath, '--json'];
  if (options.model?.trim()) args.push('--model', options.model.trim());
  const result = await run(binary, args, options.timeoutMs ?? HANDY_TRANSCRIBE_TIMEOUT_MS, deps, options.onChild);
  if (result.error?.killed) {
    throw new Error('Handy transcription was cancelled or timed out');
  }
  if (result.error && !result.stdout.trim()) {
    throw new Error(`Handy transcription failed: ${lastStderrLine(result.stderr) || result.error.message}`);
  }
  return mapHandyTranscription(parseHandyJsonOutput(result.stdout));
}
