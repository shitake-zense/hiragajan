import { describe, it, expect } from 'vitest';
import {
  createShuffledDeck, drawTilesFromDeck, calcWordScore, getNextPlayer,
  validateAgari, detectRoles, calcRoleBonus,
  calcDoraBonus, calcDoraCount, calcSetsDora,
  isHahaSomeWord, getVowelFlow, detectTourentan,
  initWinds, advanceWinds, getWindRowTiles,
  initDoraTiles, addKanDora, VOWEL_MAP
} from '../public/js/utils.js';

// 組を作るヘルパー（tiles配列からセットオブジェクトを生成）
const set = (str, type = 'tsumo') => ({ tiles: str.split(''), word: str, type });

describe('createShuffledDeck', () => {
  it('120枚ちょうど生成する', () => {
    expect(createShuffledDeck()).toHaveLength(120);
  });

  it('基本音は各2枚、特殊音は各1枚', () => {
    const deck = createShuffledDeck();
    const count = {};
    deck.forEach(c => { count[c] = (count[c] || 0) + 1; });
    expect(count['あ']).toBe(2);   // 基本音
    expect(count['か']).toBe(2);
    expect(count['が']).toBe(1);   // 濁音（特殊音）
    expect(count['ー']).toBe(1);   // 長音（特殊音）
  });

  it('シャッフルしても構成は不変', () => {
    const a = createShuffledDeck().slice().sort();
    const b = createShuffledDeck().slice().sort();
    expect(a).toEqual(b);
  });
});

describe('drawTilesFromDeck', () => {
  it('指定枚数を山の末尾から引き、山を破壊的に縮める', () => {
    const deck = ['あ', 'い', 'う', 'え', 'お'];
    const drawn = drawTilesFromDeck(deck, 2);
    expect(drawn).toEqual(['お', 'え']); // pop順
    expect(deck).toEqual(['あ', 'い', 'う']);
  });

  it('山が足りなければあるだけ引く', () => {
    const deck = ['あ'];
    expect(drawTilesFromDeck(deck, 5)).toEqual(['あ']);
  });
});

describe('calcWordScore / getNextPlayer', () => {
  it('文字数×100', () => {
    expect(calcWordScore(['あ', 'い', 'う'])).toBe(300);
  });
  it('次のプレイヤーは循環する', () => {
    const order = ['a', 'b', 'c'];
    expect(getNextPlayer(order, 'a')).toBe('b');
    expect(getNextPlayer(order, 'c')).toBe('a');
  });
});

describe('validateAgari', () => {
  it('ロック0組＋手動5組（手牌完全消費）で成立', () => {
    const submitted = [set('あい'), set('かきく'), set('さしす'), set('たちつ'), set('なにぬ')];
    const hand = 'あいかきくさしすたちつなにぬ'.split('');
    expect(validateAgari([], submitted, hand)).toEqual({ valid: true });
  });

  it('組数不足は不成立', () => {
    const submitted = [set('あい'), set('かきく')];
    const hand = 'あいかきく'.split('');
    const r = validateAgari([], submitted, hand);
    expect(r.valid).toBe(false);
  });

  it('手牌が余ると不成立', () => {
    const submitted = [set('あい'), set('かきく'), set('さしす'), set('たちつ'), set('なにぬ')];
    const hand = 'あいかきくさしすたちつなにぬん'.split(''); // 「ん」が余る
    const r = validateAgari([], submitted, hand);
    expect(r.valid).toBe(false);
    expect(r.reason).toContain('余って');
  });

  it('提出牌が手牌にないと不成立', () => {
    const submitted = [set('あい'), set('かきく'), set('さしす'), set('たちつ'), set('なにを')];
    const hand = 'あいかきくさしすたちつなにぬ'.split(''); // 「を」がない
    const r = validateAgari([], submitted, hand);
    expect(r.valid).toBe(false);
  });

  it('七対子は7組すべて2文字なら成立', () => {
    const submitted = [set('あい'), set('かき'), set('さし'), set('たち'), set('なに'), set('はひ'), set('まみ')];
    const hand = 'あいかきさしたちなにはひまみ'.split('');
    expect(validateAgari([], submitted, hand)).toEqual({ valid: true });
  });

  it('ロック組と手動組を合算して判定する', () => {
    const locked = [set('ぽん', 'pon'), set('かんかん', 'kan')];
    const submitted = [set('さしす'), set('たちつ'), set('なにぬ')];
    const hand = 'さしすたちつなにぬ'.split('');
    expect(validateAgari(locked, submitted, hand)).toEqual({ valid: true });
  });

  it('カンを含む4文字ロック組でも5組ちょうどで成立する', () => {
    const locked = [set('かんかん', 'kan')]; // カンで4文字組
    const submitted = [set('あい'), set('かきく'), set('さしす'), set('たちつ')];
    const hand = 'あいかきくさしすたちつ'.split('');
    expect(validateAgari(locked, submitted, hand)).toEqual({ valid: true });
  });

  it('6組すべて2文字（七対子未満）は専用理由で不成立', () => {
    const submitted = [set('あい'), set('かき'), set('さし'), set('たち'), set('なに'), set('はひ')];
    const hand = 'あいかきさしたちなにはひ'.split('');
    const r = validateAgari([], submitted, hand);
    expect(r.valid).toBe(false);
    expect(r.reason).toContain('七対子は7組必要');
  });
});

describe('detectRoles - 基本役', () => {
  // detectRolesは5組(または7組)を前提に役を判定する
  it('七対子（全7組2文字）を検出する', () => {
    const sets = [set('あい'), set('かき'), set('さし'), set('たち'), set('なに'), set('はひ'), set('まみ')];
    const roles = detectRoles(sets, false, {});
    expect(roles.find(r => r.id === 'chiitoi')).toBeTruthy();
  });

  it('門前自摸: 鳴きなし非立直のツモであがり', () => {
    const sets = [set('あい'), set('かきく'), set('さしす'), set('たちつ'), set('なにぬ')];
    const roles = detectRoles(sets, false, { lockedSets: [] });
    expect(roles.find(r => r.id === 'mentanmo')).toBeTruthy();
  });

  it('鳴きがあれば門前自摸は付かない', () => {
    const sets = [set('あい'), set('かきく'), set('さしす'), set('たちつ'), set('なにぬ')];
    const roles = detectRoles(sets, false, { lockedSets: [set('かきく', 'pon')] });
    expect(roles.find(r => r.id === 'mentanmo')).toBeFalsy();
  });

  it('立直で立直役、riichiAt条件で一発も付く', () => {
    const sets = [set('あい'), set('かきく'), set('さしす'), set('たちつ'), set('なにぬ')];
    const roles = detectRoles(sets, true, { lockedSets: [], riichiAt: 4, turnCount: 5, playerCount: 2 });
    expect(roles.find(r => r.id === 'riichi')).toBeTruthy();
    expect(roles.find(r => r.id === 'ippatsu')).toBeTruthy();
  });

  it('立直から時間が経つと一発は付かない', () => {
    const sets = [set('あい'), set('かきく'), set('さしす'), set('たちつ'), set('なにぬ')];
    const roles = detectRoles(sets, true, { lockedSets: [], riichiAt: 4, turnCount: 20, playerCount: 2 });
    expect(roles.find(r => r.id === 'ippatsu')).toBeFalsy();
  });

  it('対々和: ロック4組すべてポン/カン', () => {
    const locked = [set('あい', 'pon'), set('かき', 'pon'), set('さし', 'kan'), set('たち', 'pon')];
    const sets = locked.concat([set('なにぬ')]);
    const roles = detectRoles(sets, false, { lockedSets: locked });
    expect(roles.find(r => r.id === 'toitoi')).toBeTruthy();
  });
});

describe('detectRoles - 母音・文字パターン役', () => {
  it('母染め: 母音統一の組が3組以上', () => {
    // さかな(a-a-a), たまな(a-a-a), はやま(a-a-a)
    const sets = [set('さかな'), set('たまな'), set('はやま'), set('きく'), set('けこ')];
    const roles = detectRoles(sets, false, {});
    expect(roles.find(r => r.id === 'haha')).toBeTruthy();
  });

  it('同字入: 同じ文字が重複する単語が2種以上', () => {
    const sets = [set('ささ'), set('きき'), set('くけこ'), set('たちつ'), set('なにぬ')];
    const roles = detectRoles(sets, false, {});
    expect(roles.find(r => r.id === 'tonzururu')).toBeTruthy();
  });

  it('同単嬉々: 全く同じ単語が2組', () => {
    const sets = [set('さかな'), set('さかな'), set('くけこ'), set('たちつ'), set('なにぬ')];
    const roles = detectRoles(sets, false, {});
    expect(roles.find(r => r.id === 'doutankiki')).toBeTruthy();
  });

  // 注意: 5組すべてが2文字だと detectRoles は七対子と判定し、これらの役の
  //       閾値が変わる（断濁母は七対子時は無効）。3文字組を混ぜて回避する。
  it('混濁母: 濁音・半濁音を含む組が3組以上', () => {
    const sets = [set('がぎ'), set('ざじ'), set('だぢ'), set('かきく'), set('さしす')];
    const roles = detectRoles(sets, false, {});
    expect(roles.find(r => r.id === 'kondakubo')).toBeTruthy();
  });

  it('断濁母: あ行・濁音・半濁音が全組に一切ない', () => {
    const sets = [set('かきく'), set('さし'), set('たち'), set('なに'), set('はひ')];
    const roles = detectRoles(sets, false, {});
    expect(roles.find(r => r.id === 'dandakubo')).toBeTruthy();
  });

  it('あ行が混ざると断濁母は成立しない', () => {
    const sets = [set('あきく'), set('さし'), set('たち'), set('なに'), set('はひ')];
    const roles = detectRoles(sets, false, {});
    expect(roles.find(r => r.id === 'dandakubo')).toBeFalsy();
  });
});

describe('detectTourentan（頭連単）', () => {
  it('同じ行の頭文字で母音が3つ連続すると検出する', () => {
    // か行のあ・い・う段: か○○ / き○○ / く○○
    const sets = [set('かさ'), set('きし'), set('くす'), set('たち'), set('なに')];
    const r = detectTourentan(sets);
    expect(r).toBeTruthy();
    expect(r.count).toBeGreaterThanOrEqual(3);
  });

  it('連続しない母音では検出しない', () => {
    // か行のあ段とう段のみ（い段が抜けて非連続）
    const sets = [set('かさ'), set('くす'), set('たち'), set('なに'), set('はひ')];
    expect(detectTourentan(sets)).toBeNull();
  });
});

describe('母音ヘルパー', () => {
  it('isHahaSomeWord: 母音統一を判定', () => {
    expect(isHahaSomeWord(['さ', 'か', 'な'])).toBe(true);   // a-a-a
    expect(isHahaSomeWord(['あ', 'き'])).toBe(false);        // a-i
  });
  it('getVowelFlow: ん・ーを除いた母音列', () => {
    expect(getVowelFlow(['あ', 'き', 'す'])).toBe('aiu');
    expect(getVowelFlow(['か', 'ん', 'ー'])).toBe('a');
  });
});

describe('ドラ計算', () => {
  const dora = { 'か': 1, 'き': 2 }; // き は倍ドラ

  it('calcDoraBonus: 場風ドラを倍率込みで加算', () => {
    expect(calcDoraBonus(['か', 'き', 'く'], dora, 500)).toBe(500 + 1000); // か×1 + き×2
  });

  it('calcSetsDora: あいうえおは全組通じて各1枚まで', () => {
    const sets = [set('ああ'), set('あい')]; // 「あ」は3回出るが1枚分のみ
    // あ1枚(500) + い1枚(500) = 1000、場風ドラなし
    expect(calcSetsDora(sets, {}, 500)).toBe(1000);
  });

  it('calcDoraCount: 倍ドラは枚数1・倍率2で詳細に出る', () => {
    const sets = [set('きき')]; // き×2枚、各き倍率2
    const info = calcDoraCount(sets, dora);
    const ki = info.detail.find(d => d.tile === 'き');
    expect(ki.mult).toBe(2);
    expect(ki.times).toBe(2);
  });
});

describe('風システム', () => {
  it('initWinds: 場風と各プレイヤー風が割り当てられる', () => {
    const w = initWinds(['a', 'b']);
    expect(w.ba).toBeTruthy();
    expect(w.a).toBeTruthy();
    expect(w.b).toBeTruthy();
  });

  it('advanceWinds: 場風が1つ進む', () => {
    const w1 = { ba: 'あ風', a: 'い風', b: 'う風' };
    const w2 = advanceWinds(w1, ['a', 'b']);
    expect(w2.ba).toBe('い風');
  });

  it('getWindRowTiles: 母音段の牌をすべて返す', () => {
    const aRow = getWindRowTiles('a');
    expect(aRow).toContain('か');
    expect(aRow).toContain('さ');
    expect(aRow).not.toContain('き'); // い段は含まない
  });

  it('共鳴風: 場風5枚以上かつ自風5枚以上（場風≠自風）', () => {
    // 場風=あ段(a), 自風=い段(i)
    // a段牌5枚: か さ た な は / i段牌5枚: き し ち に ひ
    const sets = [set('かさ'), set('たな'), set('はき'), set('しち'), set('にひ')];
    const roles = detectRoles(sets, false, { baWind: 'あ風', myWind: 'い風' });
    expect(roles.find(r => r.id === 'kyomei')).toBeTruthy();
  });
});

describe('calcRoleBonus', () => {
  it('役スコアの合計', () => {
    expect(calcRoleBonus([{ score: 500 }, { score: 800 }])).toBe(1300);
  });
});

describe('initDoraTiles', () => {
  it('場風の段の牌のみ・最大2種・あいうえおは含まない', () => {
    const aiueo = new Set(['あ', 'い', 'う', 'え', 'お']);
    // 全母音段で繰り返し検証（ランダム選択のため複数回）
    ['あ風', 'い風', 'う風', 'え風', 'お風'].forEach(baWind => {
      const expectVowel = { 'あ風': 'a', 'い風': 'i', 'う風': 'u', 'え風': 'e', 'お風': 'o' }[baWind];
      for (let n = 0; n < 20; n++) {
        const dora = initDoraTiles(baWind);
        const keys = Object.keys(dora);
        expect(keys.length).toBeLessThanOrEqual(2); // 最大2種
        keys.forEach(tile => {
          expect(aiueo.has(tile)).toBe(false);        // あいうえおを含まない
          expect(VOWEL_MAP[tile]).toBe(expectVowel);  // 場風の段の牌のみ
        });
      }
    });
  });

  it('場風が不正なら空オブジェクト', () => {
    expect(initDoraTiles('')).toEqual({});
    expect(initDoraTiles('ん風')).toEqual({});
  });
});

describe('addKanDora', () => {
  it('呼び出し後にドラ枚数の合計が1増える', () => {
    const before = { 'か': 1 };
    const totalBefore = Object.values(before).reduce((s, v) => s + v, 0);
    const after = addKanDora(before, 'あ風');
    const totalAfter = Object.values(after).reduce((s, v) => s + v, 0);
    expect(totalAfter).toBe(totalBefore + 1); // 新種追加 or 既存倍率アップのどちらでも合計+1
  });

  it('追加された牌は場風の段（あいうえお除く）', () => {
    const after = addKanDora({}, 'あ風');
    const keys = Object.keys(after);
    expect(keys.length).toBe(1);
    expect(VOWEL_MAP[keys[0]]).toBe('a');
    expect(['あ', 'い', 'う', 'え', 'お']).not.toContain(keys[0]);
  });

  it('場風が不明なら変更しない', () => {
    const before = { 'か': 1 };
    expect(addKanDora(before, '')).toEqual(before);
    expect(addKanDora(before, 'ん風')).toEqual(before);
  });
});
