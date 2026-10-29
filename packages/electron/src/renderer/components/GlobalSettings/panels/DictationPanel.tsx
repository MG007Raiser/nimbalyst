/**
 * Settings > Dictation: where Handy lives and which of its downloaded models
 * the composer microphone uses. Models are downloaded inside Handy itself;
 * this panel only picks among the ones already on disk.
 */
import React, { useCallback, useEffect, useState } from 'react';
import { useAtom } from 'jotai';
import { MaterialSymbol } from '@nimbalyst/runtime/ui/icons/MaterialSymbol';
import { settingAtom } from '../../../store/atoms/settingAtomFamily';

type DictationStatus = Awaited<ReturnType<typeof window.electronAPI.dictation.status>>;
type DictationModel = Extract<Awaited<ReturnType<typeof window.electronAPI.dictation.listModels>>, { success: true }>['models'][number];

export function DictationPanel() {
  const [handyPath, setHandyPath] = useAtom(settingAtom('dictation.handyPath'));
  const [model, setModel] = useAtom(settingAtom('dictation.model'));
  const [draftPath, setDraftPath] = useState(handyPath);
  const [status, setStatus] = useState<DictationStatus | null>(null);
  const [models, setModels] = useState<DictationModel[]>([]);
  const [modelsError, setModelsError] = useState<string | null>(null);
  const [loadingModels, setLoadingModels] = useState(false);

  useEffect(() => {
    setDraftPath(handyPath);
  }, [handyPath]);

  const refresh = useCallback(async () => {
    const api = window.electronAPI?.dictation;
    if (!api) return;
    const next = await api.status();
    setStatus(next);
    if (!next.available) {
      setModels([]);
      return;
    }
    setLoadingModels(true);
    setModelsError(null);
    try {
      const result = await api.listModels();
      if (result.success) {
        setModels(result.models);
      } else {
        setModels([]);
        setModelsError(result.error);
      }
    } finally {
      setLoadingModels(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh, handyPath]);

  const commitPath = useCallback(() => {
    const trimmed = draftPath.trim();
    if (trimmed !== handyPath) setHandyPath(trimmed);
  }, [draftPath, handyPath, setHandyPath]);

  const detect = useCallback(async () => {
    const detected = await window.electronAPI.dictation.detect();
    setDraftPath('');
    if (handyPath !== '') setHandyPath('');
    setStatus((previous) => previous ? { ...previous, binaryPath: detected.path || previous.binaryPath } : previous);
  }, [handyPath, setHandyPath]);

  const downloaded = models.filter((entry) => entry.isDownloaded);
  const notDownloaded = models.length - downloaded.length;

  return (
    <div className="dictation-settings-panel flex flex-col gap-6 select-text">
      <section className="dictation-settings-intro">
        <h2 className="text-lg font-semibold text-[var(--nim-text)] m-0">Dictation</h2>
        <p className="text-sm text-[var(--nim-text-muted)] mt-1 mb-0">
          The microphone button in the composer records a take and transcribes it offline with{' '}
          <a href="https://handy.computer" target="_blank" rel="noreferrer" className="text-[var(--nim-link)]">Handy</a>, the open-source speech-to-text app.
          Nothing leaves this machine. Handy must be installed, and the model you pick must already be downloaded inside Handy.
        </p>
      </section>

      <section className="dictation-settings-status flex items-center gap-2 text-sm">
        {status === null ? (
          <span className="text-[var(--nim-text-muted)]">Checking for Handy...</span>
        ) : status.available ? (
          <>
            <MaterialSymbol icon="check_circle" size={18} className="text-[var(--nim-success)]" />
            <span className="text-[var(--nim-text)]">Handy found at <code className="text-xs">{status.binaryPath}</code></span>
          </>
        ) : (
          <>
            <MaterialSymbol icon="error" size={18} className="text-[var(--nim-error)]" />
            <span className="text-[var(--nim-text)]">{status.reason ?? 'Handy was not found'}</span>
          </>
        )}
        <button
          type="button"
          onClick={() => void refresh()}
          className="dictation-settings-refresh ml-auto px-2 py-1 text-xs rounded border border-[var(--nim-border)] bg-transparent text-[var(--nim-text)] cursor-pointer hover:bg-[var(--nim-bg-hover)]"
        >
          Re-check
        </button>
      </section>

      <section className="dictation-settings-path flex flex-col gap-1">
        <label htmlFor="dictation-handy-path" className="text-sm font-medium text-[var(--nim-text)]">Handy executable</label>
        <div className="flex gap-2">
          <input
            id="dictation-handy-path"
            type="text"
            value={draftPath}
            placeholder="Auto-detect (per-user install or PATH)"
            onChange={(event) => setDraftPath(event.target.value)}
            onBlur={commitPath}
            onKeyDown={(event) => { if (event.key === 'Enter') commitPath(); }}
            className="dictation-settings-path-input flex-1 px-2 py-1 text-sm rounded border border-[var(--nim-border)] bg-[var(--nim-bg)] text-[var(--nim-text)]"
          />
          <button
            type="button"
            onClick={() => void detect()}
            className="dictation-settings-detect px-2 py-1 text-xs rounded border border-[var(--nim-border)] bg-transparent text-[var(--nim-text)] cursor-pointer hover:bg-[var(--nim-bg-hover)]"
          >
            Auto-detect
          </button>
        </div>
        <p className="text-xs text-[var(--nim-text-muted)] m-0">Leave empty to use the standard install location. Set it only if Handy lives somewhere unusual.</p>
      </section>

      <section className="dictation-settings-model flex flex-col gap-1">
        <label htmlFor="dictation-model" className="text-sm font-medium text-[var(--nim-text)]">Model</label>
        <select
          id="dictation-model"
          value={model}
          disabled={!status?.available || loadingModels}
          onChange={(event) => setModel(event.target.value)}
          className="dictation-settings-model-select px-2 py-1 text-sm rounded border border-[var(--nim-border)] bg-[var(--nim-bg)] text-[var(--nim-text)] max-w-full"
        >
          <option value="">Handy's selected model</option>
          {downloaded.map((entry) => (
            <option key={entry.id} value={entry.id}>
              {entry.name}{entry.isRecommended ? ' (recommended)' : ''}{entry.sizeMb ? ` · ${entry.sizeMb} MB` : ''}
            </option>
          ))}
        </select>
        <p className="text-xs text-[var(--nim-text-muted)] m-0">
          {loadingModels
            ? 'Reading Handy\'s model list...'
            : modelsError
              ? `Could not read the model list: ${modelsError}`
              : status?.available
                ? `${downloaded.length} downloaded model${downloaded.length === 1 ? '' : 's'}${notDownloaded > 0 ? `; ${notDownloaded} more can be downloaded in Handy's Models tab` : ''}.`
                : 'Install Handy to pick a model.'}
        </p>
      </section>
    </div>
  );
}
