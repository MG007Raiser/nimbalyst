import React, { useEffect, useState } from 'react';
import { useAtomValue, useSetAtom } from 'jotai';
import type { DictationAvailability, DictationEngineSetting, DictationSettings } from '../../../shared/dictation';
import { getShortcutDisplay } from '../../../shared/KeyboardShortcuts';
import {
  dictationAvailabilityAtom,
  dictationHandyStatusAtom,
  dictationSettingsAtom,
  refreshDictationAvailabilityAtom,
  refreshDictationHandyStatusAtom,
  setDictationSettingsAtom,
} from '../../store/atoms/dictation';
import { DICTATION_SHORTCUT } from '../../dictation/dictationShortcut';
import { SettingsToggle } from '../GlobalSettings/SettingsToggle';

const ENGINE_OPTIONS: Array<{ value: DictationEngineSetting; label: string }> = [
  { value: 'auto', label: 'Auto' },
  { value: 'system', label: 'macOS dictation' },
  { value: 'on-device', label: 'On-device (macOS)' },
  { value: 'handy', label: 'Handy (offline)' },
  { value: 'openai', label: 'OpenAI' },
];

/** Whether the Handy settings apply: chosen outright, or what Auto resolves to. */
export function usesHandy(engine: DictationEngineSetting, availability: DictationAvailability | null): boolean {
  if (engine === 'handy') return true;
  if (engine !== 'auto' || !availability) return false;
  return !availability.system && !availability.onDevice && availability.handy;
}

const LANGUAGE_OPTIONS: Array<{ value: string; label: string }> = [
  { value: '', label: 'System default' },
  { value: 'en-US', label: 'English (US)' },
  { value: 'en-GB', label: 'English (UK)' },
  { value: 'de-DE', label: 'German' },
  { value: 'es-ES', label: 'Spanish' },
  { value: 'fr-FR', label: 'French' },
  { value: 'it-IT', label: 'Italian' },
  { value: 'ja-JP', label: 'Japanese' },
  { value: 'ko-KR', label: 'Korean' },
  { value: 'pt-BR', label: 'Portuguese (Brazil)' },
  { value: 'zh-CN', label: 'Chinese (Simplified)' },
];

/** Explain which engine will run, or why none can. */
function describeDictationAvailability(
  engine: DictationEngineSetting,
  availability: DictationAvailability | null,
): { ok: boolean; text: string } | null {
  if (!availability) return null;
  const { system, onDevice, openai, handy } = availability;
  if (engine === 'system' || (engine === 'auto' && system)) {
    return system
      ? {
          ok: true,
          text: `${engine === 'auto' ? 'Auto uses macOS dictation' : 'Uses macOS dictation'}: it starts instantly and follows your Keyboard > Dictation settings in System Settings. The shortcut starts it when you release the keys; it stops after a pause.`,
        }
      : { ok: false, text: 'macOS dictation is only available on a Mac. Choose Auto, Handy or OpenAI instead.' };
  }
  if (engine === 'on-device') {
    return onDevice
      ? { ok: true, text: 'On-device recognition is available. Audio stays on this Mac.' }
      : { ok: false, text: 'On-device recognition is not available here. It needs macOS with speech recognition support. Choose Handy, OpenAI or Auto instead.' };
  }
  if (engine === 'handy') {
    return handy
      ? { ok: true, text: 'Uses the Handy app installed on this computer. Audio stays on this machine; the words arrive once you stop talking.' }
      : { ok: false, text: 'Handy was not found. Install it from handy.computer, or point the field below at its executable.' };
  }
  if (engine === 'openai') {
    return openai
      ? { ok: true, text: 'Uses your OpenAI API key. Audio is sent to OpenAI and billed to that key.' }
      : { ok: false, text: 'No OpenAI API key is set. Add one under Agent Providers > Saved API keys.' };
  }
  if (onDevice) return { ok: true, text: 'Auto will use on-device recognition. Audio stays on this Mac.' };
  if (handy) return { ok: true, text: 'Auto will use Handy, installed on this computer. Audio stays on this machine.' };
  if (openai) return { ok: true, text: 'Auto will use OpenAI with your API key. Audio is sent to OpenAI.' };
  return {
    ok: false,
    text: 'No speech engine is available. On macOS, on-device recognition needs a supported macOS version; elsewhere install Handy (handy.computer) for offline dictation, or add an OpenAI API key under Agent Providers > Saved API keys. Your operating system\'s own dictation also works in any text field.',
  };
}

export function DictationPanel() {
  const settings = useAtomValue(dictationSettingsAtom);
  const setSettings = useSetAtom(setDictationSettingsAtom);
  const availability = useAtomValue(dictationAvailabilityAtom);
  const refreshAvailability = useSetAtom(refreshDictationAvailabilityAtom);
  const handyStatus = useAtomValue(dictationHandyStatusAtom);
  const refreshHandyStatus = useSetAtom(refreshDictationHandyStatusAtom);
  const [handyPathDraft, setHandyPathDraft] = useState(settings.handyPath ?? '');

  useEffect(() => {
    void refreshAvailability();
  }, [refreshAvailability]);

  const showHandy = settings.enabled && usesHandy(settings.engine, availability);
  useEffect(() => {
    if (showHandy) void refreshHandyStatus();
  }, [showHandy, settings.handyPath, refreshHandyStatus]);

  useEffect(() => {
    setHandyPathDraft(settings.handyPath ?? '');
  }, [settings.handyPath]);

  const commitHandyPath = () => {
    const next = handyPathDraft.trim();
    if (next === (settings.handyPath ?? '')) return;
    void setSettings({ handyPath: next } as Partial<DictationSettings>).then(() => refreshAvailability());
  };

  const status = describeDictationAvailability(settings.engine, availability);
  const shortcut = getShortcutDisplay(DICTATION_SHORTCUT);
  const handyModels = handyStatus?.models ?? [];
  const downloadedModels = handyModels.filter((model) => model.isDownloaded);
  const notDownloaded = handyModels.length - downloadedModels.length;

  return (
    <div className="dictation-panel provider-panel flex flex-col">
      <div className="provider-panel-header mb-6 pb-4 border-b border-[var(--nim-border)]">
        <h3 className="provider-panel-title text-xl font-semibold leading-tight mb-2 text-[var(--nim-text)]">Dictation</h3>
        <p className="provider-panel-description text-sm leading-relaxed text-[var(--nim-text-muted)]">
          Speak instead of typing in the agent input and in documents. Words appear at the cursor for you to edit; nothing is sent until you send it. This is separate from Voice Mode.
        </p>
      </div>

      <SettingsToggle
        variant="enable"
        name="Dictation"
        description={
          settings.enabled
            ? `Click the microphone button, or hold ${shortcut} to talk. A quick tap keeps it listening until you tap again. Esc discards the unfinished phrase.`
            : 'Off: microphone buttons and the shortcut are hidden everywhere.'
        }
        checked={settings.enabled}
        onChange={(enabled) => void setSettings({ enabled })}
        testId="dictation-enabled-toggle"
      />

      {settings.enabled && (
        <div className="provider-panel-section mb-6 flex flex-col gap-4">
          <div className="setting-item">
            <label htmlFor="dictation-engine" className="setting-name text-sm font-medium text-[var(--nim-text)]">Speech engine</label>
            <select
              id="dictation-engine"
              value={settings.engine}
              onChange={(e) => void setSettings({ engine: e.target.value as DictationEngineSetting })}
              className="mt-2 block px-3 py-1.5 rounded border border-[var(--nim-border)] bg-[var(--nim-bg-secondary)] text-[var(--nim-text)]"
              data-testid="dictation-engine-select"
            >
              {ENGINE_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>{o.label}</option>
              ))}
            </select>
            {status && (
              <p
                className={`dictation-availability mt-2 text-xs select-text ${status.ok ? 'text-[var(--nim-text-muted)]' : 'text-[var(--nim-warning)]'}`}
                data-testid="dictation-availability"
              >
                {status.text}
              </p>
            )}
          </div>

          <div className="setting-item">
            <label htmlFor="dictation-language" className="setting-name text-sm font-medium text-[var(--nim-text)]">Language</label>
            <select
              id="dictation-language"
              value={settings.language ?? ''}
              // '' clears the saved language (main drops empty values)
              onChange={(e) => void setSettings({ language: e.target.value })}
              className="mt-2 block px-3 py-1.5 rounded border border-[var(--nim-border)] bg-[var(--nim-bg-secondary)] text-[var(--nim-text)]"
              data-testid="dictation-language-select"
            >
              {LANGUAGE_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>{o.label}</option>
              ))}
              {settings.language && !LANGUAGE_OPTIONS.some((o) => o.value === settings.language) && (
                <option value={settings.language}>{settings.language}</option>
              )}
            </select>
          </div>

          {showHandy && (
            <div className="dictation-handy-settings flex flex-col gap-4 pt-4 border-t border-[var(--nim-border)]" data-testid="dictation-handy-settings">
              <p className="text-xs text-[var(--nim-text-muted)] select-text">
                Handy transcribes offline with the model you pick below; models are downloaded inside Handy itself.{' '}
                {handyStatus === null
                  ? 'Checking for Handy...'
                  : handyStatus.available
                    ? `Found at ${handyStatus.binaryPath}.`
                    : 'Handy was not found at its usual install location.'}
              </p>

              <div className="setting-item">
                <label htmlFor="dictation-handy-path" className="setting-name text-sm font-medium text-[var(--nim-text)]">Handy executable</label>
                <div className="mt-2 flex gap-2">
                  <input
                    id="dictation-handy-path"
                    type="text"
                    value={handyPathDraft}
                    placeholder={handyStatus?.detectedPath ? `Auto-detected: ${handyStatus.detectedPath}` : 'Auto-detect (per-user install or PATH)'}
                    onChange={(e) => setHandyPathDraft(e.target.value)}
                    onBlur={commitHandyPath}
                    onKeyDown={(e) => { if (e.key === 'Enter') commitHandyPath(); }}
                    className="flex-1 px-3 py-1.5 rounded border border-[var(--nim-border)] bg-[var(--nim-bg-secondary)] text-[var(--nim-text)] text-sm"
                    data-testid="dictation-handy-path"
                  />
                  <button
                    type="button"
                    onClick={() => void refreshHandyStatus()}
                    className="px-2 py-1 text-xs rounded border border-[var(--nim-border)] bg-transparent text-[var(--nim-text)] cursor-pointer hover:bg-[var(--nim-bg-hover)]"
                  >
                    Re-check
                  </button>
                </div>
                <p className="mt-1 text-xs text-[var(--nim-text-muted)]">Leave empty to use the standard install location. Set it only if Handy lives somewhere unusual.</p>
              </div>

              <div className="setting-item">
                <label htmlFor="dictation-handy-model" className="setting-name text-sm font-medium text-[var(--nim-text)]">Handy model</label>
                <select
                  id="dictation-handy-model"
                  value={settings.handyModel ?? ''}
                  disabled={!handyStatus?.available}
                  // '' clears the saved model (main drops empty values): Handy's own selection
                  onChange={(e) => void setSettings({ handyModel: e.target.value } as Partial<DictationSettings>)}
                  className="mt-2 block max-w-full px-3 py-1.5 rounded border border-[var(--nim-border)] bg-[var(--nim-bg-secondary)] text-[var(--nim-text)]"
                  data-testid="dictation-handy-model-select"
                >
                  <option value="">Handy&apos;s selected model</option>
                  {downloadedModels.map((model) => (
                    <option key={model.id} value={model.id}>{model.name}{model.isRecommended ? ' (recommended)' : ''}</option>
                  ))}
                  {settings.handyModel && !downloadedModels.some((model) => model.id === settings.handyModel) && (
                    <option value={settings.handyModel}>{settings.handyModel} (not downloaded)</option>
                  )}
                </select>
                <p className="mt-1 text-xs text-[var(--nim-text-muted)] select-text">
                  {handyStatus?.error
                    ? `Could not read the model list: ${handyStatus.error}`
                    : handyStatus?.available
                      ? `${downloadedModels.length} downloaded${notDownloaded > 0 ? `, ${notDownloaded} more available inside Handy` : ''}.`
                      : 'Install Handy to pick a model.'}
                </p>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
