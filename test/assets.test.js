// 資産キャッシュバスティングの不変条件テスト。
//
// 背景: 本サイトはビルド不要の静的サイトで、CSS/JS を固定URL（css/style.css 等）で
// 読み込む。Firebase Hosting は js|css に Cache-Control: max-age=3600 を付け、
// GitHub Pages も独自にキャッシュ＋CDN する。URL が変わらないと、デザイン改修を
// デプロイしてもブラウザ/CDN が旧ファイルを配り続け「反映されない」事故になる。
//
// 対策として全ローカル資産参照に ?v=YYYYMMDD のバージョンクエリを付け、
// デプロイ毎に更新する。このテストは「バージョンが付いているか」「全資産で
// 揃っているか」「参照先ファイルが実在するか」を検証して回帰を防ぐ。
//
// デザイン改修をデプロイするときは public/*.html の ?v= をまとめて上げること。

import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const publicDir = path.join(__dirname, '..', 'public');

// public/ 直下の .html を全部対象にする（将来 HTML が増えても自動で拾う）。
const htmlFiles = fs.readdirSync(publicDir).filter((f) => f.endsWith('.html'));

// <link ... href="..."> と <script ... src="..."> から URL を抜き出す。
function extractAssetRefs(html) {
  const refs = [];
  const re = /<(?:link|script)\b[^>]*?\b(?:href|src)\s*=\s*"([^"]+)"/gi;
  let m;
  while ((m = re.exec(html)) !== null) refs.push(m[1]);
  return refs;
}

// 外部CDN（http/https・プロトコル相対）は対象外。ローカルの css/js のみ。
function isLocalCssOrJs(url) {
  if (/^https?:\/\//i.test(url) || url.startsWith('//')) return false;
  const pathOnly = url.split('?')[0];
  return pathOnly.endsWith('.css') || pathOnly.endsWith('.js');
}

function getVersion(url) {
  const m = url.match(/[?&]v=([^&]+)/);
  return m ? m[1] : null;
}

// 収集はコレクション時に一括で行い、テスト間の状態共有を避ける。
const refsByFile = htmlFiles.map((file) => {
  const html = fs.readFileSync(path.join(publicDir, file), 'utf8');
  return { file, refs: extractAssetRefs(html).filter(isLocalCssOrJs) };
});
const allRefs = refsByFile.flatMap(({ file, refs }) =>
  refs.map((ref) => ({ file, ref }))
);

describe('資産のキャッシュバスティング', () => {
  it('HTML が1つ以上ある（テスト対象の取りこぼし防止）', () => {
    expect(htmlFiles.length).toBeGreaterThan(0);
  });

  it('各 HTML にローカル css/js 参照が存在する', () => {
    for (const { file, refs } of refsByFile) {
      expect(refs.length, `${file} にローカル css/js 参照がない`).toBeGreaterThan(0);
    }
  });

  it.each(allRefs)('$file の $ref に ?v= が付いている', ({ file, ref }) => {
    expect(getVersion(ref), `${file} の ${ref} に ?v= がない（キャッシュバスティング漏れ）`).toBeTruthy();
  });

  it.each(allRefs)('$file の $ref の実体ファイルが存在する', ({ ref }) => {
    const abs = path.join(publicDir, ref.split('?')[0]);
    expect(fs.existsSync(abs), `${ref} の実体が見つからない: ${abs}`).toBe(true);
  });

  it('全ローカル資産のバージョンが揃っている（部分的なバンプ漏れを検出）', () => {
    const versions = new Set(allRefs.map(({ ref }) => getVersion(ref)).filter(Boolean));
    expect([...versions], `バージョンが混在している: ${[...versions].join(', ')}`).toHaveLength(1);
  });
});
