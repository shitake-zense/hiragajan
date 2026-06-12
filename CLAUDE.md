# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## プロジェクト概要

「ひらがじゃん」— ひらがな牌で単語を作る麻雀風のリアルタイム対戦ゲーム（2〜4人）。
ビルド不要の静的サイト（素のHTML/CSS/JS）＋ Firebase Firestore で構成。Lint は存在しない。

## 開発コマンド

```bash
# ローカル起動（ビルド不要）
cd public
python -m http.server 8080

# ユニットテスト（utils.js / dictionary.js のピュア関数のみ対象）
npm test          # vitest run（ワンショット）
npm run test:watch  # vitest watch

# 辞書データの再生成（public/js/dictionary.js を上書き）
curl -o tools/JMdict_e.gz http://ftp.edrdg.org/pub/Nihongo/JMdict_e.gz
node tools/build-dictionary.mjs

# Firebase Hosting / Firestore・RTDB ルールのデプロイ
firebase deploy
```

GitHub Pages でも公開されており、ルートの `index.html` は `public/index.html` へのリダイレクトのみ。

## アーキテクチャ

**サーバーコードは存在しない。** 全ゲームロジックはクライアントJSで動き、Firestore の単一ドキュメント `rooms/{roomId}` を全プレイヤーが `onSnapshot` で購読し、`runTransaction` で書き換える設計。状態の権威はクライアント側にあり、Firestore は共有状態ストアとして使われている。

Firestore ルール（`firestore.rules`）は読み込みを全開放しつつ、作成時・更新時に以下を検証する:
- 作成: `status == 'waiting'`、`playerOrder.size() == 1`、`maxPlayers in [2,3,4]`、`maxRounds in [1,3,5]`、`dictCheck is bool`
- 更新: `playerOrder` の縮小禁止（参加者の除外を防ぐ）、`status` は3値のみ、`roomId`/`createdAt`/`dictCheck` は不変
- 削除: 全面禁止（古いルームは `expireAt` フィールド + Firestore TTL ポリシーで7日後に自動削除）

Realtime Database は**未使用**（`firebase-config.js` の `databaseURL` は残っているがコードからのアクセスはゼロ）。`database.rules.json` で読み書きとも全面拒否にしている。

Firebase SDK は `9.22.0` のCompatライブラリ（CDN経由）を使用。`db` は `firebase-config.js` がグローバルに公開する。

### ファイル構成と読み込み順

各HTMLが `<script>` で順にロードする（モジュールではなくグローバル共有）:
`firebase-config.js`（`db` をグローバル公開）→ `utils.js` → `lobby.js` or `game.js`

- `public/js/firebase-config.js` — Firebase初期化、`db` をグローバル公開
- `public/js/lobby.js` — ルーム作成・参加。ルームドキュメントの初期スキーマは `createRoomBtn` ハンドラと `makePlayerData()` にある
- `public/js/game.js`（約2,050行）— ゲーム進行のすべて。ファイル冒頭コメントにセクション構成あり。レンダリングは `renderGame()` が毎スナップショットで全UIを再構築する方式
- `public/js/utils.js`（約800行）— 牌定義（120枚）、山札、あがり判定 `validateAgari()`、役検出 `detectRoles()`、ドラ・風システム。ほぼピュア関数。末尾に `module.exports` があり Node.js/vitest からもインポートできる
- `public/js/dictionary.js`（自動生成・約26,000語）— 辞書チェック用 `isValidWord()`。`tools/build-dictionary.mjs` が JMdict から生成する。**手で編集しない**。game.html のみが読み込む（ロビーでは不要）
- `test/utils.test.js`, `test/dictionary.test.js` — vitest によるユニットテスト（ピュア関数のみ対象）

### ゲーム状態の核心

ルームドキュメントの `turnPhase` が状態機械:
`draw`（山から引く）→ `discard`（捨て/カン/立直/あがり）→ `pon_window`（下家がポン or パス）→ `pon_acquired`（ポン後、単語確定→捨てへ）

- プレイヤーIDは `sessionStorage` 生成（`getOrCreatePlayerId()`）。タブを変えると別人になる
- ローカルUI状態（`selectedIndices`, `localHandDisplay`, 各モーダルの state）は Firestore に書かず、`renderGame()` がラウンド/ステータス変化を検知してリセットする
- ポン/カンは仮加算 `ponKanScore` を score に乗せ、あがり時に `calcAgariScore()` が差し引いて正規点（文字数×100＋役＋ドラ）で再計算する。この二段階計算を壊さないこと

### 役の追加方法（冒頭コメントにも記載）

`utils.js` の `detectRoles()` に条件を追記し、`game.html` の「役一覧」「点数表」タブに表示を追記するだけ。

## 既知の重要な制約・落とし穴

- **辞書チェックはルーム作成時のオプション**（`dictCheck` フィールド、デフォルトON）。ONのとき単語確定の全6箇所（`kanTiles`/`lockPonWord`/`riichiConfirmGroup`/`confirmAgariGroup`/`confirmRiichiAgariOrder`+`executeRon`・`executeTsumo`/`submitAgari`）で `checkDictWord()` が検証する。立直の待ち牌も追加時（`checkWaitingTileWord`）と宣言確定時（`submitRiichi` 内の `canFormDictWord`）に「残り手牌＋待ち牌で辞書語が作れるか」を検証する。新たに単語を確定するコードパスを追加する場合は必ず `checkDictWord()` を通すこと
- **検証の穴（既知・意図的に未対応）**: 立直あがり（`executeRon`/`executeTsumo`）は `validateAgari` を通らない。修正時はこの前提を確認してから
- ポン・ロンの権利は下家（`getNextPlayer` の1人）のみ
- XSS対策: ユーザー由来文字列（プレイヤー名・単語・役説明等）を `innerHTML` に埋める箇所は全て `escapeHtml()` 適用済み。新規コードでも `innerHTML` への動的埋め込みには必ず `escapeHtml()` を使うか、`textContent` / `makeTile()` を使うこと
- `var`/`let`/`const` が混在しているが、既存セクションのスタイルに合わせる
- Firestore 更新はドット記法のフィールドパス（`'players.' + pid + '.hand'`）を使う。ネストオブジェクトの丸ごと上書きにしないこと
