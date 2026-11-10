import { createContext, useContext, type ReactNode } from 'react';

/**
 * What a transcript widget hands the host when it wants a dictation button
 * beside a free-text answer box. The host (desktop app) owns the microphone,
 * the speech-to-text engine and the caret insertion; the widget only exposes
 * its textarea and accepts the new value.
 */
export interface TranscriptDictationTarget {
  /** The textarea the dictated text should land in (null while unmounted). */
  getTextarea: () => HTMLTextAreaElement | null;
  /** Replace the widget's controlled value after insertion. */
  setValue: (value: string) => void;
  disabled?: boolean;
}

export interface TranscriptDictationApi {
  /** Render the host's microphone button for this target, or null when dictation is unavailable. */
  renderButton: (target: TranscriptDictationTarget) => ReactNode;
}

export const TranscriptDictationContext = createContext<TranscriptDictationApi | null>(null);

/** Null outside a host that offers dictation (mobile, standalone widget renders). */
export function useTranscriptDictation(): TranscriptDictationApi | null {
  return useContext(TranscriptDictationContext);
}
