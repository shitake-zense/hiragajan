import { describe, it, expect } from 'vitest';
import { DICTIONARY_WORDS, WORD_SET, isValidWord } from '../public/js/dictionary.js';
import { BASIC_SOUNDS, SPECIAL_SOUNDS } from '../public/js/utils.js';

describe('dictionary データ', () => {
  it('単語が1万語以上ある', () => {
    expect(DICTIONARY_WORDS.length).toBeGreaterThan(10000);
  });

  it('重複がない', () => {
    expect(WORD_SET.size).toBe(DICTIONARY_WORDS.length);
  });

  it('全単語が2〜7文字', () => {
    const bad = DICTIONARY_WORDS.filter(w => w.length < 2 || w.length > 7);
    expect(bad).toEqual([]);
  });

  it('全単語が牌セットの文字だけで構成され、枚数制約内で作れる', () => {
    const limit = {};
    BASIC_SOUNDS.forEach(c => { limit[c] = 2; });
    SPECIAL_SOUNDS.forEach(c => { limit[c] = 1; });
    const bad = DICTIONARY_WORDS.filter(w => {
      const used = {};
      for (const ch of w) {
        if (!limit[ch]) return true;
        used[ch] = (used[ch] || 0) + 1;
        if (used[ch] > limit[ch]) return true;
      }
      return false;
    });
    expect(bad).toEqual([]);
  });
});

describe('isValidWord', () => {
  it('一般的な単語を認識する', () => {
    ['ねこ', 'さくら', 'りんご', 'がっこう', 'らーめん', 'きょう', 'せんせい']
      .forEach(w => expect(isValidWord(w), w).toBe(true));
  });

  it('でたらめな文字列を弾く', () => {
    ['あえおぬ', 'ゃっーぴ', 'んんん', 'ねこさくら']
      .forEach(w => expect(isValidWord(w), w).toBe(false));
  });

  it('完全一致のみ（空文字・1文字は不可）', () => {
    expect(isValidWord('')).toBe(false);
    expect(isValidWord('ね')).toBe(false); // 1文字はそもそも辞書に入れていない
  });
});
