// @vitest-environment node
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { describe, expect, it, vi } from 'vitest';
import {
  catalogEffortCeiling,
  listCodexCatalogModels,
  mapCodexModelListResponse,
} from '../codexModelCatalog';

/**
 * Recorded from `codex app-server` 0.162.1 (`model/list`, 2026-10-29), trimmed
 * to the fields the mapper reads plus a few it must ignore.
 */
export const RECORDED_MODEL_LIST = {
  data: [
    {
      id: 'gpt-6.1-sol',
      model: 'gpt-6.1-sol',
      upgrade: null,
      displayName: 'GPT-6.1-Sol',
      description: 'Latest workhorse model for coding and everyday work.',
      hidden: false,
      supportedReasoningEfforts: [
        { reasoningEffort: 'low', description: 'Fast responses with lighter reasoning' },
        { reasoningEffort: 'medium', description: 'Balances speed and reasoning depth for everyday tasks' },
        { reasoningEffort: 'high', description: 'Greater reasoning depth for complex problems' },
        { reasoningEffort: 'xhigh', description: 'Extra high reasoning depth for complex problems' },
        { reasoningEffort: 'max', description: 'Maximum reasoning depth for the hardest problems' },
        { reasoningEffort: 'ultra', description: 'Maximum reasoning with automatic task delegation' },
      ],
      defaultReasoningEffort: 'low',
      inputModalities: ['text', 'image'],
      isDefault: true,
    },
    entry('gpt-6-astra', 'GPT-6-Astra', ['low', 'medium', 'high', 'xhigh', 'max', 'ultra'], 'medium'),
    entry('gpt-6.1-terra', 'GPT-6.1 Terra', ['low', 'medium', 'high', 'xhigh', 'max', 'ultra'], 'low'),
    entry('gpt-6-sol', 'GPT-6-Sol', ['low', 'medium', 'high', 'xhigh', 'max', 'ultra'], 'medium'),
    { ...entry('gpt-reserve', 'GPT-Reserve', ['low', 'medium', 'high', 'xhigh', 'max'], 'medium'), hidden: true },
    entry('gpt-6-luna', 'GPT-6-Luna', ['low', 'medium', 'high', 'xhigh', 'max'], 'medium'),
    entry('gpt-5.6-sol', 'GPT-5.6-Sol', ['low', 'medium', 'high', 'xhigh', 'max', 'ultra'], 'low'),
    entry('gpt-5.6-terra', 'GPT-5.6-Terra', ['low', 'medium', 'high', 'xhigh', 'max', 'ultra'], 'medium'),
    entry('gpt-5.6-luna', 'GPT-5.6-Luna', ['low', 'medium', 'high', 'xhigh', 'max'], 'medium'),
    { ...entry('codex-auto-review', 'Codex Auto Review', ['low', 'medium', 'high', 'xhigh', 'max'], 'medium'), hidden: true },
  ],
  nextCursor: null,
};

function entry(id: string, displayName: string, efforts: string[], defaultEffort: string) {
  return {
    id,
    model: id,
    displayName,
    hidden: false,
    isDefault: false,
    supportedReasoningEfforts: efforts.map((reasoningEffort) => ({ reasoningEffort, description: '' })),
    defaultReasoningEffort: defaultEffort,
    inputModalities: ['text', 'image'],
  };
}

/** A stand-in app-server: answers initialize and model/list over piped stdio. */
function fakeAppServer(response: unknown, options: { answerModelList?: boolean } = {}) {
  const child = Object.assign(new EventEmitter(), {
    stdin: new PassThrough(),
    stdout: new PassThrough(),
    stderr: new PassThrough(),
    exitCode: null as number | null,
    signalCode: null as string | null,
    killed: false,
    kill: vi.fn((): boolean => {
      child.killed = true;
      child.exitCode = 0;
      child.emit('exit', 0, null);
      child.emit('close', 0, null);
      return true;
    }),
  });
  const requests: Array<{ id?: number; method: string }> = [];
  let buffered = '';
  child.stdin.on('data', (chunk: Buffer | string) => {
    buffered += chunk.toString();
    let newline = buffered.indexOf('\n');
    while (newline >= 0) {
      const line = buffered.slice(0, newline);
      buffered = buffered.slice(newline + 1);
      newline = buffered.indexOf('\n');
      if (!line.trim()) continue;
      const message = JSON.parse(line) as { id?: number; method: string };
      requests.push(message);
      if (message.id === undefined) continue;
      if (message.method === 'initialize') {
        child.stdout.write(`${JSON.stringify({ jsonrpc: '2.0', id: message.id, result: { userAgent: 'codex' } })}\n`);
      } else if (message.method === 'model/list' && options.answerModelList !== false) {
        child.stdout.write(`${JSON.stringify({ jsonrpc: '2.0', id: message.id, result: response })}\n`);
      }
    }
  });
  const spawnFn = vi.fn(() => child);
  return { child, requests, spawnFn: spawnFn as unknown as NonNullable<Parameters<typeof listCodexCatalogModels>[0]>['spawnFn'] };
}

describe('mapCodexModelListResponse', () => {
  it('maps the recorded catalog, keeping order, hidden flags, default and effort ceilings', () => {
    const models = mapCodexModelListResponse(RECORDED_MODEL_LIST);

    expect(models.map((model) => model.id)).toEqual([
      'gpt-6.1-sol',
      'gpt-6-astra',
      'gpt-6.1-terra',
      'gpt-6-sol',
      'gpt-reserve',
      'gpt-6-luna',
      'gpt-5.6-sol',
      'gpt-5.6-terra',
      'gpt-5.6-luna',
      'codex-auto-review',
    ]);
    expect(models.filter((model) => model.hidden).map((model) => model.id)).toEqual(['gpt-reserve', 'codex-auto-review']);
    expect(models.filter((model) => model.isDefault).map((model) => model.id)).toEqual(['gpt-6.1-sol']);

    const terra = models.find((model) => model.id === 'gpt-6.1-terra')!;
    expect(terra.displayName).toBe('GPT-6.1 Terra');
    expect(terra.defaultEffort).toBe('low');
    expect(catalogEffortCeiling(terra)).toBe('ultra');
    expect(catalogEffortCeiling(models.find((model) => model.id === 'gpt-6-luna')!)).toBe('max');
    expect(models[0].inputModalities).toEqual(['text', 'image']);
    expect(models[0].description).toBe('Latest workhorse model for coding and everyday work.');
  });

  it('degrades unknown shapes to an empty or partial list instead of throwing', () => {
    expect(mapCodexModelListResponse(undefined)).toEqual([]);
    expect(mapCodexModelListResponse({ nextCursor: null })).toEqual([]);
    expect(mapCodexModelListResponse('gpt-6-sol')).toEqual([]);

    const partial = mapCodexModelListResponse([
      {},
      'gpt-6-sol',
      { id: 'gpt-7-nova', supportedReasoningEfforts: ['low', 'bogus', { reasoningEffort: 'HIGH' }] },
      { id: 'gpt-7-nova', displayName: 'duplicate, ignored' },
      { slug: 'gpt-7-mini', visibility: 'hide', supported_reasoning_levels: [{ effort: 'medium' }] },
    ]);
    expect(partial).toEqual([
      {
        id: 'gpt-7-nova',
        displayName: 'gpt-7-nova',
        description: undefined,
        isDefault: false,
        hidden: false,
        supportedEfforts: ['low', 'high'],
        defaultEffort: undefined,
      },
      {
        id: 'gpt-7-mini',
        displayName: 'gpt-7-mini',
        description: undefined,
        isDefault: false,
        hidden: true,
        supportedEfforts: ['medium'],
        defaultEffort: undefined,
      },
    ]);
    expect(catalogEffortCeiling({ supportedEfforts: [] })).toBeUndefined();
  });
});

describe('listCodexCatalogModels', () => {
  it('spawns the app-server, completes the handshake, reads model/list and stops the child', async () => {
    const server = fakeAppServer(RECORDED_MODEL_LIST);

    const models = await listCodexCatalogModels({ binaryPath: '/fake/codex', spawnFn: server.spawnFn, timeoutMs: 2_000 });

    expect(server.spawnFn).toHaveBeenCalledWith(
      '/fake/codex',
      ['app-server', '--listen', 'stdio://'],
      expect.objectContaining({ stdio: ['pipe', 'pipe', 'pipe'] }),
    );
    expect(server.requests.map((request) => request.method)).toEqual(['initialize', 'initialized', 'model/list']);
    expect(models.map((model) => model.id)).toContain('gpt-6.1-terra');
    expect(models).toHaveLength(10);
    expect(server.child.kill).toHaveBeenCalled();
  });

  it('rejects within the budget when the server never answers, and still stops the child', async () => {
    const server = fakeAppServer(RECORDED_MODEL_LIST, { answerModelList: false });

    await expect(
      listCodexCatalogModels({ binaryPath: '/fake/codex', spawnFn: server.spawnFn, timeoutMs: 60 }),
    ).rejects.toThrow(/model\/list/);
    expect(server.child.kill).toHaveBeenCalled();
  });
});
