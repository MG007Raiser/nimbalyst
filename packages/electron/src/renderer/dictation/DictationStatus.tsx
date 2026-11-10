/**
 * Status row for a dictation target: three pulsing dots, what is happening
 * ("Listening..." while recording, "Transcribing..." while a batch engine such
 * as Handy works on the take after stop) and a live elapsed counter, mirroring
 * the transcript's "Thinking..." row so the user can see at a glance that the
 * microphone is still on. Renders nothing when the target is idle.
 */
import React, { useEffect, useState } from 'react';
import { useDictation } from './useDictation';

export type DictationPhase = 'idle' | 'recording' | 'transcribing';

export function dictationStatusLabel(phase: DictationPhase): string | null {
  if (phase === 'recording') return 'Listening...';
  if (phase === 'transcribing') return 'Transcribing...';
  return null;
}

export function DictationStatus({ targetKey, compact }: { targetKey: string; compact?: boolean }) {
  const { recording, finishing } = useDictation(targetKey);
  const phase: DictationPhase = recording ? 'recording' : finishing ? 'transcribing' : 'idle';
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
  const hint = phase === 'recording' ? 'Click the microphone to finish, Esc to discard' : 'Hold on, the words land at the cursor';

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
      {!compact && (
        <span className="dictation-status-hint not-italic text-[var(--nim-text-faint)] hidden @[28rem]:inline">{hint}</span>
      )}
    </div>
  );
}
