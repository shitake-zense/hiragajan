/**
 * game.js  ―  ひらがじゃん
 *
 * ■ セクション構成
 *   1. グローバル変数
 *   2. 初期化・イベント登録
 *   3. Firestore リスナー
 *   4. レンダリング（描画）
 *   5. ゲームアクション（Firestore 書き込み）
 *   6. 立直モーダル
 *   7. 立直あがり（ロン / ツモ）
 *   8. あがりモーダル（通常）
 *   9. 並び替え
 *  10. UI ヘルパー
 *
 * ■ ターンフェーズ
 *   draw         山から1枚引く
 *   discard      捨てる / カン / 立直 / あがり宣言
 *   pon_window   捨て直後。次のプレイヤーがポン or パスを選ぶ
 *   pon_acquired ポン後。単語を確定してから捨てへ
 *
 * ■ 役追加方法
 *   utils.js の detectRoles() に条件を追記するだけ。
 *   ルール表示は game.html の「役一覧」タブと「点数表」タブに追記。
 */

// ============================================================
// 1. グローバル変数
// ============================================================

const myPlayerId = getOrCreatePlayerId();
let roomId       = null;
let roomListener = null;
let currentRoom  = null;

let selectedIndices  = [];
let localHandDisplay = [];
let currentDoraTiles = {};  // { tile: multiplier } ラウンドごとに更新
let sortMode         = false;
let sortFirstIdx     = null;
let autoPassTimer    = null;  // 立直者の自動パスタイマー（多重予約防止用に1つだけ保持）

let riichiState = {
  remainingHand:    [],
  confirmedGroups:  [],
  currentSelection: [],
  waitingTiles:     [],
  discardSelection: []
};

let riichiAgariState = {
  tiles:     [],
  firstIdx:  null,
  onConfirm: null
};

let agariState = {
  remainingHand:    [],
  confirmedGroups:  [],
  currentSelection: [],
  detectedRoles:    []
};

// ============================================================
// 2. 初期化・イベント登録
// ============================================================

function on(id, fn) {
  const el = document.getElementById(id);
  if (el) el.addEventListener('click', fn);
  else console.warn('要素が見つかりません: #' + id);
}

document.addEventListener('DOMContentLoaded', () => {
  const params = new URLSearchParams(window.location.search);
  roomId = params.get('room');
  if (!roomId) { alert('ルームIDがありません'); window.location.href = 'index.html'; return; }

  const roomIdEl = document.getElementById('roomIdDisplay');
  if (roomIdEl) roomIdEl.textContent = roomId;

  on('startGameBtn', startGame);
  on('drawBtn',      drawTile);
  on('discardBtn',   discardTile);
  on('kanBtn',       kanTiles);
  on('agariBtn',     openAgariModal);

  on('ponBtn',       ponTile);
  on('passBtn',      passPon);
  on('ponCancelBtn', cancelPon);
  on('ponLockBtn',   lockPonWord);
  on('ronBtn',       claimRon);

  on('riichiBtn',             openRiichiModal);
  on('riichiConfirmGroupBtn', riichiConfirmGroup);
  on('riichiUndoBtn',         riichiUndoGroup);
  on('riichiStep1NextBtn',    riichiGoStep2);
  on('riichiBackBtn',         riichiGoStep1);
  on('riichiStep2NextBtn',    riichiGoStep3);
  on('riichiStep3BackBtn',    riichiGoStep2);
  on('riichiAddWaitBtn',      riichiAddWaiting);
  on('riichiSubmitBtn',       submitRiichi);
  on('riichiCancelBtn',       closeRiichiModal);
  on('riichiCancelBtn2',      closeRiichiModal);
  on('riichiAgariSubmitBtn',  confirmRiichiAgariOrder);

  const waitInput = document.getElementById('riichiWaitInput');
  if (waitInput) {
    waitInput.addEventListener('keydown', e => {
      if (e.key === 'Enter') { e.preventDefault(); riichiAddWaiting(); }
    });
  }

  on('agariConfirmGroupBtn', confirmAgariGroup);
  on('agariUndoBtn',         undoAgariGroup);
  on('agariSubmitBtn',       submitAgari);
  on('agariCancelBtn',       closeAgariModal);

  on('nextRoundBtn',  startNextRound);
  on('sortModeBtn',   toggleSortMode);
  on('sortAiueoBtn',  sortByAiueo);
  on('copyRoomIdBtn', copyRoomId);
  on('standingsBtn',      openStandingsModal);
  on('standingsCloseBtn', closeStandingsModal);
  on('rulesBtn',      openRulesModal);
  on('rulesCloseBtn', closeRulesModal);
  on('playAgainBtn',  playAgain);
  // 下部情報パネルのトグル
  const bottomToggle = document.getElementById('bottomInfoToggle');
  const bottomContent = document.getElementById('bottomInfoContent');
  if (bottomToggle && bottomContent) {
    bottomToggle.addEventListener('click', () => {
      const isOpen = !bottomContent.classList.contains('hidden');
      bottomContent.classList.toggle('hidden', isOpen);
      bottomToggle.setAttribute('aria-expanded', String(!isOpen));
      const icon = bottomToggle.querySelector('.bottom-info-toggle-icon');
      if (icon) icon.textContent = isOpen ? '▲' : '▼';
    });
  }

  on('backToLobbyBtn', () => {
    if (confirm('ロビーに戻りますか？')) window.location.href = 'index.html';
  });

  document.querySelectorAll('.rules-tab').forEach(btn => {
    btn.addEventListener('click', () => {
      const tab = btn.dataset.tab;
      document.querySelectorAll('.rules-tab').forEach(b => b.classList.remove('rules-tab-active'));
      document.querySelectorAll('.rules-content').forEach(c => c.classList.add('hidden'));
      btn.classList.add('rules-tab-active');
      const el = document.getElementById('tab-' + tab);
      if (el) el.classList.remove('hidden');
    });
  });

  startRoomListener();
});

// ============================================================
// 3. Firestore リスナー
// ============================================================

function startRoomListener() {
  roomListener = db.collection('rooms').doc(roomId).onSnapshot(snap => {
    if (!snap.exists) { showMsg('ルームが見つかりません'); return; }
    currentRoom = snap.data();
    renderGame(currentRoom);
  }, err => { console.error('リスナーエラー:', err); showMsg('接続エラーが発生しました'); });
}

// ============================================================
// 4. レンダリング（描画）
// ============================================================

function renderGame(room) {
  const myData = room.players[myPlayerId];
  if (!myData) return;

  // ラウンドが変わった（または新ゲーム開始）時にローカル状態をリセット
  const prevRound   = renderGame._lastRound   || 0;
  const prevStatus  = renderGame._lastStatus  || '';
  const thisRound   = room.currentRound || 1;
  const thisStatus  = room.status || '';
  if (thisRound !== prevRound || (thisStatus === 'playing' && prevStatus !== 'playing')) {
    selectedIndices  = [];
    localHandDisplay = [];
    sortMode         = false;
    sortFirstIdx     = null;
    riichiState      = { remainingHand: [], confirmedGroups: [], currentSelection: [], waitingTiles: [], discardSelection: [] };
  }
  renderGame._lastRound  = thisRound;
  renderGame._lastStatus = thisStatus;

  // ドラ情報をグローバルに同期（全描画でドラ色が反映される）
  currentDoraTiles = room.doraTiles || {};

  const opIds             = room.playerOrder.filter(id => id !== myPlayerId);
  const currentTurnPlayer = room.currentTurn ? room.players[room.currentTurn] : null;
  const isMyTurn          = room.currentTurn === myPlayerId;
  const isWaiting         = room.status === 'waiting';
  const isFinished        = room.status === 'finished';

  setVisible('waitingSection', isWaiting);
  setVisible('gameSection',    !isWaiting);
  if (isWaiting) {
    // 再戦後の残留モーダルを全て閉じる
    setVisible('finishSection',      false);
    setVisible('roundSummaryModal',  false);
    setVisible('riichiModal',        false);
    setVisible('agariModal',         false);
    // startGameBtnのdisabledをリセット（前回押されたままの場合に対応）
    const sgBtn = document.getElementById('startGameBtn');
    if (sgBtn) { sgBtn.disabled = false; sgBtn.textContent = '🎮 ゲームスタート！'; }
    renderWaiting(room, myData);
    return;
  }

  const roundEl = document.getElementById('roundIndicator');
  if (roundEl) {
    roundEl.classList.remove('hidden');
    roundEl.textContent = 'ラウンド ' + (room.currentRound || 1) + ' / ' + (room.maxRounds || 1);
  }

  renderPlayerBar(room);
  renderOpponents(room, opIds);
  renderCenter(room);
  renderWordLog(room.wordLog || []);
  renderMyArea(room, myData, isMyTurn);
  renderActionPanel(room, isMyTurn, myData);
  renderPonOverlay(room);
  renderTurnBanner(room, isMyTurn, currentTurnPlayer, isFinished);

  if (isFinished) {
    const isLastRound = (room.currentRound || 1) >= (room.maxRounds || 1);
    if (isLastRound) { renderFinish(room); setVisible('roundSummaryModal', false); }
    else             { renderRoundSummary(room, myData); setVisible('finishSection', false); }
  } else {
    setVisible('roundSummaryModal', false);
    setVisible('finishSection', false);
  }
}

function renderPlayerBar(room) {
  const el = document.getElementById('playerBar');
  if (!el) return;
  el.innerHTML = '';
  el.classList.remove('hidden');
  room.playerOrder.forEach(pid => {
    const p   = room.players[pid];
    const isT = room.currentTurn === pid;
    const isMe = pid === myPlayerId;
    const card = document.createElement('div');
    card.className = 'pbar-card' + (isT ? ' pbar-active' : ' pbar-inactive') + (isMe ? ' pbar-me' : '');
    const nameEl = document.createElement('div');
    nameEl.className   = 'pbar-name';
    nameEl.textContent = (isT ? '▶ ' : '') + p.name + (isMe ? '（自分）' : '');
    const scoreEl = document.createElement('div');
    scoreEl.className   = 'pbar-score';
    scoreEl.textContent = (p.score || 0) + '点';
    card.appendChild(nameEl);
    card.appendChild(scoreEl);
    if (p.riichi) {
      const badge = document.createElement('div');
      badge.className = 'pbar-riichi-badge'; badge.textContent = '立直';
      card.appendChild(badge);
    }
    el.appendChild(card);
  });
}

function renderWaiting(room, myData) {
  const both = room.playerOrder.length >= 2;
  setVisible('startGameBtn',       myData.isHost && both);
  setVisible('waitingForOpponent', myData.isHost && !both);
  setVisible('waitingForHost',     !myData.isHost && !both);
  setText('dictCheckStatus', '📖 辞書チェック: ' + (room.dictCheck ? 'ON' : 'OFF'));
  setVisible('dictCheckStatus', true);
  const list = document.getElementById('playerList');
  if (!list) return;
  list.innerHTML = '';
  room.playerOrder.forEach(pid => {
    const p  = room.players[pid];
    const li = document.createElement('li');
    li.textContent = (pid === myPlayerId ? '👤 ' : '🤝 ') + p.name + (p.isHost ? ' (ホスト)' : '');
    list.appendChild(li);
  });
}

function renderOpponents(room, opIds) {
  const container = document.getElementById('opponentsContainer');
  if (!container) return;
  container.innerHTML = '';
  opIds.forEach(opId => {
    const opData  = room.players[opId];
    if (!opData) return;
    const isActive = room.currentTurn === opId;
    const lockedId = 'opLocked_' + opId;
    const handId   = 'opHand_'   + opId;

    const section = document.createElement('section');
    section.className = 'area opponent-area' + (isActive ? ' opponent-active-turn' : '');

    section.innerHTML =
      '<div class="player-bar">' +
        '<span class="player-name">' + (isActive ? '▶ ' : '') + escapeHtml(opData.name) + '</span>' +
        '<span class="score-badge">🏆 ' + (opData.score || 0) + '点' +
          (opData.riichi ? ' <span class="pbar-riichi-badge">立直</span>' : '') +
        '</span>' +
      '</div>' +
      '<div id="' + handId + '" class="hand"></div>' +
      '<div class="locked-label">確定済み（' + escapeHtml(opData.name) + '）</div>' +
      '<div id="' + lockedId + '" class="locked-area"></div>';

    container.appendChild(section);

    // 手牌（裏向き）
    const handEl = document.getElementById(handId);
    if (handEl) {
      opData.hand.forEach(() => handEl.appendChild(makeTile('🀄', 'tile-back')));
    }
    // 確定済み組
    renderLockedSets(lockedId, opData.lockedSets || [], opData.riichiSets || [], false);
  });
}

/**
 * 辞書チェック（ルーム設定 dictCheck が ON のときのみ）
 * @param {Object}   room  - ルームドキュメント
 * @param {string[]} tiles - 単語を構成する牌
 * @returns {string|null} エラーメッセージ（問題なければ null）
 */
function checkDictWord(room, tiles) {
  if (!room || !room.dictCheck) return null;
  if (typeof isValidWord !== 'function') return null; // 辞書未ロード時はスキップ
  const word = (tiles || []).join('');
  if (!isValidWord(word)) return '「' + word + '」は辞書にない単語です';
  return null;
}

/** XSS対策: HTML特殊文字をエスケープ */
function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function renderCenter(room) {
  setText('deckCount', room.deck.length);
  // 山札残り10枚以下で警告表示
  const deckNumEl = document.getElementById('deckCount');
  if (deckNumEl) {
    deckNumEl.classList.toggle('deck-warning', room.deck.length <= 10);
  }
  const pileEl = document.getElementById('discardPile');
  if (!pileEl) return;
  pileEl.innerHTML = '';
  const discardAiueoSeen = {};
  (room.discardPile || []).slice(-16).forEach(c => {
    let isAiueoDora = false;
    if (AIUEO_SET.has(c)) {
      discardAiueoSeen[c] = (discardAiueoSeen[c] || 0) + 1;
      isAiueoDora = discardAiueoSeen[c] === 1;
    }
    pileEl.appendChild(makeTile(c, 'tile-discard', isAiueoDora));
  });
  renderDoraWindBar(room);
}

/** ドラ・風情報バー描画 */
function renderDoraWindBar(room) {
  const bar = document.getElementById('doraWindBar');
  if (!bar) return;
  if (!room.doraTiles && !room.winds) { bar.classList.add('hidden'); return; }
  bar.classList.remove('hidden');

  // ドラ牌表示（あいうえおは除く）
  const doraTilesEl = document.getElementById('doraTilesDisplay');
  if (doraTilesEl) {
    doraTilesEl.innerHTML = '';
    const dora       = room.doraTiles || {};
    Object.keys(dora).sort().forEach(char => {
      const mult = dora[char] || 0;
      if (mult <= 0) return;
      if (AIUEO_SET.has(char)) return; // あいうえおは表示欄に出さない（既にドラ）
      const tile = makeTile(char, 'tile-dora-display');
      if (mult >= 2) tile.classList.add('tile-dora-2');
      else           tile.classList.add('tile-dora');
      if (mult >= 2) {
        const badge = document.createElement('span');
        badge.className = 'dora-mult-badge'; badge.textContent = '×' + mult;
        tile.appendChild(badge);
      }
      doraTilesEl.appendChild(tile);
    });
  }

  // 風表示
  if (room.winds) {
    setText('baWindDisplay', room.winds.ba || '―');
    setText('myWindDisplay', room.winds[myPlayerId] || '―');
  }
}

function renderWordLog(log) {
  const el = document.getElementById('wordLog');
  if (!el) return;
  el.innerHTML = '';
  log.slice(-6).forEach(entry => {
    const div  = document.createElement('div');
    div.className   = 'word-entry';
    const icon = { pon: '🀄', kan: '⚡', tsumo: '🎲', ron: '🏆' }[entry.type] || '📝';
    div.textContent = icon + ' ' + entry.playerName + ':「' + entry.word + '」' + entry.score + '点';
    el.appendChild(div);
  });
}

/**
 * 確定済み組を描画する
 * isOwn=true: 立直組の中身を表示 / false: 裏向き（？）
 */
function renderLockedSets(containerId, lockedSets, riichiSets, isOwn, aiueoSeenInit) {
  const el = document.getElementById(containerId);
  if (!el) return;
  el.innerHTML = '';
  const allSets = (lockedSets || []).slice();
  (riichiSets || []).forEach(s => allSets.push({ tiles: s.tiles, word: s.word, score: s.score, type: 'riichi' }));
  if (allSets.length === 0) { el.innerHTML = '<span class="no-set">なし</span>'; return; }
  const aiueoSeen = aiueoSeenInit || {};  // 参照渡し：呼び出し元のカウンターを直接更新
  allSets.forEach(set => {
    const setEl = document.createElement('div');
    setEl.className = 'locked-set';
    if (!isOwn && set.type === 'riichi') {
      set.tiles.forEach(() => setEl.appendChild(makeTile('？', 'tile-locked tile-riichi-hidden')));
    } else {
      (set.tiles || []).forEach(c => {
        let isAiueoDora = false;
        if (AIUEO_SET.has(c)) {
          aiueoSeen[c] = (aiueoSeen[c] || 0) + 1;
          isAiueoDora = aiueoSeen[c] === 1;
        }
        setEl.appendChild(makeTile(c, 'tile-locked', isAiueoDora));
      });
    }
    const badge = document.createElement('span');
    badge.className   = 'set-type-badge' + (set.type === 'riichi' ? ' riichi-badge' : '');
    badge.textContent = { pon: 'ポン', kan: 'カン', tsumo: 'ツモ', riichi: '立直' }[set.type] || set.type;
    setEl.appendChild(badge);
    el.appendChild(setEl);
  });
}

function renderMyArea(room, myData, isMyTurn) {
  setText('myName',  myData.name);
  setText('myScore', myData.score);

  // あいうえおドラカウンター: 確定済み組と手牌で共有（全牌通じて1枚目のみドラ色）
  const sharedAiueoSeen = {};
  // renderLockedSetsに空カウンターを渡し、描画後にそのカウンターを手牌側に引き継ぐ
  renderLockedSets('myLocked', myData.lockedSets || [], myData.riichiSets || [], true, sharedAiueoSeen);

  const hand  = myData.hand;
  const phase = room.turnPhase;
  localHandDisplay = syncHandDisplay(localHandDisplay, hand);
  selectedIndices  = selectedIndices.filter(i => i < hand.length);

  const sortBtn = document.getElementById('sortModeBtn');
  if (sortBtn) {
    sortBtn.textContent = sortMode ? '✅ 並び替え完了' : '🔀 並び替え';
    sortBtn.classList.toggle('btn-sort-active', sortMode);
  }

  const tappable     = isMyTurn && (phase === 'discard' || phase === 'pon_acquired');
  const isRiichi     = myData.riichi || false;
  let riichiHandLeft = (myData.riichiHand || []).slice();

  // 立直後：引いた牌（riichiHandにない牌）を自動特定し、selectedIndicesを上書き
  if (isRiichi && phase === 'discard' && isMyTurn) {
    const riichiHandCopy = (myData.riichiHand || []).slice();
    const drawnIndices   = [];
    hand.forEach((c, i) => {
      const pos = riichiHandCopy.indexOf(c);
      if (pos !== -1) { riichiHandCopy.splice(pos, 1); }
      else            { drawnIndices.push(i); }
    });
    // 引いた牌が1枚だけなら自動選択（ユーザーの操作を省略）
    if (drawnIndices.length === 1) {
      selectedIndices = drawnIndices;
    }
  }

  const handEl = document.getElementById('myHand');
  if (!handEl) return;
  handEl.innerHTML = '';

  const usedIndices  = [];
  // sharedAiueoSeenは確定済み組のカウント済み（renderMyArea冒頭で作成）
  // 手牌描画でもそのまま引き継いで「全牌通じての1枚目」を判定する
  const aiueoSeen = Object.assign({}, sharedAiueoSeen);
  localHandDisplay.forEach((char, displayIdx) => {
    let origIdx = -1;
    for (let i = 0; i < hand.length; i++) {
      if (hand[i] === char && !usedIndices.includes(i)) { origIdx = i; usedIndices.push(i); break; }
    }
    if (origIdx === -1) return;

    const riichiIdx    = isRiichi ? riichiHandLeft.indexOf(char) : -1;
    const isRiichiTile = riichiIdx !== -1;
    if (isRiichiTile) riichiHandLeft.splice(riichiIdx, 1);

    // あいうえおは手牌内で1枚目のみドラ色（2枚目以降は通常色）
    let isAiueoDora = false;
    if (AIUEO_SET.has(char)) {
      aiueoSeen[char] = (aiueoSeen[char] || 0) + 1;
      isAiueoDora = aiueoSeen[char] === 1;
    }

    const tile = makeTile(char, isRiichiTile ? 'tile-my tile-riichi-locked' : 'tile-my', isAiueoDora);
    if (sortMode) {
      tile.classList.add('sort-mode');
      if (sortFirstIdx === displayIdx) tile.classList.add('sort-selected');
      tile.addEventListener('click', () => handleSortTap(displayIdx));
    } else {
      // 立直中はriichiLockedな牌にselectedを付けない（引いた牌のみ選択可）
      if (selectedIndices.includes(origIdx) && !isRiichiTile) tile.classList.add('selected');
      if (tappable && !isRiichiTile) tile.addEventListener('click', () => handleTileTap(origIdx, hand));
    }
    handEl.appendChild(tile);
  });

  updateWordPreview(hand);

  // 待ち牌バー（立直中のみ）
  const waitEl  = document.getElementById('riichiWaitingBar');
  const waiting = myData.waitingTiles || [];
  if (waitEl) {
    if (isRiichi && waiting.length > 0) {
      waitEl.innerHTML = '';
      waitEl.classList.remove('hidden');
      const label = document.createElement('div');
      label.className = 'waiting-bar-label'; label.textContent = '待ち牌';
      waitEl.appendChild(label);
      const wrap = document.createElement('div');
      wrap.className = 'waiting-bar-tiles';
      waiting.forEach(c => wrap.appendChild(makeTile(c, 'tile-waiting')));
      waitEl.appendChild(wrap);
    } else {
      waitEl.classList.add('hidden'); waitEl.innerHTML = '';
    }
  }
}

function syncHandDisplay(display, hand) {
  const tempHand = hand.slice();
  const matched  = [];
  for (const char of display) {
    const idx = tempHand.indexOf(char);
    if (idx !== -1) { matched.push(char); tempHand.splice(idx, 1); }
  }
  return matched.concat(tempHand);
}

function renderActionPanel(room, isMyTurn, myData) {
  ['drawBtn', 'discardBtn', 'kanBtn', 'agariBtn', 'ponLockBtn', 'riichiBtn'].forEach(id => {
    const el = document.getElementById(id);
    if (el) { el.classList.add('hidden'); el.disabled = true; }
  });
  if (!isMyTurn || room.status !== 'playing' || room.turnPhase === 'pon_window') return;

  const phase        = room.turnPhase;
  const isRiichi     = myData.riichi || false;
  const hasLocked    = (myData.lockedSets || []).length > 0;
  const drawnWaiting = isRiichi && room.drawnWaitingTile === true;

  if (phase === 'draw') {
    showBtn('drawBtn', room.deck.length > 0);
  } else if (phase === 'discard') {
    if (isRiichi) {
      showBtn('discardBtn', selectedIndices.length === 1);
      // 立直後の捨てるボタンに引いた牌の文字を表示
      const discEl = document.getElementById('discardBtn');
      if (discEl && selectedIndices.length === 1) {
        const myHand = room.players[myPlayerId] ? room.players[myPlayerId].hand : [];
        const tile   = myHand[selectedIndices[0]] || '';
        discEl.textContent = '🗑️ 「' + tile + '」を捨てる（引いた牌）';
      } else if (discEl) {
        discEl.textContent = '🗑️ 捨てる';
      }
      if (drawnWaiting) showBtn('agariBtn', true);
    } else {
      showBtn('discardBtn', selectedIndices.length === 1);
      showBtn('kanBtn',     selectedIndices.length >= 4);
      showBtn('agariBtn',   true);
      showBtn('riichiBtn',  !hasLocked);
      const riichiEl = document.getElementById('riichiBtn');
      if (riichiEl) riichiEl.textContent = '🎯 立直宣言';
    }
  } else if (phase === 'pon_acquired') {
    const ct       = room.ponWindow ? room.ponWindow.tile : null;
    const claimed  = ct && selectedIndices.some(i => myData.hand[i] === ct);
    showBtn('ponLockBtn', claimed && selectedIndices.length === 3);
    showBtn('agariBtn',   true);
    showBtn('ponCancelBtn', true);
    const ponLockEl = document.getElementById('ponLockBtn');
    if (ponLockEl) ponLockEl.textContent = ct
      ? '🔒「' + ct + '」を含む3文字の単語を確定'
      : '🔒 3文字の単語を確定する';
  }
}

function renderPonOverlay(room) {
  const show = room.turnPhase === 'pon_window';
  setVisible('ponOverlay', show);
  if (!show) {
    // pon_window を抜けたら予約済みの自動パスタイマーを破棄（古い発火による巻き戻し防止）
    if (autoPassTimer !== null) { clearTimeout(autoPassTimer); autoPassTimer = null; }
    return;
  }

  const pon        = room.ponWindow || {};
  const isEligible = pon.eligiblePlayer === myPlayerId;
  setText('ponTileDisplay', pon.tile || '？');
  setText('ponTileChar',    pon.tile || '？');
  setVisible('ponActions', isEligible);
  setVisible('ponWaiting', !isEligible);

  const passBtn = document.getElementById('passBtn');
  const ponBtn  = document.getElementById('ponBtn');
  const ronBtn  = document.getElementById('ronBtn');

  if (isEligible) {
    const myData    = room.players[myPlayerId];
    const myRiichi  = myData && myData.riichi;
    const myWaiting = (myData && myData.waitingTiles) || [];
    const isRonTile = myRiichi && myWaiting.includes(pon.tile);
    if (myRiichi) {
      if (isRonTile) {
        if (ronBtn)  { ronBtn.classList.remove('hidden'); ronBtn.disabled = false; }
        if (ponBtn)  ponBtn.disabled  = true;
        if (passBtn) passBtn.disabled = false;
      } else {
        if (ronBtn)  ronBtn.classList.add('hidden');
        if (ponBtn)  ponBtn.disabled  = true;
        if (passBtn) passBtn.disabled = false;
        // 自動パス: 再描画ごとにタイマーを積まない（予約は常に1つだけ）
        if (autoPassTimer === null) {
          autoPassTimer = setTimeout(() => { autoPassTimer = null; passPon(); }, 300);
        }
      }
    } else {
      if (ponBtn)  ponBtn.disabled  = false;
      if (passBtn) passBtn.disabled = false;
      if (ronBtn)  ronBtn.classList.add('hidden');
    }
  } else {
    if (ponBtn)  ponBtn.disabled  = true;
    if (passBtn) passBtn.disabled = true;
    if (ronBtn)  ronBtn.classList.add('hidden');
  }

  const myHand  = room.players[myPlayerId] ? room.players[myPlayerId].hand : [];
  const ponHand = document.getElementById('ponMyHandDisplay');
  if (ponHand) {
    ponHand.innerHTML = '';
    const order = (localHandDisplay.length === myHand.length) ? localHandDisplay : myHand;
    order.forEach(char => {
      const t = makeTile(char, 'tile-my'); t.style.cursor = 'default'; ponHand.appendChild(t);
    });
  }
}

function renderTurnBanner(room, isMyTurn, currentTurnPlayer, isFinished) {
  const el = document.getElementById('turnIndicator');
  if (!el) return;
  if (isFinished) { el.textContent = '🏁 ゲーム終了！'; el.className = 'turn-indicator finished'; return; }
  const labels = {
    draw: '山から引く', discard: '捨てる・カン・あがり',
    pon_window: 'ポンの判断中', pon_acquired: '単語を公開して確定 → 捨てる'
  };
  const pon        = room.ponWindow;
  const turnNum    = room.turnCount ? Math.ceil(room.turnCount / (room.playerOrder ? room.playerOrder.length : 2)) : 1;
  const turnSuffix = ' ｜ ' + turnNum + '巡目';

  if (room.turnPhase === 'pon_window' && pon && pon.eligiblePlayer === myPlayerId) {
    el.textContent = '🀄 ポンできます！「' + (pon.tile || '') + '」' + turnSuffix;
    el.className   = 'turn-indicator pon-eligible';
  } else if (isMyTurn) {
    el.textContent = '🎯 あなたのターン：' + (labels[room.turnPhase] || '') + turnSuffix;
    el.className   = 'turn-indicator my-turn';
  } else {
    const name = currentTurnPlayer ? currentTurnPlayer.name : '相手';
    el.textContent = '⌛ ' + name + 'のターン（' + (labels[room.turnPhase] || '') + '）' + turnSuffix;
    el.className   = 'turn-indicator opponent-turn';
  }
}

function renderRoundSummary(room, myData) {
  setVisible('roundSummaryModal', true);
  const round     = room.currentRound || 1;
  const maxRounds = room.maxRounds   || 1;
  const history   = room.roundHistory || [];
  const last      = history.length > 0 ? history[history.length - 1] : null;
  const totals    = room.totalScores || {};

  setText('roundSummaryTitle', 'ラウンド ' + round + ' / ' + maxRounds + ' 終了！');

  const winnerEl = document.getElementById('roundWinnerDisplay');
  if (winnerEl && last) {
    const isMe = last.winnerId === myPlayerId;
    winnerEl.innerHTML =
      "<div class='round-winner-label'>" + (isMe ? '🎉 あなたのあがり！' : '🎯 ' + escapeHtml(last.winnerName) + ' のあがり！') + "</div>" +
      "<div class='round-winner-score'>+" + (last.winnerScore || 0) + '点</div>';
  }

  const wordsEl = document.getElementById('roundWordsDisplay');
  if (wordsEl && last && last.words) {
    wordsEl.innerHTML = '';
    last.words.forEach(w => {
      const div = document.createElement('div');
      div.className = 'round-word-row';
      div.innerHTML =
        "<span class='round-word-tiles'>" + escapeHtml((w.tiles || []).join('')) + "</span>" +
        "<span class='round-word-label'>" + escapeHtml(w.word) + "</span>" +
        "<span class='round-word-score'>+" + w.score + '点</span>';
      wordsEl.appendChild(div);
    });
    // ドラ枚数を表示
    if (last.doraCount > 0) {
      const doraDiv = document.createElement('div');
      doraDiv.className = 'round-word-row round-dora-row';
      const doraDetailStr = (last.doraDetail || []).map(function(d) {
        return d.tile + (d.mult > 1 ? '×' + d.mult + '倍' : '') + (d.times > 1 ? ' ' + d.times + '枚' : '');
      }).join(' ');
      doraDiv.innerHTML = "<span class='round-word-tiles'>🀄</span><span class='round-word-label'>ドラ " + last.doraCount + "枚" + (doraDetailStr ? "（" + escapeHtml(doraDetailStr) + "）" : "") + "</span><span class='round-word-score'>+" + last.doraBonus + '点</span>';
      wordsEl.appendChild(doraDiv);
    }
  }

  const rolesEl = document.getElementById('roundRolesDisplay');
  if (last && last.roles && last.roles.length > 0) {
    setVisible('roundRolesSection', true);
    if (rolesEl) {
      rolesEl.innerHTML = '';
      last.roles.forEach(r => {
        const div = document.createElement('div');
        div.className = 'round-role-row'; div.textContent = r.name + '（+' + r.score + '点）';
        rolesEl.appendChild(div);
      });
    }
  } else { setVisible('roundRolesSection', false); }

  const rsEl = document.getElementById('roundScoresDisplay');
  if (rsEl && last && last.scores) {
    rsEl.innerHTML = '';
    room.playerOrder.forEach(pid => {
      const div = document.createElement('div');
      div.className   = 'score-summary-row' + (pid === myPlayerId ? ' is-me' : '');
      div.textContent = room.players[pid].name + ':  +' + (last.scores[pid] || 0) + '点';
      rsEl.appendChild(div);
    });
  }

  const totalEl = document.getElementById('totalScoresDisplay');
  if (totalEl) {
    totalEl.innerHTML = '';
    room.playerOrder.slice().sort((a, b) => (totals[b] || 0) - (totals[a] || 0)).forEach((pid, i) => {
      const div = document.createElement('div');
      div.className   = 'score-summary-row total-row' + (pid === myPlayerId ? ' is-me' : '');
      div.textContent = (i + 1) + '位: ' + room.players[pid].name + '  ' + (totals[pid] || 0) + '点';
      totalEl.appendChild(div);
    });
  }

  const nextBtn = document.getElementById('nextRoundBtn');
  if (nextBtn) nextBtn.disabled = false;
  setVisible('nextRoundBtn',     myData.isHost);
  setVisible('waitingNextRound', !myData.isHost);
}

function renderFinish(room) {
  setVisible('finishSection', true);
  const myData = room.players[myPlayerId];
  if (myData && myData.isHost) {
    setVisible('playAgainBtn',   true);
    setVisible('waitingRematch', false);
  } else {
    setVisible('playAgainBtn',   false);
    setVisible('waitingRematch', true);
  }
  const totals = room.totalScores || {};
  const scores = room.playerOrder.map(pid => ({
    name: room.players[pid].name, score: totals[pid] || 0, isMe: pid === myPlayerId
  })).sort((a, b) => b.score - a.score);

  const resultEl = document.getElementById('resultMessage');
  if (resultEl) {
    if (scores.length > 1 && scores[0].score === scores[1].score) {
      resultEl.textContent = '🤝 引き分け！'; resultEl.className = 'result-draw';
    } else if (scores[0].isMe) {
      resultEl.textContent = '🎉 あなたの勝ち！'; resultEl.className = 'result-win';
    } else {
      resultEl.textContent = '😢 ' + scores[0].name + 'の勝ち'; resultEl.className = 'result-lose';
    }
  }

  const listEl = document.getElementById('finalScores');
  if (!listEl) return;
  listEl.innerHTML = '';

  const history = room.roundHistory || [];
  if (history.length > 0) {
    const ht = document.createElement('div');
    ht.className = 'final-history-title'; ht.textContent = '📋 ラウンド履歴';
    listEl.appendChild(ht);
    history.forEach(h => {
      const row = document.createElement('div');
      row.className = 'final-history-row';
      row.textContent = 'R' + h.round + ': ' + h.winnerName + ' あがり（' + h.winnerScore + '点）';
      listEl.appendChild(row);
      if (h.words && h.words.length > 0) {
        const ww = document.createElement('div'); ww.className = 'final-words-wrap';
        h.words.forEach(w => {
          const wd = document.createElement('div'); wd.className = 'final-word-row';
          wd.textContent = ((w.tiles || []).join('') || w.word || '') + '（' + w.score + '点）';
          ww.appendChild(wd);
        });
        listEl.appendChild(ww);
      }
      if (h.doraCount > 0) {
        const dw = document.createElement('div'); dw.className = 'final-roles-wrap';
        const dd = document.createElement('div'); dd.className = 'final-role-row final-dora-row';
        const doraDS = (h.doraDetail || []).map(function(d) {
          return d.tile + (d.mult > 1 ? '×' + d.mult + '倍' : '') + (d.times > 1 ? ' ' + d.times + '枚' : '');
        }).join(' ');
        dd.textContent = '🀄 ドラ ' + h.doraCount + '枚' + (doraDS ? '（' + doraDS + '）' : '') + '（+' + h.doraBonus + '点）';
        dw.appendChild(dd); listEl.appendChild(dw);
      }
      if (h.roles && h.roles.length > 0) {
        const rw = document.createElement('div'); rw.className = 'final-roles-wrap';
        h.roles.forEach(r => {
          const rd = document.createElement('div'); rd.className = 'final-role-row';
          rd.textContent = '🀄 ' + r.name + '（+' + r.score + '点）'; rw.appendChild(rd);
        });
        listEl.appendChild(rw);
      }
    });
    const sep = document.createElement('div'); sep.className = 'final-sep';
    listEl.appendChild(sep);
  }

  const tt = document.createElement('div');
  tt.className = 'final-history-title'; tt.textContent = '🏆 最終累計スコア';
  listEl.appendChild(tt);
  scores.forEach((s, i) => {
    const div = document.createElement('div');
    div.className   = 'final-score-entry' + (s.isMe ? ' is-me' : '');
    div.textContent = (i + 1) + '位: ' + s.name + '  ' + s.score + '点';
    listEl.appendChild(div);
  });
}

// ============================================================
// 5. ゲームアクション（Firestore 書き込み）
// ============================================================

// calcAgariScore / buildDrawResult / buildRoundResult は utils.js に移動した
// （引数のみに依存するピュア関数のためテスト可能にする目的。
//   グローバル共有スクリプトなので game.js からそのまま呼べる）

/** プレイヤーのリセットフィールドを返すヘルパー */
function makePlayerReset(pid, hand) {
  return {
    ['players.' + pid + '.hand']:         hand,
    ['players.' + pid + '.lockedSets']:   [],
    ['players.' + pid + '.score']:        0,
    ['players.' + pid + '.ponKanScore']:  0,   // ポン/カン時の仮加算合計
    ['players.' + pid + '.riichi']:       false,
    ['players.' + pid + '.riichiAt']:     -1,   // リーチ宣言時のturnCount
    ['players.' + pid + '.riichiSets']:   [],
    ['players.' + pid + '.riichiHand']:   [],
    ['players.' + pid + '.waitingTiles']: []
  };
}

async function startGame() {
  const btn = document.getElementById('startGameBtn');
  if (btn) { btn.disabled = true; btn.textContent = '開始中...'; }
  try {
    const roomRef  = db.collection('rooms').doc(roomId);
    const roomSnap = await roomRef.get();
    const room     = roomSnap.data();
    if (room.playerOrder.length < 2) {
      alert('2人揃っていません');
      if (btn) { btn.disabled = false; btn.textContent = 'ゲームスタート！'; }
      return;
    }
    const deck = createShuffledDeck();
    let upd = {};
    room.playerOrder.forEach(pid => { upd = Object.assign(upd, makePlayerReset(pid, drawTilesFromDeck(deck, INITIAL_HAND_SIZE))); });
    const winds = initWinds(room.playerOrder);
    const dora  = initDoraTiles(winds.ba);
    await roomRef.update(Object.assign({
      status: 'playing', currentTurn: room.playerOrder[0], turnPhase: 'draw', deck,
      discardPile: [], lastDiscardBy: null, ponWindow: null, wordLog: [],
      turnCount: 0,
      winds, doraTiles: dora,
      currentRound: room.currentRound || 1, roundHistory: room.roundHistory || [], totalScores: room.totalScores || {}
    }, upd));
  } catch (err) {
    console.error('startGame:', err); alert('開始に失敗しました');
    const b = document.getElementById('startGameBtn');
    if (b) { b.disabled = false; b.textContent = 'ゲームスタート！'; }
  }
}

async function startNextRound() {
  const btn = document.getElementById('nextRoundBtn');
  if (btn) btn.disabled = true;
  try {
    const roomRef  = db.collection('rooms').doc(roomId);
    const roomSnap = await roomRef.get();
    const room     = roomSnap.data();
    const nextRound = (room.currentRound || 1) + 1;
    const deck      = createShuffledDeck();
    const newWinds = room.winds
      ? advanceWinds(room.winds, room.playerOrder)
      : initWinds(room.playerOrder);
    const newDora  = initDoraTiles(newWinds.ba);
    let   upd = {
      status: 'playing', currentRound: nextRound,
      currentTurn: room.playerOrder[nextRound % room.playerOrder.length],
      turnPhase: 'draw', deck, discardPile: [], lastDiscardBy: null, ponWindow: null, wordLog: [],
      turnCount: 0,
      winds: newWinds, doraTiles: newDora
    };
    room.playerOrder.forEach(pid => { upd = Object.assign(upd, makePlayerReset(pid, drawTilesFromDeck(deck, INITIAL_HAND_SIZE))); });
    await roomRef.update(upd);
    setVisible('roundSummaryModal', false);
  } catch (err) {
    console.error('startNextRound:', err); showMsg('❌ 次のラウンドの開始に失敗しました');
    if (btn) btn.disabled = false;
  }
}

async function drawTile() {
  const btn = document.getElementById('drawBtn');
  if (btn) btn.disabled = true;
  try {
    await db.runTransaction(async t => {
      const roomRef = db.collection('rooms').doc(roomId);
      const snap = await t.get(roomRef); const room = snap.data();
      if (room.currentTurn !== myPlayerId) throw new Error('自分のターンではない');
      if (room.turnPhase   !== 'draw')     throw new Error('drawフェーズではない');
      if (room.deck.length === 0)          throw new Error('山が空');
      const deck = room.deck.slice(); const drawn = deck.pop();
      const newHand = room.players[myPlayerId].hand.concat([drawn]);
      const isRiichi      = room.players[myPlayerId].riichi || false;
      const waitTiles     = room.players[myPlayerId].waitingTiles || [];
      const drawnIsWaiting = isRiichi && waitTiles.includes(drawn);
      const newTurnCount = (room.turnCount || 0) + 1;
      const upd = { deck, turnPhase: 'discard', drawnWaitingTile: drawnIsWaiting, turnCount: newTurnCount };
      upd['players.' + myPlayerId + '.hand'] = newHand;
      t.update(roomRef, upd);
    });
    selectedIndices = [];
  } catch (err) { console.error('drawTile:', err); showMsg('❌ ' + err.message); if (btn) btn.disabled = false; }
}

/**
 * 捨て牌後の遷移フィールドを組み立てる（山切れ終局 or pon_window）。
 * discardTile / submitRiichi が共有する。山が空なら全員 ponKanScore のみ確定で終局、
 * そうでなければ下家にポンウィンドウを開く。
 * プレイヤー固有フィールド（hand・立直フィールド）は呼び出し側で付与する。
 * @returns {Object} Firestore update オブジェクト
 */
function buildDiscardTransition(room, discardBy, discardedTile, pile) {
  if (room.deck.length === 0) {
    // 山切れ終局: 全員ponKanScoreのみ確定（あがりではない）
    const { totalScores, roundHistory } = buildDrawResult(room);
    return {
      discardPile: pile, lastDiscardBy: discardBy,
      status: 'finished', ponWindow: null,
      totalScores, roundHistory
    };
  }
  const next = getNextPlayer(room.playerOrder, discardBy);
  return {
    discardPile: pile, lastDiscardBy: discardBy, currentTurn: next,
    turnPhase: 'pon_window', status: 'playing',
    ponWindow: { active: true, tile: discardedTile, discardedBy: discardBy, eligiblePlayer: next }
  };
}

async function discardTile() {
  if (selectedIndices.length !== 1) { showMsg('捨てる牌を1枚選んでください'); return; }
  const btn = document.getElementById('discardBtn');
  if (btn) btn.disabled = true;
  try {
    await db.runTransaction(async t => {
      const roomRef = db.collection('rooms').doc(roomId);
      const snap = await t.get(roomRef); const room = snap.data();
      if (room.currentTurn !== myPlayerId) throw new Error('自分のターンではない');
      if (room.turnPhase   !== 'discard')  throw new Error('discardフェーズではない');
      const isRiichi   = room.players[myPlayerId].riichi || false;
      const riichiHand = room.players[myPlayerId].riichiHand || [];
      const hand       = room.players[myPlayerId].hand.slice();
      const selTile    = hand[selectedIndices[0]];
      // 立直後は riichiHand にない牌（＝引いた牌）のみ捨て可能
      if (isRiichi && riichiHand.includes(selTile)) {
        throw new Error('立直宣言で残した牌は捨てられません。引いた牌を捨ててください');
      }
      const discarded = hand.splice(selectedIndices[0], 1)[0];
      const pile      = (room.discardPile || []).concat([discarded]);

      const upd = buildDiscardTransition(room, myPlayerId, discarded, pile);
      upd['players.' + myPlayerId + '.hand'] = hand;
      t.update(roomRef, upd);
    });
    selectedIndices = [];
  } catch (err) { console.error('discardTile:', err); showMsg('❌ ' + err.message); if (btn) btn.disabled = false; }
}

async function kanTiles() {
  if (selectedIndices.length < 4) { showMsg('4文字以上の単語を選んでください'); return; }
  const btn = document.getElementById('kanBtn');
  if (btn) btn.disabled = true;
  try {
    await db.runTransaction(async t => {
      const roomRef = db.collection('rooms').doc(roomId);
      const snap = await t.get(roomRef); const room = snap.data();
      if (room.currentTurn !== myPlayerId) throw new Error('自分のターンではない');
      if (room.turnPhase   !== 'discard')  throw new Error('discardフェーズではない');
      const hand  = room.players[myPlayerId].hand.slice();
      const tiles = selectedIndices.map(i => hand[i]);
      const dictErr = checkDictWord(room, tiles);
      if (dictErr) throw new Error(dictErr);
      selectedIndices.slice().sort((a, b) => b - a).forEach(i => hand.splice(i, 1));
      const deck = room.deck.slice();
      const extra = [];
      for (let i = 0; i < tiles.length - 3; i++) { if (deck.length > 0) extra.push(deck.pop()); }
      const word     = tiles.join('');
      const score    = calcWordScore(tiles);           // あがり時用（文字数×100）
      const tempScore = calcPonKanTempScore(tiles);   // 仮加算（文字数-1）×100
      const upd = {
        deck, turnPhase: 'discard',
        wordLog: (room.wordLog || []).concat([{ word, tiles, type: 'kan', score: tempScore, playerId: myPlayerId, playerName: room.players[myPlayerId].name, ts: Date.now() }])
      };
      // カン後ドラ追加
      const updatedDora = room.winds
        ? addKanDora(room.doraTiles || {}, room.winds.ba)
        : (room.doraTiles || {});
      // ドラ仮加算 (200/枚)
      const doraTemp = calcDoraBonus(tiles, updatedDora, DORA_BONUS_TEMP);
      const totalTemp = tempScore + doraTemp;
      upd['players.' + myPlayerId + '.hand']        = hand.concat(extra);
      upd['players.' + myPlayerId + '.lockedSets']  = (room.players[myPlayerId].lockedSets || []).concat([{ tiles, word, type: 'kan', score }]);
      upd['players.' + myPlayerId + '.score']        = room.players[myPlayerId].score + totalTemp;
      upd['players.' + myPlayerId + '.ponKanScore']  = (room.players[myPlayerId].ponKanScore || 0) + totalTemp;
      upd['doraTiles'] = updatedDora;
      t.update(roomRef, upd);
    });
    selectedIndices = []; showMsg('⚡ カン！追加で牌を引きました。次は捨ててください');
  } catch (err) { console.error('kanTiles:', err); showMsg('❌ ' + err.message); if (btn) btn.disabled = false; }
}

async function ponTile() {
  const btn = document.getElementById('ponBtn');
  if (btn) btn.disabled = true;
  try {
    await db.runTransaction(async t => {
      const roomRef = db.collection('rooms').doc(roomId);
      const snap = await t.get(roomRef); const room = snap.data();
      if (room.turnPhase !== 'pon_window') throw new Error('pon_windowフェーズではない');
      const pon = room.ponWindow;
      if (!pon || pon.eligiblePlayer !== myPlayerId) throw new Error('ポンできません');
      const pile = (room.discardPile || []).slice(); const claimed = pile.pop();
      const upd = { discardPile: pile, turnPhase: 'pon_acquired' };
      upd['players.' + myPlayerId + '.hand'] = room.players[myPlayerId].hand.concat([claimed]);
      t.update(roomRef, upd);
    });
    selectedIndices = [];
    const tile = (currentRoom && currentRoom.ponWindow) ? currentRoom.ponWindow.tile : '';
    showMsg('🀄「' + tile + '」を取りました！「' + tile + '」を含む単語を確定してください');
  } catch (err) { console.error('ponTile:', err); showMsg('❌ ' + err.message); if (btn) btn.disabled = false; }
}

async function passPon() {
  const btn = document.getElementById('passBtn');
  if (btn) btn.disabled = true;
  try {
    await db.runTransaction(async t => {
      const roomRef = db.collection('rooms').doc(roomId);
      const snap    = await t.get(roomRef);
      const room    = snap.data();
      // フェーズガード: pon_window 以外なら何もしない（古い自動パスタイマーの巻き戻し防止）
      if (room.turnPhase !== 'pon_window') return;
      const ponWindow = { active: false, tile: null, discardedBy: null, eligiblePlayer: null };

      // 山が空なら次のdrawフェーズに進めず終局
      if (room.deck.length === 0) {
        // 山切れ終局: 全員ponKanScoreのみ確定
        const { totalScores, roundHistory } = buildDrawResult(room);
        t.update(roomRef, { status: 'finished', ponWindow, totalScores, roundHistory });
      } else {
        t.update(roomRef, { turnPhase: 'draw', ponWindow });
      }
    });
  } catch (err) { console.error('passPon:', err); if (btn) btn.disabled = false; }
}

async function cancelPon() {
  if (!currentRoom || currentRoom.turnPhase !== 'pon_acquired') { showMsg('pon_acquiredフェーズではありません'); return; }
  const btn = document.getElementById('ponCancelBtn');
  if (btn) btn.disabled = true;
  try {
    await db.runTransaction(async t => {
      const roomRef = db.collection('rooms').doc(roomId);
      const snap = await t.get(roomRef); const room = snap.data();
      if (room.turnPhase !== 'pon_acquired') throw new Error('フェーズが変わっています');
      const hand = room.players[myPlayerId].hand.slice();
      const claimed = room.ponWindow ? room.ponWindow.tile : null;
      const pile    = (room.discardPile || []).slice();
      if (claimed) { const idx = hand.lastIndexOf(claimed); if (idx !== -1) hand.splice(idx, 1); pile.push(claimed); }
      const upd = { discardPile: pile, turnPhase: 'draw', ponWindow: { active: false, tile: null, discardedBy: null, eligiblePlayer: null } };
      upd['players.' + myPlayerId + '.hand'] = hand;
      t.update(roomRef, upd);
    });
    selectedIndices = []; showMsg('↩ ポンを取り消しました。山から引いてください');
  } catch (err) { console.error('cancelPon:', err); showMsg('❌ ' + err.message); if (btn) btn.disabled = false; }
}

async function lockPonWord() {
  if (selectedIndices.length < 2) { showMsg('2文字以上の単語を選んでください'); return; }
  const btn = document.getElementById('ponLockBtn');
  if (btn) btn.disabled = true;
  try {
    await db.runTransaction(async t => {
      const roomRef = db.collection('rooms').doc(roomId);
      const snap = await t.get(roomRef); const room = snap.data();
      if (room.currentTurn !== myPlayerId)    throw new Error('自分のターンではない');
      if (room.turnPhase   !== 'pon_acquired') throw new Error('pon_acquiredフェーズではない');
      const hand = room.players[myPlayerId].hand.slice();
      const ct   = room.ponWindow ? room.ponWindow.tile : null;
      if (!ct) throw new Error('ポン情報がありません');
      if (!selectedIndices.some(i => hand[i] === ct)) throw new Error('「' + ct + '」を含む単語を作ってください');
      if (selectedIndices.length !== 3) throw new Error('ポンは3文字の単語のみ確定できます');
      const tiles     = selectedIndices.map(i => hand[i]);
      const dictErr   = checkDictWord(room, tiles);
      if (dictErr) throw new Error(dictErr);
      const word      = tiles.join('');
      const score     = calcWordScore(tiles);       // あがり時用（文字数×100）
      const tempScore = calcPonKanTempScore(tiles); // 仮加算（文字数-1）×100 → ポンは200点
      selectedIndices.slice().sort((a, b) => b - a).forEach(i => hand.splice(i, 1));
      const upd = {
        turnPhase: 'discard', ponWindow: { active: false, tile: null, discardedBy: null, eligiblePlayer: null },
        wordLog: (room.wordLog || []).concat([{ word, tiles, type: 'pon', score: tempScore, playerId: myPlayerId, playerName: room.players[myPlayerId].name, ts: Date.now() }])
      };
      const doraTemp2  = calcDoraBonus(tiles, room.doraTiles || {}, DORA_BONUS_TEMP);
      const totalTemp2 = tempScore + doraTemp2;
      upd['players.' + myPlayerId + '.hand']        = hand;
      upd['players.' + myPlayerId + '.lockedSets']  = (room.players[myPlayerId].lockedSets || []).concat([{ tiles, word, type: 'pon', score }]);
      upd['players.' + myPlayerId + '.score']        = room.players[myPlayerId].score + totalTemp2;
      upd['players.' + myPlayerId + '.ponKanScore']  = (room.players[myPlayerId].ponKanScore || 0) + totalTemp2;
      t.update(roomRef, upd);
    });
    selectedIndices = []; showMsg('🀄 ポン確定！次は捨てる牌を選んでください');
  } catch (err) { console.error('lockPonWord:', err); showMsg('❌ ' + err.message); if (btn) btn.disabled = false; }
}

// ============================================================
// 6. 立直モーダル（3ステップ）
// ============================================================

function openRiichiModal() {
  if (!currentRoom) return;
  const myData = currentRoom.players[myPlayerId];
  if (myData.riichi)                        { showMsg('すでに立直宣言済みです');     return; }
  if ((myData.lockedSets || []).length > 0) { showMsg('ポン・カン後は立直できません'); return; }
  if (currentRoom.turnPhase !== 'discard')  { showMsg('牌を引いてからお使いください'); return; }

  const orderedHand = (localHandDisplay.length === myData.hand.length)
    ? localHandDisplay.slice() : myData.hand.slice();

  riichiState = { remainingHand: orderedHand, confirmedGroups: [], currentSelection: [], waitingTiles: [], discardSelection: [] };

  setVisible('riichiStep1', true); setVisible('riichiStep2', false); setVisible('riichiStep3', false);
  setText('riichiStepLabel', 'ステップ 1 / 3');
  renderRiichiStep1();
  setVisible('riichiModal', true);
}

function renderRiichiStep1() {
  if (!currentRoom) return;
  const hand = riichiState.remainingHand;

  const handEl = document.getElementById('riichiHandDisplay');
  if (handEl) {
    handEl.innerHTML = '';
    const riichiAiueoSeen = {};
    hand.forEach((char, i) => {
      let isAiueoDora = false;
      if (AIUEO_SET.has(char)) {
        riichiAiueoSeen[char] = (riichiAiueoSeen[char] || 0) + 1;
        isAiueoDora = riichiAiueoSeen[char] === 1;
      }
      const tile = makeTile(char, 'tile-my', isAiueoDora);
      if (riichiState.currentSelection.includes(i)) tile.classList.add('selected');
      tile.addEventListener('click', () => {
        const pos = riichiState.currentSelection.indexOf(i);
        if (pos === -1) riichiState.currentSelection.push(i);
        else            riichiState.currentSelection.splice(pos, 1);
        renderRiichiStep1();
      });
      handEl.appendChild(tile);
    });
  }

  const preview = riichiState.currentSelection.map(i => hand[i]).join('');
  setText('riichiPreview', preview
    ? '選択中: ' + preview + '（' + preview.length + '文字）'
    : '牌をタップして組を作ってください');

  const confEl = document.getElementById('riichiConfirmedDisplay');
  if (confEl) {
    confEl.innerHTML = '';
    riichiState.confirmedGroups.forEach(g => {
      const div = document.createElement('div'); div.className = 'agari-set agari-confirmed';
      g.tiles.forEach(c => div.appendChild(makeTile(c, 'tile-my')));
      confEl.appendChild(div);
    });
  }

  const rem     = riichiState.remainingHand.length;
  const goalMsg = (rem >= 2 && rem <= 4) ? '（次へ進めます）' : '（もう少し確定してください）';
  setText('riichiStep1Counter', '確定: ' + riichiState.confirmedGroups.length + '組 | 残り' + rem + '文字' + goalMsg);

  const confirmBtn = document.getElementById('riichiConfirmGroupBtn');
  const undoBtn    = document.getElementById('riichiUndoBtn');
  const nextBtn    = document.getElementById('riichiStep1NextBtn');
  if (confirmBtn) confirmBtn.disabled = riichiState.currentSelection.length < 2;
  if (undoBtn)    undoBtn.disabled    = riichiState.confirmedGroups.length === 0;
  if (nextBtn)    nextBtn.disabled    = !(rem >= 2 && rem <= 4);
}

function riichiConfirmGroup() {
  const selOrder = riichiState.currentSelection.slice();          // タップ順を保持
  const tiles    = selOrder.map(i => riichiState.remainingHand[i]);
  const dictErr  = checkDictWord(currentRoom, tiles);
  if (dictErr) { showMsg('❌ ' + dictErr); return; }
  selOrder.slice().sort((a, b) => b - a).forEach(i => riichiState.remainingHand.splice(i, 1));
  riichiState.confirmedGroups.push({ tiles, word: tiles.join(''), score: calcWordScore(tiles), type: 'riichi' });
  riichiState.currentSelection = [];
  renderRiichiStep1();
}

function riichiUndoGroup() {
  if (riichiState.confirmedGroups.length === 0) return;
  const last = riichiState.confirmedGroups.pop();
  riichiState.remainingHand    = riichiState.remainingHand.concat(last.tiles);
  riichiState.currentSelection = [];
  renderRiichiStep1();
}

function riichiGoStep2() {
  const remEl = document.getElementById('riichiRemainingDisplay');
  if (remEl) {
    remEl.innerHTML = '';
    riichiState.remainingHand.forEach(c => remEl.appendChild(makeTile(c, 'tile-my')));
  }
  setVisible('riichiStep1', false); setVisible('riichiStep2', true); setVisible('riichiStep3', false);
  setText('riichiStepLabel', 'ステップ 2 / 3');
  renderRiichiStep2();
}

function riichiGoStep1() {
  setVisible('riichiStep2', false); setVisible('riichiStep3', false); setVisible('riichiStep1', true);
  setText('riichiStepLabel', 'ステップ 1 / 3');
  renderRiichiStep1();
}

function renderRiichiStep2() {
  const chipsEl = document.getElementById('riichiWaitingDisplay');
  if (chipsEl) {
    chipsEl.innerHTML = '';
    riichiState.waitingTiles.forEach(tile => {
      const chip = document.createElement('div'); chip.className = 'riichi-wait-chip';
      const span = document.createElement('span'); span.className = 'riichi-wait-char'; span.textContent = tile;
      const rmBtn = document.createElement('button'); rmBtn.className = 'riichi-wait-remove'; rmBtn.textContent = '✕';
      rmBtn.addEventListener('click', () => {
        const idx = riichiState.waitingTiles.indexOf(tile);
        if (idx !== -1) riichiState.waitingTiles.splice(idx, 1);
        renderRiichiStep2();
      });
      chip.appendChild(span); chip.appendChild(rmBtn); chipsEl.appendChild(chip);
    });
  }
  const nextBtn = document.getElementById('riichiStep2NextBtn');
  if (nextBtn) nextBtn.disabled = riichiState.waitingTiles.length === 0;
}

function riichiAddWaiting() {
  const input = document.getElementById('riichiWaitInput');
  if (!input) return;
  const val = input.value.trim();
  if (!val)                                   { showMsg('ひらがな1文字を入力してください'); return; }
  if (val.length > 2)                         { showMsg('1〜2文字で入力してください');     return; }
  if (riichiState.waitingTiles.includes(val)) { showMsg('すでに追加されています');          return; }
  riichiState.waitingTiles.push(val);
  input.value = '';
  renderRiichiStep2();
}

function riichiGoStep3() {
  setVisible('riichiStep2', false); setVisible('riichiStep3', true);
  setText('riichiStepLabel', 'ステップ 3 / 3');
  riichiState.discardSelection = [];
  renderRiichiStep3();
}

function renderRiichiStep3() {
  const el = document.getElementById('riichiDiscardHandDisplay');
  if (!el) return;
  el.innerHTML = '';
  riichiState.remainingHand.forEach((char, i) => {
    const tile = makeTile(char, 'tile-my');
    if (riichiState.discardSelection[0] === i) tile.classList.add('selected');
    tile.addEventListener('click', () => { riichiState.discardSelection = [i]; renderRiichiStep3(); });
    el.appendChild(tile);
  });
  const sel = riichiState.discardSelection[0];
  setText('riichiDiscardPreview',
    sel !== undefined ? '捨てる牌: ' + riichiState.remainingHand[sel] : '捨てる牌をタップしてください（確定した組の牌は選べません）');
  const submitBtn = document.getElementById('riichiSubmitBtn');
  if (submitBtn) submitBtn.disabled = riichiState.discardSelection.length === 0;
}

async function submitRiichi() {
  if (!currentRoom) return;
  if (riichiState.discardSelection.length === 0) { showMsg('捨てる牌を選んでください'); return; }
  const btn = document.getElementById('riichiSubmitBtn');
  if (btn) btn.disabled = true;
  try {
    await db.runTransaction(async t => {
      const roomRef = db.collection('rooms').doc(roomId);
      const snap = await t.get(roomRef); const room = snap.data();
      if (room.currentTurn !== myPlayerId) throw new Error('自分のターンではない');
      if (room.turnPhase   !== 'discard')  throw new Error('discardフェーズではない');

      const riichiHand = riichiState.remainingHand.slice();
      const discarded  = riichiHand.splice(riichiState.discardSelection[0], 1)[0];
      const pile       = (room.discardPile || []).concat([discarded]);

      const riichiFields = {
        ['players.' + myPlayerId + '.hand']:         riichiHand,
        ['players.' + myPlayerId + '.riichi']:       true,
        ['players.' + myPlayerId + '.riichiAt']:     room.turnCount || 0,
        ['players.' + myPlayerId + '.riichiSets']:   riichiState.confirmedGroups.slice(),
        ['players.' + myPlayerId + '.riichiHand']:   riichiHand,
        ['players.' + myPlayerId + '.waitingTiles']: riichiState.waitingTiles
      };

      const upd = Object.assign(buildDiscardTransition(room, myPlayerId, discarded, pile), riichiFields);
      t.update(roomRef, upd);
    });
    closeRiichiModal();
    showMsg('🎯 立直宣言！待ち: ' + riichiState.waitingTiles.join('・'));
  } catch (err) { console.error('submitRiichi:', err); showMsg('❌ ' + err.message); if (btn) btn.disabled = false; }
}

function closeRiichiModal() { setVisible('riichiModal', false); }

// ============================================================
// 7. 立直あがり（ロン / ツモ）
// ============================================================

function openRiichiAgariOrderModal(payload, type) {
  const riichiHand = payload.riichiHand || [];
  const agariTile  = payload.ronTile || payload.drawnTile || '';
  riichiAgariState = {
    tiles: riichiHand.concat([agariTile]), firstIdx: null,
    onConfirm: tiles => { if (type === 'ron') executeRon(tiles); else executeTsumo(tiles); }
  };
  setText('riichiAgariTitle', type === 'ron' ? '🏆 ロン！ 最後の組の並び順' : '🎲 ツモ！ 最後の組の並び順');
  renderRiichiAgariOrderModal();
  setVisible('riichiAgariModal', true);
}

function renderRiichiAgariOrderModal() {
  const el = document.getElementById('riichiAgariTileOrder');
  if (!el) return;
  el.innerHTML = '';
  riichiAgariState.tiles.forEach((char, i) => {
    const tile = makeTile(char, 'tile-my' + (riichiAgariState.firstIdx === i ? ' sort-selected' : ''));
    tile.classList.add('sort-mode');
    tile.addEventListener('click', () => {
      if (riichiAgariState.firstIdx === null) { riichiAgariState.firstIdx = i; }
      else if (riichiAgariState.firstIdx === i) { riichiAgariState.firstIdx = null; }
      else {
        const tmp = riichiAgariState.tiles[riichiAgariState.firstIdx];
        riichiAgariState.tiles[riichiAgariState.firstIdx] = riichiAgariState.tiles[i];
        riichiAgariState.tiles[i] = tmp;
        riichiAgariState.firstIdx = null;
      }
      renderRiichiAgariOrderModal();
    });
    el.appendChild(tile);
  });
  setText('riichiAgariPreview', '完成する単語: ' + riichiAgariState.tiles.join(''));
}

function confirmRiichiAgariOrder() {
  const dictErr = checkDictWord(currentRoom, riichiAgariState.tiles);
  if (dictErr) { showMsg('❌ ' + dictErr + '。並び順を変えてください'); return; }
  setVisible('riichiAgariModal', false);
  if (riichiAgariState.onConfirm) riichiAgariState.onConfirm(riichiAgariState.tiles.slice());
}

/**
 * 立直あがり（ロン/ツモ共通）のスコア・履歴を計算する。
 * finalSets構築 → ctx構築 → detectRoles → calcAgariScore → buildRoundResult をまとめる。
 * validateAgari は通さない現仕様を維持（立直あがりは待ち牌自己申告のため）。
 * プレイヤー固有の更新フィールド（hand/lockedSets/score）と wordLog・成功演出は呼び出し側に残す。
 * @returns {{ finalSets:Array, roles:Array, newScore:number, totalScores:Object, roundHistory:Array }}
 */
function buildRiichiAgariResult(room, myData, orderedTiles) {
  const fg        = { tiles: orderedTiles, word: orderedTiles.join(''), score: calcWordScore(orderedTiles), type: 'tsumo' };
  const finalSets = (myData.lockedSets || []).concat(myData.riichiSets || []).concat([fg]);
  const ctx       = {
    lockedSets: myData.lockedSets || [], turnCount: room.turnCount || 0,
    riichiAt: myData.riichiAt !== undefined ? myData.riichiAt : -1,
    playerCount: room.playerOrder.length,
    baWind: room.winds ? room.winds.ba : '',
    myWind: room.winds ? (room.winds[myPlayerId] || '') : ''
  };
  const roles    = detectRoles(finalSets, true, ctx);
  const newScore = calcAgariScore(myData, finalSets, roles, room.doraTiles || {});
  const { totalScores, roundHistory } = buildRoundResult(room, myPlayerId, newScore, finalSets, roles);
  return { finalSets, roles, newScore, totalScores, roundHistory };
}

async function executeRon(orderedTiles) {
  if (!currentRoom) return;
  try {
    await db.runTransaction(async t => {
      const roomRef = db.collection('rooms').doc(roomId);
      const snap = await t.get(roomRef); const room = snap.data();
      const myData = room.players[myPlayerId];
      const dictErr = checkDictWord(room, orderedTiles);
      if (dictErr) throw new Error(dictErr);
      const pile   = (room.discardPile || []).slice(); pile.pop();
      const { finalSets, newScore, totalScores, roundHistory } = buildRiichiAgariResult(room, myData, orderedTiles);
      const wordLog = (room.wordLog || []).concat([{
        word: 'ロン「' + orderedTiles.join('') + '」', tiles: orderedTiles,
        type: 'ron', score: newScore, playerId: myPlayerId, playerName: myData.name, ts: Date.now()
      }]);
      const upd = { status: 'finished', discardPile: pile, ponWindow: { active: false, tile: null, discardedBy: null, eligiblePlayer: null }, wordLog, roundHistory, totalScores };
      upd['players.' + myPlayerId + '.hand']       = [];
      upd['players.' + myPlayerId + '.lockedSets'] = finalSets;
      upd['players.' + myPlayerId + '.score']      = newScore;
      t.update(roomRef, upd);
    });
    showMsg('🏆 ロン！');
  } catch (err) { console.error('executeRon:', err); showMsg('❌ ' + err.message); }
}

async function executeTsumo(orderedTiles) {
  if (!currentRoom) return;
  const btn = document.getElementById('riichiAgariSubmitBtn');
  if (btn) btn.disabled = true;
  try {
    await db.runTransaction(async t => {
      const roomRef = db.collection('rooms').doc(roomId);
      const snap = await t.get(roomRef); const room = snap.data();
      if (room.currentTurn !== myPlayerId) throw new Error('自分のターンではない');
      if (room.turnPhase   !== 'discard')  throw new Error('discardフェーズではない');
      const myData = room.players[myPlayerId];
      const dictErr = checkDictWord(room, orderedTiles);
      if (dictErr) throw new Error(dictErr);
      const { finalSets, newScore, totalScores, roundHistory } = buildRiichiAgariResult(room, myData, orderedTiles);
      const wordLog = (room.wordLog || []).concat([{ word: orderedTiles.join(''), tiles: orderedTiles, type: 'tsumo', score: newScore, playerId: myPlayerId, playerName: myData.name, ts: Date.now() }]);
      const upd = { status: 'finished', wordLog, roundHistory, totalScores };
      upd['players.' + myPlayerId + '.hand']       = [];
      upd['players.' + myPlayerId + '.lockedSets'] = finalSets;
      upd['players.' + myPlayerId + '.score']      = newScore;
      t.update(roomRef, upd);
    });
    setVisible('riichiAgariModal', false); showMsg('🎉 ツモあがり！');
  } catch (err) { console.error('executeTsumo:', err); showMsg('❌ ' + err.message); if (btn) btn.disabled = false; }
}

async function claimRon() {
  if (!currentRoom) return;
  const pon     = currentRoom.ponWindow || {};
  const myData  = currentRoom.players[myPlayerId];
  const waiting = myData.waitingTiles || [];
  if (!myData.riichi)                  { showMsg('立直していません');    return; }
  if (!waiting.includes(pon.tile))     { showMsg('待ち牌ではありません'); return; }
  if (pon.eligiblePlayer !== myPlayerId){ showMsg('ロンできません');      return; }
  openRiichiAgariOrderModal({ riichiHand: myData.riichiHand || [], ronTile: pon.tile }, 'ron');
}

// ============================================================
// 8. あがりモーダル（通常）
// ============================================================

function openAgariModal() {
  if (!currentRoom) return;
  const myData   = currentRoom.players[myPlayerId];
  if (myData.riichi) {
    // 立直ツモ → 並び順モーダルへ
    const riichiHand = myData.riichiHand || [];
    const temp = myData.hand.slice();
    riichiHand.forEach(c => { const i = temp.indexOf(c); if (i !== -1) temp.splice(i, 1); });
    openRiichiAgariOrderModal({ riichiHand, drawnTile: temp[0] || '' }, 'tsumo');
    return;
  }
  agariState = { remainingHand: myData.hand.slice(), confirmedGroups: [], currentSelection: [], detectedRoles: [] };
  renderAgariModal();
  setVisible('agariModal', true);
}

function renderAgariModal() {
  if (!currentRoom) return;
  const myData = currentRoom.players[myPlayerId];
  const locked = myData.lockedSets || [];

  const lockedEl = document.getElementById('agariLockedDisplay');
  if (lockedEl) {
    lockedEl.innerHTML = '';
    if (locked.length > 0) {
      locked.forEach(set => {
        const div = document.createElement('div'); div.className = 'agari-set agari-locked';
        set.tiles.forEach(c => div.appendChild(makeTile(c, 'tile-locked')));
        const badge = document.createElement('span'); badge.className = 'set-type-badge'; badge.textContent = set.type;
        div.appendChild(badge); lockedEl.appendChild(div);
      });
    } else { lockedEl.innerHTML = '<span class="no-set">なし</span>'; }
  }

  const handEl = document.getElementById('agariHandDisplay');
  if (handEl) {
    handEl.innerHTML = '';
    const agariAiueoSeen = {};
    agariState.remainingHand.forEach((char, i) => {
      let isAiueoDora = false;
      if (AIUEO_SET.has(char)) {
        agariAiueoSeen[char] = (agariAiueoSeen[char] || 0) + 1;
        isAiueoDora = agariAiueoSeen[char] === 1;
      }
      const tile = makeTile(char, 'tile-my', isAiueoDora);
      if (agariState.currentSelection.includes(i)) tile.classList.add('selected');
      tile.addEventListener('click', () => {
        const pos = agariState.currentSelection.indexOf(i);
        if (pos === -1) agariState.currentSelection.push(i);
        else            agariState.currentSelection.splice(pos, 1);
        renderAgariModal();
      });
      handEl.appendChild(tile);
    });
  }

  const preview = agariState.currentSelection.map(i => agariState.remainingHand[i]).join('');
  setText('agariPreview', preview ? '選択中: ' + preview + '（' + preview.length + '文字）' : '牌をタップして組を作ってください');

  const confEl = document.getElementById('agariConfirmedDisplay');
  if (confEl) {
    confEl.innerHTML = '';
    agariState.confirmedGroups.forEach(g => {
      const div = document.createElement('div'); div.className = 'agari-set agari-confirmed';
      g.tiles.forEach(c => div.appendChild(makeTile(c, 'tile-my'))); confEl.appendChild(div);
    });
  }

  const setsNeeded = WIN_SET_COUNT - locked.length;
  setText('agariSetCounter', (locked.length + agariState.confirmedGroups.length) + ' / ' + WIN_SET_COUNT + ' 組');

  const confirmBtn = document.getElementById('agariConfirmGroupBtn');
  const undoBtn    = document.getElementById('agariUndoBtn');
  const submitBtn  = document.getElementById('agariSubmitBtn');
  if (confirmBtn) confirmBtn.disabled = agariState.currentSelection.length < 2;
  if (undoBtn)    undoBtn.disabled    = agariState.confirmedGroups.length === 0;
  if (submitBtn)  submitBtn.disabled  = agariState.confirmedGroups.length < setsNeeded;

  const roleEl = document.getElementById('agariRoleDisplay');
  if (!roleEl) return;

  if (agariState.confirmedGroups.length >= setsNeeded) {
    const allSets = locked.concat(agariState.confirmedGroups);
    const room    = currentRoom;
    const ctx     = {
      lockedSets: locked, turnCount: room ? (room.turnCount || 0) : 0,
      riichiAt: myData.riichiAt !== undefined ? myData.riichiAt : -1,
      playerCount: room ? room.playerOrder.length : 2,
      baWind: room && room.winds ? room.winds.ba : '',
      myWind: room && room.winds ? (room.winds[myPlayerId] || '') : ''
    };
    const roles   = detectRoles(allSets, myData.riichi || false, ctx);
    agariState.detectedRoles = roles;
    // プレビューは calcAgariScore と同じ内訳ヘルパーを使う（計算式の二重持ちを防ぐ）
    const bd        = calcAgariBreakdown(myData, allSets, roles, room ? (room.doraTiles || {}) : {});
    const baseScore = bd.baseScore;
    const roleBonus = bd.roleBonus;
    const doraBonus = bd.doraBonus;
    const totalGain = bd.total;

    roleEl.innerHTML = ''; roleEl.classList.remove('hidden');
    const title = document.createElement('div'); title.className = 'role-section-title'; title.textContent = '🀄 検出された役';
    roleEl.appendChild(title);

    if (roles.length === 0) {
      const none = document.createElement('div'); none.className = 'role-none'; none.textContent = '役なし（ベース点のみ）';
      roleEl.appendChild(none);
    } else {
      roles.forEach(r => {
        const row = document.createElement('div'); row.className = 'role-row';
        row.innerHTML = '<span class="role-name">' + escapeHtml(r.name) + '</span><span class="role-desc">' + escapeHtml(r.desc) + '</span><span class="role-score">+' + r.score + '点</span>';
        roleEl.appendChild(row);
      });
    }
    // ドラ枚数を計算して表示
    const doraInfoModal = calcDoraCount(allSets, room ? (room.doraTiles || {}) : {});
    const doraTileCount = doraInfoModal.count;
    const doraDetailModal = doraInfoModal.detail;
    // ドラ詳細表示文字列（例: 「か×3 う×1」）
    const doraDetailStr = doraDetailModal.map(function(d) {
      return d.tile + (d.mult > 1 ? '×' + d.mult + '倍' : '') + (d.times > 1 ? ' ' + d.times + '枚' : '');
    }).join(' ');
    const summary = document.createElement('div'); summary.className = 'score-summary';
    summary.innerHTML =
      '<div class="score-row"><span>単語点</span><span>+' + baseScore + '点</span></div>' +
      (doraTileCount > 0 ? '<div class="score-row dora-row"><span>🀄 ドラ ' + doraTileCount + '枚（' + escapeHtml(doraDetailStr) + '）</span><span>+' + doraBonus + '点</span></div>' : '') +
      (roleBonus > 0 ? '<div class="score-row"><span>役ボーナス</span><span>+' + roleBonus + '点</span></div>' : '') +
      '<div class="score-row score-total"><span>今回の獲得点</span><span>+' + totalGain + '点</span></div>';
    roleEl.appendChild(summary);
    if (submitBtn) submitBtn.textContent = '🎉 あがり！（+' + totalGain + '点）';
  } else {
    roleEl.classList.add('hidden');
    if (submitBtn) submitBtn.textContent = '🎉 あがり！';
  }
}

function confirmAgariGroup() {
  const selOrder = agariState.currentSelection.slice(); // タップ順を保持（sort しない）
  const tiles    = selOrder.map(i => agariState.remainingHand[i]);
  const dictErr  = checkDictWord(currentRoom, tiles);
  if (dictErr) { showMsg('❌ ' + dictErr); return; }
  // 削除はインデックスずれ防止のため降順
  selOrder.slice().sort((a, b) => b - a).forEach(i => agariState.remainingHand.splice(i, 1));
  agariState.confirmedGroups.push({ tiles, word: tiles.join(''), score: calcWordScore(tiles), type: 'tsumo' });
  agariState.currentSelection = [];
  renderAgariModal();
}

function undoAgariGroup() {
  if (agariState.confirmedGroups.length === 0) return;
  const last = agariState.confirmedGroups.pop();
  agariState.remainingHand    = agariState.remainingHand.concat(last.tiles);
  agariState.currentSelection = [];
  renderAgariModal();
}

async function submitAgari() {
  if (!currentRoom) return;
  const myData = currentRoom.players[myPlayerId];
  const locked = myData.lockedSets || [];
  const result = validateAgari(locked, agariState.confirmedGroups, myData.hand);
  if (!result.valid) { showMsg('❌ ' + result.reason); return; }

  const btn = document.getElementById('agariSubmitBtn');
  if (btn) { btn.disabled = true; btn.textContent = '確認中...'; }
  try {
    await db.runTransaction(async t => {
      const roomRef = db.collection('rooms').doc(roomId);
      const snap = await t.get(roomRef); const room = snap.data();
      if (room.currentTurn !== myPlayerId) throw new Error('自分のターンではない');
      if (room.turnPhase   !== 'discard')  throw new Error('discardフェーズではない');
      for (const g of agariState.confirmedGroups) {
        const dictErr = checkDictWord(room, g.tiles);
        if (dictErr) throw new Error(dictErr);
      }

      const myDataT    = room.players[myPlayerId];
      const riichiSets = myDataT.riichiSets || [];
      const finalSets  = locked.concat(riichiSets).concat(agariState.confirmedGroups);
      const ctx        = {
        lockedSets: locked, turnCount: room.turnCount || 0,
        riichiAt: myDataT.riichiAt !== undefined ? myDataT.riichiAt : -1,
        playerCount: room.playerOrder.length,
        baWind: room.winds ? room.winds.ba : '',
        myWind: room.winds ? (room.winds[myPlayerId] || '') : ''
      };
      const roles      = detectRoles(finalSets, myDataT.riichi || false, ctx);
      const newScore   = calcAgariScore(myDataT, finalSets, roles, room.doraTiles || {});

      const wordLog = (room.wordLog || []).slice();
      agariState.confirmedGroups.forEach(g => {
        wordLog.push({ word: g.word, tiles: g.tiles, type: 'tsumo', score: calcWordScore(g.tiles), playerId: myPlayerId, playerName: room.players[myPlayerId].name, ts: Date.now() });
      });
      const roleBonus = calcRoleBonus(roles);
      if (roles.length > 0) {
        wordLog.push({ word: roles.map(r => r.name).join('・'), tiles: [], type: 'role', score: roleBonus, playerId: myPlayerId, playerName: room.players[myPlayerId].name, ts: Date.now() });
      }

      const { totalScores, roundHistory } = buildRoundResult(room, myPlayerId, newScore, finalSets, roles);
      const upd = { status: 'finished', wordLog, roundHistory, totalScores };
      upd['players.' + myPlayerId + '.lockedSets'] = finalSets;
      upd['players.' + myPlayerId + '.hand']       = [];
      upd['players.' + myPlayerId + '.score']      = newScore;
      t.update(roomRef, upd);
    });
    closeAgariModal(); showMsg('🎉 あがり！');
  } catch (err) {
    console.error('submitAgari:', err); showMsg('❌ ' + err.message);
    if (btn) { btn.disabled = false; btn.textContent = 'あがり！'; }
  }
}

function closeAgariModal() { setVisible('agariModal', false); }

// ============================================================
// 9. 並び替え
// ============================================================

function handleSortTap(displayIdx) {
  if (sortFirstIdx === null) { sortFirstIdx = displayIdx; }
  else if (sortFirstIdx === displayIdx) { sortFirstIdx = null; }
  else {
    const tmp = localHandDisplay[sortFirstIdx];
    localHandDisplay[sortFirstIdx] = localHandDisplay[displayIdx];
    localHandDisplay[displayIdx]   = tmp;
    sortFirstIdx = null;
  }
  if (currentRoom) renderGame(currentRoom);
}

function toggleSortMode() {
  sortMode = !sortMode; sortFirstIdx = null; selectedIndices = [];
  if (currentRoom) renderGame(currentRoom);
}

function sortByAiueo() {
  if (!currentRoom) return;
  localHandDisplay = localHandDisplay.slice().sort((a, b) => a.localeCompare(b, 'ja'));
  sortFirstIdx = null;
  renderGame(currentRoom);
}

// ============================================================
// 10. UI ヘルパー
// ============================================================

function handleTileTap(origIdx, hand) {
  const pos = selectedIndices.indexOf(origIdx);
  if (pos === -1) selectedIndices.push(origIdx);
  else            selectedIndices.splice(pos, 1);

  const used = [];
  document.querySelectorAll('#myHand .tile-my').forEach((el, di) => {
    const char = localHandDisplay[di];
    let oi = -1;
    if (char !== undefined && currentRoom) {
      const h = currentRoom.players[myPlayerId] ? currentRoom.players[myPlayerId].hand : [];
      for (let i = 0; i < h.length; i++) { if (h[i] === char && !used.includes(i)) { oi = i; used.push(i); break; } }
    }
    el.classList.toggle('selected', oi !== -1 && selectedIndices.includes(oi));
  });

  updateWordPreview(hand);

  const dis = document.getElementById('discardBtn');
  const kan = document.getElementById('kanBtn');
  const pon = document.getElementById('ponLockBtn');
  if (dis && !dis.classList.contains('hidden')) dis.disabled = selectedIndices.length !== 1;
  if (kan && !kan.classList.contains('hidden')) kan.disabled = selectedIndices.length < 4;
  if (pon && !pon.classList.contains('hidden')) {
    const ct = currentRoom && currentRoom.ponWindow ? currentRoom.ponWindow.tile : null;
    const h  = currentRoom && currentRoom.players[myPlayerId] ? currentRoom.players[myPlayerId].hand : [];
    pon.disabled = !(ct && selectedIndices.some(i => h[i] === ct) && selectedIndices.length === 3);
  }
}

function updateWordPreview(hand) {
  const el = document.getElementById('wordPreview');
  if (!el) return;
  if (selectedIndices.length === 0) { el.textContent = ''; return; }
  const word = selectedIndices.map(i => hand[i]).join('');
  el.textContent = '選択中: ' + word + '（' + word.length + '文字）';
}

function showBtn(id, enabled) {
  const el = document.getElementById(id);
  if (!el) return;
  el.classList.remove('hidden'); el.disabled = !enabled;
}

// あいうえおはドラ計算の対象（ただし各2枚中1枚分のみドラ色付け）
const AIUEO_SET = new Set(['あ','い','う','え','お']);

/**
 * 牌要素を生成する
 * @param {string}  char        - 牌の文字
 * @param {string}  classes     - CSSクラス
 * @param {boolean} isAiueoDora - あいうえおをドラ色で表示するか（呼び出し側で1枚目のみtrueにする）
 */
function makeTile(char, classes, isAiueoDora = false) {
  const el   = document.createElement('div');
  let doraClass = '';
  if (AIUEO_SET.has(char)) {
    // あいうえお: 呼び出し側が「1枚目か」を判断して isAiueoDora=true を渡す
    if (isAiueoDora) doraClass = ' tile-dora';
  } else if (currentDoraTiles[char]) {
    const mult = currentDoraTiles[char] || 0;
    doraClass = mult >= 2 ? ' tile-dora-2' : ' tile-dora';
  }
  el.className = 'tile ' + classes + doraClass;
  el.textContent = char;
  return el;
}

function setVisible(id, visible) {
  const el = document.getElementById(id);
  if (el) el.classList.toggle('hidden', !visible);
}

function setText(id, text) {
  const el = document.getElementById(id);
  if (el) el.textContent = text;
}

function copyRoomId() {
  navigator.clipboard.writeText(roomId).then(() => {
    const btn = document.getElementById('copyRoomIdBtn');
    if (!btn) return;
    btn.textContent = 'コピー済み！';
    setTimeout(() => { btn.textContent = 'IDをコピー'; }, 2000);
  });
}

function showMsg(msg) {
  const el = document.getElementById('systemMsg');
  if (!el) return;
  el.textContent = msg; el.classList.remove('hidden');
  clearTimeout(el._t);
  el._t = setTimeout(() => { el.classList.add('hidden'); }, 3000);
}

function openStandingsModal() {
  if (!currentRoom) return;
  renderStandingsModal(currentRoom);
  setVisible('standingsModal', true);
}
function closeStandingsModal() { setVisible('standingsModal', false); }

function renderStandingsModal(room) {
  const totalScores = room.totalScores || {};
  const history     = room.roundHistory || [];

  // 累計スコア（順位順）
  const totalEl = document.getElementById('standingsTotalScores');
  if (totalEl) {
    totalEl.innerHTML = '';
    const sorted = room.playerOrder.slice().sort((a, b) => (totalScores[b] || 0) - (totalScores[a] || 0));
    sorted.forEach((pid, i) => {
      const p   = room.players[pid];
      const row = document.createElement('div');
      row.className = 'standings-score-row' + (pid === myPlayerId ? ' standings-me' : '');
      const medal = ['🥇','🥈','🥉'][i] || (i + 1) + '位';
      row.innerHTML =
        '<span class="standings-rank">' + medal + '</span>' +
        '<span class="standings-name">' + escapeHtml(p.name) + '</span>' +
        '<span class="standings-score">' + (totalScores[pid] || 0) + '点</span>';
      totalEl.appendChild(row);
    });
  }

  // ラウンド履歴
  const histEl     = document.getElementById('standingsHistory');
  const histSection = document.getElementById('standingsHistorySection');
  if (histSection) setVisible('standingsHistorySection', history.length > 0);
  if (histEl && history.length > 0) {
    histEl.innerHTML = '';
    history.forEach(h => {
      const block = document.createElement('div');
      block.className = 'standings-round-block';

      const title = document.createElement('div');
      title.className = 'standings-round-title';
      title.textContent = 'R' + h.round + '  ' + h.winnerName + ' あがり（+' + h.winnerScore + '点）';
      block.appendChild(title);

      // 単語一覧
      if (h.words && h.words.length > 0) {
        const wordWrap = document.createElement('div');
        wordWrap.className = 'standings-words';
        h.words.forEach(w => {
          const chip = document.createElement('span');
          chip.className   = 'standings-word-chip';
          chip.textContent = (w.tiles || []).join('') || w.word;
          wordWrap.appendChild(chip);
        });
        block.appendChild(wordWrap);
      }

      // ドラ
      if (h.doraCount > 0) {
        const doraWrap = document.createElement('div');
        doraWrap.className = 'standings-roles';
        const doraChip = document.createElement('span');
        doraChip.className   = 'standings-role-chip standings-dora-chip';
        const doraDStr = (h.doraDetail || []).map(function(d) {
          return d.tile + (d.mult > 1 ? '×' + d.mult + '倍' : '') + (d.times > 1 ? ' ' + d.times + '枚' : '');
        }).join(' ');
        doraChip.textContent = '🀄 ドラ ' + h.doraCount + '枚' + (doraDStr ? '（' + doraDStr + '）' : '') + ' +' + h.doraBonus + '点';
        doraWrap.appendChild(doraChip);
        block.appendChild(doraWrap);
      }

      // 役
      if (h.roles && h.roles.length > 0) {
        const roleWrap = document.createElement('div');
        roleWrap.className = 'standings-roles';
        h.roles.forEach(r => {
          const chip = document.createElement('span');
          chip.className   = 'standings-role-chip';
          chip.textContent = r.name + ' +' + r.score + '点';
          roleWrap.appendChild(chip);
        });
        block.appendChild(roleWrap);
      }

      // ラウンド得点
      if (h.scores) {
        const scoresWrap = document.createElement('div');
        scoresWrap.className = 'standings-round-scores';
        room.playerOrder.forEach(pid => {
          const p   = room.players[pid];
          const s   = document.createElement('span');
          s.className   = 'standings-round-score' + (pid === myPlayerId ? ' standings-me-text' : '');
          s.textContent = p.name + ': +' + (h.scores[pid] || 0) + '点';
          scoresWrap.appendChild(s);
        });
        block.appendChild(scoresWrap);
      }

      histEl.appendChild(block);
    });
  }
}

function openRulesModal()  { setVisible('rulesModal', true); }
function closeRulesModal() { setVisible('rulesModal', false); }

// ============================================================
// 再戦処理
// ============================================================

async function playAgain() {
  const btn = document.getElementById('playAgainBtn');
  if (btn) { btn.disabled = true; btn.textContent = '準備中...'; }
  try {
    const roomRef  = db.collection('rooms').doc(roomId);
    const roomSnap = await roomRef.get();
    const room     = roomSnap.data();

    const deck = createShuffledDeck();
    const winds = initWinds(room.playerOrder);
    const dora  = initDoraTiles(winds.ba);

    let upd = {
      status: 'waiting',
      currentRound:  1,
      totalScores:   {},
      roundHistory:  [],
      currentTurn:   null,
      turnPhase:     'draw',
      deck:          [],
      discardPile:   [],
      lastDiscardBy: null,
      ponWindow:     null,
      wordLog:       [],
      turnCount:     0,
      winds,
      doraTiles:     dora
    };
    room.playerOrder.forEach(pid => {
      // makePlayerReset と同一の9フィールド（hand は再戦時 [] 固定）
      upd = Object.assign(upd, makePlayerReset(pid, []));
    });
    await roomRef.update(upd);
    // 待機画面に戻る（onSnapshotが自動で画面を切り替える）
    showMsg('✅ 再戦の準備ができました！ゲームスタートを押してください');
  } catch (err) {
    console.error('playAgain:', err);
    showMsg('❌ 再戦の準備に失敗しました');
    if (btn) { btn.disabled = false; btn.textContent = '🔄 同じメンバーで再戦'; }
  }
}

window.addEventListener('beforeunload', () => { if (roomListener) roomListener(); });
