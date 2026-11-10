/**
 * Gives transcript widgets (AskUserQuestion, RequestUserInput, interactive
 * prompts) the same dictation button the agent input has. The runtime widget
 * exposes its answer textarea; this host-side provider registers it as a
 * dictation target so partials and finals land at the caret, and renders the
 * shared DictationButton for it. The widget still owns its value: text goes
 * back through the widget's own setter, never straight into the DOM.
 */
import React, { useEffect, useId, useMemo, useRef } from 'react';
import {
  TranscriptDictationContext,
  type TranscriptDictationApi,
  type TranscriptDictationTarget,
} from '@nimbalyst/runtime/ui/AgentTranscript/components/transcriptDictationContext';
import { DictationButton } from '../../dictation/DictationButton';
import { DictationStatus } from '../../dictation/DictationStatus';
import { getDictationController } from '../../dictation/dictationController';
import { registerDictationTarget } from '../../dictation/dictationTargets';
import {
  applyDictationText,
  clearDictationPartial,
  type TextareaDictationResult,
  type TextareaDictationState,
} from '../../dictation/textareaDictation';

function WidgetDictationButton({ target }: { target: TranscriptDictationTarget }) {
  const targetKey = `question:${useId()}`;
  const targetRef = useRef(target);
  targetRef.current = target;
  const stateRef = useRef<TextareaDictationState | null>(null);

  useEffect(() => {
    const read = () => {
      const ta = targetRef.current.getTextarea();
      const value = ta?.value ?? '';
      const end = value.length;
      return { ta, value, selection: { start: ta?.selectionStart ?? end, end: ta?.selectionEnd ?? end } };
    };
    const apply = (result: TextareaDictationResult) => {
      targetRef.current.setValue(result.value);
      const ta = targetRef.current.getTextarea();
      if (!ta) return;
      requestAnimationFrame(() => {
        if (document.activeElement !== ta) return;
        try {
          ta.setSelectionRange(result.cursor, result.cursor);
        } catch {
          // value not applied yet; best-effort caret placement
        }
      });
    };
    const unregister = registerDictationTarget({
      key: targetKey,
      surface: 'question',
      kind: 'rich-text',
      hasFocus: () => {
        const ta = targetRef.current.getTextarea();
        return !!ta && document.activeElement === ta;
      },
      showPartial: (text) => {
        const { value, selection } = read();
        const r = applyDictationText(value, stateRef.current, selection, text, 'partial');
        stateRef.current = r.state;
        apply(r);
      },
      clearPartial: () => {
        const r = clearDictationPartial(read().value, stateRef.current);
        if (r) {
          stateRef.current = r.state;
          apply(r);
        }
      },
      commitFinal: (text) => {
        const { value, selection } = read();
        const r = applyDictationText(value, stateRef.current, selection, text, 'final');
        stateRef.current = r.state;
        apply(r);
      },
    });
    return () => {
      unregister();
      const controller = getDictationController();
      if (controller.isRecording(targetKey)) controller.stop(true);
      stateRef.current = null;
    };
  }, [targetKey]);

  return (
    <div className="transcript-dictation flex flex-col items-end gap-1">
      <DictationButton targetKey={targetKey} disabled={target.disabled} />
      <DictationStatus targetKey={targetKey} compact />
    </div>
  );
}

export function TranscriptDictationProvider({ children }: { children: React.ReactNode }) {
  const api = useMemo<TranscriptDictationApi>(
    () => ({
      renderButton: (target) => <WidgetDictationButton target={target} />,
    }),
    [],
  );
  return <TranscriptDictationContext.Provider value={api}>{children}</TranscriptDictationContext.Provider>;
}
