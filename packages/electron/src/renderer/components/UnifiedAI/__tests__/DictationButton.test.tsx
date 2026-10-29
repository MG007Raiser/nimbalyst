import React from 'react';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DictationButton } from '../DictationButton';

const recorder = {
  start: vi.fn(async () => {}),
  stop: vi.fn(async () => ({ pcm16: new Uint8Array([1, 2, 3, 4]), sampleRate: 16_000, durationMs: 1_500 })),
  cancel: vi.fn(),
};
vi.mock('../../../utils/dictationRecorder', () => ({
  DictationRecorder: class {
    start = recorder.start;
    stop = recorder.stop;
    cancel = recorder.cancel;
  },
}));

type DictationApi = Window['electronAPI']['dictation'];
type StatusResult = Awaited<ReturnType<DictationApi['status']>>;
type TranscribeResult = Awaited<ReturnType<DictationApi['transcribe']>>;

const api = {
  status: vi.fn(async (): Promise<StatusResult> => ({ available: true, binaryPath: 'C:\\handy.exe', configuredPath: '', model: '' })),
  transcribe: vi.fn(async (): Promise<TranscribeResult> => ({ success: true, text: 'fix the picker', timings: {} })),
  cancel: vi.fn(async () => ({ cancelled: true })),
  listModels: vi.fn(),
  detect: vi.fn(),
};

async function settle() {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  api.status.mockResolvedValue({ available: true, binaryPath: 'C:\\handy.exe', configuredPath: '', model: '' });
  Object.defineProperty(window, 'electronAPI', { configurable: true, value: { dictation: api } });
});

describe('DictationButton', () => {
  it('records on the first click, transcribes on the second, and hands the text over', async () => {
    const onTranscript = vi.fn();
    render(<DictationButton onTranscript={onTranscript} />);
    await settle();
    const button = screen.getByRole('button', { name: 'Dictate with Handy' });

    fireEvent.click(button);
    await settle();
    expect(recorder.start).toHaveBeenCalledTimes(1);
    expect(button.getAttribute('data-dictation-phase')).toBe('recording');

    fireEvent.click(button);
    await settle();
    expect(recorder.stop).toHaveBeenCalledTimes(1);
    expect(api.transcribe).toHaveBeenCalledWith({ pcm16: new Uint8Array([1, 2, 3, 4]), sampleRate: 16_000 });
    expect(onTranscript).toHaveBeenCalledWith('fix the picker');
    expect(button.getAttribute('data-dictation-phase')).toBe('idle');
  });

  it('stays disabled with the reason when Handy is not installed', async () => {
    api.status.mockResolvedValueOnce({ available: false, configuredPath: '', model: '', reason: 'Handy is not installed' });
    render(<DictationButton onTranscript={vi.fn()} />);
    await settle();
    const button = screen.getByRole('button', { name: 'Dictate with Handy' }) as HTMLButtonElement;
    expect(button.disabled).toBe(true);
    expect(button.title).toContain('Handy is not installed');
  });

  it('discards the take on Escape while recording', async () => {
    const onTranscript = vi.fn();
    render(<DictationButton onTranscript={onTranscript} />);
    await settle();
    fireEvent.click(screen.getByRole('button'));
    await settle();

    fireEvent.keyDown(window, { key: 'Escape' });
    await settle();

    expect(recorder.cancel).toHaveBeenCalledTimes(1);
    expect(recorder.stop).not.toHaveBeenCalled();
    expect(onTranscript).not.toHaveBeenCalled();
    expect(screen.getByRole('button').getAttribute('data-dictation-phase')).toBe('idle');
  });

  it('shows the failure instead of inserting anything when Handy reports an error', async () => {
    api.transcribe.mockResolvedValueOnce({ success: false, error: 'model parakeet-x is not downloaded' });
    const onTranscript = vi.fn();
    render(<DictationButton onTranscript={onTranscript} />);
    await settle();
    fireEvent.click(screen.getByRole('button'));
    await settle();
    fireEvent.click(screen.getByRole('button'));
    await settle();

    expect(onTranscript).not.toHaveBeenCalled();
    expect((screen.getByRole('button') as HTMLButtonElement).title).toBe('model parakeet-x is not downloaded');
  });
});
