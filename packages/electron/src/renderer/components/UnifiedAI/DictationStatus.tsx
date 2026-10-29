/**
 * Composer status row shown while dictation is active: three pulsing dots,
 * what is happening ("Listening" or "Transcribing") and a live elapsed
 * counter, mirroring the transcript's "Thinking..." row so the operator can
 * see at a glance that the microphone is still on.
 */
import React, { useEffect, useState } from 'react';
import type { DictationPhase } from './DictationButton';

interface DictationStatusProps {
  phase: DictationPhase;
}

export function dictationStatusLabel(phase: DictationPhase): string | null {
  if (phase === 'recording') return 'Listening...';
  if (phase === 'transcribing') return 'Transcribing...';
  return null;
}

export function DictationStatus({ phase }: DictationStatusProps) {
  const [elapsedSeconds, setElapsedSeconds] = useState(0);

  useEffect(() => {
    setElapsedSeconds(0);
    if (phase === 'idle') return;
    const startedAt = Date.now();
    const timer = window.setInterval(() => {
      setElapsedSeconds(Math.floor((Date.now() - startedAt) / 1000));
    }, 500);
    return () => window.clearInterval(timer);
  }, [phase]);

  const label = dictationStatusLabel(phase);
  if (!label) return null;

  const dotColor = phase === 'recording' ? 'bg-[var(--nim-error)]' : 'bg-[var(--nim-primary)]';
  const hint = phase === 'recording' ? 'Click the microphone to transcribe, Esc to discard' : 'Click the microphone to cancel';

  return (
    <div
      className="dictation-status flex items-center gap-2 px-1 text-[12px] text-[var(--nim-text-muted)] italic"
      data-dictation-status={phase}
      role="status"
      aria-live="polite"
    >
      <div className="dictation-status-dots flex gap-1">
        {[0, 0.2, 0.4].map((delay) => (
          <div
            key={delay}
            className={`dictation-status-dot w-2 h-2 rounded-full animate-pulse ${dotColor}`}
            style={{ animationDelay: `${delay}s` }}
          />
        ))}
      </div>
      <span className="dictation-status-text">{label}</span>
      <span className="dictation-status-elapsed tabular-nums not-italic text-[var(--nim-text-faint)]" data-testid="dictation-elapsed">
        {elapsedSeconds}s
      </span>
      <span className="dictation-status-hint not-italic text-[var(--nim-text-faint)] hidden @[28rem]:inline">{hint}</span>
    </div>
  );
}
