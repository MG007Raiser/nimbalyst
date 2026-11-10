import React from 'react';
import { MaterialSymbol } from '@nimbalyst/runtime/ui/icons/MaterialSymbol';
import { getShortcutDisplay } from '../../shared/KeyboardShortcuts';
import { DICTATION_SHORTCUT } from './dictationShortcut';
import { useDictation } from './useDictation';

/**
 * Mic toggle for a dictation target. Renders nothing when dictation is
 * disabled in Settings.
 */
export function DictationButton({ targetKey, disabled }: { targetKey: string; disabled?: boolean }) {
  const { enabled, recording, status, hearing, finishing, toggle } = useDictation(targetKey);
  if (!enabled) return null;

  // Pulse until the mic delivers real audio: Bluetooth headsets send silence
  // for about 2s while switching into mic mode, so talking early is lost.
  // Pulse again after stop while a batch engine (Handy) is still transcribing.
  const preparing = status === 'starting' || status === 'preparing' || (recording && !hearing) || finishing;
  const title = recording
    ? hearing
      ? 'Stop dictation (Esc discards the unfinished phrase)'
      : 'Waiting for the microphone...'
    : finishing
      ? 'Transcribing what you said...'
      : `Dictate (click, or hold ${getShortcutDisplay(DICTATION_SHORTCUT)})`;

  return (
    <button
      type="button"
      className={`dictation-button w-9 h-9 shrink-0 flex items-center justify-center rounded-md border border-[var(--nim-border)] cursor-pointer transition-colors duration-150 disabled:opacity-40 disabled:cursor-not-allowed ${
        recording
          ? 'dictation-button-recording bg-[var(--nim-error)] text-white border-transparent'
          : 'bg-[var(--nim-bg)] text-[var(--nim-text-muted)] hover:enabled:bg-[var(--nim-bg-hover)] hover:enabled:text-[var(--nim-text)]'
      } ${preparing ? 'animate-pulse' : ''}`}
      // Keep focus (and the caret) in the input the button dictates into.
      onMouseDown={(e) => e.preventDefault()}
      onClick={toggle}
      disabled={disabled && !recording}
      title={title}
      aria-label={recording ? 'Stop dictation' : 'Start dictation'}
      aria-pressed={recording}
      data-testid="dictation-button"
      data-dictation-phase={recording ? 'recording' : finishing ? 'transcribing' : 'idle'}
    >
      <MaterialSymbol icon={recording ? 'stop' : finishing ? 'hourglass_top' : 'mic'} size={18} />
    </button>
  );
}
