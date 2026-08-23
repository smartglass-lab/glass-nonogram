(function () {
  'use strict';

  // ==================== CONFIG ====================
  var CONFIG = {
    storageKey: 'mdg_glass_logic',
  };

  // 0=空, 1=ぬる。クリアするまで名前は「？？？」で隠す
  var PUZZLES = [
    {
      id: 'heart', name: 'ハート', emoji: '❤️', color: '#ff5c7a', level: 'かんたん',
      grid: [
        '01010',
        '11111',
        '11111',
        '01110',
        '00100',
      ],
    },
    {
      id: 'cross', name: 'じゅうじ', emoji: '➕', color: '#7ee7ff', level: 'かんたん',
      grid: [
        '00100',
        '00100',
        '11111',
        '00100',
        '00100',
      ],
    },
    {
      id: 'boat', name: 'ヨット', emoji: '⛵', color: '#ffd868', level: 'かんたん',
      grid: [
        '00100',
        '01110',
        '00100',
        '11111',
        '01110',
      ],
    },
    {
      id: 'butterfly', name: 'ちょうちょ', emoji: '🦋', color: '#c792ea', level: 'ふつう',
      grid: [
        '10001',
        '11011',
        '01110',
        '11011',
        '10001',
      ],
    },
    {
      id: 'cat', name: 'ネコ', emoji: '🐱', color: '#ffb45e', level: 'むずかしい',
      grid: [
        '0100000010',
        '0110000110',
        '0111111110',
        '0111111110',
        '0110110110',
        '0111111110',
        '0111001110',
        '0111111110',
        '0011111100',
        '0001111000',
      ],
    },
    {
      id: 'apple', name: 'リンゴ', emoji: '🍎', color: '#ff6b5c', level: 'むずかしい',
      grid: [
        '0000110000',
        '0000010110',
        '0011101110',
        '0111111110',
        '0111111110',
        '0111111110',
        '0111111110',
        '0111111110',
        '0011111100',
        '0011011000',
      ],
    },
  ];

  // セル状態: 0=空, 1=ぬり, 2=✕しるし
  var EMPTY = 0, FILL = 1, MARK = 2;

  // ==================== STATE ====================
  var state = {
    currentScreen: 'home',
    screenHistory: [],
    records: {},   // puzzleId -> {cleared: true, best: 秒}
    play: null,    // {puzzle, size, cells, cursor{r,c}, startTs, done, rowHints, colHints}
  };

  var screens = {};
  var timerHandle = null;

  function $(id) { return document.getElementById(id); }

  function collectScreens() {
    document.querySelectorAll('.screen').forEach(function (s) {
      if (s.id) screens[s.id] = s;
    });
  }

  // ==================== UTIL ====================
  function toZen(str) {
    return String(str).replace(/\d/g, function (d) {
      return String.fromCharCode(d.charCodeAt(0) + 0xFEE0);
    });
  }

  function fmtClock(sec) {
    return toZen(Math.floor(sec / 60)) + ':' + toZen(('0' + (sec % 60)).slice(-2));
  }

  function lineHints(bits) {
    var hints = [];
    var run = 0;
    for (var i = 0; i < bits.length; i++) {
      if (bits[i]) { run += 1; }
      else if (run) { hints.push(run); run = 0; }
    }
    if (run) hints.push(run);
    return hints.length ? hints : [0];
  }

  function lineRuns(cells) {
    // 現在のぬり状態から連続数を取り出す（✕は空とみなす）
    return lineHints(cells.map(function (v) { return v === FILL ? 1 : 0; }));
  }

  function sameArr(a, b) {
    if (a.length !== b.length) return false;
    for (var i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
    return true;
  }

  // ==================== NAVIGATION ====================
  function navigateTo(screenId, options) {
    options = options || {};
    if (state.currentScreen === 'play' && screenId !== 'play') stopTimer();
    if (options.addToHistory !== false && state.currentScreen) {
      state.screenHistory.push(state.currentScreen);
    }
    Object.keys(screens).forEach(function (id) { screens[id].classList.add('hidden'); });
    var next = screens[screenId];
    if (!next) return;
    next.classList.remove('hidden');
    state.currentScreen = screenId;
    onScreenEnter(screenId);
    focusFirst(next);
  }

  function goHome() {
    state.screenHistory = [];
    navigateTo('home', { addToHistory: false });
  }

  function navigateBack() {
    if (state.currentScreen === 'play') { goHome(); return; }
    if (state.screenHistory.length > 0) {
      navigateTo(state.screenHistory.pop(), { addToHistory: false });
    } else if (state.currentScreen !== 'home') {
      goHome();
    }
  }

  // ==================== FOCUS ====================
  function focusFirst(container) {
    if (container.id === 'play') { $('board').focus(); return; }
    var el = container.querySelector('.focusable:not([disabled])');
    if (el && el.offsetParent !== null) el.focus();
  }

  function visibleFocusables(container) {
    return Array.from(container.querySelectorAll('.focusable:not([disabled])'))
      .filter(function (el) { return el.offsetParent !== null; });
  }

  function moveFocus(direction) {
    var container = screens[state.currentScreen];
    if (!container) return;
    var focusables = visibleFocusables(container);
    if (focusables.length === 0) return;
    var idx = focusables.indexOf(document.activeElement);
    if (idx === -1) { focusables[0].focus(); return; }
    var nextIdx;
    if (direction === 'up' || direction === 'left') {
      nextIdx = idx > 0 ? idx - 1 : focusables.length - 1;
    } else {
      nextIdx = idx < focusables.length - 1 ? idx + 1 : 0;
    }
    focusables[nextIdx].focus();
    focusables[nextIdx].scrollIntoView({ block: 'nearest' });
  }

  // ==================== STORAGE ====================
  function loadData() {
    try {
      var saved = JSON.parse(localStorage.getItem(CONFIG.storageKey) || '{}');
      if (saved.records) state.records = saved.records;
    } catch (e) { /* 壊れた保存データは無視して初期値で続行 */ }
  }

  function saveData() {
    try {
      localStorage.setItem(CONFIG.storageKey, JSON.stringify({ records: state.records }));
    } catch (e) { /* private mode 等では保存できなくてもアプリは動かす */ }
  }

  // ==================== RENDER: HOME ====================
  function renderHome() {
    var clearedCount = PUZZLES.filter(function (p) { return state.records[p.id] && state.records[p.id].cleared; }).length;
    $('home-meta').textContent = clearedCount > 0
      ? 'クリア ' + toZen(clearedCount) + '/' + toZen(PUZZLES.length)
      : 'おえかきロジック';
    var list = $('puzzle-list');
    list.innerHTML = '';
    PUZZLES.forEach(function (p) {
      var rec = state.records[p.id];
      var cleared = rec && rec.cleared;
      var btn = document.createElement('button');
      btn.className = 'puzzle-item focusable';
      btn.dataset.action = 'open-puzzle';
      btn.dataset.puzzleId = p.id;
      btn.innerHTML =
        '<span class="pi-emoji"></span>' +
        '<span class="pi-main"><span class="pi-name"></span><span class="pi-sub"></span></span>' +
        '<span class="pi-best"></span>';
      btn.querySelector('.pi-emoji').textContent = cleared ? p.emoji : '❔';
      btn.querySelector('.pi-name').textContent = cleared ? p.name : '？？？';
      btn.querySelector('.pi-sub').textContent = toZen(p.grid.length) + '×' + toZen(p.grid.length) + '・' + p.level;
      btn.querySelector('.pi-best').textContent = cleared ? 'ベスト ' + fmtClock(rec.best) : 'みかいとう';
      list.appendChild(btn);
    });
  }

  // ==================== PLAY ====================
  function startPlay(puzzleId) {
    var puzzle = null;
    for (var i = 0; i < PUZZLES.length; i++) if (PUZZLES[i].id === puzzleId) puzzle = PUZZLES[i];
    if (!puzzle) return;
    var size = puzzle.grid.length;
    var solution = puzzle.grid.map(function (row) {
      return row.split('').map(Number);
    });
    state.play = {
      puzzle: puzzle,
      size: size,
      solution: solution,
      cells: solution.map(function (row) { return row.map(function () { return EMPTY; }); }),
      rowHints: solution.map(lineHints),
      colHints: solution[0].map(function (_, c) {
        return lineHints(solution.map(function (row) { return row[c]; }));
      }),
      cursor: { r: 0, c: 0 },
      startTs: Date.now(),
      done: false,
    };
    $('play-title').textContent = '？？？（' + toZen(size) + '×' + toZen(size) + '）';
    buildBoard();
    navigateTo('play');
    startTimer();
  }

  function buildBoard() {
    var p = state.play;
    var board = $('board');
    board.innerHTML = '';
    board.classList.toggle('big', p.size > 5);
    var maxRowHint = Math.max.apply(null, p.rowHints.map(function (h) { return h.length; }));
    var maxColHint = Math.max.apply(null, p.colHints.map(function (h) { return h.length; }));
    board.style.gridTemplateColumns = 'minmax(0, auto) repeat(' + p.size + ', var(--cell))';
    board.style.gridTemplateRows = 'minmax(0, auto) repeat(' + p.size + ', var(--cell))';

    // 左上コーナー
    var corner = document.createElement('div');
    corner.className = 'bh-corner';
    board.appendChild(corner);

    // 列ヒント
    p.colHints.forEach(function (hints, c) {
      var el = document.createElement('div');
      el.className = 'bh col';
      el.id = 'colhint-' + c;
      el.innerHTML = hints.map(function (n) { return '<span>' + toZen(n) + '</span>'; }).join('');
      board.appendChild(el);
    });

    // 行ヒント＋セル
    for (var r = 0; r < p.size; r++) {
      var rh = document.createElement('div');
      rh.className = 'bh row';
      rh.id = 'rowhint-' + r;
      rh.innerHTML = p.rowHints[r].map(function (n) { return '<span>' + toZen(n) + '</span>'; }).join('');
      board.appendChild(rh);
      for (var c = 0; c < p.size; c++) {
        var cell = document.createElement('div');
        cell.className = 'cell';
        cell.id = 'cell-' + r + '-' + c;
        if (r % 5 === 4 && r !== p.size - 1) cell.classList.add('edge-b');
        if (c % 5 === 4 && c !== p.size - 1) cell.classList.add('edge-r');
        board.appendChild(cell);
      }
    }
    renderBoard();
  }

  function renderBoard() {
    var p = state.play;
    for (var r = 0; r < p.size; r++) {
      for (var c = 0; c < p.size; c++) {
        var el = $('cell-' + r + '-' + c);
        el.classList.toggle('fill', p.cells[r][c] === FILL);
        el.classList.toggle('mark', p.cells[r][c] === MARK);
        el.classList.toggle('cursor', p.cursor.r === r && p.cursor.c === c);
        el.textContent = p.cells[r][c] === MARK ? '✕' : '';
      }
    }
    // そろった行・列のヒントを薄くする
    for (var i = 0; i < p.size; i++) {
      $('rowhint-' + i).classList.toggle('ok', sameArr(lineRuns(p.cells[i]), p.rowHints[i]));
      var col = p.cells.map(function (row) { return row[i]; });
      $('colhint-' + i).classList.toggle('ok', sameArr(lineRuns(col), p.colHints[i]));
    }
  }

  function moveCursor(dr, dc) {
    var p = state.play;
    var r = p.cursor.r + dr;
    var c = p.cursor.c + dc;
    if (r < 0) r = p.size - 1;
    if (c < 0) c = p.size - 1;
    if (c >= p.size) c = 0;
    if (r >= p.size) { $('cell-' + p.cursor.r + '-' + p.cursor.c).classList.remove('cursor'); document.querySelector('#play .quit-btn').focus(); return; }
    p.cursor = { r: r, c: c };
    renderBoard();
  }

  function cycleCell() {
    var p = state.play;
    if (p.done) return;
    var cur = p.cells[p.cursor.r][p.cursor.c];
    p.cells[p.cursor.r][p.cursor.c] = (cur + 1) % 3; // 空→ぬり→✕→空
    renderBoard();
    checkWin();
  }

  function checkWin() {
    var p = state.play;
    for (var r = 0; r < p.size; r++) {
      for (var c = 0; c < p.size; c++) {
        var filled = p.cells[r][c] === FILL ? 1 : 0;
        if (filled !== p.solution[r][c]) return;
      }
    }
    p.done = true;
    stopTimer();
    var sec = Math.max(1, Math.round((Date.now() - p.startTs) / 1000));
    var rec = state.records[p.puzzle.id] || {};
    var isBest = !rec.best || sec < rec.best;
    state.records[p.puzzle.id] = { cleared: true, best: isBest ? sec : rec.best };
    saveData();
    showClear(sec, isBest);
  }

  function showClear(sec, isBest) {
    var p = state.play;
    var art = $('clear-art');
    art.innerHTML = '';
    art.style.gridTemplateColumns = 'repeat(' + p.size + ', var(--art-cell))';
    art.classList.toggle('big', p.size > 5);
    p.solution.forEach(function (row) {
      row.forEach(function (v) {
        var d = document.createElement('div');
        d.className = 'art-px' + (v ? ' on' : '');
        if (v) d.style.background = p.puzzle.color;
        art.appendChild(d);
      });
    });
    $('clear-title').textContent = '🎉 ' + p.puzzle.name + '！ ' + p.puzzle.emoji;
    $('clear-sub').textContent = 'タイム ' + fmtClock(sec) + (isBest ? '（ベスト更新！）' : '');
    var nextIdx = PUZZLES.indexOf(p.puzzle) + 1;
    $('next-puzzle-btn').classList.toggle('hidden', nextIdx >= PUZZLES.length);
    state.screenHistory = [];
    setTimeout(function () { navigateTo('clear', { addToHistory: false }); }, 500);
  }

  // ==================== TIMER ====================
  function startTimer() {
    stopTimer();
    $('play-timer').textContent = '０:００';
    timerHandle = setInterval(function () {
      if (!state.play || state.play.done) return;
      $('play-timer').textContent = fmtClock(Math.round((Date.now() - state.play.startTs) / 1000));
    }, 1000);
  }

  function stopTimer() {
    clearInterval(timerHandle);
    timerHandle = null;
  }

  // ==================== ACTIONS ====================
  function handleAction(action, element) {
    switch (action) {
      case 'open-puzzle':
        startPlay(element.dataset.puzzleId);
        break;
      case 'quit-play':
        goHome();
        break;
      case 'next-puzzle': {
        var idx = PUZZLES.indexOf(state.play.puzzle) + 1;
        if (idx < PUZZLES.length) startPlay(PUZZLES[idx].id);
        else goHome();
        break;
      }
      case 'go-home':
        goHome();
        break;
      case 'noop':
        break;
      case 'back':
        navigateBack();
        break;
    }
  }

  function onScreenEnter(screenId) {
    if (screenId === 'home') renderHome();
  }

  // ==================== EVENTS ====================
  function setupEvents() {
    document.addEventListener('click', function (e) {
      var el = e.target.closest('[data-action]');
      if (el) handleAction(el.dataset.action, el);
    });

    document.addEventListener('keydown', function (e) {
      var onBoard = state.currentScreen === 'play' && document.activeElement === $('board') && state.play && !state.play.done;
      switch (e.key) {
        case 'ArrowUp':
          if (onBoard) moveCursor(-1, 0);
          else if (state.currentScreen === 'play' && document.activeElement === document.querySelector('#play .quit-btn')) {
            $('board').focus();
            renderBoard();
          } else moveFocus('up');
          e.preventDefault();
          break;
        case 'ArrowDown':
          if (onBoard) moveCursor(1, 0);
          else moveFocus('down');
          e.preventDefault();
          break;
        case 'ArrowLeft':
          if (onBoard) moveCursor(0, -1);
          else moveFocus('left');
          e.preventDefault();
          break;
        case 'ArrowRight':
          if (onBoard) moveCursor(0, 1);
          else moveFocus('right');
          e.preventDefault();
          break;
        case 'Enter':
          if (onBoard) cycleCell();
          else if (document.activeElement && document.activeElement.classList.contains('focusable')) {
            document.activeElement.click();
          }
          e.preventDefault();
          break;
        case 'Escape':
          // PC確認用の補助のみ（グラスに戻るジェスチャーはない）
          navigateBack();
          e.preventDefault();
          break;
      }
    });
  }

  // ==================== INIT ====================
  function init() {
    collectScreens();
    setupEvents();
    loadData();
    setTimeout(function () { navigateTo('home', { addToHistory: false }); }, 50);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
