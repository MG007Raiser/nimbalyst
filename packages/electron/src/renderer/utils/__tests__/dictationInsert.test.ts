// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { insertDictatedText } from '../dictationInsert';

describe('insertDictatedText', () => {
  it('appends to an empty draft with one trailing space and places the caret after it', () => {
    expect(insertDictatedText('', 0, 0, 'fix the picker')).toEqual({ value: 'fix the picker ', caret: 15 });
  });

  it('separates from the word before the caret and from the word after it', () => {
    expect(insertDictatedText('please', 6, 6, 'fix it')).toEqual({ value: 'please fix it ', caret: 14 });
    // The following " now" already starts with a space, so none is added after.
    expect(insertDictatedText('please now', 6, 6, 'fix it')).toEqual({ value: 'please fix it now', caret: 13 });
  });

  it('does not double spaces that are already there', () => {
    expect(insertDictatedText('please ', 7, 7, ' fix it ')).toEqual({ value: 'please fix it ', caret: 14 });
    expect(insertDictatedText('a  b', 2, 2, 'x')).toEqual({ value: 'a x b', caret: 3 });
  });

  it('replaces the selection', () => {
    expect(insertDictatedText('keep THIS end', 5, 9, 'that')).toEqual({ value: 'keep that end', caret: 9 });
  });

  it('leaves the draft untouched for an empty transcript and clamps odd caret values', () => {
    expect(insertDictatedText('draft', 2, 4, '   ')).toEqual({ value: 'draft', caret: 4 });
    expect(insertDictatedText('ab', 10, 1, 'c')).toEqual({ value: 'ab c ', caret: 5 });
  });
});
