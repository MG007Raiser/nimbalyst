/**
 * The transcript must stay at its true end when its geometry changes without
 * the message list changing: the "Thinking" row giving way to the completed
 * turn, the last row growing, or the viewport shrinking under the raw terminal
 * panel. It must also leave a user who scrolled up alone, and must not move on
 * the post-completion reloads that hand over an equal but fresh array.
 */
import React from 'react';
import { act, render } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { TranscriptViewMessage } from '../../../../ai/server/transcript/TranscriptProjector';
import { RichTranscriptView } from '../RichTranscriptView';

const scrollToIndex = vi.fn();
const listGeometry = { scrollOffset: 200, scrollSize: 300, viewportSize: 100 };
let listProps: { onScroll?: (offset: number) => void } = {};

vi.mock('virtua', async () => {
  const ReactModule = await import('react');
  return {
    VList: ReactModule.forwardRef((props: { children: React.ReactNode; className?: string; onScroll?: (offset: number) => void }, ref) => {
      listProps = props;
      ReactModule.useImperativeHandle(ref, () => ({
        cache: undefined,
        get scrollOffset() { return listGeometry.scrollOffset; },
        get scrollSize() { return listGeometry.scrollSize; },
        get viewportSize() { return listGeometry.viewportSize; },
        findItemIndex: () => 0,
        getItemOffset: () => 0,
        scrollToIndex,
        scrollBy: vi.fn(),
      }));
      return (
        <div className={props.className}>
          <div data-testid="vlist-content">{ReactModule.Children.toArray(props.children)}</div>
        </div>
      );
    }),
  };
});

type ObserverRecord = { callback: ResizeObserverCallback; targets: Element[] };
const observers: ObserverRecord[] = [];
class FakeResizeObserver {
  private record: ObserverRecord;
  constructor(callback: ResizeObserverCallback) {
    this.record = { callback, targets: [] };
    observers.push(this.record);
  }
  observe(target: Element) { this.record.targets.push(target); }
  unobserve() {}
  disconnect() { this.record.targets = []; }
}

function makeMessage(index: number, overrides: Partial<TranscriptViewMessage> = {}): TranscriptViewMessage {
  return {
    id: index + 1,
    sequence: index + 1,
    createdAt: new Date(1_784_648_445_000 + index),
    type: index % 2 === 0 ? 'user_message' : 'assistant_message',
    text: `message ${index}`,
    subagentId: null,
    ...overrides,
  };
}

function view(messages: TranscriptViewMessage[]) {
  return (
    <RichTranscriptView
      sessionId="stick"
      sessionStatus="idle"
      isProcessing={false}
      messages={messages}
      provider="claude-code-cli"
      persistScrollState={false}
    />
  );
}

/** Let the component's requestAnimationFrame callbacks run. */
async function flushFrames() {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 50));
  });
}

function fireResize() {
  act(() => {
    for (const record of observers) {
      if (record.targets.length > 0) record.callback([], record as unknown as ResizeObserver);
    }
  });
}

beforeEach(() => {
  observers.length = 0;
  scrollToIndex.mockClear();
  listGeometry.scrollOffset = 200;
  // Stubs stay in place across the file: testing-library unmounts after each
  // test and the component still touches CSS.highlights on the way out.
  vi.stubGlobal('ResizeObserver', FakeResizeObserver);
  vi.stubGlobal('CSS', { highlights: { delete: vi.fn(), set: vi.fn() } });
});

describe('transcript stick-to-bottom', () => {
  it('observes the list viewport and its content once the list is rendered', async () => {
    render(view([makeMessage(0), makeMessage(1)]));
    await flushFrames();

    const live = observers.filter((record) => record.targets.length > 0);
    expect(live).toHaveLength(1);
    expect(live[0].targets.map((target) => (target as HTMLElement).className.split(' ')[0])).toEqual([
      'rich-transcript-vlist',
      '',
    ]);
  });

  it('re-sticks to the end when the geometry changes while the user is at the bottom', async () => {
    render(view([makeMessage(0), makeMessage(1)]));
    await flushFrames();
    scrollToIndex.mockClear();

    fireResize();
    await flushFrames();

    expect(scrollToIndex).toHaveBeenCalledWith(1, { align: 'end' });
  });

  it('leaves the viewport alone after a resize once the user has scrolled up', async () => {
    render(view([makeMessage(0), makeMessage(1), makeMessage(2)]));
    await flushFrames();
    // The user scrolls to the top: 200px from the bottom is well past the threshold.
    listGeometry.scrollOffset = 0;
    act(() => listProps.onScroll?.(0));
    scrollToIndex.mockClear();

    fireResize();
    await flushFrames();

    expect(scrollToIndex).not.toHaveBeenCalled();
  });

  it('does not scroll on a reload that hands over the same messages in a fresh array', async () => {
    const messages = [makeMessage(0), makeMessage(1)];
    const { rerender } = render(view(messages));
    await flushFrames();
    scrollToIndex.mockClear();

    rerender(view(messages.map((message) => ({ ...message }))));
    await flushFrames();

    expect(scrollToIndex).not.toHaveBeenCalled();
  });

  it('still scrolls when a new message is appended', async () => {
    const messages = [makeMessage(0), makeMessage(1)];
    const { rerender } = render(view(messages));
    await flushFrames();
    scrollToIndex.mockClear();

    rerender(view([...messages, makeMessage(2)]));
    await flushFrames();

    expect(scrollToIndex).toHaveBeenCalledWith(2, { align: 'end' });
  });
});
