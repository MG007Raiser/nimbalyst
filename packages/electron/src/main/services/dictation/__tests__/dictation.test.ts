// @vitest-environment node
import { EventEmitter } from 'events';
import { PassThrough } from 'stream';
import { describe, expect, it, vi } from 'vitest';
import type { DictationEvent, DictationSettings } from '../../../../shared/dictation';
import { DictationController, type DictationTarget } from '../DictationController';
import { selectDictationEngine, type DictationEngine } from '../DictationEngine';
import { HandyDictationEngine, type HandyEngineDeps } from '../HandyDictationEngine';
import type { TranscribeFileOptions } from '../handyCli';
import { createLineSplitter, parseHelperLine } from '../helperProtocol';
import { OnDeviceDictationEngine } from '../OnDeviceDictationEngine';
import { pcm16BytesToSamples, resamplePcm16 } from '../pcmResample';

/** Minimal stand-in for the Swift helper's ChildProcess. */
function fakeHelper() {
  const proc = new EventEmitter() as any;
  proc.stdout = new PassThrough();
  proc.stderr = new PassThrough();
  proc.stdin = new PassThrough();
  proc.exitCode = null;
  proc.killed = false;
  proc.kill = vi.fn(() => { proc.killed = true; });
  const commands: any[] = [];
  const split = createLineSplitter((line) => { if (line) commands.push(JSON.parse(line)); });
  proc.stdin.on('data', split);
  proc.commands = commands;
  proc.reply = (message: object) => proc.stdout.write(JSON.stringify(message) + '\n');
  return proc;
}

function onDeviceEngine(spawnHelper: () => any) {
  return new OnDeviceDictationEngine({
    platform: 'darwin',
    osRelease: '25.0.0',
    helperPath: '/fake/nimbalyst-dictation',
    fileExists: () => true,
    spawnHelper,
    log: () => {},
  });
}

function stubEngine(id: 'on-device' | 'openai' | 'handy', available: boolean): DictationEngine {
  return { id, isAvailable: () => available, start: vi.fn(), dispose: vi.fn() } as unknown as DictationEngine;
}

const none = { system: false, onDevice: false, openai: false, handy: false };

/** A HandyDictationEngine with the CLI, file system and binary lookup faked. */
function handyEngine(overrides: Partial<HandyEngineDeps> = {}) {
  const written = new Map<string, Buffer>();
  const removed: string[] = [];
  const transcribe = vi.fn(async (_binary: string, wavPath: string, _options: TranscribeFileOptions) => ({
    text: `heard:${written.get(wavPath)?.length ?? 0}`,
  }));
  const engine = new HandyDictationEngine({
    getConfiguredPath: () => undefined,
    getModel: () => 'parakeet',
    resolveBinary: () => 'C:/Handy/handy.exe',
    transcribe,
    writeFile: async (filePath, data) => { written.set(filePath, data); },
    removeFile: async (filePath) => { removed.push(filePath); },
    tempDir: 'C:/tmp',
    log: () => {},
    ...overrides,
  });
  return { engine, transcribe, written, removed };
}

/** 24 kHz PCM16 of the given duration, base64 as the renderer sends it. */
function audioChunk(seconds: number): string {
  return Buffer.alloc(Math.round(24000 * 2 * seconds), 1).toString('base64');
}

function target(events: DictationEvent[]): DictationTarget {
  return { id: 1, isDestroyed: () => false, sendEvent: (event) => events.push(event) };
}

const tick = () => new Promise((resolve) => setImmediate(resolve));

describe('dictation helper protocol', () => {
  it('reassembles JSON lines split across stdout chunks and drops malformed ones', () => {
    const messages: unknown[] = [];
    const feed = createLineSplitter((line) => {
      const message = parseHelperLine(line);
      if (message) messages.push(message);
    });
    feed('{"type":"partial","id":"d1","te');
    feed('xt":"hello"}\nnot json\n{"type":"final","id":"d1","text":"hello world"}\n{"type":"ended"');
    feed(',"id":"d1"}\n{"type":"partial","id":"d1"}\n');

    expect(messages).toEqual([
      { type: 'partial', id: 'd1', text: 'hello' },
      { type: 'final', id: 'd1', text: 'hello world' },
      { type: 'ended', id: 'd1' },
    ]);
  });
});

describe('dictation engine selection', () => {
  it('auto prefers on-device, then Handy, then OpenAI, and explicit choices never fall back', () => {
    expect(selectDictationEngine('auto', { ...none, onDevice: true, openai: true, handy: true })).toBe('on-device');
    expect(selectDictationEngine('auto', { ...none, openai: true, handy: true })).toBe('handy');
    expect(selectDictationEngine('auto', { ...none, openai: true })).toBe('openai');
    expect(selectDictationEngine('auto', none)).toBeNull();
    expect(selectDictationEngine('on-device', { ...none, openai: true, handy: true })).toBeNull();
    expect(selectDictationEngine('handy', { ...none, onDevice: true, openai: true })).toBeNull();
    expect(selectDictationEngine('handy', { ...none, handy: true })).toBe('handy');
    expect(selectDictationEngine('openai', { ...none, onDevice: true, handy: true })).toBeNull();
  });

  it('on-device is unavailable off macOS, before macOS 13, or without the helper binary', () => {
    const make = (platform: NodeJS.Platform, osRelease: string, exists: boolean) => new OnDeviceDictationEngine({
      platform, osRelease, helperPath: '/x', fileExists: () => exists, spawnHelper: vi.fn(), log: () => {},
    }).isAvailable();
    expect(make('darwin', '25.1.0', true)).toBe(true);
    expect(make('win32', '10.0.0', true)).toBe(false);
    expect(make('darwin', '21.6.0', true)).toBe(false);
    expect(make('darwin', '25.1.0', false)).toBe(false);
  });
});

describe('DictationController', () => {
  function controllerWith(
    settings: DictationSettings,
    onDevice: DictationEngine,
    extra: Partial<{ voice: boolean; mic: boolean; handy: DictationEngine }> = {},
  ) {
    const ensureMicrophoneAccess = vi.fn(async () => extra.mic ?? true);
    const controller = new DictationController({
      getSettings: () => settings,
      engines: { 'on-device': onDevice, openai: stubEngine('openai', false), handy: extra.handy ?? stubEngine('handy', false) },
      isVoiceModeActive: () => extra.voice ?? false,
      ensureMicrophoneAccess,
      log: () => {},
      platform: 'darwin',
    });
    return { controller, ensureMicrophoneAccess };
  }

  it('returns disabled without asking for the mic or launching the helper', async () => {
    const spawnHelper = vi.fn(fakeHelper);
    const { controller, ensureMicrophoneAccess } = controllerWith({ enabled: false, engine: 'auto' }, onDeviceEngine(spawnHelper));

    await expect(controller.start(target([]), { dictationId: 'd1' })).resolves.toEqual({ ok: false, reason: 'disabled' });
    expect(spawnHelper).not.toHaveBeenCalled();
    expect(ensureMicrophoneAccess).not.toHaveBeenCalled();
  });

  it('returns no-engine when nothing is available and busy while Voice Mode is active', async () => {
    const none = controllerWith({ enabled: true, engine: 'auto' }, stubEngine('on-device', false));
    await expect(none.controller.start(target([]), { dictationId: 'd1' })).resolves.toEqual({ ok: false, reason: 'no-engine' });

    const spawnHelper = vi.fn(fakeHelper);
    const voice = controllerWith({ enabled: true, engine: 'auto' }, onDeviceEngine(spawnHelper), { voice: true });
    await expect(voice.controller.start(target([]), { dictationId: 'd1' })).resolves.toEqual({ ok: false, reason: 'busy' });
    expect(spawnHelper).not.toHaveBeenCalled();
  });

  it('runs an on-device dictation end to end and ends once when the helper dies', async () => {
    const helper = fakeHelper();
    const { controller } = controllerWith({ enabled: true, engine: 'auto', language: 'en-US' }, onDeviceEngine(() => helper));
    const events: DictationEvent[] = [];

    const started = controller.start(target(events), { dictationId: 'd1', contextStrings: ['DictationService', 'DictationService', ''] });
    await tick();
    expect(helper.commands[0]).toEqual({ type: 'start', id: 'd1', locale: 'en-US', contextualStrings: ['DictationService'] });

    helper.reply({ type: 'ready', id: 'd1' });
    await expect(started).resolves.toEqual({ ok: true, engine: 'on-device' });

    controller.audio(target(events), 'd1', 'AAAA');
    controller.audio(target(events), 'other', 'BBBB');
    helper.reply({ type: 'partial', id: 'd1', text: 'hel' });
    helper.reply({ type: 'final', id: 'd1', text: 'hello' });
    await tick();
    expect(helper.commands.filter((c: any) => c.type === 'audio')).toEqual([{ type: 'audio', id: 'd1', data: 'AAAA' }]);

    helper.exitCode = 1;
    helper.emit('exit', 1, null);
    await tick();
    expect(events.map((e) => e.type)).toEqual(['ready', 'partial', 'final', 'error', 'ended']);
    expect(controller.isActive()).toBe(false);
  });

  it('maps a helper speech-permission error to speech-permission-denied', async () => {
    const helper = fakeHelper();
    const { controller } = controllerWith({ enabled: true, engine: 'on-device' }, onDeviceEngine(() => helper));
    const started = controller.start(target([]), { dictationId: 'd1' });
    await tick();
    helper.reply({ type: 'error', id: 'd1', code: 'speech-permission-denied', message: 'no' });
    helper.reply({ type: 'ended', id: 'd1' });
    await expect(started).resolves.toMatchObject({ ok: false, reason: 'speech-permission-denied' });
    expect(controller.isActive()).toBe(false);
  });

  it('runs a Handy dictation end to end: buffers audio, transcribes the take on stop, ends once', async () => {
    const { engine, transcribe, written, removed } = handyEngine();
    const { controller } = controllerWith({ enabled: true, engine: 'handy' }, stubEngine('on-device', false), { handy: engine });
    const events: DictationEvent[] = [];

    await expect(controller.start(target(events), { dictationId: 'd1' })).resolves.toEqual({ ok: true, engine: 'handy' });
    await tick();
    expect(events.map((e) => e.type)).toEqual(['ready']);

    controller.audio(target(events), 'd1', audioChunk(0.5));
    controller.audio(target(events), 'd1', audioChunk(0.5));
    expect(transcribe).not.toHaveBeenCalled();

    controller.stop(target(events), { dictationId: 'd1', cancel: false });
    await tick();
    await tick();

    // One 16 kHz WAV of the whole take (24k samples per 0.5 s -> 16k), run once with the configured model, then deleted.
    expect(transcribe).toHaveBeenCalledTimes(1);
    const [binary, wavPath, options] = transcribe.mock.calls[0];
    expect(binary).toBe('C:/Handy/handy.exe');
    expect(options.model).toBe('parakeet');
    const wav = written.get(wavPath)!;
    expect(wav.toString('ascii', 0, 4)).toBe('RIFF');
    expect(wav.readUInt32LE(24)).toBe(16000);
    expect(wav.readUInt32LE(40)).toBe(16000 * 2);
    expect(removed).toEqual([wavPath]);
    expect(events.map((e) => e.type)).toEqual(['ready', 'final', 'ended']);
    expect(events[1]).toMatchObject({ type: 'final', text: `heard:${wav.length}` });
    expect(controller.isActive()).toBe(false);
  });

  it('a cancelled Handy dictation never runs the transcriber, and a failed one reports the error', async () => {
    const cancelled = handyEngine();
    const first = controllerWith({ enabled: true, engine: 'handy' }, stubEngine('on-device', false), { handy: cancelled.engine });
    const events: DictationEvent[] = [];
    await first.controller.start(target(events), { dictationId: 'd1' });
    first.controller.audio(target(events), 'd1', audioChunk(1));
    first.controller.stop(target(events), { dictationId: 'd1', cancel: true });
    await tick();
    expect(cancelled.transcribe).not.toHaveBeenCalled();
    expect(events.map((e) => e.type)).toEqual(['ready', 'ended']);

    const failing = handyEngine({ transcribe: vi.fn(async () => { throw new Error('model not downloaded'); }) });
    const second = controllerWith({ enabled: true, engine: 'handy' }, stubEngine('on-device', false), { handy: failing.engine });
    const failEvents: DictationEvent[] = [];
    await second.controller.start(target(failEvents), { dictationId: 'd2' });
    second.controller.audio(target(failEvents), 'd2', audioChunk(1));
    second.controller.stop(target(failEvents), { dictationId: 'd2', cancel: false });
    await tick();
    await tick();
    expect(failEvents.map((e) => e.type)).toEqual(['ready', 'error', 'ended']);
    expect(failEvents[1]).toMatchObject({ type: 'error', message: 'model not downloaded' });
    expect(failing.removed).toHaveLength(1);
  });

  it('Handy is unavailable without a binary and skips the transcriber for a take too short to hold speech', async () => {
    expect(handyEngine({ resolveBinary: () => undefined }).engine.isAvailable()).toBe(false);
    expect(handyEngine().engine.isAvailable()).toBe(true);

    const { engine, transcribe } = handyEngine();
    const { controller } = controllerWith({ enabled: true, engine: 'handy' }, stubEngine('on-device', false), { handy: engine });
    const events: DictationEvent[] = [];
    await controller.start(target(events), { dictationId: 'd1' });
    controller.audio(target(events), 'd1', audioChunk(0.05));
    controller.stop(target(events), { dictationId: 'd1', cancel: false });
    await tick();
    expect(transcribe).not.toHaveBeenCalled();
    expect(events.map((e) => e.type)).toEqual(['ready', 'ended']);
  });
});

describe('pcm resampling for Handy', () => {
  it('downsamples 24 kHz to 16 kHz by linear interpolation and leaves same-rate audio alone', () => {
    const input = new Int16Array([0, 300, 600, 900, 1200, 1500]);
    const out = resamplePcm16(input, 24000, 16000);
    // ratio 1.5: positions 0, 1.5, 3 -> 0, 450, 900 and a fourth at 4.5 -> 1350
    expect(Array.from(out)).toEqual([0, 450, 900, 1350]);
    expect(resamplePcm16(input, 16000, 16000)).toBe(input);
    expect(resamplePcm16(new Int16Array(0), 24000, 16000)).toHaveLength(0);
    expect(() => resamplePcm16(input, 0, 16000)).toThrow();
  });

  it('reads little-endian PCM16 bytes as samples and drops a trailing odd byte', () => {
    const bytes = new Uint8Array([0x01, 0x00, 0xff, 0xff, 0x00, 0x80, 0x7f]);
    expect(Array.from(pcm16BytesToSamples(bytes))).toEqual([1, -1, -32768]);
  });
});
