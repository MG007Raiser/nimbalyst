/**
 * Live Codex model catalog.
 *
 * The Codex CLI's own `/model` picker is fed by the app-server `model/list`
 * RPC, and the roster it returns depends on the codex binary version (GPT-6
 * entries only appear from 0.153.0 on, for example). Reading the same RPC from
 * the binary Nimbalyst ships keeps the picker identical to the CLI without a
 * hand-maintained list, so a model OpenAI adds shows up the day the bundled
 * codex learns about it and a retired one disappears with it.
 *
 * `mapCodexModelListResponse` is pure so tests can drive it with a recorded
 * response; `listCodexCatalogModels` owns the short-lived child process.
 */

import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import path from 'node:path';
import { JsonRpcClient } from '../../protocols/codexAppServer/jsonRpcClient';
import {
  getCodexVendorPathEntries,
  resolveCodexBinaryPath,
} from '../../protocols/codexAppServer/codexAppServerBinary';
import { resolvePackagedCodexBinaryPath } from './codexBinaryPath';
import { EFFORT_LEVELS, type EffortLevel } from '../../effortLevels';

export interface CodexCatalogModel {
  /** Model slug as codex expects it in `model` (for example `gpt-6.1-terra`). */
  id: string;
  /** Human label from the catalog (`GPT-6.1 Terra`). */
  displayName: string;
  description?: string;
  /** The entry codex selects when the user has not picked a model. */
  isDefault: boolean;
  /** Internal entries (`codex-auto-review`, `gpt-reserve`) the CLI hides too. */
  hidden: boolean;
  /** Reasoning efforts the model accepts, in ascending order. */
  supportedEfforts: EffortLevel[];
  defaultEffort?: EffortLevel;
  inputModalities?: string[];
}

export interface ListCodexCatalogModelsOptions {
  /** Explicit binary path; otherwise resolved like the app-server transport. */
  binaryPath?: string;
  /** Packaged-app resolver, mirrors `resolveCodexBinaryPath`'s first argument. */
  packagedResolver?: () => string | undefined;
  /** Whole-call budget for spawn, handshake and `model/list`. */
  timeoutMs?: number;
  /** Extra environment entries (for example a `CODEX_HOME` override). */
  env?: Record<string, string>;
  /** Test seam: replaces `child_process.spawn`. */
  spawnFn?: typeof spawn;
}

export const DEFAULT_CODEX_CATALOG_TIMEOUT_MS = 8_000;

const KNOWN_EFFORTS = new Set<EffortLevel>(EFFORT_LEVELS.map((level) => level.key));
const EFFORT_RANK = new Map<EffortLevel, number>(EFFORT_LEVELS.map((level, index) => [level.key, index]));

function readString(source: Record<string, unknown>, keys: string[]): string | undefined {
  for (const key of keys) {
    const value = source[key];
    if (typeof value === 'string' && value.trim()) return value.trim();
  }
  return undefined;
}

function readEffort(value: unknown): EffortLevel | undefined {
  if (typeof value !== 'string') return undefined;
  const lower = value.trim().toLowerCase() as EffortLevel;
  return KNOWN_EFFORTS.has(lower) ? lower : undefined;
}

function readEfforts(value: unknown): EffortLevel[] {
  if (!Array.isArray(value)) return [];
  const efforts = new Set<EffortLevel>();
  for (const entry of value) {
    const effort = typeof entry === 'string'
      ? readEffort(entry)
      : entry && typeof entry === 'object'
        ? readEffort((entry as Record<string, unknown>).reasoningEffort
            ?? (entry as Record<string, unknown>).effort
            ?? (entry as Record<string, unknown>).reasoning_effort)
        : undefined;
    if (effort) efforts.add(effort);
  }
  return Array.from(efforts).sort((a, b) => (EFFORT_RANK.get(a) ?? 0) - (EFFORT_RANK.get(b) ?? 0));
}

/**
 * Map a `model/list` response (`{ data: [...] }`, or a bare array) to catalog
 * entries. Unknown shapes yield an empty list rather than throwing so a
 * protocol change degrades to the static fallback instead of breaking the
 * picker. Duplicate slugs keep their first occurrence; order is preserved
 * because codex already sorts by its `priority` field.
 */
export function mapCodexModelListResponse(raw: unknown): CodexCatalogModel[] {
  let entries: unknown[] = [];
  if (Array.isArray(raw)) {
    entries = raw;
  } else if (raw && typeof raw === 'object') {
    const container = raw as Record<string, unknown>;
    for (const key of ['data', 'models', 'items']) {
      if (Array.isArray(container[key])) {
        entries = container[key] as unknown[];
        break;
      }
    }
  }

  const seen = new Set<string>();
  const models: CodexCatalogModel[] = [];
  for (const entry of entries) {
    if (!entry || typeof entry !== 'object') continue;
    const record = entry as Record<string, unknown>;
    const id = readString(record, ['id', 'model', 'slug']);
    if (!id || id.length > 256 || seen.has(id)) continue;
    seen.add(id);
    const inputModalities = Array.isArray(record.inputModalities)
      ? (record.inputModalities as unknown[]).filter((m): m is string => typeof m === 'string')
      : undefined;
    models.push({
      id,
      displayName: readString(record, ['displayName', 'display_name', 'name']) ?? id,
      description: readString(record, ['description']),
      isDefault: record.isDefault === true || record.is_default === true,
      hidden: record.hidden === true || record.visibility === 'hide',
      supportedEfforts: readEfforts(record.supportedReasoningEfforts ?? record.supported_reasoning_levels),
      defaultEffort: readEffort(record.defaultReasoningEffort ?? record.default_reasoning_level),
      ...(inputModalities ? { inputModalities } : {}),
    });
  }
  return models;
}

/** Highest effort a catalog entry accepts, or undefined when it lists none. */
export function catalogEffortCeiling(model: Pick<CodexCatalogModel, 'supportedEfforts'>): EffortLevel | undefined {
  return model.supportedEfforts.length > 0
    ? model.supportedEfforts[model.supportedEfforts.length - 1]
    : undefined;
}

function buildCatalogEnv(binaryPath: string, extra?: Record<string, string>): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (value !== undefined) env[key] = value;
  }
  if (extra) Object.assign(env, extra);
  // Same PATH treatment as the app-server transport: the native launcher
  // expects its vendored helpers (rg and friends) to be discoverable.
  const extraPathEntries = getCodexVendorPathEntries(binaryPath);
  if (extraPathEntries.length > 0) {
    const existing = (env.PATH ?? env.Path ?? '')
      .split(path.delimiter)
      .map((entry) => entry.trim())
      .filter(Boolean);
    env.PATH = Array.from(new Set([...extraPathEntries, ...existing])).join(path.delimiter);
    delete env.Path;
  }
  return env;
}

function stopChild(child: ChildProcessWithoutNullStreams): void {
  if (child.exitCode !== null || child.signalCode !== null) return;
  try {
    child.kill();
  } catch {
    // Already gone.
  }
  const escalate = setTimeout(() => {
    if (child.exitCode === null && child.signalCode === null) {
      try { child.kill('SIGKILL'); } catch { /* noop */ }
    }
  }, 1_000);
  escalate.unref?.();
}

/**
 * Spawn `codex app-server`, complete the handshake, read `model/list`, and
 * tear the child down. Rejects on spawn failure, handshake failure, or when
 * the whole exchange exceeds `timeoutMs`; callers decide how to degrade.
 */
export async function listCodexCatalogModels(
  options: ListCodexCatalogModelsOptions = {},
): Promise<CodexCatalogModel[]> {
  const timeoutMs = options.timeoutMs ?? DEFAULT_CODEX_CATALOG_TIMEOUT_MS;
  const binaryPath = options.binaryPath
    ?? resolveCodexBinaryPath(options.packagedResolver ?? (() => resolvePackagedCodexBinaryPath()));
  const spawnFn = options.spawnFn ?? spawn;
  const child = spawnFn(binaryPath, ['app-server', '--listen', 'stdio://'], {
    env: buildCatalogEnv(binaryPath, options.env),
    stdio: ['pipe', 'pipe', 'pipe'],
    windowsHide: true,
  }) as ChildProcessWithoutNullStreams;
  // Drain stderr so a chatty binary can never block on a full pipe.
  child.stderr?.on('data', () => {});

  const client = new JsonRpcClient(child, {
    defaultTimeoutMs: timeoutMs,
    logger: { log: () => {}, warn: (message, ...args) => console.warn('[CodexCatalog]', message, ...args) },
  });

  const deadline = new Promise<never>((_, reject) => {
    const timer = setTimeout(
      () => reject(new Error(`[CodexCatalog] model/list exceeded ${timeoutMs}ms`)),
      timeoutMs,
    );
    timer.unref?.();
  });

  try {
    const exchange = (async () => {
      await client.request('initialize', {
        clientInfo: { name: 'nimbalyst', title: 'Nimbalyst', version: '0.0.0' },
        capabilities: { experimentalApi: true },
      }, timeoutMs);
      client.notify('initialized', {});
      const response = await client.request<unknown>('model/list', {}, timeoutMs);
      return mapCodexModelListResponse(response);
    })();
    return await Promise.race([exchange, deadline]);
  } finally {
    try { client.close('catalog read complete'); } catch { /* noop */ }
    stopChild(child);
  }
}
