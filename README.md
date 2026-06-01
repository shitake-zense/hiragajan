# 🀄 ひらがじゃん

ひらがな牌で単語を作って遊ぶ、麻雀風の対戦単語ゲームです。
ブラウザだけで動く静的サイトなので、GitHub Pages にこのフォルダを置けばそのまま遊べます。

Firebase / Firestore を使ってルーム状態を共有するため、オンライン対戦にはインターネット接続が必要です。

---

## すぐ遊ぶ

GitHub Pages で公開した URL を開くと、ロビー画面が表示されます。

1. 名前を入力する
2. ホストがルームを作る
3. 表示されたルーム ID を相手に伝える
4. 参加者が同じ URL を開いてルーム ID を入力する
5. 人数がそろったらホストがゲーム開始

---

## GitHub Pages で公開する

このリポジトリは、ビルド不要の静的サイトとして公開できます。

1. GitHub に新しいリポジトリを作る
2. この `hiragajan` フォルダの中身をそのまま push する
3. GitHub の `Settings` → `Pages` を開く
4. `Build and deployment` の `Source` を `Deploy from a branch` にする
5. `Branch` を `main`、フォルダを `/ (root)` にして保存する
6. 数十秒後に表示される Pages URL を開く

ルートの `index.html` は `public/index.html` へ自動で案内します。
そのため、Pages の公開先は `/public` ではなく `/ (root)` のままで大丈夫です。

---

## ローカルで動かす

`public` を静的配信できれば動きます。

```bash
cd hiragajan/public
python -m http.server 8080
```

ブラウザで `http://localhost:8080` を開きます。

Node.js を使う場合:

```bash
cd hiragajan/public
npx serve .
```

---

## Firebase 設定

現在の設定は `.firebaserc` と `public/js/firebase-config.js` で `hiragajan-f3887` を参照しています。

自分の Firebase プロジェクトで運用する場合は、主に次を差し替えます。

- `public/js/firebase-config.js`
- `.firebaserc`
- 必要に応じて `firestore.rules`

Firebase Hosting にも出す場合:

```bash
firebase deploy --only hosting,firestore:rules
```

GitHub Pages は静的ファイルを配るだけなので、Firestore ルールの反映は Firebase 側で行います。

---

## これは何？

- 2〜4人で遊べる対戦ゲーム
- 1 / 3 / 5 ラウンド制
- ひらがな牌を集めて単語を作る
- ポン、カン、立直、ドラ、風、役ボーナスあり
- スマホでも遊びやすい UI

公開サービス向けというより、友達同士で遊ぶ前提の作りです。

---

## 今できること

- ルーム作成 / 参加
- 対戦人数の選択
- ラウンド数の選択
- 山札、捨て牌、ポン、カン、立直、ロン、ツモ
- ドラ / 風の表示と加点
- 役の自動検出
- ラウンド結果表示
- 累計順位表示
- 同じメンバーで再戦

---

## まだ割り切っていること

- 辞書チェックは未実装
- Firebase Auth は未使用
- 得点計算や進行管理はクライアント側
- Firestore ルールは「身内用として壊れにくくする」程度

知らない人に広く公開して、強い不正対策を期待する構成ではありません。

---

## フォルダ構成

```text
hiragajan/
├── index.html
├── public/
│   ├── index.html
│   ├── game.html
│   ├── css/
│   │   └── style.css
│   └── js/
│       ├── firebase-config.js
│       ├── utils.js
│       ├── lobby.js
│       └── game.js
├── firebase.json
├── firestore.rules
├── firestore.indexes.json
├── .firebaserc
└── README.md
```

主な役割:

- `index.html`: GitHub Pages の入口。`public/index.html` に移動します
- `public/index.html`: ロビー画面
- `public/game.html`: 対戦画面
- `public/js/lobby.js`: ルーム作成 / 参加
- `public/js/game.js`: 対戦進行、画面更新、Firestore 書き込み
- `public/js/utils.js`: 山札、役判定、スコア、ドラ / 風
- `firestore.rules`: 身内向けの軽い整合性チェック

---

## Firestore のデータ構造

このプロジェクトでは `rooms/{roomId}` に 1 ルーム分の状態をまとめて持ちます。

```text
rooms/
  {roomId}
    roomId: "123456"
    status: "waiting" | "playing" | "finished"
    maxPlayers: 2 | 3 | 4
    maxRounds: 1 | 3 | 5
    currentRound: 1
    createdAt: Timestamp

    playerOrder: ["p_abc", "p_xyz"]
    currentTurn: "p_abc" | null
    turnPhase: "draw" | "discard" | "pon_window" | "pon_acquired"
    turnCount: 0

    deck: ["あ", "い", ...]
    discardPile: ["う", ...]
    lastDiscardBy: "p_abc" | null
    ponWindow: {
      active: true,
      tile: "か",
      discardedBy: "p_abc",
      eligiblePlayer: "p_xyz"
    } | null

    winds: {
      ba: "東風",
      "p_abc": "東風",
      "p_xyz": "南風"
    }
    doraTiles: {
      "あ": 1,
      "い": 2
    }

    wordLog: [...]
    totalScores: { "p_abc": 2200, "p_xyz": 800 }
    roundHistory: [...]

    players: {
      "p_abc": {
        name: "たろう",
        hand: ["あ", "い", ...],
        lockedSets: [],
        score: 0,
        ponKanScore: 0,
        riichi: false,
        riichiAt: -1,
        riichiSets: [],
        riichiHand: [],
        waitingTiles: [],
        isHost: true,
        joinedAt: Timestamp
      }
    }
```

---

## よくあるつまずき

| 状態 | 見るところ |
|---|---|
| Pages URL を開いても README しか出ない | Pages の公開フォルダを `/ (root)` にする / ルートの `index.html` が push されているか確認 |
| ルームに入れない | `roomId` が正しいか、すでに開始済み / 満員ではないか確認 |
| Firestore エラーが出る | Firebase 設定、Firestore ルール、Firebase プロジェクトの有効化を確認 |
| 画面が更新されない | ブラウザのコンソールで JavaScript エラーを確認 |
| 得点が期待と違う | 役 / ドラ / ポンカン加算の仕様差を確認 |

---

## メモ

この README は、公開ページを開いた人と、あとで開発を再開する自分が迷わないためのメモです。
GitHub Pages ではビルド工程を持たず、`public` 配下の静的ファイルをそのまま使います。
