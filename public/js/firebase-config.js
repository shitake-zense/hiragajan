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

console.log("✅ Firebase 初期化完了");
