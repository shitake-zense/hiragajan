# refactor-instructions.md ― ひらがじゃん 機能追加 兼 リファクタ指示書（第2期）

> この指示書は実装担当モデル向け。**既存仕様を壊さず、3つの新機能を安全に追加し、その周辺の負債だけを減らす**ことが目的。
> 見た目の綺麗さや全面書き換えは目的ではない。証拠なく大きな削除・書き換えをしないこと。
>
> **第1期のリファクタ（点数計算の統一・テスト整備・七対子修正・待ち牌辞書検証など）は完了済み**で、その記録は git 履歴（`f6e9054` 周辺のコミットと、本ファイルの過去バージョン）に残っている。本ファイルは**第2期＝新機能追加**の指示書として置き換えたもの。第1期の Debt Map（D1〜D15）はすべて実装済み・マージ済みなので再着手しないこと。

---

## Objective

人間が承認した次の3機能を、既存挙動を壊さず小さなフェーズで追加する。

1. **F1: 共有URLでの参加** — 現在はルームIDをコピーして口頭/チャットで渡すのみ。**URL（`index.html?room=XXXXXX`）を共有すると参加フォームにIDが自動入力される**ようにする。
2. **F2: 辞書の拡充** — 現在約26,632語（常用語＝優先度タグ付きのみ）。`tools/build-dictionary.mjs` の抽出フィルタを**段階的に緩和**し、和製英語・カタカナ語・一般語義タグ付きの通常語まで収録範囲を広げる。稀語・古語・専門タグは除外する。
3. **F3: ゲーム画面の辞書内検索** — 入力した単語が辞書に登録されているかをゲーム画面で検索できるUIを、**ルールモーダルの「辞書検索」タブ**として追加する。

副次目的: 上記の作業で触れるファイル周辺にある明白な負債（タイプミスのセレクタ等）だけを、無関係な整形を避けつつ最小限で直す。

やらないこと: Firebase SDK 移行、レンダリング方式の変更、`var`/`let`/`const` の一括統一、サーバー権威化、`firestore.rules`/`database.rules.json` の変更（→ Out-of-scope 参照）。

---

## 実装前の確認事項と回答（記録・全問回答済み）

> 人間が回答済み（2026-06-12）。**未回答の質問は残っていない**。実装中に新たな疑義が生じた場合は Stop And Ask Conditions に従うこと。

- **Q1（F2 辞書の範囲）**: どこまで拡充するか → **回答: 「フィルタを段階的に緩和（中間）」**。⇒ 優先度タグ必須を撤廃しつつ、一般語義タグ（名詞/形容詞/和製英語など通常の語）を持つエントリを採用し、稀語・古語・廃語・専門/固有名詞系タグは除外する。「最大（全部入り）」でも「外部辞書追加」でもない。実装は Phase 5 / D-F2 参照。
- **Q2（F1 共有URLの動線）**: 共有URLを開いた相手をどこへ導くか → **回答: 「ロビーに room を引き継ぎ事前入力」**。⇒ 共有URLは `index.html?room=XXXXXX` を指し、ロビーの参加フォームにIDを自動入力する。相手は名前を入れて従来どおり参加する。**自動入室はしない**（名前未入力の分岐を増やさない）。実装は Phase 3 / D-F1 参照。
- **Q3（F3 検索UIの配置）**: 辞書内検索UIをどこに置くか → **回答: 「ルールモーダルに『辞書検索』タブ追加」**。⇒ 既存の `rules-tab` 仕組み（基本/役一覧/点数表/ドラ・風）に1タブ足す。新規ボタン/モーダルは作らない。実装は Phase 4 / D-F3 参照。

---

## Project Understanding

- **何のプロジェクトか**: 「ひらがじゃん」— ひらがな牌120枚で単語を作る麻雀風リアルタイム対戦ゲーム（2〜4人）。ビルド不要の静的サイト（素のHTML/CSS/JS）+ Firebase Firestore。**サーバーコードは存在しない**（クライアント権威設計）。
- **ユーザー体験 / ワークフロー**:
  - ロビー（`public/index.html` + `lobby.js`）で名前を入れ、ルーム作成 or ルームIDで参加 → ゲーム画面（`public/game.html` + `game.js`）。
  - 全プレイヤーが Firestore の単一ドキュメント `rooms/{roomId}` を `onSnapshot` で購読し、操作は `runTransaction` で書き込む。`renderGame()` が毎スナップショットで全UIを再構築。
  - **F1 はこのロビー入口の動線にIDの引き継ぎを足すだけで、ゲーム本体には触れない。**
- **エントリーポイント**（各HTMLが `<script>` で順ロードするグローバル共有方式。ESモジュールではない）:
  - `game.html`: firebase CDN(compat 9.22.0) → `firebase-config.js` → `utils.js` → `dictionary.js` → `game.js`
  - `index.html`: firebase CDN → `firebase-config.js` → `utils.js` → `lobby.js`（**辞書はロビーでは読み込まない**。F3 がゲーム画面限定なのはこのため）
- **主要モジュールと責務**:
  - `public/js/firebase-config.js`(36行) — Firebase初期化、グローバル `db` 公開、iOS向けロングポーリング自動検出
  - `public/js/utils.js`(約940行) — 牌定義・山札・あがり判定・役検出・ドラ/風・点数定数・集計関数（第1期で移設）。`getOrCreatePlayerId()`(51)/`getPlayerName()`(61)/`generateRoomId()`(107) などロビー共通関数もここ。ほぼピュア関数。末尾 `module.exports`(940) で vitest からインポート可能。**F3 の文字正規化純関数はここに追加する**
  - `public/js/lobby.js`(148行) — ルーム作成/参加。作成は `createRoomBtn` ハンドラ(46)、参加は `joinRoomBtn` ハンドラ(88)、`makePlayerData()`(133)。**F1 はここに room 事前入力を足す**
  - `public/js/game.js`(約2090行) — ゲーム進行のすべて。`?room=` 読み取り(75-77)、待機画面のID表示(79-80)・コピー(`copyRoomId` 1861)、辞書チェック `checkDictWord`(332)、`escapeHtml`(341)、`makeTile`(1836)、`setVisible`(1851)。**F1 の共有リンクボタンと F3 の検索ハンドラはここに足す**
  - `public/js/dictionary.js` — **自動生成**（`tools/build-dictionary.mjs` がJMdictから生成）。`isValidWord(word)` を提供。**手で編集禁止**。**F2 は生成スクリプトを変えて再生成する**
  - `tools/build-dictionary.mjs` — 辞書生成スクリプト。優先度タグフィルタ(85)、牌制約 `isFormable`(59)、片仮名→平仮名 `kataToHira`(53)。**F2 の本体**
- **データフロー**: ローカルUI状態（`selectedIndices` 等）は Firestore に書かず、`renderGame()` がラウンド/ステータス変化で初期化。Firestore 更新はドット記法のフィールドパス（`'players.' + pid + '.hand'`）。
- **状態機械**: `turnPhase`: `draw` → `discard` → `pon_window` → (`pon_acquired` → `discard`) | `draw`。プレイヤーIDは `sessionStorage` 生成（タブごとに別人）。
- **外部依存**: Firebase Firestore（compat SDK 9.22.0, CDN）、JMdict（辞書生成時のみ・`tools/JMdict_e.gz` は `.gitignore` 済みでリポジトリに無い）。Realtime Database は未使用。
- **セキュリティ境界**: `firestore.rules` が作成/更新時の構造検証（`playerOrder` 縮小禁止、`status` 3値、`roomId`/`createdAt`/`dictCheck` 不変、削除禁止）。XSS対策はユーザー由来文字列への `escapeHtml()`(game.js:341) 適用。
- **検証手段**: vitest（`test/utils.test.js` / `test/dictionary.test.js`、現在 2 files / 64 tests / all passed）。ピュア関数のみ対象。Lint・CI(GitHub Actions で vitest)・typecheck のうち typecheck/Lint は無い。手動スモークテストは `python -m http.server`。

---

## Behaviors To Preserve（絶対に壊してはいけない既存挙動）

1. **二段階スコア計算**: ポン/カンの仮加算 `ponKanScore` と、あがり時 `calcAgariScore()` での差し引き・正規再計算（第1期で utils.js に移設済み）。新機能はここに一切触れない
2. **辞書チェックの全コードパス**: `dictCheck` ON のとき、単語確定の全箇所で `checkDictWord()`(game.js:332) が呼ばれること、待ち牌は `checkWaitingTileWord`/`submitRiichi` 内で `canFormDictWord` 検証されること。**F2/F3 は `isValidWord` の中身（語彙）を増やすだけで、呼び出し箇所や判定ロジックは変えない**
3. **`checkDictWord` の辞書未ロードフォールバック**（game.js:334: `typeof isValidWord !== 'function'` ならスキップ）。ロビーは辞書未ロードのため必要。**F3 でもこのフォールバック前提を壊さない**（検索UIはゲーム画面=辞書ロード済みでのみ動く）
4. **Firestore ドキュメントのスキーマ**: フィールド名・型・更新方法（ドット記法。丸ごと上書き禁止）。`firestore.rules` の検証と整合。**進行中の既存ルームが読める形を維持**。**F1 はスキーマを一切変更しない**（既存の参加フローを使う）
5. **既存の参加フロー**（lobby.js:88-126）: status/満員/既参加のチェックと `arrayUnion` 参加。F1 は「IDを事前入力する」だけで、この検証を弱めない
6. **`?room=` の既存読み取り**（game.js:75-77）と、無い場合のロビーリダイレクト。F1 はこれを壊さない
7. **辞書ファイルの形式**: `dictionary.js` が `DICTIONARY_WORDS`(配列) / `WORD_SET` / `isValidWord` / 末尾 `module.exports` を公開する形と、収録は**ひらがな・牌セットで物理的に作れる2〜7文字のみ**という不変条件。F2 で語彙は増えても、この形式と「牌で作れる」制約は維持
8. **グローバル共有のスクリプト読み込み順**と `utils.js` 末尾の `module.exports` ガード（`typeof module !== 'undefined'`）。F3 で utils.js に純関数を足す際もこの形式を維持
9. **XSS対策**: `innerHTML` への動的埋め込みは `escapeHtml()` 必須（または `textContent`/`makeTile()`）。**F3 の検索結果表示はユーザー入力を画面に出すので必ず適用**
10. **テストが全件成功し続けること**（現在 64 件）。F2 で語彙が変わると `test/dictionary.test.js` の固定語に依存したテストが影響を受けうる → Stop And Ask #3 を参照

---

## Non-Negotiables（実装上の制約）

- 最初に `git status` を確認する。**既存の未コミット変更があれば作業を止めて報告**し、自分の変更と混ぜない
- 編集前に `npm test` を実行し、ベースライン結果（ファイル数・テスト数・成否）を記録する
- 変更は小さく戻しやすい単位にする（フェーズごとに独立して revert できること）。**1フェーズ＝1コミット相当**
- 無関係な整形・ついでのリファクタリングをしない（`var`→`const` 一括変換等を含む）。本指示書が明示した負債（D-T1 等）以外には手を付けない
- 既存挙動を勝手に変えない。「これはバグでは」と思っても Stop And Ask Conditions に従う
- `public/js/dictionary.js` は**手で編集しない**。F2 は必ず `tools/build-dictionary.mjs` 経由で再生成する
- `firestore.rules` / `database.rules.json` / `firebase.json` は変更しない。F1 は既存ルールの範囲内で完結させる
- `firebase deploy` を実行しない（検証はローカルのみ）
- 各フェーズごとに `npm test` ＋（UIに触れたフェーズは）手動スモークで検証する
- 正しさが不明な場合は実装を止めて質問する

---

## Stop And Ask Conditions（止まって質問する条件）

以下に該当したら実装せず、状況を整理して人間に質問すること:

1. Firestore ドキュメントのフィールド追加・リネーム・型変更、または `firestore.rules` の変更が必要になった場合（F1 で必要になったら設計を見直す合図）
2. F2 の再生成で **`tools/JMdict_e.gz` を入手できない**（ネットワーク不可・配布元が落ちている等）場合 → スクリプト変更だけ用意し、再生成は人間に委ねる
3. F2 の再生成後、辞書語数が**80,000語超 もしくは `dictionary.js` が約2MB超**になった場合 → モバイル初期ロードへの影響が大きいので、コミット前に語数・サイズを報告して人間の承認を得る（人間が「中間の緩和」を選んだ意図はサイズ肥大の回避も含む）
4. F2 で `test/dictionary.test.js` の既存テストが**落ちた**場合（テストが特定語の収録/非収録を前提にしている）→ テストと新語彙の矛盾として報告し、勝手にテストを書き換えない（Stop And Ask の本旨）
5. 削除候補のコードが本当に不要か証拠から判断できない場合
6. ゲームルール上の正解（点数・役・あがり条件）に関わる変更が必要になった場合（本機能では発生しない想定。発生したらスコープ外）
7. Debt Map で「提案のみ」とマークした項目に手を付けたくなった場合

---

## Baseline Commands

```bash
# ユニットテスト（utils.js / dictionary.js のピュア関数のみ対象）
npm test            # vitest run（2026-06-12 時点: 2 files, 64 tests, all passed）
npm run test:watch

# ローカル起動（手動スモークテスト用。ビルド不要）
cd public
python -m http.server 8080
# → http://localhost:8080/index.html を2タブで開く（sessionStorage 生成IDなので別タブで別人になれる）

# 辞書の再生成（F2 でのみ実行。JMdict_e.gz は .gitignore 済みなので取得が必要）
curl -o tools/JMdict_e.gz http://ftp.edrdg.org/pub/Nihongo/JMdict_e.gz
node tools/build-dictionary.mjs   # public/js/dictionary.js を上書き再生成
```

Lint・typecheck は存在しない。検証手段は vitest と手動スモークテストのみ。

---

## Debt Map（本機能のスコープに限定）

> 形式: 各項目に「根拠 / なぜ負債か / 影響範囲 / 変更リスク / 改善案 / 検証 / 実装可否」を記す。
> ここに挙げた以外の負債（第1期で残した提案項目を含む）には手を付けないこと。

### D-F1. 共有URLでの参加導線がない【承認済み・実装してよい（機能追加）】

- **根拠**: ルームIDは `game.js:1861 copyRoomId()` で**ID文字列のみ**コピーされ、`game.html` の待機画面(game.html:22-24)も「このIDを相手に送ってください」と表示するのみ。`index.html`/`lobby.js` は URL クエリを一切読まない（`lobby.js` 冒頭の DOMContentLoaded に `URLSearchParams` の参照なし）。一方 `game.js:75-77` は既に `?room=` を読む実装がある
- **なぜ負債/不足か**: 参加の障壁が高い（IDを手入力させる）。`?room=` を読む仕組みが game 側にしか無く、入口（ロビー）に無いのは抽象の不足
- **影響範囲**: ロビーの参加導線、待機画面のコピーボタン。**ゲーム進行・スキーマ・ルールには影響しない**
- **変更リスク**: 低。Firestore/ルール変更なし。既存の参加フロー(lobby.js:88-126)はそのまま使う
- **改善案**（承認済み = ロビー事前入力方式）:
  1. `lobby.js` の DOMContentLoaded 冒頭で `new URLSearchParams(location.search).get('room')` を読み、値があれば `roomIdInput.value` に設定する（数字6桁のみ許容するサニタイズを軽く入れる。`maxlength=6 inputmode=numeric` は既存）。任意で参加カードへスクロール/フォーカス
  2. 待機画面の共有手段を「URLコピー」に拡張する。`game.html:24` のコピーボタンの隣に **「参加リンクをコピー」** ボタンを追加し、`game.js` に `copyJoinLink()` を実装: `const url = new URL('index.html', location.href); url.searchParams.set('room', roomId); navigator.clipboard.writeText(url.href)`。既存の `copyRoomId()`（IDのみ）は残す（どちらも選べると親切）
  3. `navigator.clipboard` 不可環境（古い/非HTTPS）に備え、`copyRoomId` 同様の成功トーストに加え、失敗時フォールバック（テキスト選択 or プロンプト表示）を軽く入れる。既存 `copyRoomId` がフォールバック無しなら、最低限 `.catch()` でトースト「コピーできませんでした」を出す
- **検証**: 手動: (a) 待機画面で「参加リンクをコピー」→ そのURLを別タブで開く → ロビーの参加欄にIDが入っている → 名前を入れて参加できる。(b) `?room=` 無しでロビーを開いても従来どおり空欄であること。(c) 既存の「IDをコピー」も従来どおり動く
- **実装可否**: **承認済み（Q2）**。Phase 3 で実装

### D-F2. 辞書が常用語（優先度タグ付き）に絞られ語数が少ない【承認済み・実装してよい（生成条件の緩和）】

- **根拠**: `tools/build-dictionary.mjs:85` の `if (!/<(ke|re)_pri>/.test(body)) continue;` により、JMdict の**優先度タグ付きエントリのみ**を採用 → 26,632語（2字1299/3字6192/4字10439/5字5382/6字2276/7字1044）。和製英語・カタカナ語の多くは JMdict 内に読み（`<reb>`）として存在し `kataToHira`(53) で正規化されるが、優先度タグが無いものは捨てられている
- **なぜ負債か**: dictCheck ON で「辞書にあるはずの普通の語」が弾かれ、ゲーム体験を損なう。人間の判断（Q1）で「段階的に緩和」が確定
- **影響範囲**: `dictionary.js`（自動生成）の語彙。dictCheck ON のルームの単語確定可否、F3 の検索結果。**dictCheck OFF のルームは語彙に依存しない**
- **変更リスク**: 中。緩めすぎると(a)稀語/古語/専門語で「何でも通る」状態になり dictCheck の意味が薄れる、(b)ファイルが肥大しモバイルの初期ロード/パースが重くなる、(c) `test/dictionary.test.js` が特定語の収録/非収録を前提にしていると落ちる
- **改善案**（承認済み = 中間の緩和）:
  1. **採用条件を「優先度タグ必須」から「品質タグによる除外方式」へ変更**する。具体的には:
     - 優先度タグ(`ke_pri`/`re_pri`)の有無は問わない（フィルタを外す）
     - ただしエントリの `<misc>` 品質タグを見て、**除外集合に該当するエントリはスキップ**する。除外する JMdict misc エンティティの目安: `&arch;`（古語）, `&obs;`（廃用）, `&obsc;`（隠語/難解）, `&rare;`（稀語）, `&derog;`（侮蔑）, `&vulg;`（卑語）, `&X;`（露骨）, `&sl;`（俗語）のうち**人間が許容しない範囲**。最低限 `arch/obs/obsc/rare/vulg/X/derog` は除外を推奨。`sl`(俗語)・`col`(口語) は「日本語として認められる範囲」に含めてよい（Q1 の方針＝和製英語等は可）。**具体的な採用/除外タグの最終確定は、まず除外集合で試作 → 語数とサンプルを人間に提示**してよい（Stop And Ask #3）
     - 既存の `isFormable`(59) による牌制約・長さ制約（2〜7文字）・`kataToHira` 正規化は**そのまま維持**（牌で作れない語は引き続き除外）
     - JMdict_e には固有名詞（人名・地名）は基本含まれない（それらは JMnedict 側）。よって proper-noun 対策は実質不要だが、`<misc>` に該当タグがあれば除外でよい
  2. スクリプトのコメント（抽出条件 build-dictionary.mjs:11-16）を新方針に更新する
  3. 再生成し、**語数・ファイルサイズ・各文字数の内訳・無作為サンプル20語**をログ出力して報告する
  4. **Stop And Ask #3 の閾値（80,000語超 or 約2MB超）に達したら、コミット前に人間へ報告**して除外タグを締めるか判断を仰ぐ
  5. 生成後、`isValidWord` の形式・牌制約・ひらがな限定が保たれていることを Phase 1 で追加したテストで確認
- **検証**: `npm test`（Phase 1 の不変条件テスト＋ `test/dictionary.test.js`）。落ちたら Stop And Ask #4。手動: F3 検索（Phase 4 完了後）で、以前弾かれた普通の和製英語/カタカナ語がヒットすること、明らかな非語がヒットしないこと
- **実装可否**: **承認済み（Q1）**。Phase 5 で実装。**JMdict_e.gz を入手できなければ Stop And Ask #2**

### D-F3. ゲーム画面に辞書内検索がない【承認済み・実装してよい（機能追加）】

- **根拠**: `game.html` は `dictionary.js` をロードし `isValidWord` が使えるが、ユーザーが任意の語を辞書照合するUIが無い。クライアント側にカタカナ→ひらがなの正規化純関数も無い（`kataToHira` は `tools/build-dictionary.mjs:53` にあるが Node 専用でブラウザからは見えない）
- **なぜ不足か**: dictCheck ON で何が通るか事前に確認できず、ユーザーが試行錯誤を強いられる
- **影響範囲**: `game.html`（ルールモーダル）、`game.js`（検索ハンドラ）、`utils.js`（正規化純関数）。**ゲーム状態・Firestore・スキーマには触れない**
- **変更リスク**: 低。表示専用。唯一の注意点はユーザー入力のXSS（Behaviors #9）
- **改善案**（承認済み = ルールモーダルにタブ追加）:
  1. `utils.js` に純関数を追加し `module.exports` に載せ、テストする:
     - `toHiraganaWord(str)`: 片仮名→平仮名変換＋前後空白除去＋`ー`はそのまま（`tools/build-dictionary.mjs:53` の `kataToHira` と同等のロジックをブラウザ＆Node共用で持つ）。**辞書が常にひらがなで持つため、検索入力も同じ正規化を通す**
     - 任意: `isFormableLength(word)`（2〜7文字判定）は新規不要なら作らない。検索は長さ外でも「未登録」と表示すればよい
  2. `game.html` のルールモーダル `rules-tabs`(266-271) に `<button class="rules-tab" data-tab="search">辞書検索</button>` を追加し、対応する `<div id="tab-search" class="rules-content hidden">` に検索入力＋結果表示領域を作る。既存タブ切替JS（`openRulesModal`/`closeRulesModal` 周辺、`data-tab` で `tab-<name>` を表示する仕組み）に乗せる
  3. `game.js` に検索ハンドラを実装: 入力を `toHiraganaWord` で正規化 → `typeof isValidWord === 'function'` を確認 → `isValidWord(normalized)` の真偽で「✅ 辞書にあります／❌ 見つかりません」を表示。**表示は `textContent`/`escapeHtml`(341) を使い、生の入力を `innerHTML` に入れない**
  4. 検索は dictCheck の ON/OFF に依存しない（辞書は常にロード済み）。入力 Enter でも検索できるよう keydown を拾う
  5. （任意・提案にとどめてよい）前方一致の候補表示や「近い語」は**やらない**。要件は「登録されているかの検索」= 完全一致判定で十分。やりたくなったら提案として報告（Out-of-scope）
- **検証**: `npm test`（`toHiraganaWord` のテスト）。手動: ルール→辞書検索タブで、(a)「さかな」→ あり、(b)「サカナ」→ ひらがな正規化されて あり、(c) でたらめな「ぱぴぷぺぽぱ」→ なし、(d) 入力を `<script>` 等にしてもエスケープされ実行されないこと（XSS確認）
- **実装可否**: **承認済み（Q3）**。Phase 4 で実装

### D-T1. ロビーのルール切替JSに死んだセレクタ（タイプミス）【今実装してよい（F1 で触れる範囲のみ・任意）】

- **根拠**: `index.html:214` の `document.querySelectorAll('#lobbyRuysModal .rules-content, #lobbyRulesModal .rules-content')` に **`#lobbyRuysModal`（`Rules` の誤り）** が含まれる。同じ行に正しい `#lobbyRulesModal .rules-content` も並記されているため動作は正常だが、前者は常に0件マッチの死コード
- **なぜ負債か**: 読み手が「2つのモーダルがあるのか」と誤認する
- **影響範囲**: ロビーのルールモーダルのタブ切替（表示のみ）
- **変更リスク**: 最低。誤セレクタを削るだけ
- **改善案**: `#lobbyRuysModal .rules-content, ` を削除し `#lobbyRulesModal .rules-content` のみにする
- **検証**: 手動: ロビーの「ルール・役一覧・点数表を見る」→ 各タブが従来どおり切り替わること
- **実装可否**: **F1 で `index.html`/ロビー周辺に触れるついでに直してよい（任意）**。F1 と無関係に単独で直すのは「無関係な整形」に当たるので、F1 のフェーズ内に限る。やらない判断も可

### D-P1. ロビーの満員チェックが非トランザクション【提案のみ・今回スコープ外】

- **根拠**: `lobby.js:97-118`。`get()` で読んで `playerOrder.length >= maxPlayers` を確認後 `update()` で `arrayUnion`。同時参加でレースすると maxPlayers を超えうる（`firestore.rules` は4人で頭打ちにするだけ）
- **F1 との関係**: 共有URLで参加が増えると同時参加レースの確率は上がりうるが、身内向け前提で発生頻度は低い
- **実装可否**: **提案のみ**。`runTransaction` 化は参加フローの挙動変更であり本機能のスコープ外。最終報告に根拠と推奨だけ載せる

### D-P2. ルームIDが6桁数字で総当たり可能【提案のみ・今回スコープ外】

- **根拠**: `generateRoomId`(utils.js:107) が6桁数字。README「既知の課題」にも明記。共有URL化で**URLにIDが平文で載る**が、もともとIDは口頭共有される前提で秘匿情報ではない
- **F1 との関係**: 機密性を新たに下げるものではない（IDは元から共有される）。ただしURLがチャット履歴等に残りやすくなる点は留意
- **実装可否**: **提案のみ**。桁数/生成方式の変更はスコープ外（Out-of-scope）。最終報告に注意点として記載

---

## Implementation Phases

各フェーズの完了条件: `npm test` 全件成功 ＋ そのフェーズの手動検証項目をクリア。**フェーズをまたいで変更を混ぜない。**
順序の方針: ①状態確認 → ②安全網（テスト先行）→ ③外部依存のない安全な機能から → ④外部DL/再生成を伴う最大変更（F2）は最後。

### Phase 0: 現状確認とベースライン記録
1. `git status` を確認。未コミット変更があれば**停止して報告**
2. `npm test` を実行し、結果（ファイル数・テスト数・成否）を記録（参考: 2026-06-12 時点で 2 files / 64 tests / all passed）
3. `cd public && python -m http.server 8080` で起動し、2タブでルーム作成→参加→ゲーム開始→1枚引いて捨てる、までのスモークが通ることを確認

### Phase 1: 安全網の追加（コード変更は最小、テスト中心）
- `test/utils.test.js` に **F3 で追加予定の正規化純関数のテストの受け皿**は Phase 2 で書くため、ここでは**辞書の不変条件テスト**を追加する（F2 で壊さないため先に固定）:
  - `test/dictionary.test.js` に「全語がひらがな＋`ー`のみ」「全語が2〜7文字」「`isFormable` 相当（牌制約）を満たす」ことを**現行 `DICTIONARY_WORDS` に対して**検証するテストを追加。これが F2 後も通れば、緩和しても形式不変を担保できる
- **既存実装の挙動をそのまま固定する**テストを書く。失敗するテストを書いて実装を「直す」ことはしない（矛盾を見つけたら Stop And Ask #4）

### Phase 2: F3のコア純関数（DOM非依存・テスト先行）
1. `utils.js` に `toHiraganaWord(str)` を追加（片仮名→平仮名・トリム・`ー`保持）。`module.exports`(940) に追記
2. `test/utils.test.js` にテスト追加: 片仮名→平仮名（「サカナ」→「さかな」）、前後空白除去、`ー` 保持、空文字、混在入力
- 検証: `npm test`（UI変更なし）

### Phase 3: F1 共有URL参加（D-F1, 任意で D-T1）
1. `lobby.js`: DOMContentLoaded で `?room=` を読み、6桁数字サニタイズして `roomIdInput.value` に事前入力
2. `game.html`/`game.js`: 待機画面に「参加リンクをコピー」ボタンを追加し `copyJoinLink()` を実装（`index.html?room=XXXXXX` をコピー）。既存「IDをコピー」(`copyRoomId`)は残す。clipboard 失敗時のトーストを入れる
3. （任意）D-T1: `index.html:214` の死んだセレクタ `#lobbyRuysModal` を削除
- 検証: `npm test` ＋ 手動（D-F1 の (a)(b)(c)、D-T1 を直したならロビールールタブ切替）

### Phase 4: F3 検索UI（D-F3）
1. `game.html` ルールモーダルに「辞書検索」タブ（`data-tab="search"` ＋ `#tab-search`）と入力/結果要素を追加
2. `game.js` に検索ハンドラを実装（`toHiraganaWord` → `isValidWord` → 結果表示。`escapeHtml`/`textContent` 使用。Enter対応）
3. タブ切替の既存JSに `search` が乗ることを確認
- 検証: `npm test` ＋ 手動（D-F3 の (a)〜(d)、特に (d) XSS）

### Phase 5: F2 辞書拡充（D-F2・外部DL/再生成）
1. `tools/build-dictionary.mjs` の抽出条件を「優先度タグ必須」→「品質タグ除外方式」に変更（D-F2 改善案1）。コメントも更新
2. `tools/JMdict_e.gz` を取得（無ければ **Stop And Ask #2**）し `node tools/build-dictionary.mjs` で再生成
3. 語数・ファイルサイズ・文字数内訳・サンプル20語を記録。**閾値超なら Stop And Ask #3**
4. `npm test`（Phase 1 の不変条件 ＋ `test/dictionary.test.js`）。落ちたら **Stop And Ask #4**
5. `README.md`(49,57,81,89,136 付近の「約26,000語」表記)・`index.html`(49 の「約26,000語」)・`CLAUDE.md`(辞書の語数記述) を新語数に更新
- 検証: `npm test` ＋ 手動: F3 検索で、以前弾かれた一般的な和製英語/カタカナ語がヒット、明らかな非語は非ヒット。dictCheck ON のゲームで普通の語が確定できること

### Phase 6: ドキュメント整理と提案項目のまとめ（コードは最小）
1. `README.md`「既知の課題」「遊び方」を新機能（共有URL・辞書検索・語彙拡充）に合わせて更新
2. D-P1（満員レース）・D-P2（ID総当たり）を**提案のみ**として最終報告にまとめる。**コードは書かない**

---

## Verification Requirements

- 各フェーズ後に `npm test` を実行し、**全件成功**を確認してから次へ進む
- UI に触れたフェーズ（Phase 3/4/5）は手動スモークを行う:
  1. `cd public && python -m http.server 8080`
  2. タブA: 名前入力→ルーム作成（辞書チェックONのまま）。**Phase 3 以降は「参加リンクをコピー」→ そのURLをタブBで開く → IDが事前入力されていることを確認**してから参加
  3. タブA: ゲームスタート → 引く→捨てる → タブB: ポン or パス
  4. **Phase 4 以降**: ルール→「辞書検索」タブで数語を検索（ひらがな/カタカナ/非語/XSS文字列）
  5. **Phase 5 以降**: 辞書チェックが効くこと（でたらめな語でエラー）＋ 拡充で普通の語が通ることを確認
- ブラウザ DevTools コンソールにエラーが出ていないこと
- `firebase deploy` は実行しない

---

## Reporting Format

最終報告には以下を含めること:

1. **ベースライン**: Phase 0 で記録した `git status` と `npm test` の結果
2. **フェーズごとの結果表**: 実施した変更の要約 / 変更ファイルと行 / 実行コマンドと出力要点（テスト数・成否）/ 手動検証の項目と結果
3. **F2 の数値報告**: 再生成後の語数・ファイルサイズ・文字数内訳・サンプル語、閾値判定の結果
4. **スキップ・未完了項目**とその理由（Stop And Ask 該当、JMdict 取得不可など）
5. **発見した新たな問題**（あれば）— 修正せず報告のみ
6. **提案のみ項目（D-P1/D-P2）のまとめ**: 根拠箇所・推奨対応・想定工数
7. 最後に実行したコマンドとその結果

---

## Out-of-scope Items（今回やらないこと）

- Firebase compat SDK → modular SDK 移行
- ES モジュール化・ビルド工程の導入・Lint/typecheck の導入
- `renderGame` 全再構築方式の差分レンダリング化
- `var`/`let`/`const` の一括統一・コードフォーマッタ適用
- サーバー権威化、待ち牌・ロンのサーバー検証、全員ポン/ロン対応
- `firestore.rules` / `database.rules.json` / `firebase.json` の変更
- ルームIDの桁数・生成方式の変更（D-P2）、ロビー参加のトランザクション化（D-P1）— 提案のみ
- ゲームルール（点数・役・閾値・あがり条件）の変更
- 辞書の前方一致/サジェスト検索や外部辞書APIの導入（F3 は完全一致判定のみ）
- 第1期 Debt Map（D1〜D15）への再着手（すべて完了済み）
