/**
 * Composer microphone: press to record, press again to transcribe offline
 * through Handy, and the text lands at the caret. Esc cancels a recording.
 * Nothing is sent automatically; the operator reviews and presses Enter.
 */
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { MaterialSymbol } from '@nimbalyst/runtime/ui/icons/MaterialSymbol';
import { DictationRecorder } from '../../utils/dictationRecorder';

type DictationPhase = 'idle' | 'recording' | 'transcribing';

interface DictationButtonProps {
  onTranscript: (text: string) => void;
  disabled?: boolean;
}

const ERROR_DISPLAY_MS = 6_000;

export function DictationButton({ onTranscript, disabled = false }: DictationButtonProps) {
  const [phase, setPhase] = useState<DictationPhase>('idle');
  const [available, setAvailable] = useState<boolean | null>(null);
  const [unavailableReason, setUnavailableReason] = useState<string>('');
  const [error, setError] = useState<string | null>(null);
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const recorderRef = useRef<DictationRecorder | null>(null);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    const api = window.electronAPI?.dictation;
    if (!api) {
      setAvailable(false);
      setUnavailableReason('Dictation is not available in this build');
      return;
    }
    api.status().then((status) => {
      if (!mountedRef.current) return;
      setAvailable(status.available);
      setUnavailableReason(status.reason ?? '');
    }).catch(() => {
      if (!mountedRef.current) return;
      setAvailable(false);
      setUnavailableReason('Could not check Handy');
    });
    return () => {
      mountedRef.current = false;
      recorderRef.current?.cancel();
      recorderRef.current = null;
    };
  }, []);

  useEffect(() => {
    if (phase !== 'recording') {
      setElapsedSeconds(0);
      return;
    }
    const startedAt = Date.now();
    const timer = window.setInterval(() => setElapsedSeconds(Math.floor((Date.now() - startedAt) / 1000)), 500);
    return () => window.clearInterval(timer);
  }, [phase]);

  useEffect(() => {
    if (!error) return;
    const timer = window.setTimeout(() => setError(null), ERROR_DISPLAY_MS);
    return () => window.clearTimeout(timer);
  }, [error]);

  const cancelRecording = useCallback(() => {
    recorderRef.current?.cancel();
    recorderRef.current = null;
    setPhase('idle');
  }, []);

  useEffect(() => {
    if (phase !== 'recording') return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        cancelRecording();
      }
    };
    window.addEventListener('keydown', onKeyDown, true);
    return () => window.removeEventListener('keydown', onKeyDown, true);
  }, [phase, cancelRecording]);

  const startRecording = useCallback(async () => {
    const recorder = new DictationRecorder();
    try {
      await recorder.start();
      recorderRef.current = recorder;
      setError(null);
      setPhase('recording');
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setError(/denied|permission|NotAllowed/i.test(message) ? 'Microphone access was denied' : `Microphone error: ${message}`);
    }
  }, []);

  const stopAndTranscribe = useCallback(async () => {
    const recorder = recorderRef.current;
    if (!recorder) return;
    recorderRef.current = null;
    setPhase('transcribing');
    try {
      const take = await recorder.stop();
      if (take.durationMs < 300) {
        setError('That was too short to transcribe');
        return;
      }
      const result = await window.electronAPI.dictation.transcribe({ pcm16: take.pcm16, sampleRate: take.sampleRate });
      if (!mountedRef.current) return;
      if (!result.success) {
        if (!result.cancelled) setError(result.error);
        return;
      }
      if (result.text) {
        onTranscript(result.text);
      } else {
        setError('Handy heard nothing in that take');
      }
    } catch (err) {
      if (mountedRef.current) setError(err instanceof Error ? err.message : String(err));
    } finally {
      if (mountedRef.current) setPhase('idle');
    }
  }, [onTranscript]);

  const cancelTranscription = useCallback(() => {
    void window.electronAPI.dictation.cancel();
  }, []);

  const handleClick = useCallback(() => {
    if (phase === 'idle') void startRecording();
    else if (phase === 'recording') void stopAndTranscribe();
    else cancelTranscription();
  }, [phase, startRecording, stopAndTranscribe, cancelTranscription]);

  const isUnavailable = available === false;
  const title = error
    ? error
    : isUnavailable
      ? `${unavailableReason || 'Handy is not available'}. Install Handy and pick a model in Settings > Dictation.`
      : phase === 'recording'
        ? `Recording ${elapsedSeconds}s. Click to transcribe, Esc to discard`
        : phase === 'transcribing'
          ? 'Transcribing with Handy. Click to cancel'
          : 'Dictate with Handy (offline)';

  const stateClasses = error
    ? 'text-[var(--nim-error)]'
    : phase === 'recording'
      ? 'bg-[var(--nim-error)] text-white animate-pulse'
      : phase === 'transcribing'
        ? 'text-[var(--nim-primary)]'
        : 'text-[var(--nim-text-muted)] hover:enabled:text-[var(--nim-text)] hover:enabled:bg-[var(--nim-bg-hover)]';

  return (
    <button
      type="button"
      className={`dictation-button w-9 h-9 flex items-center justify-center rounded-md border-none bg-transparent cursor-pointer transition-all duration-200 shrink-0 disabled:opacity-40 disabled:cursor-not-allowed ${stateClasses}`}
      data-dictation-phase={phase}
      onClick={handleClick}
      disabled={disabled || isUnavailable || available === null}
      title={title}
      aria-label={phase === 'recording' ? 'Stop recording and transcribe' : phase === 'transcribing' ? 'Cancel transcription' : 'Dictate with Handy'}
      aria-pressed={phase === 'recording'}
    >
      <MaterialSymbol
        icon={error ? 'mic_off' : phase === 'recording' ? 'stop' : phase === 'transcribing' ? 'progress_activity' : 'mic'}
        size={18}
        className={phase === 'transcribing' ? 'animate-spin' : undefined}
      />
    </button>
  );
}
