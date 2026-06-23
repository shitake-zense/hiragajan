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
 * 抽出条件（品質タグ除外方式）:
 *   - 優先度タグの有無は問わない（常用語に限定しない）
 *   - ただし次のいずれかに該当するエントリはスキップする:
 *       a) <misc> 品質タグ = 古語/廃用/稀語/卑語/侮蔑/露骨（俗語 sl・口語 col は採用）
 *       b) <field> 専門ドメインタグ（医学/法律/計算機 等の専門語）
 *       c) <misc> 固有名詞系タグ（人名/地名/会社名 等。JMdict_e には基本含まれないが念のため）
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
let excludedCount = 0;

// 除外する <misc> 品質タグ（JMdict エンティティ短縮形）:
//   arch=古語, obs/obsc=廃用・難解, rare=稀語, vulg=卑語, X=露骨, derog=侮蔑
// 俗語(sl)・口語(col)は「日本語として認められる範囲」として採用する。
const EXCLUDE_MISC  = /<misc>&(?:arch|obs|obsc|rare|vulg|X|derog);<\/misc>/;
// 専門ドメインタグ（医学・法律・計算機 等）。<field> が付くエントリは専門語として除外。
const EXCLUDE_FIELD = /<field>/;
// 固有名詞系 <misc> タグ（人名・地名・会社名等）。JMdict_e には基本含まれないが念のため。
const EXCLUDE_NAME  = /<misc>&(?:n-pr|place|surname|given|fam|male|fem|company|product|organization|station|work|relig|myth|char|dei|leg|obj|ev|group);<\/misc>/;
function isExcluded(body) {
  return EXCLUDE_MISC.test(body) || EXCLUDE_FIELD.test(body) || EXCLUDE_NAME.test(body);
}

// <entry>単位で処理。除外タグを持たないエントリの読みを採用
const entryRe = /<entry>([\s\S]*?)<\/entry>/g;
const rebRe   = /<reb>([^<]+)<\/reb>/g;
let m;
while ((m = entryRe.exec(xml)) !== null) {
  entryCount++;
  const body = m[1];
  if (isExcluded(body)) { excludedCount++; continue; } // 古語・稀語・専門語・固有名詞は除外
  let r;
  while ((r = rebRe.exec(body)) !== null) {
    const word = kataToHira(r[1]);
    if (isFormable(word)) words.add(word);
  }
}

const sorted = [...words].sort((a, b) => a.localeCompare(b, 'ja'));
console.log(`エントリ総数: ${entryCount} / 除外エントリ: ${excludedCount} / 採用単語数: ${sorted.length}`);

// 文字数内訳とサンプルを報告（D-F2 改善案3）
const byLen = {};
sorted.forEach(w => { byLen[w.length] = (byLen[w.length] || 0) + 1; });
console.log('文字数内訳:', Object.keys(byLen).sort().map(k => `${k}字${byLen[k]}`).join(' / '));
const sample = [];
for (let i = 0; i < 20; i++) sample.push(sorted[Math.floor(i * sorted.length / 20)]);
console.log('サンプル20語:', sample.join('、'));

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
// 実ディスクサイズは UTF-8 バイト数（日本語は1文字3バイト）。文字数で測ると過小評価になる。
const kb = Math.round(Buffer.byteLength(header + body, 'utf8') / 1024);
console.log(`生成完了: ${OUT}（約${kb}KB / UTF-8実バイト）`);
