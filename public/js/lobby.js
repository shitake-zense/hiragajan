/**
 * lobby.js  ―  ロビー画面
 */

document.addEventListener("DOMContentLoaded", () => {
  const myPlayerId      = getOrCreatePlayerId();
  const createRoomBtn   = document.getElementById("createRoomBtn");
  const joinRoomBtn     = document.getElementById("joinRoomBtn");
  const playerNameInput = document.getElementById("playerName");
  const roomIdInput     = document.getElementById("roomIdInput");
  const errorMsg        = document.getElementById("errorMsg");

  playerNameInput.value = getPlayerName();

  // ---- 人数選択 ----
  let selectedMaxPlayers = 2;
  document.querySelectorAll("#playerCountSelect .count-btn").forEach(btn => {
    btn.addEventListener("click", () => {
      document.querySelectorAll("#playerCountSelect .count-btn").forEach(b => b.classList.remove("count-btn-active"));
      btn.classList.add("count-btn-active");
      selectedMaxPlayers = parseInt(btn.dataset.count, 10);
    });
  });

  // ---- ラウンド数選択 ----
  let selectedMaxRounds = 1;
  document.querySelectorAll("#roundCountSelect .count-btn").forEach(btn => {
    btn.addEventListener("click", () => {
      document.querySelectorAll("#roundCountSelect .count-btn").forEach(b => b.classList.remove("count-btn-active"));
      btn.classList.add("count-btn-active");
      selectedMaxRounds = parseInt(btn.dataset.round, 10);
    });
  });

  // ---- 辞書チェック選択 ----
  let selectedDictCheck = true;
  document.querySelectorAll("#dictCheckSelect .count-btn").forEach(btn => {
    btn.addEventListener("click", () => {
      document.querySelectorAll("#dictCheckSelect .count-btn").forEach(b => b.classList.remove("count-btn-active"));
      btn.classList.add("count-btn-active");
      selectedDictCheck = btn.dataset.dict === "on";
    });
  });

  // ---- ルーム作成 ----
  createRoomBtn.addEventListener("click", async () => {
    const name = playerNameInput.value.trim();
    if (!validateName(name, errorMsg)) return;
    savePlayerName(name);
    createRoomBtn.disabled = true;
    createRoomBtn.textContent = "作成中...";
    try {
      const roomId  = generateRoomId();
      const roomRef = db.collection("rooms").doc(roomId);
      // 作成から7日後を失効時刻に設定（Firestore TTLポリシーで自動削除される）
      const expireAt = firebase.firestore.Timestamp.fromMillis(Date.now() + 7 * 24 * 60 * 60 * 1000);
      await roomRef.set({
        roomId,
        status:        "waiting",
        expireAt,
        maxPlayers:    selectedMaxPlayers,
        maxRounds:     selectedMaxRounds,
        dictCheck:     selectedDictCheck,
        currentRound:  1,
        totalScores:   {},
        roundHistory:  [],
        createdAt:     firebase.firestore.FieldValue.serverTimestamp(),
        playerOrder:   [myPlayerId],
        currentTurn:   null,
        turnPhase:     "draw",
        deck:          [],
        discardPile:   [],
        lastDiscardBy: null,
        ponWindow:     null,
        wordLog:       [],
        players: { [myPlayerId]: makePlayerData(name, true) }
      });
      window.location.href = `game.html?room=${roomId}`;
    } catch (err) {
      console.error(err);
      showError(errorMsg, "ルームの作成に失敗しました");
      createRoomBtn.disabled = false;
      createRoomBtn.textContent = "ルームを作成する";
    }
  });

  // ---- ルーム参加 ----
  joinRoomBtn.addEventListener("click", async () => {
    const name   = playerNameInput.value.trim();
    const roomId = roomIdInput.value.trim();
    if (!validateName(name, errorMsg)) return;
    if (!roomId) { showError(errorMsg, "ルームIDを入力してください"); return; }
    savePlayerName(name);
    joinRoomBtn.disabled = true;
    joinRoomBtn.textContent = "参加中...";
    try {
      const roomRef  = db.collection("rooms").doc(roomId);
      const roomSnap = await roomRef.get();
      if (!roomSnap.exists) {
        showError(errorMsg, `ルーム「${roomId}」が見つかりません`);
        joinRoomBtn.disabled = false; joinRoomBtn.textContent = "参加する"; return;
      }
      const room = roomSnap.data();
      if (room.status !== "waiting") {
        showError(errorMsg, "このルームはゲームが始まっています");
        joinRoomBtn.disabled = false; joinRoomBtn.textContent = "参加する"; return;
      }
      if (room.playerOrder.length >= room.maxPlayers) {
        showError(errorMsg, `このルームは満員です（${room.maxPlayers}人）`);
        joinRoomBtn.disabled = false; joinRoomBtn.textContent = "参加する"; return;
      }
      if (room.playerOrder.includes(myPlayerId)) {
        window.location.href = `game.html?room=${roomId}`; return;
      }
      await roomRef.update({
        playerOrder: firebase.firestore.FieldValue.arrayUnion(myPlayerId),
        [`players.${myPlayerId}`]: makePlayerData(name, false)
      });
      window.location.href = `game.html?room=${roomId}`;
    } catch (err) {
      console.error(err);
      showError(errorMsg, "参加に失敗しました");
      joinRoomBtn.disabled = false;
      joinRoomBtn.textContent = "参加する";
    }
  });

  roomIdInput.addEventListener("keydown", e => {
    if (e.key === "Enter") joinRoomBtn.click();
  });
});

function makePlayerData(name, isHost) {
  return {
    name, hand: [], lockedSets: [], score: 0, riichi: false, isHost,
    joinedAt: firebase.firestore.FieldValue.serverTimestamp()
  };
}
function validateName(name, el) {
  if (!name) { showError(el, "名前を入力してください"); return false; }
  return true;
}
function showError(el, msg) {
  el.textContent = msg;
  el.classList.remove("hidden");
  setTimeout(() => el.classList.add("hidden"), 3000);
}
