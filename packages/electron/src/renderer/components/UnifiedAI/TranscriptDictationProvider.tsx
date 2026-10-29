/**
 * Gives transcript widgets (AskUserQuestion, RequestUserInput, interactive
 * prompts) the same Handy dictation button the composer has. The runtime
 * widget exposes its answer textarea; this host-side provider renders the
 * button and lands the transcript at the caret as one undo step.
 */
import React, { useMemo } from 'react';
import {
  TranscriptDictationContext,
  type TranscriptDictationApi,
  type TranscriptDictationTarget,
} from '@nimbalyst/runtime/ui/AgentTranscript/components/transcriptDictationContext';
import { DictationButton } from './DictationButton';
import { insertDictatedText } from '../../utils/dictationInsert';

export function insertTranscriptIntoTarget(target: TranscriptDictationTarget, transcript: string): void {
  const ta = target.getTextarea();
  const current = ta?.value ?? '';
  const start = ta?.selectionStart ?? current.length;
  const end = ta?.selectionEnd ?? current.length;
  const next = insertDictatedText(current, start, end, transcript);
  target.setValue(next.value);
  if (ta) {
    requestAnimationFrame(() => {
      ta.focus();
      ta.setSelectionRange(next.caret, next.caret);
    });
  }
}

function WidgetDictationButton({ target }: { target: TranscriptDictationTarget }) {
  return (
    <DictationButton
      onTranscript={(text) => insertTranscriptIntoTarget(target, text)}
      disabled={target.disabled}
    />
  );
}

export function TranscriptDictationProvider({ children }: { children: React.ReactNode }) {
  const api = useMemo<TranscriptDictationApi>(
    () => ({
      renderButton: (target) => <WidgetDictationButton target={target} />,
    }),
    []
  );
  return <TranscriptDictationContext.Provider value={api}>{children}</TranscriptDictationContext.Provider>;
}
