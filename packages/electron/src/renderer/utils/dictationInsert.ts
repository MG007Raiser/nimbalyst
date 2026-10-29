/**
 * Where dictated text lands in the composer. Pure, so the spacing rules are
 * unit-tested: the transcript replaces the selection, gets a space before it
 * when it follows a non-space character, and a space after it when it is
 * followed by one or sits at the end of the draft (so the next take or the
 * next typed word does not glue onto it).
 */
export function insertDictatedText(
  value: string,
  selectionStart: number,
  selectionEnd: number,
  transcript: string,
): { value: string; caret: number } {
  const text = transcript.trim();
  const start = Math.max(0, Math.min(selectionStart, value.length));
  const end = Math.max(start, Math.min(selectionEnd, value.length));
  if (!text) {
    return { value, caret: end };
  }
  const before = value.slice(0, start);
  const after = value.slice(end);
  const needsLeadingSpace = before.length > 0 && !/\s$/.test(before);
  const needsTrailingSpace = after.length === 0 || !/^\s/.test(after);
  const inserted = `${needsLeadingSpace ? ' ' : ''}${text}${needsTrailingSpace ? ' ' : ''}`;
  return { value: `${before}${inserted}${after}`, caret: before.length + inserted.length };
}
