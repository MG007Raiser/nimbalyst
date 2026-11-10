// @vitest-environment node
import path from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import {
  listHandyModels,
  mapHandyTranscription,
  parseHandyJsonOutput,
  resolveHandyBinary,
  transcribeFileWithHandy,
  type ExecFileLike,
} from '../handyCli';
import { encodePcm16MonoWav, WAV_HEADER_BYTES } from '../wavEncoder';

/** Recorded from Handy 0.9.7 on Windows, 2026-10-29 (log lines on stderr, JSON on stdout). */
const RECORDED_STDERR = [
  '[2026-10-29][13:15:51][handy_app_lib][INFO] Vulkan layer policy: VK_LOADER_LAYERS_DISABLE=Some("~implicit~")',
  '[2026-10-29][13:15:51][handy_app_lib::managers::model][INFO] Seeded 69 catalog model(s) into the registry',
  '[2026-10-29][13:16:01][handy_app_lib::managers::transcription][INFO] Transcription completed in 9.61s for 4.17s of audio (0.43x real-time)',
].join('\n');
const RECORDED_TRANSCRIBE_STDOUT =
  '{"audio_secs":4.165,"best_ms":62,"bound_backend":"Vulkan0","load_ms":595,"model":"handy-computer/parakeet-tdt-0.6b-v2-gguf/parakeet-tdt-0.6b-v2-Q8_0.gguf","requested_device":"settings","rtf":67.17,"text":"Go with your recommendations and start the fix for the model picker.","transcribe_ms":[62]}\n';
const RECORDED_LIST_STDOUT = JSON.stringify([
  {
    id: 'handy-computer/parakeet-unified-en-0.6b-gguf/parakeet-unified-en-0.6b-Q8_0.gguf',
    name: 'Parakeet Unified EN 0.6B',
    engine_type: 'TranscribeCpp',
    size_mb: 697,
    is_downloaded: false,
    is_recommended: true,
    supported_languages: ['en'],
  },
  {
    id: 'handy-computer/parakeet-tdt-0.6b-v2-gguf/parakeet-tdt-0.6b-v2-Q8_0.gguf',
    name: 'Parakeet TDT 0.6B v2',
    engine_type: 'TranscribeCpp',
    size_mb: 695,
    is_downloaded: true,
  },
  { id: 'parakeet-tdt-0.6b-v3', name: 'Parakeet TDT 0.6B v3', engine_type: 'Parakeet', size_mb: 456, is_downloaded: true },
  { name: 'no id, skipped' },
], null, 2);

function fakeExecFile(stdout: string, stderr = '', error: (Error & { killed?: boolean }) | null = null) {
  const calls: Array<{ binary: string; args: string[] }> = [];
  const execFile = ((binary: string, args: string[], _options: unknown, callback: (e: unknown, out: string, err: string) => void) => {
    calls.push({ binary, args });
    setTimeout(() => callback(error, stdout, stderr), 0);
    return { kill: vi.fn() } as unknown as ReturnType<ExecFileLike>;
  }) as unknown as ExecFileLike;
  return { execFile, calls };
}

describe('resolveHandyBinary', () => {
  const win = { platform: 'win32' as const, env: { LOCALAPPDATA: 'C:\\Users\\u\\AppData\\Local', ProgramFiles: 'C:\\Program Files', PATH: 'C:\\tools;C:\\other' } };

  it('prefers a configured path that exists and rejects one that does not', () => {
    expect(resolveHandyBinary('D:\\apps\\handy.exe', { ...win, existsSync: (p) => p === 'D:\\apps\\handy.exe' })).toBe('D:\\apps\\handy.exe');
    expect(resolveHandyBinary('D:\\apps\\handy.exe', { ...win, existsSync: () => false })).toBeUndefined();
  });

  it('finds the per-user Windows install, then PATH, else nothing', () => {
    const perUser = path.join('C:\\Users\\u\\AppData\\Local', 'Handy', 'handy.exe');
    expect(resolveHandyBinary('', { ...win, existsSync: (p) => p === perUser })).toBe(perUser);
    const onPath = path.join('C:\\other', 'handy.exe');
    expect(resolveHandyBinary(undefined, { ...win, existsSync: (p) => p === onPath })).toBe(onPath);
    expect(resolveHandyBinary(undefined, { ...win, existsSync: () => false })).toBeUndefined();
  });

  it('knows the macOS app bundle location', () => {
    const bundle = '/Applications/Handy.app/Contents/MacOS/Handy';
    expect(resolveHandyBinary(undefined, { platform: 'darwin', env: { PATH: '/usr/bin' }, existsSync: (p) => p === bundle })).toBe(bundle);
  });
});

describe('parseHandyJsonOutput', () => {
  it('reads the JSON document even when log noise precedes it', () => {
    expect(parseHandyJsonOutput(`noise line\n${RECORDED_TRANSCRIBE_STDOUT}`)).toMatchObject({ text: expect.any(String) });
    expect(parseHandyJsonOutput(`[INFO] starting\n${RECORDED_LIST_STDOUT}`)).toHaveLength(4);
  });

  it('throws on empty or non-JSON output', () => {
    expect(() => parseHandyJsonOutput('')).toThrow(/no output/);
    expect(() => parseHandyJsonOutput('plain words only')).toThrow(/not JSON/);
  });
});

describe('listHandyModels', () => {
  it('maps the catalog and keeps only entries with an id', async () => {
    const { execFile, calls } = fakeExecFile(RECORDED_LIST_STDOUT, RECORDED_STDERR);

    const models = await listHandyModels('C:\\handy.exe', { execFile });

    expect(calls).toEqual([{ binary: 'C:\\handy.exe', args: ['--list-models', '--json'] }]);
    expect(models.map((model) => [model.id.split('/').pop(), model.isDownloaded, model.engineType])).toEqual([
      ['parakeet-unified-en-0.6b-Q8_0.gguf', false, 'TranscribeCpp'],
      ['parakeet-tdt-0.6b-v2-Q8_0.gguf', true, 'TranscribeCpp'],
      ['parakeet-tdt-0.6b-v3', true, 'Parakeet'],
    ]);
    expect(models[0]).toMatchObject({ name: 'Parakeet Unified EN 0.6B', sizeMb: 697, isRecommended: true, supportedLanguages: ['en'] });
  });

  it('surfaces the last stderr line when the binary fails without output', async () => {
    const { execFile } = fakeExecFile('', 'boot\nmodel registry is locked', Object.assign(new Error('exit 1'), { code: 1 }));
    await expect(listHandyModels('handy', { execFile })).rejects.toThrow('model registry is locked');
  });
});

describe('transcribeFileWithHandy', () => {
  it('passes the wav and the chosen model, and maps the recorded result line', async () => {
    const { execFile, calls } = fakeExecFile(RECORDED_TRANSCRIBE_STDOUT, RECORDED_STDERR);

    const result = await transcribeFileWithHandy('C:\\handy.exe', 'C:\\tmp\\take.wav', { model: 'parakeet-tdt-0.6b-v3' }, { execFile });

    expect(calls[0].args).toEqual(['--transcribe-file', 'C:\\tmp\\take.wav', '--json', '--model', 'parakeet-tdt-0.6b-v3']);
    expect(result).toEqual({
      text: 'Go with your recommendations and start the fix for the model picker.',
      model: 'handy-computer/parakeet-tdt-0.6b-v2-gguf/parakeet-tdt-0.6b-v2-Q8_0.gguf',
      audioSeconds: 4.165,
      loadMs: 595,
      transcribeMs: 62,
    });
  });

  it('omits --model when none is chosen and hands the child to the caller for cancellation', async () => {
    const { execFile, calls } = fakeExecFile(RECORDED_TRANSCRIBE_STDOUT);
    const onChild = vi.fn();
    await transcribeFileWithHandy('handy', '/tmp/take.wav', { onChild }, { execFile });
    expect(calls[0].args).toEqual(['--transcribe-file', '/tmp/take.wav', '--json']);
    expect(onChild).toHaveBeenCalledTimes(1);
  });

  it('reports a kill as a cancellation and a silent failure with the stderr tail', async () => {
    const killed = fakeExecFile('', 'loading', Object.assign(new Error('killed'), { killed: true }));
    await expect(transcribeFileWithHandy('handy', '/tmp/a.wav', {}, { execFile: killed.execFile })).rejects.toThrow(/cancelled or timed out/);
    const failed = fakeExecFile('', 'model parakeet-x is not downloaded', Object.assign(new Error('exit 2'), { code: 2 }));
    await expect(transcribeFileWithHandy('handy', '/tmp/a.wav', {}, { execFile: failed.execFile })).rejects.toThrow('model parakeet-x is not downloaded');
  });

  it('treats an error field in the JSON as a failure and empty text as empty', () => {
    expect(() => mapHandyTranscription({ error: 'no speech detected' })).toThrow('no speech detected');
    expect(mapHandyTranscription({ text: '   ' })).toEqual({ text: '' });
  });
});

describe('encodePcm16MonoWav', () => {
  it('writes a canonical 44-byte header for 16 kHz mono 16-bit samples', () => {
    const samples = new Int16Array([0, 1000, -1000, 32767]);
    const wav = encodePcm16MonoWav(new Uint8Array(samples.buffer), 16_000);

    expect(wav.length).toBe(WAV_HEADER_BYTES + 8);
    expect(wav.toString('ascii', 0, 4)).toBe('RIFF');
    expect(wav.readUInt32LE(4)).toBe(36 + 8);
    expect(wav.toString('ascii', 8, 12)).toBe('WAVE');
    expect(wav.toString('ascii', 12, 16)).toBe('fmt ');
    expect(wav.readUInt16LE(20)).toBe(1);        // PCM
    expect(wav.readUInt16LE(22)).toBe(1);        // mono
    expect(wav.readUInt32LE(24)).toBe(16_000);   // sample rate
    expect(wav.readUInt32LE(28)).toBe(32_000);   // byte rate
    expect(wav.readUInt16LE(32)).toBe(2);        // block align
    expect(wav.readUInt16LE(34)).toBe(16);       // bits per sample
    expect(wav.toString('ascii', 36, 40)).toBe('data');
    expect(wav.readUInt32LE(40)).toBe(8);
    expect(wav.readInt16LE(WAV_HEADER_BYTES + 2)).toBe(1000);
    expect(wav.readInt16LE(WAV_HEADER_BYTES + 6)).toBe(32767);
  });

  it('drops a trailing odd byte and rejects a bad sample rate', () => {
    const wav = encodePcm16MonoWav(new Uint8Array([1, 2, 3]), 16_000);
    expect(wav.readUInt32LE(40)).toBe(2);
    expect(() => encodePcm16MonoWav(new Uint8Array(2), 0)).toThrow(/sample rate/);
  });
});
