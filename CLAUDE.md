# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## プロジェクト概要

「ひらがじゃん」— ひらがな牌で単語を作る麻雀風のリアルタイム対戦ゲーム（2〜4人）。
ビルド不要の静的サイト（素のHTML/CSS/JS）＋ Firebase Firestore で構成。npm / package.json / テスト / Lint は存在しない。

## 開発コマンド

```bash
# ローカル起動（ビルド不要）
cd public
python -m http.server 8080

# Firebase Hosting / Firestore ルールのデプロイ
firebase deploy
```

GitHub Pages でも公開されており、ルートの `index.html` は `public/index.html` へのリダイレクトのみ。

## アーキテクチャ

**サーバーコードは存在しない。** 全ゲームロジックはクライアントJSで動き、Firestore の単一ドキュメント `rooms/{roomId}` を全プレイヤーが `onSnapshot` で購読し、`runTransaction` で書き換える設計。状態の権威はクライアント側にあり、Firestore は共有状態ストアとして使われている（firestore.rules はほぼ素通しで、検証は status の値と playerOrder ≤ 4 のみ）。

### ファイル構成と読み込み順

各HTMLが `<script>` で順にロードする（モジュールではなくグローバル共有）:
`firebase-config.js`（`db` をグローバル公開）→ `utils.js` → `lobby.js` or `game.js`

- `public/js/lobby.js` — ルーム作成・参加。ルームドキュメントの初期スキーマは `createRoomBtn` ハンドラと `makePlayerData()` にある
- `public/js/game.js`（約2,050行）— ゲーム進行のすべて。ファイル冒頭コメントにセクション構成あり。レンダリングは `renderGame()` が毎スナップショットで全UIを再構築する方式
- `public/js/utils.js`（約800行）— 牌定義（120枚）、山札、あがり判定 `validateAgari()`、役検出 `detectRoles()`、ドラ・風システム。ほぼピュア関数

### ゲーム状態の核心

ルームドキュメントの `turnPhase` が状態機械:
`draw`（山から引く）→ `discard`（捨て/カン/立直/あがり）→ `pon_window`（下家がポン or パス）→ `pon_acquired`（ポン後、単語確定→捨てへ）

- プレイヤーIDは `sessionStorage` 生成（`getOrCreatePlayerId()`）。タブを変えると別人になる
- ローカルUI状態（`selectedIndices`, `localHandDisplay`, 各モーダルの state）は Firestore に書かず、`renderGame()` がラウンド/ステータス変化を検知してリセットする
- ポン/カンは仮加算 `ponKanScore` を score に乗せ、あがり時に `calcAgariScore()` が差し引いて正規点（文字数×100＋役＋ドラ）で再計算する。この二段階計算を壊さないこと

### 役の追加方法（冒頭コメントにも記載）

`utils.js` の `detectRoles()` に条件を追記し、`game.html` の「役一覧」「点数表」タブに表示を追記するだけ。

## 既知の重要な制約・落とし穴

- **検証の穴（既知・意図的に未対応）**: 辞書チェックなし、立直の待ち牌は自己申告で無検証、立直あがり（`executeRon`/`executeTsumo`）は `validateAgari` を通らない。修正時はこの前提を確認してから
- ポン・ロンの権利は下家（`getNextPlayer` の1人）のみ
- XSS対策は `escapeHtml()` があるが適用が不完全。`innerHTML` にプレイヤー名等を埋める箇所では必ずエスケープすること
- `var`/`let`/`const` が混在しているが、既存セクションのスタイルに合わせる
- Firestore 更新はドット記法のフィールドパス（`'players.' + pid + '.hand'`）を使う。ネストオブジェクトの丸ごと上書きにしないこと
