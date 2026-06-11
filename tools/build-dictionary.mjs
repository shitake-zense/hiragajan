/**
 * build-dictionary.mjs ― 辞書データ生成スクリプト
 *
 * JMdict（日本語辞書・EDRDG）から「ひらがじゃん」の牌セットで作れる
 * 単語だけを抽出し、public/js/dictionary.js を生成する。
 *
 * 使い方:
 *   curl -o tools/JMdict_e.gz http://ftp.edrdg.org/pub/Nihongo/JMdict_e.gz
 *   node tools/build-dictionary.mjs
 *
 * 抽出条件:
 *   - 優先度タグ付きエントリ（news1/2, ichi1/2, spec1/2, gai1/2, nfXX）= 常用語のみ
 *   - 読み（かな）を片仮名→平仮名に正規化（外来語の「ー」対応）
 *   - 2〜7文字
 *   - 牌セットに存在する文字のみ（「を」「ぁぃぅぇぉ」等は牌がないので除外）
 *   - 牌の枚数制約で物理的に作れる単語のみ（基本音は2枚・特殊音は1枚まで）
 *
 * JMdict は EDRDG のライセンス（CC BY-SA 4.0）で公開されている。
 * https://www.edrdg.org/edrdg/licence.html
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SRC = join(__dirname, 'JMdict_e.gz');
const OUT = join(__dirname, '..', 'public', 'js', 'dictionary.js');

// ---- 牌セット（public/js/utils.js と同一定義） ----
const BASIC_SOUNDS = [
  'あ','い','う','え','お','か','き','く','け','こ',
  'さ','し','す','せ','そ','た','ち','つ','て','と',
  'な','に','ぬ','ね','の','は','ひ','ふ','へ','ほ',
  'ま','み','む','め','も','や','ゆ','よ',
  'ら','り','る','れ','ろ','わ','ん'
]; // 各2枚
const SPECIAL_SOUNDS = [
  'が','ぎ','ぐ','げ','ご','ざ','じ','ず','ぜ','ぞ',
  'だ','ぢ','づ','で','ど','ば','び','ぶ','べ','ぼ',
  'ぱ','ぴ','ぷ','ぺ','ぽ','ゃ','ゅ','ょ','っ','ー'
]; // 各1枚

const TILE_LIMIT = {};
BASIC_SOUNDS.forEach(c => { TILE_LIMIT[c] = 2; });
SPECIAL_SOUNDS.forEach(c => { TILE_LIMIT[c] = 1; });

const MIN_LEN = 2;
const MAX_LEN = 7;

/** 片仮名→平仮名（「ー」はそのまま） */
function kataToHira(s) {
  return s.replace(/[ァ-ヶ]/g, ch =>
    String.fromCharCode(ch.charCodeAt(0) - 0x60));
}

/** 牌セットで物理的に作れる単語か */
function isFormable(word) {
  if (word.length < MIN_LEN || word.length > MAX_LEN) return false;
  const used = {};
  for (const ch of word) {
    const limit = TILE_LIMIT[ch];
    if (!limit) return false;            // 牌が存在しない文字
    used[ch] = (used[ch] || 0) + 1;
    if (used[ch] > limit) return false;  // 枚数オーバー
  }
  return true;
}

// ---- JMdict をパース ----
console.log('JMdict を読み込み中...');
const xml = gunzipSync(readFileSync(SRC)).toString('utf8');

const words = new Set();
let entryCount = 0;

// <entry>単位で処理。優先度タグ（ke_pri/re_pri）付きエントリのみ採用
const entryRe = /<entry>([\s\S]*?)<\/entry>/g;
const rebRe   = /<reb>([^<]+)<\/reb>/g;
let m;
while ((m = entryRe.exec(xml)) !== null) {
  entryCount++;
  const body = m[1];
  if (!/<(ke|re)_pri>/.test(body)) continue; // 常用語のみ
  let r;
  while ((r = rebRe.exec(body)) !== null) {
    const word = kataToHira(r[1]);
    if (isFormable(word)) words.add(word);
  }
}

const sorted = [...words].sort((a, b) => a.localeCompare(b, 'ja'));
console.log(`エントリ総数: ${entryCount} / 採用単語数: ${sorted.length}`);

// ---- dictionary.js を出力 ----
const header = `/**
 * dictionary.js ― 辞書チェック用 単語データ（自動生成）
 *
 * tools/build-dictionary.mjs が JMdict から生成する。手で編集しないこと。
 * 再生成: node tools/build-dictionary.mjs
 *
 * This file uses the JMdict dictionary (https://www.edrdg.org/jmdict/j_jmdict.html),
 * property of the Electronic Dictionary Research and Development Group,
 * used in conformance with the Group's licence (CC BY-SA 4.0).
 * https://www.edrdg.org/edrdg/licence.html
 *
 * 単語数: ${sorted.length}（2〜${MAX_LEN}文字・牌セットで作れるもののみ）
 */

`;

const body = `const DICTIONARY_WORDS = ${JSON.stringify(sorted)};

const WORD_SET = new Set(DICTIONARY_WORDS);

/**
 * 辞書に存在する単語か判定する
 * @param {string} word - ひらがなの単語
 * @returns {boolean}
 */
function isValidWord(word) {
  return WORD_SET.has(word);
}

console.log('✅ 辞書 読み込み完了 | 単語数: ' + DICTIONARY_WORDS.length);

// テスト用エクスポート（ブラウザでは無視される）
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { DICTIONARY_WORDS, WORD_SET, isValidWord };
}
`;

writeFileSync(OUT, header + body, 'utf8');
const kb = Math.round((header.length + body.length) / 1024);
console.log(`生成完了: ${OUT}（約${kb}KB）`);
