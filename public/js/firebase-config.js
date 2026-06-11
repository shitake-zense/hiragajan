/**
 * firebase-config.js
 * Firebaseプロジェクトの設定ファイル
 *
 * 【設定方法】
 * 1. https://console.firebase.google.com にアクセス
 * 2. プロジェクトを作成 → 「ウェブアプリを追加」
 * 3. 表示されたfirebaseConfigの内容をここに貼り付ける
 */

const firebaseConfig = {
  apiKey: "AIzaSyATU_7EImbCTkiv0pXmC4c04Y_ijJ3zE3A",
  authDomain: "hiragajan-f3887.firebaseapp.com",
  databaseURL: "https://hiragajan-f3887-default-rtdb.firebaseio.com",
  projectId: "hiragajan-f3887",
  storageBucket: "hiragajan-f3887.firebasestorage.app",
  messagingSenderId: "182364824295",
  appId: "1:182364824295:web:f195bf498d18b7dd047842"
};

// Firebaseを初期化（全ページで共通）
firebase.initializeApp(firebaseConfig);

// Firestoreのインスタンスをグローバル変数として公開
// 他のJSファイルから `db.collection(...)` として使える
const db = firebase.firestore();

// iOS Safari など一部環境では、Firestore のリアルタイム更新（onSnapshot）に
// 使われる WebChannel ストリーミングがうまく流れず、状態反映が数秒〜十数秒
// 遅延することがある（ページ読み込みは正常なのに対戦中だけ重い症状）。
// ストリーミングが流れない環境を自動検出し、ロングポーリングへ切り替える。
// ※ settings() は他の Firestore 操作より前に1度だけ呼ぶ必要がある。
db.settings({ experimentalAutoDetectLongPolling: true });

console.log("✅ Firebase 初期化完了");
