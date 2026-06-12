# refactor-instructions.md ― ひらがじゃん リファクタリング指示書

> この指示書は実装担当モデル向け。**既存仕様を壊さず、負債を減らし、今後変更しやすい状態にする**ことが目的。
> 見た目の綺麗さや全面書き換えは目的ではない。証拠なく大きな削除・書き換えをしないこと。

---

## Objective

1. ゲームロジック（点数計算・ラウンド集計）の重複と散在を減らし、単一の計算経路に統一する
2. テスト不能だったピュア関数をテスト可能にし、ユニットテストの安全網を広げる
3. 明白な死コード・重複定義・迷子コメントを除去する
4. 人間が明示承認した修正のみ実装する: passPon フェーズガード（D8）、七対子は7組のみ（D14）、待ち牌の辞書検証（D15）、点数定数の集約（D13）
5. 上記を**1フェーズ＝1コミット相当の小さな単位**で、各フェーズ後に検証しながら行う

やらないこと: Firebase SDK 移行、レンダリング方式の変更、`var`/`let`/`const` の一括統一、上記4以外の仕様変更（→ Out-of-scope 参照）。

---

## Project Understanding

- **何のプロジェクトか**: 「ひらがじゃん」— ひらがな牌120枚で単語を作る麻雀風リアルタイム対戦ゲーム（2〜4人）。ビルド不要の静的サイト（素のHTML/CSS/JS）+ Firebase Firestore。サーバーコードは存在しない。
- **ユーザー体験**: ロビー（`public/index.html` + `lobby.js`）でルーム作成/参加 → ゲーム画面（`public/game.html` + `game.js`）で対戦。全プレイヤーが Firestore の単一ドキュメント `rooms/{roomId}` を `onSnapshot` で購読し、操作は `runTransaction` で書き込む。**状態の権威はクライアント側**。
- **エントリーポイント**: 各HTMLが `<script>` で順にロードするグローバル共有方式（ESモジュールではない）。
  - `game.html`: firebase CDN(compat 9.22.0) → `firebase-config.js` → `utils.js` → `dictionary.js` → `game.js`
  - `index.html`: firebase CDN → `firebase-config.js` → `utils.js` → `lobby.js`（辞書はロビーでは読み込まない）
- **主要モジュールと責務**:
  - `public/js/firebase-config.js`(36行) — Firebase初期化、グローバル `db` 公開、iOS向けロングポーリング自動検出
  - `public/js/utils.js`(816行) — 牌定義・山札・あがり判定 `validateAgari()`・役検出 `detectRoles()`・ドラ/風システム。ほぼピュア関数。末尾の `module.exports` で vitest からインポート可能
  - `public/js/lobby.js`(148行) — ルーム作成/参加。ルームドキュメントの初期スキーマは `createRoomBtn` ハンドラと `makePlayerData()` にある
  - `public/js/game.js`(2087行) — ゲーム進行のすべて。`renderGame()` が毎スナップショットで全UIを再構築
  - `public/js/dictionary.js` — **自動生成**（`tools/build-dictionary.mjs` がJMdictから生成、約26,000語）。`isValidWord()` を提供。**手で編集禁止**
- **データフロー**: ローカルUI状態（`selectedIndices`, `localHandDisplay`, 各モーダル state）は Firestore に書かず、`renderGame()` がラウンド/ステータス変化を検知してリセット。Firestore 更新はドット記法のフィールドパス（`'players.' + pid + '.hand'`）。
- **状態機械**: `turnPhase`: `draw` → `discard` → `pon_window` → (`pon_acquired` → `discard`) | `draw`。プレイヤーIDは `sessionStorage` 生成（タブごとに別人）。
- **二段階スコア計算（最重要）**: ポン/カンは仮加算 `ponKanScore`（(文字数-1)×100 + ドラ200/枚）を `score` に乗せ、あがり時に `calcAgariScore()`（game.js:870）が仮加算を差し引いて正規点（文字数×100 + 役 + ドラ500/枚）で再計算する。
- **外部依存**: Firebase Firestore（compat SDK 9.22.0, CDN）、JMdict（辞書生成時のみ）。Realtime Database は**未使用**（`database.rules.json` で全面拒否済み。`firebase-config.js` の `databaseURL` は残置で良い）。
- **セキュリティ境界**: `firestore.rules` が作成/更新時の構造検証（`playerOrder` 縮小禁止、`status` 3値、`roomId`/`createdAt`/`dictCheck` 不変、削除禁止）。XSS対策はユーザー由来文字列への `escapeHtml()` 適用。
- **テスト**: vitest（`test/utils.test.js` 37件、`test/dictionary.test.js` 7件、計44件、現在全て成功）。ピュア関数のみ対象。Lint・CI・typecheck は存在しない。

---

## Behaviors To Preserve（絶対に壊してはいけない既存挙動）

1. **二段階スコア計算**: ポン/カンの仮加算 `ponKanScore` と、あがり時 `calcAgariScore()` での差し引き・正規再計算。あがれなかったプレイヤーは `ponKanScore` のみラウンド得点として確定（game.js:913-941 のコメント参照）
2. **辞書チェックの全6箇所**: `dictCheck` ON のとき、単語確定の全コードパス（`kanTiles` / `lockPonWord` / `riichiConfirmGroup` / `confirmAgariGroup` / `confirmRiichiAgariOrder` + `executeRon`・`executeTsumo` / `submitAgari`）で `checkDictWord()` が呼ばれること。リファクタ後も呼び出し漏れを作らない
3. **立直あがり（`executeRon`/`executeTsumo`）は `validateAgari` を通らない**: これは既知・意図的（CLAUDE.md / README「既知の課題」）。共通化の際にうっかり検証を追加しないこと。※なお「待ち牌の無検証」は人間の承認（2026-06-12, Q4）により**辞書検証を追加する仕様に変更が確定**した（D15 / Phase 7 参照）。それ以外の検証は追加しない
4. **ポン・ロンの権利は下家（`getNextPlayer` の1人）のみ**
5. **Firestore ドキュメントのスキーマ**: フィールド名・型・更新方法（ドット記法。ネストオブジェクトの丸ごと上書き禁止）。`firestore.rules` の検証と整合していること。**進行中の既存ルームが読める形を維持**（フィールドのリネーム・削除禁止）
6. **グローバル共有のスクリプト読み込み順**: `utils.js` の関数は `game.js`/`lobby.js` からグローバル参照される。ESモジュール化しない。`utils.js` 末尾の `module.exports` ガード（`typeof module !== 'undefined'`）の形式を維持
7. **`renderGame()` の全再構築方式**と、ラウンド/ステータス変化検知によるローカル状態リセット（game.js:178-191）
8. **山切れ終局**: `discardTile` / `passPon` / `submitRiichi` の3箇所で山が空のとき `buildDrawResult()` による終局処理が走ること
9. **`checkDictWord` の辞書未ロードフォールバック**（game.js:333: `typeof isValidWord !== 'function'` ならスキップ）— ロビーでは辞書を読み込まないため必要
10. **XSS対策**: `innerHTML` への動的埋め込みは `escapeHtml()` 必須（または `textContent` / `makeTile()`）
11. **テスト44件が全て成功し続けること**

---

## Non-Negotiables（実装上の制約）

- 最初に `git status` を確認する。**既存の未コミット変更があれば作業を止めて報告**し、自分の変更と混ぜない
- 編集前に `npm test` を実行し、ベースライン結果（成功数・失敗数）を記録する
- 変更は小さく戻しやすい単位にする（フェーズごとに独立して revert できること）
- 無関係な整形・ついでのリファクタリングをしない（`var`→`const` の一括変換等を含む）
- 既存挙動を勝手に変えない。「これはバグでは」と思っても、修正は Stop And Ask Conditions に従う
- `public/js/dictionary.js` は自動生成ファイル。**絶対に編集しない**
- `firestore.rules` / `database.rules.json` / `firebase.json` / `lobby.js` のルーム初期スキーマは今回のスコープでは変更しない
- `firebase deploy` を実行しない（検証はローカルのみ）
- 各フェーズごとに `npm test` で検証する
- 正しさが不明な場合は実装を止めて質問する

---

## Stop And Ask Conditions（止まって質問する条件）

以下に該当したら実装せず、状況を整理して人間に質問すること:

1. Firestore ドキュメントのフィールド追加・リネーム・型変更が必要になった場合
2. `firestore.rules` の変更が必要になった場合
3. リファクタ中に**テストと実装が矛盾**しているのを見つけた場合
4. 「Behaviors To Preserve」に挙げた挙動を変えないと進められないと判断した場合
5. 削除候補のコードが本当に不要か証拠から判断できない場合
6. ゲームルール上の正解（点数・役・あがり条件）がコードから一意に決まらない場合
7. 下記 Debt Map で「提案のみ」とマークされた項目に手を付けたくなった場合

---

## Baseline Commands

```bash
# ユニットテスト（utils.js / dictionary.js のピュア関数のみ対象）
npm test            # vitest run（2026-06-12 時点: 2 files, 44 tests, all passed）
npm run test:watch

# ローカル起動（手動スモークテスト用。ビルド不要）
cd public
python -m http.server 8080
# → http://localhost:8080/index.html を2つのタブで開く
#   （プレイヤーIDは sessionStorage 生成なので、同一ブラウザの別タブで2人になれる）
```

Lint・typecheck・CI は存在しない。検証手段は vitest と手動スモークテストのみ。

---

## Debt Map

### D1. `playAgain()` が `makePlayerReset()` を複製している【今実装してよい】

- **根拠**: game.js:2065-2075 のプレイヤーリセット9フィールドが、game.js:944-956 の `makePlayerReset(pid, hand)` と完全に同一（hand が `[]` 固定なだけ）
- **なぜ負債か**: リセットフィールドを追加する際に2箇所の修正が必要で、片方だけ直すと再戦時に古い状態が残留するバグになる
- **影響範囲**: 再戦処理のみ
- **変更リスク**: 低。`makePlayerReset(pid, [])` の戻り値と現コードのキー・値が一致することを目視確認すれば等価
- **改善案**: `playAgain()` 内のループを `upd = Object.assign(upd, makePlayerReset(pid, []))` に置き換える
- **検証**: `npm test` + 手動: 1ラウンドゲームを終了→「同じメンバーで再戦」→ waiting に戻り再スタートできること

### D2. あいうえおセットの重複定義と `renderDoraWindBar` 内の二重チェック【今実装してよい】

- **根拠**: `AIUEO_SET`（game.js:1877）、`AROW`（game.js:379）、`AEIOU_SET`（game.js:383）が同一内容 `['あ','い','う','え','お']`。さらに renderDoraWindBar 内で `if (AEIOU_SET.has(char)) return;` と `if (AROW.has(char)) return;`（game.js:387-388）が**同じ条件を2回チェック**しており、後者は到達不能の死コード。utils.js にも `A_ROW_SET`（utils.js:346）と `AIUEO_DORA`（utils.js:520）がある
- **なぜ負債か**: 同一概念が5つの名前で存在し、読み手が「違いがあるのか」を毎回疑う。到達不能チェックは紛らわしい
- **影響範囲**: ドラ表示まわりの描画のみ
- **変更リスク**: 低。注意点: `AIUEO_SET` は game.js:1877 で定義されるが `const` のホイスティングなし（TDZ）…ではなく、実行時には DOMContentLoaded 後の関数呼び出しなので参照可能。game.js 内は `AIUEO_SET` に統一し、`AROW`/`AEIOU_SET` のローカル定義を削除する。**utils.js 側の `A_ROW_SET`/`AIUEO_DORA` は役判定・ドラ計算で意味が異なる（断濁母判定用 vs ドラ計上用）ため統合しない**
- **改善案**: game.js 内のみ `AIUEO_SET` 1つに統一、死んだ二重チェックを1つに
- **検証**: `npm test` + 手動: ゲーム開始してドラ表示バーに「あいうえお」が出ない・場風ドラ2種が出ること

### D3. あがり点プレビューが `calcAgariScore()` の計算式を複製【今実装してよい】

- **根拠**: game.js:1679-1684（`renderAgariModal` 内）に「プレビューも calcAgariScore と完全同一の計算」というコメント付きで、calcAgariScore(game.js:870-880) と同じ式が手書き複製されている
- **なぜ負債か**: 点数ルールを変えるとプレビューと確定点がズレる。実際にコメントで「同一であること」を人力保証している状態
- **影響範囲**: あがりモーダルの表示のみ（確定点は `submitAgari` 側の calcAgariScore が権威）
- **変更リスク**: 低〜中。プレビューは `baseScore`/`roleBonus`/`doraBonus` の**内訳**も表示に使うため、合計だけ calcAgariScore に置き換えると内訳が出せない。改善案参照
- **改善案**: calcAgariScore を「内訳オブジェクトを返す関数」に分解する（例: `calcAgariBreakdown(myData, finalSets, roles, doraTiles)` が `{ baseScore, roleBonus, doraBonus, total }` を返し、calcAgariScore はその `total` を返す薄いラッパーにする）。`renderAgariModal` と `calcAgariScore` の両方がこれを使う。**既存の calcAgariScore の呼び出し3箇所（executeRon / executeTsumo / submitAgari）の結果が変わらないこと**
- **検証**: `npm test`（D6 でテスト追加後はそのテストも）+ 手動: あがりモーダルのプレビュー点数と、確定後のラウンドサマリの点数が一致すること

### D4. `executeRon` と `executeTsumo` が約90%重複【今実装してよい】

- **根拠**: game.js:1499-1533 と game.js:1535-1569。差分は (a) ターン/フェーズ検証の有無（ロンは他人のターンなので検証なし、ツモはあり）、(b) discardPile から1枚 pop するか、(c) ponWindow リセットの有無、(d) wordLog の文言、(e) 成功メッセージ
- **なぜ負債か**: あがり処理の修正（役コンテキスト追加等）を2箇所に同時適用する必要があり、過去にズレた形跡はないが構造的にズレやすい
- **影響範囲**: 立直あがり（ロン/ツモ）
- **変更リスク**: 中。トランザクション内のロジックなので、共通化の際に検証順序・更新フィールドを1つでも落とすと対戦が壊れる
- **改善案**: トランザクション内の共通部（finalSets 構築 → ctx 構築 → detectRoles → calcAgariScore → buildRoundResult → players.* 更新）をヘルパー関数に抽出し、差分（a〜e）は呼び出し側に残す。**`validateAgari` を通さない現仕様を維持**（Behaviors To Preserve #3）
- **検証**: `npm test` + 手動: 2タブで立直→ツモあがり、立直→相手の捨て牌でロン、の両方が完走すること

### D5. 山切れ終局・捨て牌処理の分岐が3箇所に重複【今実装してよい】

- **根拠**: `discardTile`（game.js:1065-1083）と `submitRiichi`（game.js:1428-1444)が「山切れなら buildDrawResult で終局 / そうでなければ pon_window へ」のほぼ同一分岐を持つ。`passPon`（game.js:1163-1170）にも山切れ分岐がある
- **なぜ負債か**: 終局条件やponWindow スキーマを変える際に3箇所の同期が必要
- **影響範囲**: 捨て牌・立直宣言・ポンパスの3経路
- **変更リスク**: 中。Firestore 更新オブジェクトの組み立てなので、フィールドの抜けが即バグ
- **改善案**: 「捨て牌後の遷移フィールドを組み立てる」ピュアヘルパー（例: `buildDiscardTransition(room, myPlayerId, discardedTile, pile)` が upd オブジェクトを返す）を抽出し、discardTile / submitRiichi から使う。passPon は構造が異なる（捨て牌なし）ため無理に統合しない
- **検証**: `npm test` + 手動: 通常の捨て→ポンウィンドウ表示、立直宣言→捨て、（可能なら）山を減らした状態での山切れ終局

### D6. ラウンド集計・あがり点計算がテスト不能（game.js 内にあるため）【今実装してよい】

- **根拠**: `calcAgariScore`（game.js:870）、`buildDrawResult`（game.js:886）、`buildRoundResult`（game.js:913）は引数のみに依存するピュア関数だが、game.js は DOM 前提（トップレベルで `getOrCreatePlayerId()` 実行・イベント登録）のため Node から import できず、テストが書けない
- **なぜ負債か**: 二段階スコア計算という**このゲームで最も壊しやすい仕様**（CLAUDE.md 明記）に安全網がない。D3/D4/D5 のリファクタはこの3関数の周辺を触るため、先にテストが要る
- **影響範囲**: 全あがり経路・山切れ終局
- **変更リスク**: 低〜中。移動自体は読み込み順（utils.js → game.js）的に安全。utils.js の責務「牌、役、点数まわり」（README）にも合致
- **改善案**: 3関数を utils.js へ移動し、`module.exports` に追加。game.js からは（グローバル共有なので）そのまま呼べる。移動は**コピペ＋元の削除のみ**で、ロジックを1文字も変えない。その後 `test/utils.test.js` にテストを追加:
  - calcAgariScore: ponKanScore 差し引きの検証（仮加算済み score から正規点に再計算されること）、ponKanScore=0 のケース
  - buildRoundResult: 勝者は winnerScore、敗者は ponKanScore のみ確定すること、totalScores の累積、roundHistory の追記
  - buildDrawResult: 全員 ponKanScore のみ確定、winnerName に「（山切れ）」が付くこと
- **検証**: `npm test`（既存44件 + 追加分）。手動: 通常あがり1回で点数表示が従来どおりであること

### D7. `detectRoles` の JSDoc が迷子になっている【今実装してよい】

- **根拠**: utils.js:325-345 と utils.js:395-406 に `detectRoles` 用の JSDoc/コメントブロックがあるが、間に「濁音セット定義」「風・ドラシステム」セクション（utils.js:330-598）が挿入され、実際の `function detectRoles` は utils.js:601 にある。`@param` 説明が2つに分裂
- **なぜ負債か**: ドキュメントが関数と紐付かず、ctx パラメータの仕様（riichiAt, baWind 等）を探すのに苦労する
- **影響範囲**: コメントのみ（コード変更なし）
- **変更リスク**: 最低
- **改善案**: 分裂した JSDoc を統合して `function detectRoles` 直前（utils.js:601 の前）に移動する。コメント内容は変更しない（統合のみ）
- **検証**: `npm test`

### D8. `passPon` にフェーズガードがなく、立直者の自動パスタイマーが多重発火しうる【承認済み・実装してよい】

- **根拠**: `passPon`（game.js:1153-1173）はトランザクション内で `turnPhase === 'pon_window'` を**検証せずに** `turnPhase: 'draw'` を書き込む。一方 `renderPonOverlay`（game.js:644）は立直者が待ち牌以外を見たとき `setTimeout(() => passPon(), 300)` を仕掛けるが、`renderGame` はスナップショットごとに走るため pon_window 中の再描画のたびにタイマーが積まれる。遅延発火した古いタイマーが、すでに `draw`→`discard` へ進んだゲームを `draw` に巻き戻す競合の余地がある
- **なぜ負債か**: 他の全アクション（drawTile/discardTile/ponTile/lockPonWord 等）はフェーズ検証があるのに passPon だけない。状態機械の防御の穴
- **影響範囲**: ポンウィンドウ→次ターンの遷移。発生するとターン進行の desync
- **変更リスク**: 中。「ガード追加」は実質バグ修正＝挙動変更であり、正常系で passPon が pon_window 以外から呼ばれる正当なケースがないことの確認が要る（コード上は見当たらないが、人間の確認を取ること）
- **改善案**: (a) passPon のトランザクション内に `if (room.turnPhase !== 'pon_window') return;`（throw ではなく静かに無視）を追加、(b) renderPonOverlay の自動パスに「すでにタイマー予約済みなら積まない」ガードを追加
- **検証**: 手動: 立直者の下家が待ち牌以外を捨てたとき自動パスされてゲームが続行すること。立直ロン・通常ポンが従来どおり動くこと
- **実装可否**: **承認済み（2026-06-12、Q1 にて人間が承認）**。Phase 6 で実装する。なお修正は (a)(b) のガード追加のみに留め、ポン/ロン/パスの正常系フローのロジックは変えないこと

### D9. ローカル `selectedIndices` をトランザクション内の最新 hand に適用している【提案のみ】

- **根拠**: `discardTile`（game.js:1055）、`kanTiles`（game.js:1100）、`lockPonWord`（game.js:1211）は、描画時点の手牌に対するインデックス `selectedIndices` を、トランザクションで読み直した `room.players[myPlayerId].hand` に適用する。トランザクションのリトライや競合更新で手牌が変わっていた場合、別の牌を捨てる/使う理論的リスク
- **なぜ負債か**: 自分のターン中に自分の手牌を書き換える他者はいない設計のため実害はほぼないが、インデックスではなく牌そのものを渡す方が堅牢
- **影響範囲**: 捨て牌・カン・ポン確定
- **変更リスク**: 中。選択UIとの整合（同字が複数あるときの同定）に注意が要る
- **実装可否**: **提案のみ**。現設計で実害が出る再現手順が示せないため、修正は人間の判断を仰ぐ

### D10. ロビーの満員チェックが非トランザクション【提案のみ】

- **根拠**: lobby.js:97-118。`get()` で読んで `playerOrder.length >= maxPlayers` をチェック後、`update()` で arrayUnion。同時参加でレースすると maxPlayers を超えうる（firestore.rules は4人で頭打ちにするだけで、maxPlayers=2 のルームに3人入りうる）
- **影響範囲**: ルーム参加
- **実装可否**: **提案のみ**。runTransaction 化は容易だが、参加フローの挙動変更でありスモークテストの工数に対し発生頻度が低い（身内向け前提）。人間の判断を仰ぐ

### D11. Firebase compat SDK（9.22.0・旧API）【提案のみ・今回スコープ外】

- **根拠**: README「既知の課題」に明記。CDN + グローバル共有の現アーキテクチャと一体
- **実装可否**: **提案のみ**。modular SDK への移行は全ファイルに波及する設計変更。承認なしに着手しない

### D12. `var`/`let`/`const` の混在、`renderGame` の全再構築方式【触らない】

- **根拠**: CLAUDE.md が「既存セクションのスタイルに合わせる」と明記。全再構築は設計判断（README）
- **実装可否**: **触らない**。一括変換・差分レンダリング化はしない

### D13. スコアルールの位置づけと魔法数の散在【今実装してよい（コメント更新＋定数集約のみ）】

- **根拠**: utils.js:112-118 に「TODO: スコアルール確定後に修正する」とあるが、人間の回答（2026-06-12, Q2）により実態は「**文字数×100 が現行仕様。ただし将来、より良いバランスのルールがあれば変更の可能性あり。ルールの理解しやすさも重視**」と確定した。一方、点数の魔法数が複数ファイルに散在している:
  - 単語点 ×100: utils.js:117（`calcWordScore`）
  - ポン/カン仮加算 `(文字数-1)×100`: game.js:1109（kanTiles）と game.js:1216（lockPonWord）に同じ式が2回
  - ドラ仮加算 200/枚: game.js:1119（kanTiles）と game.js:1222（lockPonWord）
  - ドラあがり時 500/枚: game.js:875（calcAgariScore）、game.js:935（buildRoundResult）、game.js:1682（renderAgariModal）
- **なぜ負債か**: 将来バランス調整する方針が明言されている以上、点数定数が6箇所以上に散らばっている現状は「ルール変更が多点修正になる」という直接的なリスク。仮加算と正規点の対応関係（200↔500、(n-1)×100↔n×100）もコードを読まないと分からない
- **影響範囲**: 全スコア計算経路
- **変更リスク**: 低〜中。**数値・式は1つも変えない**。リテラルを名前付き定数に置き換えるだけ
- **改善案**:
  1. utils.js の牌定義セクション付近に定数を集約する（例）:
     ```js
     // ---- 点数ルール（バランス調整時はここだけ変更する） ----
     const SCORE_PER_TILE       = 100;  // 単語点: 文字数×100
     const PON_KAN_TEMP_PER_TILE = 100; // ポン/カン仮加算: (文字数-1)×100
     const DORA_BONUS_AGARI     = 500;  // あがり時ドラ1枚あたり
     const DORA_BONUS_TEMP      = 200;  // ポン/カン仮加算時ドラ1枚あたり
     ```
  2. `calcWordScore` と仮加算式 `(tiles.length - 1) * 100` をこの定数で書き直し、仮加算式は `calcPonKanTempScore(tiles)` として utils.js に関数化（game.js の2箇所から使う）
  3. game.js / utils.js 内の 500・200 リテラルを定数参照に置換（D3/D4 のヘルパー統一後に行うと置換箇所が減る）
  4. utils.js:112-114 の TODO コメントを実態に合わせて更新する（例: 「現行ルール: 文字数×100。将来バランス調整の可能性あり。変更時は上の点数定数のみ修正する」）。**TODO の趣旨（ルールは再調整されうる）は消さない**
  5. 定数と `calcPonKanTempScore` を `module.exports` に追加し、「仮加算＋差し引き再計算の整合」をテストで固定する（例: ポン3文字の仮加算200点が、あがり時に300点として再計算されること）
- **検証**: `npm test`（既存＋追加分）。数値を変えていないので既存テストは無変更で通るはず。通らなければ置換ミス
- **注意**: **点数バランス自体の変更（×100以外への変更、役点の調整等）はこのリファクタでは行わない**。それはプロダクト判断であり Out-of-scope。この項目は「将来の変更を一点修正にする」準備まで

### D14. `detectRoles` が「2文字×5組」を七対子として誤検出する【承認済み・実装してよい（仕様修正）】

- **根拠**: utils.js:606-607 の `allTwo = (allSets.length === WIN_SET_COUNT || allSets.length === 7) && all 2文字` により、**5組**すべて2文字の場合も七対子役（500点）が付き、`isChiitoi` フラグが他の役の閾値を引き上げる（母染め・母音流れ・混濁母・混拗長が3組→5組に、断濁母が無効に）。人間の回答（2026-06-12, Q3）: 「**5組の七対子はないはずなので意図していない**」→ 七対子は7組のときのみ、が正しい仕様
- **なぜ負債か**: 仕様と実装の不一致（確定）。テスト側も誤検出を前提に回避している（test/utils.test.js:164-165 のコメント「5組すべてが2文字だと detectRoles は七対子と判定し…3文字組を混ぜて回避する」）
- **影響範囲**: `detectRoles` の七対子判定と、isChiitoi に連動する各役の閾値。なお `validateAgari`（utils.js:155-157）の「5組あがり自体の成立」は通常ルールどおりで**変更しない**（あがり可否は仕様どおり。役の誤検出だけが問題）
- **変更リスク**: 低。修正は1条件の削除。実プレイで「2文字×5組かつロックなし」は手牌枚数の制約上ほぼ到達不能だが、仕様の正しさとテストの素直さのために直す価値がある
- **改善案**:
  1. utils.js:606 を `var allTwo = allSets.length === 7 && allSets.every(...)` に変更（`WIN_SET_COUNT ||` の分岐を削除）
  2. `detectRoles` 内の母染め等の閾値コメント「5組または7組」系の記述があれば実態に合わせて更新
  3. テスト追加: 「2文字×5組では七対子役が付かない」「2文字×7組では付く（既存テストで担保済み）」
  4. test/utils.test.js:164-165 の回避コメントを削除または更新（回避が不要になるが、既存テストケース自体は変更不要で通るはず）
- **検証**: `npm test`。既存テストは七対子誤検出を**回避して**書かれているため、この修正で壊れるテストはない見込み。壊れた場合は Stop And Ask #3（テストと実装の矛盾）として報告
- **実装可否**: **承認済み（2026-06-12、Q3 にて人間が「意図していない」と回答）**。Phase 6 で実装する

### D15. 立直の待ち牌に辞書検証がない【承認済み・実装してよい（仕様追加）】

- **根拠**: `riichiAddWaiting`（game.js:1365-1375）は1〜2文字の任意文字列を無検証で待ち牌として受け付ける。人間の回答（2026-06-12, Q4）: 「**待ち牌設定時に辞書にその単語があるかを確認**」する仕様に変更が確定
- **確定仕様**:
  - `dictCheck` ON のルームのみ検証する（OFF は従来どおり無検証）。辞書未ロード時はスキップ（`checkDictWord` と同じフォールバック方針）
  - 待ち牌 w が有効 ＝「立直後に残る手牌（riichiHand）＋ w の**並べ替えのいずれか**が辞書語になる」こと（あがり時は `confirmRiichiAgariOrder` で並び順を選んで辞書チェックされるため、判定基準を揃える）
  - **ステップ2（追加時）**: 捨て牌が未確定のため、「`remainingHand` から1枚捨てた残り＋w」が辞書語になる捨て方が1つでも存在すれば追加を許可。なければエラー表示（例: 「この待ち牌では辞書の単語が完成しません」）で追加拒否＝即時フィードバック
  - **`submitRiichi`（宣言確定時）**: 実際の捨て牌を除いた riichiHand で全待ち牌を再検証し、不成立があればエラーで中断（権威チェック。例: 「捨て牌の選択と待ち牌が合っていません: 〇」）
  - **入力は1文字のみに制限**する。根拠: あがり牌との照合は単一牌の文字列一致（`drawTile` の `waitTiles.includes(drawn)` game.js:1032、`claimRon` の `waiting.includes(pon.tile)` game.js:1577）であり、2文字の待ちは現状でも**絶対に成立しない死に入力**のため（牌は全て1文字）
- **なぜ今まで放置されていたか**: README「既知の課題」に「立直の待ち牌が自己申告制」と明記された意図的未対応だったが、Q4 の回答で方針転換
- **影響範囲**: 立直フロー（ステップ2・宣言確定）。dictCheck OFF のルームは挙動不変
- **変更リスク**: 中。立直の UX が変わる（不正な待ちが追加できなくなる）。トランザクション内で重い計算をしないこと（順列は riichiHand 1〜3枚＋w の最大4文字＝高々24通りなので問題なし）
- **改善案**:
  1. utils.js に純関数 `canFormDictWord(tiles, isValid)` を追加（tiles の順列のいずれかで `isValid(word)` が true になるか。validator を引数で受けるので utils.js は dictionary.js に依存しない）。`module.exports` に追加し、スタブ validator でユニットテストを書く
  2. `riichiAddWaiting`: 1文字チェックに変更 → dictCheck ON かつ `isValidWord` 利用可能なら、`remainingHand` の各捨て候補について `canFormDictWord(残り.concat([w]), isValidWord)` を試し、全滅なら追加拒否
  3. `submitRiichi`: 捨て牌除去後の riichiHand で各待ち牌を `canFormDictWord` 検証、不成立があれば throw（既存のエラーハンドリング様式 `showMsg('❌ ' + err.message)` に乗せる）
  4. CLAUDE.md の「検証の穴」と README「既知の課題」の待ち牌自己申告に関する記述を、実装後の実態に合わせて更新する
- **検証**: `npm test`（canFormDictWord のテスト）+ 手動: dictCheck ON で (a) 辞書語が完成しない待ち牌が追加できないこと、(b) 正しい待ち牌で立直→ツモ・ロンが従来どおり完走すること、(c) dictCheck OFF のルームでは任意の1文字が追加できること
- **実装可否**: **承認済み（2026-06-12、Q4 にて人間が指示）**。Phase 7 で実装する

---

## Implementation Phases

各フェーズの完了条件: `npm test` 全件成功 + そのフェーズの手動検証項目をクリア。**フェーズをまたいで変更を混ぜない。**

### Phase 0: 現状確認とベースライン記録
1. `git status` を確認。未コミット変更があれば**停止して報告**
2. `npm test` を実行し、結果（ファイル数・テスト数・成否）を記録する（参考: 2026-06-12 時点で 2 files / 44 tests / all passed）
3. `cd public && python -m http.server 8080` で起動し、2タブでルーム作成→参加→ゲーム開始→1枚引いて捨てる、までのスモークが通ることを確認

### Phase 1: 安全網の追加（コード変更なし、テストのみ）
- `test/utils.test.js` に既存ピュア関数の未カバーエッジを追加:
  - `validateAgari`: カンを含む4文字ロック組での成立、七対子未満（6組2文字）の不成立理由
  - `initDoraTiles`: 戻り値のドラが場風の段の牌のみで「あいうえお」を含まないこと、最大2種
  - `addKanDora`: 呼び出し後にドラ種が増える or 既存ドラの倍率が上がること、winds 不明時は変更なし
- **既存実装の挙動をそのまま固定する**テストを書く。失敗するテストを書いて実装を「直す」ことはしない（矛盾を見つけたら Stop And Ask #3）

### Phase 2: 明らかに安全な整理（D1, D2, D7）
1. D1: `playAgain()` を `makePlayerReset()` 再利用に置換
2. D2: game.js 内のあいうえおセットを `AIUEO_SET` に統一、`renderDoraWindBar` の死んだ二重チェックを除去
3. D7: utils.js の迷子 JSDoc を `detectRoles` 直前に統合
- 検証: `npm test` + 手動（再戦フロー・ドラ表示）

### Phase 3: 集計ロジックの責務分離とテスト（D6）
1. `calcAgariScore` / `buildRoundResult` / `buildDrawResult` を game.js から utils.js へ**無変更で移動**し、`module.exports` に追加
2. D6 記載の観点でユニットテストを追加
- 検証: `npm test` + 手動: 通常あがり1回（モーダルで5組作成→あがり→ラウンドサマリの点数確認）

### Phase 4: 重複計算の統一と点数定数の集約（D3, D13）
1. `calcAgariScore` を内訳返却ヘルパー + 薄いラッパーに分解（utils.js 内）
2. `renderAgariModal` のプレビュー計算をヘルパー呼び出しに置換
3. Phase 3 で書いたテストが**無変更で**通ることを確認（通らなければ分解が等価でない＝やり直し）
4. D13: 点数定数（`SCORE_PER_TILE` / `DORA_BONUS_AGARI` / `DORA_BONUS_TEMP` 等）を utils.js に集約し、game.js / utils.js のリテラル（100・200・500、`(tiles.length - 1) * 100`）を定数・`calcPonKanTempScore()` 参照に置換。**数値は1つも変えない**
5. D13: utils.js の TODO コメントを実態（現行×100・将来調整の可能性あり・変更時は定数のみ修正）に合わせて更新
6. D13: 仮加算↔正規点の整合テストを追加
- 検証: `npm test` + 手動: プレビュー点と確定点の一致、ポン確定時の仮加算点（3文字なら+200+ドラ）が従来どおりであること

### Phase 5: あがり経路・捨て牌経路の重複排除（D4, D5）
1. D4: executeRon/executeTsumo の共通部をヘルパー抽出（validateAgari は通さないまま）
2. D5: discardTile/submitRiichi の終局/pon_window 分岐をピュアヘルパー化
- 検証: `npm test` + 手動: 立直ツモ・立直ロン・通常捨て→ポン→単語確定、の3フローを2タブで完走

### Phase 6: 承認済みの防御的修正・仕様修正（D8, D14）
- **D8（承認済み 2026-06-12）**:
  1. `passPon` のトランザクション内に、`room.turnPhase !== 'pon_window'` なら何も書き込まず終了するガードを追加（throw ではなく静かに無視。エラーメッセージ表示も不要）
  2. `renderPonOverlay` の立直者自動パス（game.js:644 の `setTimeout(() => passPon(), 300)`）に多重予約ガードを追加（例: モジュールスコープのフラグ/タイマーIDで「予約済みなら積まない」。pon_window が閉じたらフラグをリセット）
- **D14（承認済み 2026-06-12）**: `detectRoles` の七対子判定を「7組のみ」に修正（utils.js:606 の `WIN_SET_COUNT ||` 分岐を削除）。「2文字×5組では七対子が付かない」テストを追加し、test/utils.test.js:164-165 の回避コメントを更新
- 検証: `npm test` + 手動2タブで (a) 通常ポン→単語確定、(b) 立直者の下家として待ち牌以外が流れてきたとき自動パスでゲーム続行、(c) 立直ロン、の3フローが従来どおり動くこと
- D8/D14 以外の挙動変更はこのフェーズでは行わない（D9/D10 は引き続き提案のみ）

### Phase 7: 待ち牌の辞書検証を追加（D15・承認済み仕様追加）
1. utils.js に `canFormDictWord(tiles, isValid)` を追加し、スタブ validator でユニットテストを書く
2. `riichiAddWaiting` を1文字制限＋辞書検証（捨て候補ごとの成立判定）に変更
3. `submitRiichi` に権威チェック（確定 riichiHand での全待ち牌再検証）を追加
4. CLAUDE.md・README の「待ち牌は自己申告・無検証」記述を実態に合わせて更新
- 検証: `npm test` + 手動: D15 記載の (a)(b)(c)。dictCheck OFF ルームの挙動が不変であることを必ず確認

### Phase 8: 提案に留める項目の整理（実装しない）
- D9, D10, D11 について、現状の根拠箇所と推奨対応を最終報告にまとめる。**コードは書かない**

---

## Verification Requirements

- 各フェーズ後に `npm test` を実行し、**全件成功**を確認してから次へ進む
- Phase 2 以降、UI に触れる変更をしたフェーズでは手動スモークテストを行う:
  1. `cd public && python -m http.server 8080`
  2. タブA: 名前入力→ルーム作成（辞書チェックONのまま）。タブB: ルームIDで参加
  3. タブA: ゲームスタート → 引く→捨てる → タブB: ポン or パス
  4. 変更したフローに応じて: カン / 立直宣言→ツモ・ロン / 通常あがり / 再戦
  5. 辞書チェックが効くこと（でたらめな2文字で組確定→エラーになる）を1箇所で確認
- ブラウザの DevTools コンソールにエラーが出ていないこと
- `firebase deploy` は実行しない

## Reporting Format

最終報告には以下を含めること:

1. **ベースライン**: Phase 0 で記録した `git status` と `npm test` の結果
2. **フェーズごとの結果表**: 実施した変更の要約 / 変更ファイルと行 / 実行したコマンドとその出力要点（テスト数・成否）/ 手動検証の実施項目と結果
3. **スキップ・未完了項目**とその理由（承認待ち、Stop And Ask 該当など）
4. **発見した新たな問題**（あれば）— 修正せず報告のみ
5. **提案のみ項目（D8〜D11）のまとめ**: 根拠箇所・推奨対応・想定工数
6. 最後に実行したコマンドとその結果

## Out-of-scope Items（今回やらないこと）

- Firebase compat SDK → modular SDK 移行（D11）
- ES モジュール化・ビルド工程の導入・Lint/CI の導入
- `renderGame` 全再構築方式の差分レンダリング化
- `var`/`let`/`const` の一括統一・コードフォーマッタ適用
- サーバー権威化、待ち牌検証、全員ポン/ロン対応（README「今後の展望」記載の機能群）
- `firestore.rules` / `database.rules.json` の変更
- `public/js/dictionary.js` の再生成・編集
- ルームIDの桁数・生成方式の変更
- ゲームルール（点数・役・閾値）の変更 — **ただし人間が明示承認した D14（七対子は7組のみ）と D15（待ち牌の辞書検証）は例外として実装する**。点数バランス（×100等）の変更はプロダクト判断であり引き続き対象外

---

## 実装前の確認事項と回答（記録・全問回答済み）

> 4問すべて人間が回答済み（2026-06-12）。**未回答の質問は残っていない**ため、Phase 0〜8 すべて実施できる。実装中に新たな疑義が生じた場合は Stop And Ask Conditions に従うこと。

- **Q1（D8）**: `passPon` のフェーズガード追加＋自動パスタイマー多重予約の防止 → **承認**。Phase 6 で実装。
- **Q2（D13）**: 文字数×100 は確定仕様か → **回答: 「×100 予定だが、ゲームルール的に更に良いバランスのルールがあるなら変更可能。ルールの理解しやすさも大切」**。⇒ 解釈: 現行は×100、ただし将来の再調整に開かれている。よって TODO は削除せず実態に合うコメントへ更新し、点数定数を1箇所に集約して将来の変更を一点修正にする（D13 / Phase 4）。**バランス変更そのものはこのリファクタでは行わない**（プロダクト判断）。
- **Q3（D14）**: 2文字×5組の七対子扱いは意図されたものか → **回答: 「5組の七対子はないはずなので意図していない」**。⇒ 七対子は7組のみが正。`detectRoles` を修正する（D14 / Phase 6）。
- **Q4（D15）**: 待ち牌の無検証は意図的仕様か → **回答: 「待ち牌設定時に辞書にその単語があるかを確認」**。⇒ 仕様変更が確定。待ち牌の辞書検証＋1文字制限を追加する（D15 / Phase 7）。
