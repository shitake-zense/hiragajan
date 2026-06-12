/**
 * utils.js  ―  ひらがじゃん v3
 * 牌セット定義・山札生成・あがり判定
 */

// ============================================================
// 牌セット定義（計120枚）
// ============================================================

/** 基本45音 × 2枚 = 90枚（「を」は除く） */
const BASIC_SOUNDS = [
  "あ","い","う","え","お",
  "か","き","く","け","こ",
  "さ","し","す","せ","そ",
  "た","ち","つ","て","と",
  "な","に","ぬ","ね","の",
  "は","ひ","ふ","へ","ほ",
  "ま","み","む","め","も",
  "や","ゆ","よ",
  "ら","り","る","れ","ろ",
  "わ","ん"
]; // 45音 ✅

/** 濁音・半濁音・拗音・長音 × 1枚 = 30枚 */
const SPECIAL_SOUNDS = [
  // 濁音 20音
  "が","ぎ","ぐ","げ","ご",
  "ざ","じ","ず","ぜ","ぞ",
  "だ","ぢ","づ","で","ど",
  "ば","び","ぶ","べ","ぼ",
  // 半濁音 5音
  "ぱ","ぴ","ぷ","ぺ","ぽ",
  // 拗音 4音（小書き）
  "ゃ","ゅ","ょ","っ",
  // 長音 1音
  "ー"
]; // 30音 ✅

// 合計: 45×2 + 30×1 = 120枚

/** 各プレイヤーの最初の手牌枚数 */
const INITIAL_HAND_SIZE = 13;

/** あがりに必要な組数 */
const WIN_SET_COUNT = 5;

// ============================================================
// プレイヤーID管理
// ============================================================

function getOrCreatePlayerId() {
  let id = sessionStorage.getItem("playerId");
  if (!id) {
    id = "p_" + Math.random().toString(36).substr(2, 9);
    sessionStorage.setItem("playerId", id);
  }
  return id;
}

function savePlayerName(name) { sessionStorage.setItem("playerName", name); }
function getPlayerName()      { return sessionStorage.getItem("playerName") || "名無し"; }

// ============================================================
// 山札生成・シャッフル
// ============================================================

/**
 * 120枚のシャッフル済み山札を作る
 * @returns {string[]}
 */
function createShuffledDeck() {
  const deck = [];

  // 基本音 × 2
  for (const c of BASIC_SOUNDS)   { deck.push(c, c); }
  // 特殊音 × 1
  for (const c of SPECIAL_SOUNDS) { deck.push(c); }

  // Fisher-Yates シャッフル
  for (let i = deck.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [deck[i], deck[j]] = [deck[j], deck[i]];
  }

  return deck; // 120枚
}

/**
 * デッキの末尾からN枚引く（末尾 = 山の上）
 * @param {string[]} deck - 山札（破壊的変更）
 * @param {number} n
 * @returns {string[]} 引いた牌
 */
function drawTilesFromDeck(deck, n) {
  const drawn = [];
  for (let i = 0; i < n; i++) {
    if (deck.length === 0) break;
    drawn.push(deck.pop());
  }
  return drawn;
}

// ============================================================
// ルームID生成
// ============================================================

function generateRoomId() {
  return Math.floor(100000 + Math.random() * 900000).toString();
}

// ============================================================
// 点数ルール（現行: 文字数×100）
// 将来バランス調整の可能性あり。変更時はこのセクションの定数・関数のみ修正する。
// ============================================================

/** 単語点: 1文字あたりの点数 */
const SCORE_PER_TILE = 100;
/** あがり時のドラ1枚あたりの点数 */
const DORA_BONUS_AGARI = 500;
/** ポン/カン仮加算時のドラ1枚あたりの点数 */
const DORA_BONUS_TEMP = 200;

/** 単語点: 文字数×SCORE_PER_TILE */
function calcWordScore(tiles) {
  return tiles.length * SCORE_PER_TILE;
}

/**
 * ポン/カン時の仮加算点: (文字数-1)×SCORE_PER_TILE
 * あがり時に calcAgariBreakdown が ponKanScore ごと差し引き、
 * calcWordScore の正規点で再計算する（二段階スコア計算）
 */
function calcPonKanTempScore(tiles) {
  return (tiles.length - 1) * SCORE_PER_TILE;
}

// ============================================================
// ターン管理
// ============================================================

function getNextPlayer(playerOrder, currentId) {
  const idx = playerOrder.indexOf(currentId);
  return playerOrder[(idx + 1) % playerOrder.length];
}

// ============================================================
// あがり判定
// ============================================================

/**
 * あがりが成立するか判定する
 *
 * 条件:
 *  1. ロック済み組 + 手動提出組 = ちょうど5組
 *  2. 提出組の牌がすべて手牌に存在する（余りなし）
 *  3. 各組は2文字以上
 *
 * Note: 厳密な「2文字×1・3文字×4」のチェックはここでは行わない。
 *       カンで4文字組が出る可能性があるため、MVP段階では枚数のみ確認する。
 *
 * @param {Array}    lockedSets    - ポン・カンで確定済みの組
 * @param {Array}    submittedSets - プレイヤーが今回提出する組
 * @param {string[]} hand          - 現在の手牌
 * @returns {{ valid: boolean, reason?: string }}
 */
function validateAgari(lockedSets, submittedSets, hand) {
  const locked  = lockedSets  || [];
  const allSets = [...locked, ...submittedSets];

  // 1. 組数チェック（通常5組 or 七対子7組）
  // 七対子: 全組が2文字 かつ 7組の場合のみ許容
  var isChiitoiAttempt = allSets.length > 0 && allSets.every(function(s) { return s.tiles.length === 2; });
  var requiredSets     = (isChiitoiAttempt && allSets.length === 7) ? 7 : WIN_SET_COUNT;
  if (allSets.length !== requiredSets) {
    if (isChiitoiAttempt && allSets.length < 7) {
      return { valid: false, reason: '七対子は7組必要です（現在 ' + allSets.length + ' 組）' };
    }
    return { valid: false, reason: WIN_SET_COUNT + '組必要です（現在 ' + allSets.length + ' 組）' };
  }

  // 2. 手牌の牌がすべて使われているか
  const remaining = [...hand];
  for (const set of submittedSets) {
    for (const tile of set.tiles) {
      const idx = remaining.indexOf(tile);
      if (idx === -1) {
        return { valid: false, reason: `「${tile}」が手牌にありません` };
      }
      remaining.splice(idx, 1);
    }
  }
  if (remaining.length > 0) {
    return { valid: false, reason: `手牌が ${remaining.length} 枚余っています（全部使ってください）` };
  }

  // 3. 各組が2文字以上か
  for (const set of allSets) {
    if (!set.tiles || set.tiles.length < 2) {
      return { valid: false, reason: "各組は2文字以上必要です" };
    }
  }

  return { valid: true };
}

/**
 * 牌の並べ替えのいずれかが辞書語になるか判定する（立直の待ち牌検証用）
 * @param {string[]} tiles   - 判定する牌（立直の残り手牌＋待ち牌。高々4〜5枚を想定し全順列を試す）
 * @param {Function} isValid - 単語判定関数（例: dictionary.js の isValidWord）
 * @returns {boolean}
 */
function canFormDictWord(tiles, isValid) {
  if (!tiles || tiles.length === 0) return false;
  var found = false;
  var permute = function(rest, acc) {
    if (found) return;
    if (rest.length === 0) {
      if (isValid(acc.join(''))) found = true;
      return;
    }
    var seen = {};
    for (var i = 0; i < rest.length; i++) {
      if (seen[rest[i]]) continue; // 同じ牌から始まる順列はスキップ（重複防止）
      seen[rest[i]] = true;
      var next = rest.slice(); next.splice(i, 1);
      permute(next, acc.concat([rest[i]]));
    }
  };
  permute(tiles.slice(), []);
  return found;
}

console.log(`✅ utils.js 読み込み完了 | 牌総数: ${BASIC_SOUNDS.length * 2 + SPECIAL_SOUNDS.length}枚`);

// ============================================================
// 役システム
// ============================================================

/**
 * 母音マップ（母染め判定用）
 * 各ひらがなの母音を返す。ん・ーは特殊扱い。
 *   さかな → さ(a) か(a) な(a) → 全てa → 母染め成立
 *   おとこ → お(o) と(o) こ(o) → 全てo → 母染め成立
 */
const VOWEL_MAP = {
  // あ段
  'あ':'a','か':'a','さ':'a','た':'a','な':'a','は':'a','ま':'a','や':'a','ら':'a','わ':'a',
  'が':'a','ざ':'a','だ':'a','ば':'a','ぱ':'a','ゃ':'a',
  // い段
  'い':'i','き':'i','し':'i','ち':'i','に':'i','ひ':'i','み':'i','り':'i',
  'ぎ':'i','じ':'i','ぢ':'i','び':'i','ぴ':'i',
  // う段
  'う':'u','く':'u','す':'u','つ':'u','ぬ':'u','ふ':'u','む':'u','ゆ':'u','る':'u',
  'ぐ':'u','ず':'u','づ':'u','ぶ':'u','ぷ':'u','っ':'u','ゅ':'u',
  // え段
  'え':'e','け':'e','せ':'e','て':'e','ね':'e','へ':'e','め':'e','れ':'e',
  'げ':'e','ぜ':'e','で':'e','べ':'e','ぺ':'e',
  // お段
  'お':'o','こ':'o','そ':'o','と':'o','の':'o','ほ':'o','も':'o','よ':'o','ろ':'o',
  'ご':'o','ぞ':'o','ど':'o','ぼ':'o','ぽ':'o','ょ':'o',
  // 特殊
  'ん':'n', 'ー':'long'
};

/**
 * 行マップ（頭連単判定用）
 * 各ひらがながどの行に属するかを返す。清音・濁音・半濁音を統合。
 * 行が同じ = 子音グループが同じ（か行なら k, は行なら h, など）
 */
var ROW_MAP = {
  // あ行
  'あ':'あ行','い':'あ行','う':'あ行','え':'あ行','お':'あ行',
  // か行（濁音含む）
  'か':'か行','き':'か行','く':'か行','け':'か行','こ':'か行',
  'が':'か行','ぎ':'か行','ぐ':'か行','げ':'か行','ご':'か行',
  // さ行
  'さ':'さ行','し':'さ行','す':'さ行','せ':'さ行','そ':'さ行',
  'ざ':'さ行','じ':'さ行','ず':'さ行','ぜ':'さ行','ぞ':'さ行',
  // た行
  'た':'た行','ち':'た行','つ':'た行','て':'た行','と':'た行',
  'だ':'た行','ぢ':'た行','づ':'た行','で':'た行','ど':'た行',
  // な行
  'な':'な行','に':'な行','ぬ':'な行','ね':'な行','の':'な行',
  // は行（濁音・半濁音含む）
  'は':'は行','ひ':'は行','ふ':'は行','へ':'は行','ほ':'は行',
  'ば':'は行','び':'は行','ぶ':'は行','べ':'は行','ぼ':'は行',
  'ぱ':'は行','ぴ':'は行','ぷ':'は行','ぺ':'は行','ぽ':'は行',
  // ま行
  'ま':'ま行','み':'ま行','む':'ま行','め':'ま行','も':'ま行',
  // や行
  'や':'や行','ゆ':'や行','よ':'や行',
  // ら行
  'ら':'ら行','り':'ら行','る':'ら行','れ':'ら行','ろ':'ら行',
  // わ行
  'わ':'わ行','を':'わ行'
};

// 母音の順序（あいうえお = 0〜4）
var VOWEL_POSITION = { 'a': 0, 'i': 1, 'u': 2, 'e': 3, 'o': 4 };
var VOWEL_LABEL    = { 0: 'あ', 1: 'い', 2: 'う', 3: 'え', 4: 'お' };

/**
 * 頭連単を検出する
 * @param {Array} allSets - 全組（tiles配列を持つオブジェクト）
 * @returns {{ count, row, vowelLabels }} or null
 */
function detectTourentan(allSets) {
  // 各組の頭文字から「行」と「母音位置」を取得してグループ化
  var rowGroups = {}; // { "は行": { 0: true, 1: true, 2: true, ... } }
  allSets.forEach(function(set) {
    if (!set.tiles || set.tiles.length === 0) return;
    var first  = set.tiles[0];
    var row    = ROW_MAP[first];
    var vowel  = VOWEL_MAP[first];
    if (!row || !vowel || vowel === 'n' || vowel === 'long') return;
    var vPos = VOWEL_POSITION[vowel];
    if (vPos === undefined) return;
    if (!rowGroups[row]) rowGroups[row] = {};
    rowGroups[row][vPos] = true;
  });

  // 各行グループで連続する母音の最長ランを探す
  var bestCount  = 0;
  var bestRow    = '';
  var bestLabels = [];

  Object.keys(rowGroups).forEach(function(row) {
    var positions = Object.keys(rowGroups[row]).map(Number).sort(function(a, b) { return a - b; });
    // 連続ランを探す
    var curStart = 0;
    var curLen   = 1;
    var maxLen   = 1;
    var maxStart = 0;
    for (var i = 1; i < positions.length; i++) {
      if (positions[i] === positions[i - 1] + 1) {
        curLen++;
        if (curLen > maxLen) { maxLen = curLen; maxStart = curStart; }
      } else {
        curLen = 1; curStart = i;
      }
    }
    if (maxLen >= 3 && maxLen > bestCount) {
      bestCount = maxLen;
      bestRow   = row;
      // 連続する母音のラベルを生成（例: ["あ","い","う"]）
      bestLabels = positions.slice(maxStart, maxStart + maxLen).map(function(p) { return VOWEL_LABEL[p]; });
    }
  });

  if (bestCount < 3) return null;
  return { count: bestCount, row: bestRow, vowelLabels: bestLabels };
}

/**
 * 単語（tiles配列）が母染め条件を満たすか
 * ん・ーを除いた文字の母音が全て同じであれば true
 */
function isHahaSomeWord(tiles) {
  var vowelTiles = tiles.filter(function(c) {
    var v = VOWEL_MAP[c];
    return v && v !== 'n' && v !== 'long';
  });
  if (vowelTiles.length < 2) return false;
  var first = VOWEL_MAP[vowelTiles[0]];
  return vowelTiles.every(function(c) { return VOWEL_MAP[c] === first; });
}

// ============================================================
// 濁音・半濁音・あ行 判定セット
// ============================================================

// 濁音セット（が行・ざ行・だ行・ば行）
var DAKUTEN_SET = new Set([
  'が','ぎ','ぐ','げ','ご',
  'ざ','じ','ず','ぜ','ぞ',
  'だ','ぢ','づ','で','ど',
  'ば','び','ぶ','べ','ぼ'
]);

// 半濁音セット（ぱ行）
var HANDAKUTEN_SET = new Set(['ぱ','ぴ','ぷ','ぺ','ぽ']);

// あ行セット
var A_ROW_SET = new Set(['あ','い','う','え','お']);

/** 組のどこかに濁音・半濁音が含まれるか */
function hasDakuten(tiles) {
  return tiles.some(function(c) { return DAKUTEN_SET.has(c) || HANDAKUTEN_SET.has(c); });
}

/**
 * 断濁母の条件チェック
 * 全組の全文字に「あ行・濁音・半濁音」が一切含まれなければ true
 */
function isDandakubo(allSets) {
  return allSets.every(function(set) {
    return (set.tiles || []).every(function(c) {
      return !A_ROW_SET.has(c) && !DAKUTEN_SET.has(c) && !HANDAKUTEN_SET.has(c);
    });
  });
}

// 拗音・長音セット（小書き文字 + ー）
var YOON_SET = new Set(['ぁ','ぃ','ぅ','ぇ','ぉ','っ','ゃ','ゅ','ょ','ゎ','ー']);

/** 組のどこかに拗音・長音が含まれるか */
function hasYoon(tiles) {
  return tiles.some(function(c) { return YOON_SET.has(c); });
}

/** 同字入: 1つの単語に同じ文字が複数使われているか */
function hasDuplicateChar(tiles) {
  var seen = {};
  for (var i = 0; i < tiles.length; i++) {
    if (seen[tiles[i]]) return true;
    seen[tiles[i]] = true;
  }
  return false;
}

/**
 * 単語の「母音の流れ」を文字列で返す
 * ん・ーは除外して母音だけを並べた文字列
 * 例: あきす → "aiu" / かしつ → "aiu" / おけ → "oe"
 */
function getVowelFlow(tiles) {
  return tiles.map(function(c) {
    var v = VOWEL_MAP[c];
    return (v && v !== 'n' && v !== 'long') ? v : null;
  }).filter(function(v) { return v !== null; }).join('');
}

// ============================================================
// 風・ドラシステム
// ============================================================

const WIND_VOWELS = ['a', 'i', 'u', 'e', 'o'];
const WIND_NAMES  = { a: 'あ風', i: 'い風', u: 'う風', e: 'え風', o: 'お風' };
const WIND_LABELS = ['あ', 'い', 'う', 'え', 'お'];

/**
 * 風を初期化する
 * @param {string[]} playerOrder - プレイヤーID配列
 * @returns {{ ba: string, [pid]: string }} 各プレイヤーと場の風
 */
function initWinds(playerOrder) {
  var start  = Math.floor(Math.random() * 5);
  var result = { ba: WIND_NAMES[WIND_VOWELS[start]] };
  playerOrder.forEach(function(pid, i) {
    result[pid] = WIND_NAMES[WIND_VOWELS[(start + 1 + i) % 5]];
  });
  return result;
}

/**
 * ラウンドが進んだ時に風を1つ進める
 * @param {Object} winds - 現在の風オブジェクト
 * @param {string[]} playerOrder
 */
function advanceWinds(winds, playerOrder) {
  var baVowel = WIND_VOWELS.find(function(v) { return WIND_NAMES[v] === winds.ba; }) || 'a';
  var newStart = (WIND_VOWELS.indexOf(baVowel) + 1) % 5;
  var result   = { ba: WIND_NAMES[WIND_VOWELS[newStart]] };
  playerOrder.forEach(function(pid, i) {
    result[pid] = WIND_NAMES[WIND_VOWELS[(newStart + 1 + i) % 5]];
  });
  return result;
}

/**
 * 場風の母音に対応するドラ候補牌を返す
 * BASIC_SOUNDS + SPECIAL_SOUNDS の中で VOWEL_MAP が一致するもの
 */
function getWindRowTiles(windVowel) {
  var allTiles = BASIC_SOUNDS.concat(SPECIAL_SOUNDS);
  return allTiles.filter(function(c) { return VOWEL_MAP[c] === windVowel; });
}

/**
 * ドラを初期化する
 * @param {string} baWind - 場風の名前（例: "あ風"）
 * @returns {Object} doraTiles: { tile: multiplier }
 */
function initDoraTiles(baWind) {
  var dora = {};

  // あいうえおは常にドラ扱い（calcDoraBonus で別途処理するためここには入れない）

  // 場風の母音を特定
  var baVowel = null;
  WIND_VOWELS.forEach(function(v) { if (WIND_NAMES[v] === baWind) baVowel = v; });

  if (baVowel) {
    var candidates = getWindRowTiles(baVowel).filter(function(c) {
      return !WIND_LABELS.includes(c); // あいうえおは除く（既にドラ）
    });
    // ランダムに2種選んでドラに追加
    shuffleArray(candidates);
    for (var i = 0; i < Math.min(2, candidates.length); i++) {
      dora[candidates[i]] = (dora[candidates[i]] || 0) + 1;
    }
  }

  return dora;
}

/**
 * カン時に場風の段からランダム1種ドラ追加
 * @param {Object} doraTiles - 現在のドラ
 * @param {string} baWind    - 場風の名前
 * @returns {Object} 更新後のドラ
 */
function addKanDora(doraTiles, baWind) {
  var baVowel = null;
  WIND_VOWELS.forEach(function(v) { if (WIND_NAMES[v] === baWind) baVowel = v; });
  if (!baVowel) return doraTiles;

  var candidates = getWindRowTiles(baVowel).filter(function(c) {
    return !WIND_LABELS.includes(c);
  });
  if (candidates.length === 0) return doraTiles;

  // ランダム1種（重複の可能性あり → 倍ドラになる）
  var picked = candidates[Math.floor(Math.random() * candidates.length)];
  var updated = Object.assign({}, doraTiles);
  updated[picked] = (updated[picked] || 0) + 1;
  return updated;
}

/** 配列をシャッフル（Fisher-Yates） */
function shuffleArray(arr) {
  for (var i = arr.length - 1; i > 0; i--) {
    var j = Math.floor(Math.random() * (i + 1));
    var tmp = arr[i]; arr[i] = arr[j]; arr[j] = tmp;
  }
  return arr;
}

/**
 * tiles配列に含まれるドラの合計ポイントを計算する
 * @param {string[]} tiles
 * @param {Object}   doraTiles - { tile: multiplier }
 * @param {number}   perDora   - 1枚あたりのドラ点
 */
// あいうえおは常にドラ（デッキに2枚あるうち1枚分 = 全体で各1枚上限）
var AIUEO_DORA = new Set(['あ', 'い', 'う', 'え', 'お']);

function calcDoraBonus(tiles, doraTiles, perDora) {
  if (!tiles) return 0;
  return tiles.reduce(function(sum, c) {
    return sum + ((doraTiles && doraTiles[c]) ? doraTiles[c] * perDora : 0);
  }, 0);
}

/**
 * 全組に含まれるドラの総枚数を返す
 * あいうえおドラは全組通じて各1枚まで
 * @param {Array}  allSets   - 全組 ({tiles:[]} の配列)
 * @param {Object} doraTiles - 場風ドラ
 * @returns {number} ドラ総枚数
 */
/**
 * 全組のドラ情報をまとめて返す
 * @returns {{ count: number, detail: {tile, mult, times}[] }}
 *   count  = 実際の牌枚数（1枚の2倍ドラは1枚）
 *   detail = 各ドラ牌の詳細（tile:牌, mult:倍率, times:出現枚数）
 */
function calcDoraCount(allSets, doraTiles) {
  var aiueoSeen    = {};
  var tileCount    = {};  // { tile: 出現枚数 }
  var count        = 0;

  (allSets || []).forEach(function(s) {
    (s.tiles || []).forEach(function(c) {
      // 場風ドラ
      if (doraTiles && doraTiles[c]) {
        tileCount[c] = (tileCount[c] || 0) + 1;
        count += 1;  // 枚数は1枚（倍率は別で管理）
      }
      // あいうえおドラ：全組通じて各1枚まで
      if (AIUEO_DORA.has(c) && !aiueoSeen[c]) {
        aiueoSeen[c] = true;
        tileCount[c] = (tileCount[c] || 0) + 1;
        count += 1;
      }
    });
  });

  // 詳細リストを生成（倍率×枚数で表示用）
  var detail = [];
  Object.keys(tileCount).forEach(function(tile) {
    var mult  = (doraTiles && doraTiles[tile]) ? doraTiles[tile] : 1;
    var times = tileCount[tile];
    detail.push({ tile: tile, mult: mult, times: times });
  });

  return { count: count, detail: detail };
}

/**
 * 全組のドラ合計点を計算する
 * あいうえおは全組トータルで各1枚分まで（デッキの片方のみドラ扱い）
 * @param {Array}  allSets   - 全組 ({tiles:[]} の配列)
 * @param {Object} doraTiles - 場風ドラ（あいうえおは含まない）
 * @param {number} perDora
 */
function calcSetsDora(allSets, doraTiles, perDora) {
  var aiueoSeen = {}; // あいうえお各文字の計上済みフラグ
  var total = 0;
  (allSets || []).forEach(function(s) {
    (s.tiles || []).forEach(function(c) {
      // 場風ドラ（あいうえお以外）
      if (doraTiles && doraTiles[c]) {
        total += doraTiles[c] * perDora;
      }
      // あいうえおドラ：全組を通じて各1枚分まで
      if (AIUEO_DORA.has(c) && !aiueoSeen[c]) {
        aiueoSeen[c] = true;
        total += perDora;
      }
    });
  });
  return total;
}


/**
 * 役を自動検出する
 * @param {Array}   allSets      - 全組（lockedSets + submittedSets）
 * @param {boolean} riichiActive - 立直宣言していたか
 * @param {Object}  ctx          - 追加コンテキスト
 *   ctx.lockedSets   {Array}   - ポン/カン組（門前判定用）
 *   ctx.turnCount    {number}  - あがり時のturnCount
 *   ctx.riichiAt     {number}  - リーチ宣言時のturnCount (-1=未宣言)
 *   ctx.playerCount  {number}  - プレイヤー数（一発1巡の計算用）
 *   ctx.baWind       {string}  - 場風の名前（例: "え風"）
 *   ctx.myWind       {string}  - 自風の名前（例: "あ風"）
 * @returns {Array} [{id, name, score, desc}]
 */
function detectRoles(allSets, riichiActive, ctx) {
  ctx = ctx || {};
  var roles = [];

  // 七対子: 7組すべてが2文字の場合のみ（5組×2文字は通常あがり扱いで七対子にはしない）
  var allTwo = allSets.length === 7 &&
    allSets.every(function(s) { return s.tiles.length === 2; });
  var isChiitoi = allTwo;
  if (allTwo) {
    // 七対子は点数を500点に抑える（強すぎる調整）
    roles.push({ id: 'chiitoi', name: '七対子', score: 500, desc: '全組が2文字' });
  }

  // 母染め: 通常3組以上 / 七対子時は5組以上（七対子は2文字なので条件を厳しく）
  var hahaCount = allSets.filter(function(s) { return isHahaSomeWord(s.tiles); }).length;
  var hahaThresh = isChiitoi ? 5 : 3;
  if (hahaCount >= hahaThresh) {
    var hahaBonus = hahaCount >= 5 ? 1500 : hahaCount === 4 ? 1000 : 500;
    roles.push({ id: 'haha', name: '母染め', score: hahaBonus,
      desc: '母音統一の単語が' + hahaCount + '組' });
  }

  // 母音流れ: 同じ母音パターン（流れ）を持つ単語が3組以上
  // 例: a-i-u の流れ → あきす・かしつ・なちす がそれぞれ a-i-u
  var flowMap = {};  // { "aiu": 2, "oe": 1, ... }
  allSets.forEach(function(s) {
    var flow = getVowelFlow(s.tiles);
    if (flow.length >= 2) {  // 2文字以上の流れがあるもの対象
      flowMap[flow] = (flowMap[flow] || 0) + 1;
    }
  });
  // 最大一致数を取得
  var maxFlow = 0;
  var maxFlowPattern = '';
  Object.keys(flowMap).forEach(function(flow) {
    if (flowMap[flow] > maxFlow) {
      maxFlow      = flowMap[flow];
      maxFlowPattern = flow;
    }
  });
  // 母音流れ: 通常3組以上 / 七対子時は5組以上
  var flowThresh = isChiitoi ? 5 : 3;
  if (maxFlow >= flowThresh && maxFlow <= 7) {
    // 3組→600点、4組→1500点、5組以上→2000点
    var flowBonus = maxFlow >= 5 ? 2000 : maxFlow === 4 ? 1500 : 600;
    var patternDisplay = maxFlowPattern.split('').join('-');
    roles.push({ id: 'vowelflow', name: '母音流れ', score: flowBonus,
      desc: '「' + patternDisplay + '」の流れが' + maxFlow + '組' });
  }

  // 混濁母: 通常3組以上 / 七対子時は5組以上
  var dakuCount = allSets.filter(function(s) { return hasDakuten(s.tiles || []); }).length;
  var dakuThresh = isChiitoi ? 5 : 3;
  if (dakuCount >= dakuThresh) {
    // 3組→500点, 4組→1000点, 5組→1500点
    var dakuBonus = dakuCount >= 5 ? 1500 : dakuCount === 4 ? 1000 : 500;
    roles.push({ id: 'kondakubo', name: '混濁母', score: dakuBonus,
      desc: '濁音・半濁音を含む組が' + dakuCount + '組' });
  }

  // 断濁母: 全組に「あ行・濁音・半濁音」が一切含まれない（七対子時は無効）
  if (!isChiitoi && isDandakubo(allSets)) {
    roles.push({ id: 'dandakubo', name: '断濁母', score: 1200,
      desc: 'あ行・濁音・半濁音が全組に含まれない' });
  }

  // 混拗長: 通常3組以上 / 七対子時は5組以上
  var yoonCount = allSets.filter(function(s) { return hasYoon(s.tiles || []); }).length;
  var yoonThresh = isChiitoi ? 5 : 3;
  if (yoonCount >= yoonThresh) {
    // 3組→500点, 4組→1000点, 5組→1800点
    var yoonBonus = yoonCount >= 5 ? 1800 : yoonCount === 4 ? 1000 : 500;
    roles.push({ id: 'funaochan', name: '混拗長', score: yoonBonus,
      desc: '拗音・長音を含む組が' + yoonCount + '組' });
  }

  // 同単嬉々: 全く同じ単語（文字配列）が2組以上ある
  var wordStrings = allSets.map(function(s) { return (s.tiles || []).join(''); });
  var wordFreq = {};
  wordStrings.forEach(function(w) { wordFreq[w] = (wordFreq[w] || 0) + 1; });
  var hasDuplWord = Object.keys(wordFreq).some(function(w) { return wordFreq[w] >= 2; });
  if (hasDuplWord) {
    var dupWord = Object.keys(wordFreq).filter(function(w) { return wordFreq[w] >= 2; })[0];
    roles.push({ id: 'doutankiki', name: '同単嬉々', score: 1500,
      desc: '「' + dupWord + '」が2組' });
  }

  // 同字入: 同じ文字が複数含まれる単語が2種以上
  var duplCharCount = allSets.filter(function(s) { return hasDuplicateChar(s.tiles || []); }).length;
  if (duplCharCount >= 2) {
    // 2種→600点, 3種→1200点, 4種→2000点, 5種→3000点
    var duplBonus = duplCharCount >= 5 ? 3000 : duplCharCount === 4 ? 2000 : duplCharCount === 3 ? 1200 : 600;
    roles.push({ id: 'tonzururu', name: '同字入', score: duplBonus,
      desc: '同じ文字が重複する単語が' + duplCharCount + '種' });
  }

  // 頭連単: 同じ行の頭文字で母音が3つ以上連続
  var tourentan = detectTourentan(allSets);
  if (tourentan) {
    // 3組→800点, 4組→1800点, 5組（全母音）→4000点
    var trScore = tourentan.count >= 5 ? 4000 : tourentan.count === 4 ? 1800 : 800;
    var trLabel = tourentan.vowelLabels.join('・');
    roles.push({ id: 'tourentan', name: '頭連単', score: trScore,
      desc: tourentan.row + 'の ' + trLabel + ' が連続（' + tourentan.count + '組）' });
  }

  // 対々和: ロック組4組がすべてポン or カン（2文字組の雀頭1組を除く）
  var lockSets = ctx.lockedSets || [];
  if (lockSets.length === 4) {
    var allPonKan = lockSets.every(function(s) { return s.type === 'pon' || s.type === 'kan'; });
    if (allPonKan) {
      roles.push({ id: 'toitoi', name: '対々和', score: 800,
        desc: '4組すべてポン・カンで揃えてあがり' });
    }
  }

  // 門前自摸: ポン・カンなしでツモあがり（riichiでない場合も含む）
  var hasNaki = (ctx.lockedSets || []).some(function(s) { return s.type === 'pon' || s.type === 'kan'; });
  if (!hasNaki && !riichiActive) {
    roles.push({ id: 'mentanmo', name: '門前自摸', score: 400, desc: '鳴かずにツモあがり' });
  }

  // 立直: Firestoreで宣言済みの場合
  if (riichiActive) {
    roles.push({ id: 'riichi', name: '立直', score: 800, desc: '立直宣言あがり' });

    // 一発: リーチ後1巡以内にあがり
    var riichiAt    = (ctx.riichiAt !== undefined) ? ctx.riichiAt : -1;
    var turnCount   = (ctx.turnCount !== undefined) ? ctx.turnCount : -1;
    var playerCount = ctx.playerCount || 2;
    if (riichiAt >= 0 && turnCount >= 0 && (turnCount - riichiAt) <= playerCount) {
      roles.push({ id: 'ippatsu', name: '一発', score: 800, desc: 'リーチ後1巡以内にあがり' });
    }
  }

  // ============================================================
  // 風牌役（場風乱舞・我風貫通・共鳴風）
  // ============================================================
  var baWind = ctx.baWind || '';
  var myWind = ctx.myWind || '';

  if (baWind || myWind) {
    // 場風の母音・自風の母音を取得
    var baVowel = null;
    var myVowel = null;
    WIND_VOWELS.forEach(function(v) {
      if (WIND_NAMES[v] === baWind) baVowel = v;
      if (WIND_NAMES[v] === myWind) myVowel = v;
    });

    // 場風牌セット・自風牌セット（VOWEL_MAPで該当段の牌すべて）
    var baTiles = baVowel  ? new Set(getWindRowTiles(baVowel))  : new Set();
    var myTiles = myVowel  ? new Set(getWindRowTiles(myVowel))  : new Set();

    // 全あがり牌をフラット化してカウント
    var allTilesFlat = allSets.reduce(function(acc, s) {
      return acc.concat(s.tiles || []);
    }, []);

    var baCount = allTilesFlat.filter(function(c) { return baTiles.has(c); }).length;
    var myCount = allTilesFlat.filter(function(c) { return myTiles.has(c); }).length;

    // 共鳴風: 場風5枚以上 かつ 自風5枚以上（場風≠自風の場合のみ成立）
    var kyomeiValid = baVowel && myVowel && baVowel !== myVowel && baCount >= 5 && myCount >= 5;
    if (kyomeiValid) {
      var kyomeiScore = (baCount >= 7 && myCount >= 7) ? 4000 : 2000;
      var kyomeiDesc  = '場風' + baCount + '枚＋自風' + myCount + '枚';
      roles.push({ id: 'kyomei', name: '共鳴風', score: kyomeiScore, desc: kyomeiDesc });
    }

    // 共鳴風が成立した場合、場風乱舞・我風貫通は無効
    if (!kyomeiValid) {
      // 場風乱舞: 場風牌7枚以上
      if (baVowel && baCount >= 7) {
        var bafuScore = baCount >= 11 ? 2500 : baCount >= 9 ? 1500 : 800;
        roles.push({ id: 'bafu_ranbu', name: '場風乱舞', score: bafuScore,
          desc: '場風牌（' + baWind + '段）が' + baCount + '枚' });
      }

      // 我風貫通: 自風牌5枚以上
      if (myVowel && myCount >= 5) {
        var wafuScore = myCount >= 9 ? 2000 : myCount >= 7 ? 1200 : 600;
        roles.push({ id: 'wafu_kantsuu', name: '我風貫通', score: wafuScore,
          desc: '自風牌（' + myWind + '段）が' + myCount + '枚' });
      }
    }
  }

  return roles;
}

/**
 * 役ボーナスの合計点
 */
function calcRoleBonus(roles) {
  return roles.reduce(function(sum, r) { return sum + r.score; }, 0);
}

console.log("✅ 役システム 読み込み完了");

// ============================================================
// ラウンド集計・あがり点計算
// （旧 game.js から移動。引数のみに依存するピュア関数）
// ============================================================

/**
 * あがり時のスコア内訳を計算する
 * ポン/カン仮加算分を差し引いて全組を文字数×100で再計算する。
 * あがりモーダルのプレビューと calcAgariScore の両方がこれを使う（計算式の二重持ちを防ぐ）。
 * @param {Object} myData    - Firestoreのプレイヤーデータ
 * @param {Array}  finalSets - 全組
 * @param {Array}  roles     - 検出された役
 * @param {Object} doraTiles - 場風ドラ
 * @returns {{ baseScore:number, roleBonus:number, doraBonus:number, prevScore:number, total:number }}
 */
function calcAgariBreakdown(myData, finalSets, roles, doraTiles) {
  // 全組のベース点を文字数×100で計算（ロック組も含む）
  const baseScore = finalSets.reduce((s, g) => s + calcWordScore(g.tiles || []), 0);
  const roleBonus = calcRoleBonus(roles);
  // あがり時ドラ（DORA_BONUS_AGARI/枚）
  const doraBonus = calcSetsDora(finalSets, doraTiles || {}, DORA_BONUS_AGARI);
  // ポン/カン仮加算分（文字数仮点 + ドラ200）を差し引いて正規点数で上書き
  const ponKanTemp = myData.ponKanScore || 0;
  const prevScore  = myData.score - ponKanTemp;
  const total      = prevScore + baseScore + roleBonus + doraBonus;
  return { baseScore, roleBonus, doraBonus, prevScore, total };
}

/**
 * あがり時の最終スコアを返す（calcAgariBreakdown の total の薄いラッパー）
 * @returns {number} 最終的なスコア（0以上）
 */
function calcAgariScore(myData, finalSets, roles, doraTiles) {
  return calcAgariBreakdown(myData, finalSets, roles, doraTiles).total;
}

/**
 * 山切れ終局時のスコア・履歴計算
 * あがりではないので全員 ponKanScore のみ確定。正規化なし。
 */
function buildDrawResult(room) {
  const currentRound = room.currentRound || 1;
  const roundScores  = {};
  room.playerOrder.forEach(pid => {
    // 山切れ時は全プレイヤーのポン/カン仮加算のみ確定
    roundScores[pid] = room.players[pid].ponKanScore || 0;
  });
  const totalScores = Object.assign({}, room.totalScores || {});
  room.playerOrder.forEach(pid => {
    totalScores[pid] = (totalScores[pid] || 0) + (roundScores[pid] || 0);
  });
  // 勝者は現在スコア（ponKanScore込み）が最大のプレイヤー
  const winnerId = room.playerOrder.slice().sort((a, b) =>
    (roundScores[b] || 0) - (roundScores[a] || 0)
  )[0];
  const roundHistory = (room.roundHistory || []).concat([{
    round: currentRound,
    winnerId,
    winnerName: room.players[winnerId].name + '（山切れ）',
    winnerScore: roundScores[winnerId] || 0,
    words: [], roles: [], scores: roundScores,
    doraCount: 0, doraDetail: [], doraBonus: 0
  }]);
  return { roundScores, totalScores, roundHistory };
}

/** ラウンド終了時のスコア・履歴計算（あがり共通） */
function buildRoundResult(room, winnerId, winnerScore, finalSets, roles) {
  const currentRound = room.currentRound || 1;
  const roundScores  = {};
  room.playerOrder.forEach(pid => {
    if (pid === winnerId) {
      // あがったプレイヤー：calcAgariScoreで算出したwinnerScoreを使用
      roundScores[pid] = winnerScore;
    } else {
      // あがれなかったプレイヤー：ポン/カン仮加算（ponKanScore）のみ確定
      // ※仕様: ポン/カンは試合中の点数として残るが、正規化（文字数×100）はされない
      roundScores[pid] = room.players[pid].ponKanScore || 0;
    }
  });
  const totalScores = Object.assign({}, room.totalScores || {});
  room.playerOrder.forEach(pid => { totalScores[pid] = (totalScores[pid] || 0) + (roundScores[pid] || 0); });
  const roundWords = finalSets.map(s => ({
    tiles: s.tiles || [], word: s.word || (s.tiles || []).join(''),
    score: (s.score != null) ? s.score : calcWordScore(s.tiles || []), type: s.type || 'tsumo'
  }));
  const doraInfo  = calcDoraCount(finalSets, room.doraTiles || {});
  const doraCount  = doraInfo.count;
  const doraDetail = doraInfo.detail;
  const doraBonus  = calcSetsDora(finalSets, room.doraTiles || {}, DORA_BONUS_AGARI);
  const roundHistory = (room.roundHistory || []).concat([{
    round: currentRound, winnerId, winnerName: room.players[winnerId].name,
    winnerScore, words: roundWords, roles, scores: roundScores, doraCount, doraDetail, doraBonus
  }]);
  return { roundScores, totalScores, roundHistory };
}

/**
 * 検索/正規化用: 片仮名→平仮名に変換し、前後の空白を除去する。
 * 「ー」（長音符）はそのまま保持する。辞書は常にひらがなで持つため、
 * 辞書照合の入力も同じ正規化を通す（tools/build-dictionary.mjs の kataToHira と同等）。
 * @param {string} str
 * @returns {string}
 */
function toHiraganaWord(str) {
  return String(str == null ? '' : str)
    .trim()
    .replace(/[ァ-ヶ]/g, ch => String.fromCharCode(ch.charCodeAt(0) - 0x60));
}

// ============================================================
// テスト用エクスポート（ブラウザでは無視される）
// ============================================================
if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    BASIC_SOUNDS, SPECIAL_SOUNDS, INITIAL_HAND_SIZE, WIN_SET_COUNT,
    createShuffledDeck, drawTilesFromDeck, generateRoomId,
    calcWordScore, calcPonKanTempScore, getNextPlayer, validateAgari,
    SCORE_PER_TILE, DORA_BONUS_AGARI, DORA_BONUS_TEMP,
    detectTourentan, isHahaSomeWord, hasDakuten, isDandakubo, hasYoon,
    hasDuplicateChar, getVowelFlow, detectRoles, calcRoleBonus,
    initWinds, advanceWinds, getWindRowTiles, initDoraTiles, addKanDora,
    shuffleArray, calcDoraBonus, calcDoraCount, calcSetsDora,
    calcAgariBreakdown, calcAgariScore, buildDrawResult, buildRoundResult,
    canFormDictWord, toHiraganaWord,
    VOWEL_MAP, ROW_MAP
  };
}
