/**
 * Component-side view of dictation for one target surface.
 * Reads atoms only; the controller and the central listener do the work.
 */

import { useCallback } from 'react';
import { useAtomValue } from 'jotai';
import {
  activeDictationAtom,
  dictationEnabledAtom,
  dictationFinishingAtom,
  dictationSessionAtomFamily,
  INITIAL_DICTATION_SESSION,
  type DictationStatus,
} from '../store/atoms/dictation';
import { getDictationController } from './dictationController';

const IDLE_ATOM_KEY = '__idle__';

export interface UseDictationResult {
  /** False means render nothing dictation-related. */
  enabled: boolean;
  recording: boolean;
  status: DictationStatus | null;
  /** Recording and real (non-silent) audio is arriving: safe to talk. */
  hearing: boolean;
  /** Recording stopped and the engine is still producing text (Handy transcribes the whole take now). */
  finishing: boolean;
  toggle: () => void;
}

export function useDictation(targetKey: string | null): UseDictationResult {
  const enabled = useAtomValue(dictationEnabledAtom);
  const active = useAtomValue(activeDictationAtom);
  const finishingDictation = useAtomValue(dictationFinishingAtom);
  const recording = !!targetKey && active?.targetKey === targetKey;
  const finishing = !recording && !!targetKey && finishingDictation?.targetKey === targetKey;
  const session = useAtomValue(dictationSessionAtomFamily(recording ? active!.dictationId : IDLE_ATOM_KEY));
  const toggle = useCallback(() => {
    if (targetKey) void getDictationController().toggle(targetKey);
  }, [targetKey]);
  return {
    enabled,
    recording,
    status: recording ? (session ?? INITIAL_DICTATION_SESSION).status : null,
    hearing: recording && !!active?.hearing,
    finishing,
    toggle,
  };
}
