/* Giao diện Kỳ Thủ Cờ Tướng: bàn cờ, đấu với máy, gợi ý, phân tích ván, bộ nhớ học, luyện tập. */
(function () {
  'use strict';
  const X = window.XQ;
  const $ = (id) => document.getElementById(id);
  const SVGNS = 'http://www.w3.org/2000/svg';

  // ---------- Lưu trữ an toàn ----------
  const store = {
    get(k, def) { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : def; } catch (e) { return def; } },
    set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { /* bỏ qua */ } },
  };

  // ---------- Engine (Web Worker, dự phòng chạy trên luồng chính) ----------
  class EngineClient {
    constructor() { this.worker = null; this.mode = 'main'; this.seq = 0; this.cur = null; this.local = null; }
    async init() {
      const tryWorker = (w) => new Promise((resolve) => {
        let ok = false;
        const t = setTimeout(() => { if (!ok) { try { w.terminate(); } catch (e) { } resolve(false); } }, 4000);
        w.onerror = () => { clearTimeout(t); try { w.terminate(); } catch (e) { } resolve(false); };
        w.onmessage = (e) => { if (e.data && e.data.type === 'done') { ok = true; clearTimeout(t); resolve(true); } };
        w.postMessage({ cmd: 'search', id: -1, fen: X.START_FEN, moves: [], time: 20, depth: 1 });
      });
      try {
        const w = new Worker('engine.js');
        if (await tryWorker(w)) { this.url = 'engine.js'; return this.attach(w, 'worker'); }
      } catch (e) { /* thử cách khác */ }
      try {
        const src = await (await fetch('engine.js')).text();
        const url = URL.createObjectURL(new Blob([src], { type: 'text/javascript' }));
        const w = new Worker(url);
        if (await tryWorker(w)) { this.url = url; return this.attach(w, 'worker'); }
      } catch (e) { /* luồng chính */ }
      this.mode = 'main';
      return this;
    }
    attach(w, mode) {
      this.worker = w; this.mode = mode;
      w.onmessage = (e) => this.onMsg(e.data);
      w.onerror = () => { };
      return this;
    }
    onMsg(m) {
      const c = this.cur;
      if (!c || m.id !== c.id) return;
      if (m.type === 'info' && c.onInfo) c.onInfo(m.info);
      if (m.type === 'done') { this.cur = null; c.resolve(m.result); }
    }
    cancel() {
      if (!this.cur) return;
      const c = this.cur; this.cur = null;
      if (this.worker) {
        this.worker.terminate();
        const w = new Worker(this.url);
        this.attach(w, 'worker');
      }
      c.resolve(null);
    }
    search(fen, moves, time, onInfo, full) {
      this.cancel();
      return new Promise((resolve) => {
        const id = ++this.seq;
        this.cur = { id, resolve, onInfo };
        if (this.worker) {
          this.worker.postMessage({ cmd: 'search', id, fen, moves, time, full: !!full });
        } else {
          setTimeout(() => {
            if (!this.cur || this.cur.id !== id) return;
            if (!this.local) this.local = new X.Searcher();
            const pos = new X.Position().fromFen(fen);
            for (const mv of moves) pos.makeMove(mv);
            const r = this.local.think(pos, { time: Math.min(time, 4000), onInfo, fullOnForced: !!full });
            if (this.cur && this.cur.id === id) { this.cur = null; resolve(r); }
          }, 30);
        }
      });
    }
  }

  // ---------- Khai cuộc cơ bản (ICCS) ----------
  const BOOK_LINES = [
    'h2e2 h9g7 h0g2 i9h9 i0h0 b9c7 b0c2 h7i7',
    'h2e2 h9g7 h0g2 b9c7 i0h0 i9h9 h0h6 c6c5',
    'h2e2 h7e7 h0g2 h9g7 i0h0 i9h9 b0c2',
    'h2e2 b9c7 h0g2 a9b9 i0h0 h9g7',
    'h2e2 c6c5 h0g2 b9c7 i0h0',
    'c3c4 g6g5 b0c2 b9c7 h0g2',
    'c3c4 b7c7 h2e2 c9e7 h0g2',
    'c3c4 c9e7 h2e2 h9g7',
    'g3g4 c6c5 h0g2 b9c7',
    'b0c2 g6g5 c3c4 h9g7',
    'h0g2 g6g5 c3c4 h9g7',
    'c0e2 h7e7 h0g2 h9g7 i0h0',
    'g0e2 h7e7 h0g2 h9g7',
  ];
  const mirrorIccs = (s) => s.replace(/[a-i]/g, (c) => String.fromCharCode(105 - (c.charCodeAt(0) - 97)));
  const BOOK = [];
  for (const l of BOOK_LINES) { BOOK.push(l.split(' ')); BOOK.push(mirrorIccs(l).split(' ')); }
  function bookMove(startFen, moves) {
    if (startFen !== X.START_FEN) return 0;
    const played = moves.map(X.moveToIccs);
    const cands = [];
    for (const line of BOOK) {
      if (line.length <= played.length) continue;
      let ok = true;
      for (let i = 0; i < played.length; i++) if (line[i] !== played[i]) { ok = false; break; }
      if (ok) cands.push(line[played.length]);
    }
    if (!cands.length) return 0;
    return X.iccsToMove(cands[Math.floor(Math.random() * cands.length)]);
  }

  // ---------- Bộ nhớ học (thế cờ → nước tốt nhất đã phân tích sâu) ----------
  const MEM_KEY = 'kythu.memory.v1', MIST_KEY = 'kythu.mistakes.v1', MEM_LIMIT = 6000;
  let memory = store.get(MEM_KEY, {});
  let mistakes = store.get(MIST_KEY, []);
  const posKey = (pos) => pos.toFen().split(' ').slice(0, 2).join(' ');
  function learn(pos, result) {
    if (!result || !result.move || result.depth < 6) return;
    const k = posKey(pos);
    const old = memory[k];
    if (old && old.d >= result.depth) return;
    memory[k] = { m: X.moveToIccs(result.move), s: result.score, d: result.depth };
    const keys = Object.keys(memory);
    if (keys.length > MEM_LIMIT) for (const kk of keys.slice(0, keys.length - MEM_LIMIT)) delete memory[kk];
    store.set(MEM_KEY, memory);
    renderLearnInfo();
  }
  function recall(pos) {
    const e = memory[posKey(pos)];
    if (!e) return null;
    const mv = X.iccsToMove(e.m);
    return pos.legalMove(mv) ? { move: mv, score: e.s, depth: e.d } : null;
  }

  // ---------- Trạng thái ----------
  const S = {
    startFen: X.START_FEN, moves: [], notes: [], view: null,
    mode: 'play', human: 0, flipped: false, time: 3000,
    selected: -1, hint: null, analysis: null, review: null,
    editing: false, edPiece: 12, edBoard: null, edSide: 0,
    train: null,
  };
  const engine = new EngineClient();

  function buildPos(n) {
    const p = new X.Position().fromFen(S.startFen);
    const k = n == null ? S.moves.length : n;
    for (let i = 0; i < k; i++) p.makeMove(S.moves[i]);
    return p;
  }
  const viewIndex = () => (S.view == null ? S.moves.length : S.view);
  function currentPos() {
    if (S.train) return S.train.pos;
    return buildPos(viewIndex());
  }

  function gameResult(pos) {
    if (pos.legalMoves().length === 0) return { winner: 1 - pos.sd, text: (pos.sd === 0 ? 'Đen' : 'Đỏ') + ' thắng — ' + (pos.inCheck() ? 'chiếu bí.' : 'đối phương hết nước đi.') };
    const rep = pos.repStatus(3);
    if (rep > 0) {
      if (rep & 2) return { winner: 1 - pos.sd, text: (pos.sd === 0 ? 'Đen' : 'Đỏ') + ' thắng — bên kia chiếu dai (phạm luật).' };
      if (rep & 4) return { winner: pos.sd, text: (pos.sd === 0 ? 'Đỏ' : 'Đen') + ' thắng — bên kia chiếu dai (phạm luật).' };
      return { winner: -1, text: 'Hoà — thế cờ lặp lại ba lần.' };
    }
    if (!pos.hasAttackers(0) && !pos.hasAttackers(1)) return { winner: -1, text: 'Hoà — hai bên không còn quân tấn công.' };
    return null;
  }

  // ---------- Vẽ bàn cờ ----------
  const CELL = 56, OX = 36, OY = 46;
  const HAN = { 8: '帥', 9: '仕', 10: '相', 11: '傌', 12: '俥', 13: '炮', 14: '兵', 16: '將', 17: '士', 18: '象', 19: '馬', 20: '車', 21: '砲', 22: '卒' };
  const sqXY = (sq) => {
    let c = (sq & 15) - 3, r = (sq >> 4) - 3;
    if (S.flipped) { c = 8 - c; r = 9 - r; }
    return [OX + c * CELL, OY + r * CELL];
  };
  function el(tag, attrs, parent) {
    const e = document.createElementNS(SVGNS, tag);
    for (const k in attrs) e.setAttribute(k, attrs[k]);
    if (parent) parent.appendChild(e);
    return e;
  }

  function drawGrid(svg) {
    const g = el('g', { stroke: 'var(--wood-line)', 'stroke-width': 1.4, fill: 'none' }, svg);
    el('rect', { x: OX - 6, y: OY - 6, width: 8 * CELL + 12, height: 9 * CELL + 12, 'stroke-width': 2.6 }, g);
    for (let r = 0; r < 10; r++) el('line', { x1: OX, y1: OY + r * CELL, x2: OX + 8 * CELL, y2: OY + r * CELL }, g);
    for (let c = 0; c < 9; c++) {
      if (c === 0 || c === 8) el('line', { x1: OX + c * CELL, y1: OY, x2: OX + c * CELL, y2: OY + 9 * CELL }, g);
      else {
        el('line', { x1: OX + c * CELL, y1: OY, x2: OX + c * CELL, y2: OY + 4 * CELL }, g);
        el('line', { x1: OX + c * CELL, y1: OY + 5 * CELL, x2: OX + c * CELL, y2: OY + 9 * CELL }, g);
      }
    }
    for (const r0 of [0, 7]) {
      el('line', { x1: OX + 3 * CELL, y1: OY + r0 * CELL, x2: OX + 5 * CELL, y2: OY + (r0 + 2) * CELL }, g);
      el('line', { x1: OX + 5 * CELL, y1: OY + r0 * CELL, x2: OX + 3 * CELL, y2: OY + (r0 + 2) * CELL }, g);
    }
    // dấu vị trí pháo, tốt
    const marks = [[1, 2], [7, 2], [1, 7], [7, 7], [0, 3], [2, 3], [4, 3], [6, 3], [8, 3], [0, 6], [2, 6], [4, 6], [6, 6], [8, 6]];
    for (const [c, r] of marks) {
      const x = OX + c * CELL, y = OY + r * CELL, d = 4, l = 9;
      for (const sx of [-1, 1]) for (const sy of [-1, 1]) {
        if ((c === 0 && sx < 0) || (c === 8 && sx > 0)) continue;
        el('polyline', { points: `${x + sx * (d + l)},${y + sy * d} ${x + sx * d},${y + sy * d} ${x + sx * d},${y + sy * (d + l)}`, 'stroke-width': 1.2 }, g);
      }
    }
    const t = el('g', { fill: 'var(--wood-line)', 'font-family': 'var(--font-han)', 'font-size': 26, 'text-anchor': 'middle', 'dominant-baseline': 'central', opacity: .75 }, svg);
    const ry = OY + 4.5 * CELL;
    [['楚', 1.5], ['河', 2.5], ['漢', 5.5], ['界', 6.5]].forEach(([ch, c]) => { const e = el('text', { x: OX + c * CELL, y: ry }, t); e.textContent = ch; });
    // số cột
    const n = el('g', { fill: 'var(--wood-line)', 'font-family': 'var(--font-mono)', 'font-size': 11, 'text-anchor': 'middle', opacity: .8 }, svg);
    for (let c = 0; c < 9; c++) {
      // mỗi bên đánh số cột từ phải sang trái theo phía mình
      el('text', { x: OX + c * CELL, y: 14 }, n).textContent = c + 1;
      el('text', { x: OX + c * CELL, y: 590 }, n).textContent = 9 - c;
    }
  }

  function arrow(svg, mv, color, width, opacity) {
    const [x1, y1] = sqXY(X.SRC(mv)), [x2, y2] = sqXY(X.DST(mv));
    const dx = x2 - x1, dy = y2 - y1, len = Math.hypot(dx, dy);
    const ux = dx / len, uy = dy / len;
    const sx = x1 + ux * 14, sy = y1 + uy * 14, ex = x2 - ux * 18, ey = y2 - uy * 18;
    const g = el('g', { opacity, 'pointer-events': 'none' }, svg);
    el('line', { x1: sx, y1: sy, x2: ex, y2: ey, stroke: color, 'stroke-width': width, 'stroke-linecap': 'round' }, g);
    const hx = ex + ux * 12, hy = ey + uy * 12, px = -uy, py = ux;
    el('polygon', { points: `${hx},${hy} ${ex + px * 10},${ey + py * 10} ${ex - px * 10},${ey - py * 10}`, fill: color }, g);
  }

  function render() {
    const svg = $('board');
    svg.textContent = '';
    drawGrid(svg);
    const pos = S.editing ? null : currentPos();
    const board = S.editing ? S.edBoard : pos.board;
    const vi = viewIndex();
    const last = S.train ? 0 : (vi > 0 ? S.moves[vi - 1] : 0);
    if (last) {
      for (const sq of [X.SRC(last), X.DST(last)]) {
        const [x, y] = sqXY(sq);
        el('rect', { x: x - 27, y: y - 27, width: 54, height: 54, rx: 8, fill: 'none', stroke: 'var(--jade)', 'stroke-width': 2.5, 'stroke-dasharray': '6 4' }, svg);
      }
    }
    // quân
    for (let sq = 0; sq < 256; sq++) {
      const pc = board[sq];
      if (!pc) continue;
      const [x, y] = sqXY(sq);
      const isRed = pc < 16;
      const g = el('g', { transform: `translate(${x},${y})` }, svg);
      if (sq === S.selected) el('circle', { r: 28, fill: 'var(--jade)', opacity: .35 }, g);
      el('circle', { r: 25, fill: 'var(--piece)', stroke: 'var(--piece-ring)', 'stroke-width': 2.5 }, g);
      el('circle', { r: 20.5, fill: 'none', stroke: isRed ? 'var(--red)' : 'var(--ink)', 'stroke-width': 1.4 }, g);
      if (!S.editing && pos.inCheck() && (pc & 7) === X.KING && (isRed ? 0 : 1) === pos.sd) el('circle', { r: 25, fill: 'none', stroke: 'var(--bad)', 'stroke-width': 4 }, g);
      const t = el('text', { 'text-anchor': 'middle', 'dominant-baseline': 'central', 'font-family': 'var(--font-han)', 'font-size': 27, 'font-weight': 700, fill: isRed ? 'var(--red)' : 'var(--ink)', y: 1 }, g);
      t.textContent = HAN[pc];
    }
    // nước đi hợp lệ của quân đang chọn
    if (!S.editing && S.selected >= 0) {
      for (const mv of pos.legalMoves()) {
        if (X.SRC(mv) !== S.selected) continue;
        const [x, y] = sqXY(X.DST(mv));
        if (pos.board[X.DST(mv)]) el('circle', { cx: x, cy: y, r: 27, fill: 'none', stroke: 'var(--jade)', 'stroke-width': 3, 'pointer-events': 'none' }, svg);
        else el('circle', { cx: x, cy: y, r: 7, fill: 'var(--jade)', opacity: .8, 'pointer-events': 'none' }, svg);
      }
    }
    if (!S.editing && S.hint && S.hint.fenKey === posKey(pos)) {
      if (S.hint.pv && S.hint.pv[1]) arrow(svg, S.hint.pv[1], 'var(--muted)', 5, .55);
      arrow(svg, S.hint.move, 'var(--jade)', 7, .9);
    }
    renderStatus(pos);
  }

  function renderStatus(pos) {
    if (S.editing) {
      $('turnText').textContent = 'Đang xếp cờ';
      $('turnDot').className = 'dot ' + (S.edSide === 0 ? 'red' : 'black');
      $('checkChip').hidden = true;
      return;
    }
    $('turnDot').className = 'dot ' + (pos.sd === 0 ? 'red' : 'black');
    let t = (pos.sd === 0 ? 'Đỏ' : 'Đen') + ' đi';
    if (S.view != null && !S.train) t += ` · đang xem nước ${S.view}/${S.moves.length}`;
    if (S.train) t += ' · luyện tập';
    $('turnText').textContent = t;
    $('checkChip').hidden = !pos.inCheck();
    const res = S.train ? null : gameResult(pos);
    const gm = $('gameMsg');
    if (res) { gm.hidden = false; gm.textContent = res.text; } else gm.hidden = true;
    renderMoveList();
  }

  function setEval(score, sd) {
    let red = sd === 0 ? score : -score;
    if (Math.abs(red) > X.WIN) red = red > 0 ? 3000 : -3000;
    const p = 1 / (1 + Math.exp(-red / 350));
    $('evalFill').style.width = (p * 100).toFixed(1) + '%';
  }

  function qualityOf(i) {
    if (!S.review || !S.review.items[i + 1]) return null;
    return S.review.quality[i];
  }

  function renderMoveList() {
    const box = $('moveList');
    box.textContent = '';
    const startBlack = new X.Position().fromFen(S.startFen).sd === 1;
    const offset = startBlack ? 1 : 0;
    const total = S.moves.length + offset;
    const vi = viewIndex();
    for (let k = 0; k < total; k += 2) {
      const no = document.createElement('span'); no.className = 'no'; no.textContent = (k / 2 + 1) + '.'; box.appendChild(no);
      for (let j = 0; j < 2; j++) {
        const idx = k + j - offset;
        const sp = document.createElement('span');
        if (idx >= 0 && idx < S.moves.length) {
          sp.className = 'mv' + (idx === vi - 1 ? ' cur' : '');
          const q = qualityOf(idx);
          if (q) { const d = document.createElement('i'); d.className = 'tag ' + q.cls; d.title = q.label; sp.appendChild(d); }
          sp.appendChild(document.createTextNode(S.notes[idx]));
          sp.addEventListener('click', () => goto(idx + 1));
        }
        box.appendChild(sp);
      }
    }
    const cur = box.querySelector('.cur');
    if (cur) cur.scrollIntoView({ block: 'nearest' });
  }

  // ---------- Phân tích / gợi ý ----------
  function showAnalysis(pos, r, label) {
    if (!r || !r.move) return;
    $('aBest').textContent = X.moveToVN(pos, r.move);
    $('aScore').textContent = X.scoreText(r.score, pos.sd);
    const p = pos.clone(); const parts = [];
    for (const mv of r.pv || []) { if (!p.legalMove(mv)) break; parts.push(X.moveToVN(p, mv)); p.makeMove(mv); }
    $('aPv').textContent = parts.length ? 'Diễn biến dự kiến: ' + parts.join('  ') : '';
    const nps = r.time ? Math.round(r.nodes / r.time) : 0;
    $('aMeta').textContent = label || `Độ sâu ${r.depth} · ${(r.nodes / 1000).toFixed(0)}k thế · ${nps}k thế/giây`;
    setEval(r.score, pos.sd);
    S.hint = { fenKey: posKey(pos), move: r.move, pv: r.pv, score: r.score };
  }

  function clearAnalysis(msg) {
    $('aBest').textContent = '—'; $('aScore').textContent = ''; $('aPv').textContent = '';
    $('aMeta').textContent = msg || '';
    S.hint = null;
    const pos = currentPos();
    const m = recall(pos);
    const mm = $('aMemory');
    if (m) { mm.hidden = false; mm.textContent = `Máy đã học thế này: ${X.moveToVN(pos, m.move)} (độ sâu ${m.depth}, ${X.scoreText(m.score, pos.sd)})`; }
    else mm.hidden = true;
  }

  async function analyze(time) {
    const pos = currentPos();
    if (gameResult(pos) && !S.train) return null;
    const fen = S.train ? S.train.fen : S.startFen;
    const moves = S.train ? [] : S.moves.slice(0, viewIndex());
    const key = posKey(pos);
    $('thinkChip').hidden = false;
    const r = await engine.search(fen, moves, time || S.time, (info) => {
      if (posKey(currentPos()) === key) { showAnalysis(pos, info); render(); }
    });
    $('thinkChip').hidden = true;
    if (!r || posKey(currentPos()) !== key) return null;
    learn(pos, r);
    showAnalysis(pos, r);
    render();
    return r;
  }

  async function engineTurn() {
    const pos = currentPos();
    if (S.mode !== 'play' || S.view != null || S.train || pos.sd === S.human || gameResult(pos)) return;
    const key = posKey(pos);
    let mv = bookMove(S.startFen, S.moves);
    if (mv && !pos.legalMove(mv)) mv = 0;
    let label = 'Nước khai cuộc quen thuộc';
    if (!mv) {
      const mem = recall(pos);
      if (mem && mem.depth >= 9 && S.time <= 6000) { mv = mem.move; label = `Nhớ từ lần phân tích trước (độ sâu ${mem.depth})`; showAnalysis(pos, { ...mem, pv: [mem.move], nodes: 0, time: 0 }, label); }
    }
    if (!mv) {
      const r = await analyze(S.time);
      if (!r || posKey(currentPos()) !== key) return;
      mv = r.move;
    } else {
      await new Promise((res) => setTimeout(res, 350));
      if (posKey(currentPos()) !== key) return;
      $('aMeta').textContent = label;
    }
    doMove(mv, true);
  }

  // ---------- Đi quân ----------
  function doMove(mv, byEngine) {
    if (S.train) return trainMove(mv);
    if (S.view != null && S.view < S.moves.length) {
      S.moves = S.moves.slice(0, S.view); S.notes = S.notes.slice(0, S.view);
      S.review = null; renderReview();
    }
    S.view = null;
    const pos = buildPos();
    if (!pos.legalMove(mv)) return;
    S.notes.push(X.moveToVN(pos, mv));
    S.moves.push(mv);
    S.selected = -1;
    afterChange();
  }

  function afterChange() {
    engine.cancel();
    $('thinkChip').hidden = true;
    clearAnalysis(S.mode === 'analyze' ? 'Đang phân tích…' : '');
    render();
    saveGame();
    const pos = currentPos();
    if (S.train) return;
    if (S.mode === 'analyze') analyze(S.time);
    else if (S.view == null) setTimeout(engineTurn, 60);
  }

  function goto(n) {
    if (S.train) return;
    n = Math.max(0, Math.min(S.moves.length, n));
    S.view = n === S.moves.length ? null : n;
    S.selected = -1;
    afterChange();
  }

  function svgPoint(evt) {
    const svg = $('board');
    const pt = svg.createSVGPoint();
    pt.x = evt.clientX; pt.y = evt.clientY;
    const p = pt.matrixTransform(svg.getScreenCTM().inverse());
    let c = Math.round((p.x - OX) / CELL), r = Math.round((p.y - OY) / CELL);
    if (c < 0 || c > 8 || r < 0 || r > 9) return -1;
    if (S.flipped) { c = 8 - c; r = 9 - r; }
    return X.COORD(c + 3, r + 3);
  }

  $('board').addEventListener('click', (evt) => {
    const sq = svgPoint(evt);
    if (sq < 0) return;
    if (S.editing) return editClick(sq);
    const pos = currentPos();
    if (!S.train && gameResult(pos)) return;
    if (!S.train && S.mode === 'play' && pos.sd !== S.human && S.view == null) return;
    const pc = pos.board[sq];
    const mine = pc && ((pc < 16 ? 0 : 1) === pos.sd);
    if (S.selected >= 0) {
      const mv = X.MOVE(S.selected, sq);
      if (pos.legalMove(mv)) return doMove(mv);
    }
    S.selected = mine ? (S.selected === sq ? -1 : sq) : -1;
    render();
  });

  document.addEventListener('keydown', (e) => {
    if (e.target.closest('textarea, input, select')) return;
    if (e.key === 'ArrowLeft') goto(viewIndex() - 1);
    if (e.key === 'ArrowRight') goto(viewIndex() + 1);
  });

  // ---------- Điều khiển ----------
  function setPressed(a, b, first) { $(a).setAttribute('aria-pressed', String(first)); $(b).setAttribute('aria-pressed', String(!first)); }
  function setMode(m) {
    S.mode = m;
    setPressed('modePlay', 'modeAnalyze', m === 'play');
    $('sideRow').hidden = m !== 'play';
    $('modeHint').textContent = m === 'play'
      ? 'Bạn đi quân của mình, máy tự đáp lại. Bấm “Gợi ý” khi cần.'
      : 'Bạn tự đi cho cả hai bên (ví dụ chép lại ván đang đánh ngoài đời). Máy liên tục chỉ ra nước tốt nhất.';
    afterChange();
  }
  $('modePlay').onclick = () => setMode('play');
  $('modeAnalyze').onclick = () => setMode('analyze');
  $('sideRed').onclick = () => { S.human = 0; S.flipped = false; setPressed('sideRed', 'sideBlack', true); afterChange(); };
  $('sideBlack').onclick = () => { S.human = 1; S.flipped = true; setPressed('sideRed', 'sideBlack', false); afterChange(); };
  $('thinkTime').onchange = (e) => { S.time = Number(e.target.value); store.set('kythu.time', S.time); };
  $('btnNew').onclick = () => { exitTrain(); S.startFen = X.START_FEN; S.moves = []; S.notes = []; S.view = null; S.review = null; renderReview(); afterChange(); };
  $('btnUndo').onclick = () => {
    if (S.train) return;
    let n = S.mode === 'play' ? (buildPos().sd === S.human ? 2 : 1) : 1;
    n = Math.min(n, S.moves.length);
    S.moves = S.moves.slice(0, S.moves.length - n); S.notes = S.notes.slice(0, S.moves.length);
    S.view = null; S.review = null; renderReview();
    afterChange();
  };
  $('btnHint').onclick = () => analyze(S.time);
  $('btnPlayBest').onclick = () => {
    const pos = currentPos();
    if (S.hint && S.hint.fenKey === posKey(pos)) doMove(S.hint.move);
    else analyze(S.time).then((r) => { if (r) doMove(r.move); });
  };
  $('btnFlip').onclick = () => { S.flipped = !S.flipped; render(); };
  $('btnFirst').onclick = () => goto(0);
  $('btnPrev').onclick = () => goto(viewIndex() - 1);
  $('btnNext').onclick = () => goto(viewIndex() + 1);
  $('btnLast').onclick = () => goto(S.moves.length);

  for (const b of document.querySelectorAll('.tabs button')) {
    b.onclick = () => {
      for (const o of document.querySelectorAll('.tabs button')) o.setAttribute('aria-selected', String(o === b));
      for (const t of ['play', 'learn', 'edit']) $('pane-' + t).hidden = t !== b.dataset.tab;
      if (b.dataset.tab !== 'edit' && S.editing) { S.editing = false; render(); }
      if (b.dataset.tab === 'edit') { $('fenText').value = currentPos().toFen(); $('iccsText').value = S.moves.map(X.moveToIccs).join(' '); }
    };
  }

  // ---------- Phân tích cả ván ----------
  const LEVELS = [
    { max: 15, cls: 'q-best', label: 'Tốt nhất' },
    { max: 50, cls: 'q-good', label: 'Tốt' },
    { max: 130, cls: 'q-inacc', label: 'Thiếu chính xác' },
    { max: 300, cls: 'q-mist', label: 'Sai lầm' },
    { max: Infinity, cls: 'q-blun', label: 'Sai lầm nặng' },
  ];
  const clampScore = (s) => (s > X.WIN ? 3000 : s < -X.WIN ? -3000 : Math.max(-3000, Math.min(3000, s)));
  let reviewStop = false;

  $('btnReview').onclick = async () => {
    if (S.train) exitTrain();
    if (!S.moves.length) { $('reviewOut').innerHTML = '<p class="muted">Chưa có nước nào để phân tích. Hãy đánh vài nước hoặc nạp biên bản ở tab Xếp cờ.</p>'; return; }
    const t = Number($('reviewTime').value);
    reviewStop = false;
    $('btnReview').disabled = true; $('btnReviewStop').hidden = false; $('reviewProg').hidden = false;
    const fen = S.startFen, moves = S.moves.slice();
    const items = [];
    for (let i = 0; i <= moves.length && !reviewStop; i++) {
      $('reviewProg').firstElementChild.style.width = (100 * i / (moves.length + 1)).toFixed(0) + '%';
      const pos = new X.Position().fromFen(fen);
      for (let j = 0; j < i; j++) pos.makeMove(moves[j]);
      if (pos.legalMoves().length === 0) { items.push({ score: -X.MATE + 1, best: 0, pv: [], depth: 0 }); continue; }
      const r = await engine.search(fen, moves.slice(0, i), t, null, true);
      if (!r) break;
      learn(pos, r);
      items.push({ score: r.score, best: r.move, pv: r.pv.slice(0, 6), depth: r.depth });
    }
    $('btnReview').disabled = false; $('btnReviewStop').hidden = true; $('reviewProg').hidden = true;
    if (items.length < 2 || S.moves.length !== moves.length) return;
    // chấm điểm từng nước
    const quality = [];
    const start = new X.Position().fromFen(fen);
    let added = 0;
    for (let i = 0; i + 1 < items.length; i++) {
      const before = clampScore(items[i].score), after = clampScore(-items[i + 1].score);
      let loss = Math.max(0, before - after);
      if (moves[i] === items[i].best) loss = 0;
      const lv = LEVELS.find((l) => loss <= l.max);
      const mover = (start.sd + i) % 2;
      quality.push({ ...lv, loss, mover });
      const isHumanMove = S.mode === 'analyze' || mover === S.human;
      if (loss > 130 && isHumanMove && items[i].best) {
        const p = new X.Position().fromFen(fen);
        for (let j = 0; j < i; j++) p.makeMove(moves[j]);
        const pf = p.toFen();
        if (!mistakes.some((m) => m.fen === pf)) {
          mistakes.push({ fen: pf, best: X.moveToIccs(items[i].best), played: X.moveToIccs(moves[i]), loss, solved: 0 });
          added++;
        }
      }
    }
    if (mistakes.length > 300) mistakes = mistakes.slice(-300);
    store.set(MIST_KEY, mistakes);
    S.review = { items, quality, moves, fen, added };
    renderReview(); renderMoveList(); renderLearnInfo();
  };
  $('btnReviewStop').onclick = () => { reviewStop = true; engine.cancel(); };

  function renderReview() {
    const out = $('reviewOut');
    out.textContent = '';
    const R = S.review;
    if (!R) return;
    const sides = [{ n: 'Đỏ', c: {} }, { n: 'Đen', c: {} }];
    const acc = [[0, 0], [0, 0]];
    R.quality.forEach((q) => {
      sides[q.mover].c[q.label] = (sides[q.mover].c[q.label] || 0) + 1;
      acc[q.mover][0] += Math.min(q.loss, 500); acc[q.mover][1]++;
    });
    const sum = document.createElement('div'); sum.className = 'summary';
    sides.forEach((s, k) => {
      const d = document.createElement('div'); d.className = 'side';
      const avg = acc[k][1] ? acc[k][0] / acc[k][1] : 0;
      const accuracy = Math.max(0, Math.round(100 - avg / 2.5));
      d.innerHTML = `${s.n} · độ chính xác<strong>${acc[k][1] ? accuracy + '%' : '—'}</strong>` +
        LEVELS.map((l) => s.c[l.label] ? `${l.label}: ${s.c[l.label]}` : '').filter(Boolean).join(' · ');
      sum.appendChild(d);
    });
    out.appendChild(sum);
    // biểu đồ thế cờ theo góc nhìn Đỏ
    const startSd = new X.Position().fromFen(R.fen).sd;
    const pts = R.items.map((it, i) => { const sd = (startSd + i) % 2; const red = clampScore(sd === 0 ? it.score : -it.score); return Math.max(-1000, Math.min(1000, red)); });
    const W = 400, H = 90;
    const svg = document.createElementNS(SVGNS, 'svg');
    svg.setAttribute('viewBox', `0 0 ${W} ${H}`); svg.setAttribute('class', 'chart'); svg.setAttribute('preserveAspectRatio', 'none');
    svg.setAttribute('role', 'img'); svg.setAttribute('aria-label', 'Biểu đồ ưu thế qua từng nước (trên là Đỏ hơn, dưới là Đen hơn)');
    const xOf = (i) => (pts.length < 2 ? 0 : i * W / (pts.length - 1)), yOf = (v) => H / 2 - v / 1000 * (H / 2 - 4);
    const area = `M0,${H / 2} ` + pts.map((v, i) => `L${xOf(i)},${yOf(v)}`).join(' ') + ` L${W},${H / 2} Z`;
    el('path', { d: area, fill: 'var(--red)', opacity: .18 }, svg);
    el('line', { x1: 0, y1: H / 2, x2: W, y2: H / 2, stroke: 'var(--line)', 'stroke-width': 1 }, svg);
    el('polyline', { points: pts.map((v, i) => `${xOf(i)},${yOf(v)}`).join(' '), fill: 'none', stroke: 'var(--red)', 'stroke-width': 2, 'vector-effect': 'non-scaling-stroke' }, svg);
    out.appendChild(svg);
    const cap = document.createElement('p'); cap.className = 'muted';
    cap.textContent = 'Đường đi lên: Đỏ có ưu thế; đi xuống: Đen có ưu thế. Bấm vào một nước để xem lại thế cờ đó.' + (R.added ? ` Đã thêm ${R.added} nước sai vào sổ luyện tập.` : '');
    out.appendChild(cap);
    const list = document.createElement('div'); list.className = 'review-list';
    const p = new X.Position().fromFen(R.fen);
    R.quality.forEach((q, i) => {
      const it = R.items[i];
      const played = X.moveToVN(p, R.moves[i]);
      const best = it.best ? X.moveToVN(p, it.best) : '';
      p.makeMove(R.moves[i]);
      const row = document.createElement('button'); row.className = 'rv'; row.type = 'button';
      const num = Math.floor((i + (startSd === 1 ? 1 : 0)) / 2) + 1;
      row.innerHTML = `<span class="muted">${num}${q.mover === 0 ? '.' : '…'}</span><span class="q ${q.cls}">${q.label}</span>` +
        `<span><code>${played}</code>${q.loss > 15 && best ? ` <span class="muted">· nên đi</span> <code>${best}</code> <span class="muted">(−${(q.loss / 100).toFixed(1)})</span>` : ''}</span>`;
      row.onclick = () => { goto(i); setTimeout(() => { const pos = currentPos(); if (it.best) { showAnalysis(pos, { ...it, move: it.best, nodes: 0, time: 0 }, `Phân tích lại: nên đi ${best}`); render(); } }, 80); };
      list.appendChild(row);
    });
    out.appendChild(list);
  }

  // ---------- Luyện tập ----------
  function renderLearnInfo() {
    const open = mistakes.filter((m) => m.solved < 2).length;
    $('trainInfo').textContent = mistakes.length
      ? `Sổ có ${mistakes.length} thế cờ bạn từng đi sai, ${open} thế chưa thuộc. Máy cho lại thế cờ, bạn tìm nước đúng.`
      : 'Sổ còn trống. Phân tích một ván bạn đã đánh, các nước sai sẽ được ghi vào đây.';
    $('btnTrain').disabled = !mistakes.length;
    $('memInfo').textContent = `Máy đã ghi nhớ ${Object.keys(memory).length} thế cờ đã tính sâu. Gặp lại thế đó, máy đi ngay nước đã tính và hiện lời nhắc khi bạn phân tích.`;
  }
  function pickMistake() {
    const pool = mistakes.filter((m) => m.solved < 2);
    const arr = pool.length ? pool : mistakes;
    return arr[Math.floor(Math.random() * arr.length)];
  }
  function startTrain() {
    const item = pickMistake();
    if (!item) return;
    engine.cancel();
    const pos = new X.Position().fromFen(item.fen);
    S.train = { item, pos, fen: item.fen, tries: 0, done: false };
    S.flipped = pos.sd === 1; S.selected = -1; S.hint = null;
    $('btnTrainNext').hidden = false; $('btnTrainExit').hidden = false;
    const tm = $('trainMsg'); tm.hidden = false; tm.className = 'msg';
    tm.textContent = `${pos.sd === 0 ? 'Đỏ' : 'Đen'} đi. Lần trước bạn đi ${X.moveToVN(pos, X.iccsToMove(item.played))} và mất khoảng ${(item.loss / 100).toFixed(1)} điểm. Hãy tìm nước tốt hơn.`;
    clearAnalysis('');
    render();
  }
  async function trainMove(mv) {
    const T = S.train;
    if (T.done) return;
    const pos = T.pos;
    const best = X.iccsToMove(T.item.best);
    const note = X.moveToVN(pos, mv), bestNote = X.moveToVN(pos, best);
    T.tries++;
    const tm = $('trainMsg');
    let ok = mv === best;
    if (!ok) {
      tm.className = 'msg'; tm.textContent = `Đang kiểm tra ${note}…`;
      const p2 = pos.clone(); p2.makeMove(mv);
      const r = await engine.search(T.fen, [mv], 800, null, true);
      const rb = await engine.search(T.fen, [best], 800, null, true);
      if (r && rb && clampScore(-r.score) >= clampScore(-rb.score) - 25) ok = true;
    }
    if (ok) {
      T.item.solved++; T.done = true;
      pos.makeMove(mv);
      tm.className = 'msg'; tm.textContent = `Đúng rồi: ${note}${mv !== best ? ` (cũng tốt như ${bestNote})` : ''}. Bấm “Bài tiếp”.`;
    } else if (T.tries >= 2) {
      T.done = true; T.item.solved = 0;
      tm.className = 'msg bad'; tm.textContent = `Chưa đúng. Nước tốt nhất là ${bestNote}. Mũi tên xanh chỉ nước đó.`;
      S.hint = { fenKey: posKey(pos), move: best, pv: [best] };
    } else {
      tm.className = 'msg bad'; tm.textContent = `${note} chưa phải nước tốt. Thử thêm một lần nữa.`;
    }
    store.set(MIST_KEY, mistakes);
    S.selected = -1;
    renderLearnInfo(); render();
  }
  function exitTrain() {
    if (!S.train) return;
    S.train = null; S.flipped = S.human === 1 && S.mode === 'play';
    $('btnTrainNext').hidden = true; $('btnTrainExit').hidden = true; $('trainMsg').hidden = true;
    afterChange();
  }
  $('btnTrain').onclick = startTrain;
  $('btnTrainNext').onclick = startTrain;
  $('btnTrainExit').onclick = exitTrain;

  // ---------- Bộ nhớ: xuất / nhập ----------
  async function copyText(text, msgEl) {
    try { await navigator.clipboard.writeText(text); msgEl.textContent = 'Đã sao chép.'; }
    catch (e) { msgEl.textContent = 'Không sao chép tự động được, hãy chọn chữ trong ô và sao chép tay.'; }
    msgEl.hidden = false;
  }
  $('btnMemExport').onclick = () => {
    const ta = $('memText'); ta.hidden = false;
    ta.value = JSON.stringify({ memory, mistakes });
    ta.select();
    copyText(ta.value, $('memMsg'));
  };
  $('btnMemImport').onclick = () => {
    const ta = $('memText');
    if (ta.hidden || !ta.value.trim()) { ta.hidden = false; ta.value = ''; ta.focus(); $('memMsg').hidden = false; $('memMsg').textContent = 'Dán dữ liệu đã xuất vào ô rồi bấm “Nhập bộ nhớ” lần nữa.'; return; }
    try {
      const d = JSON.parse(ta.value);
      let n = 0;
      for (const k in (d.memory || {})) { if (!memory[k] || memory[k].d < d.memory[k].d) { memory[k] = d.memory[k]; n++; } }
      for (const m of (d.mistakes || [])) if (!mistakes.some((x) => x.fen === m.fen)) mistakes.push(m);
      store.set(MEM_KEY, memory); store.set(MIST_KEY, mistakes);
      $('memMsg').textContent = `Đã nhập ${n} thế cờ.`; ta.hidden = true;
    } catch (e) { $('memMsg').textContent = 'Dữ liệu không đúng định dạng. Hãy dán nguyên văn nội dung đã xuất.'; }
    $('memMsg').hidden = false; renderLearnInfo();
  };
  let clearArmed = false;
  $('btnMemClear').onclick = () => {
    if (!clearArmed) { clearArmed = true; $('btnMemClear').textContent = 'Bấm lần nữa để xoá hết'; setTimeout(() => { clearArmed = false; $('btnMemClear').textContent = 'Xoá bộ nhớ'; }, 3000); return; }
    memory = {}; mistakes = []; store.set(MEM_KEY, memory); store.set(MIST_KEY, mistakes);
    clearArmed = false; $('btnMemClear').textContent = 'Xoá bộ nhớ'; renderLearnInfo();
  };

  // ---------- Xếp cờ ----------
  const PAL = [8, 9, 10, 11, 12, 13, 14, 16, 17, 18, 19, 20, 21, 22];
  const NAME = (pc) => (pc < 16 ? 'Đỏ ' : 'Đen ') + X.VN_NAME[pc & 7].toLowerCase();
  function buildPalette() {
    const box = $('palette');
    for (const pc of PAL) {
      const b = document.createElement('button');
      b.className = pc < 16 ? 'r' : 'b'; b.textContent = HAN[pc]; b.title = NAME(pc); b.setAttribute('aria-label', NAME(pc));
      b.setAttribute('aria-pressed', String(pc === S.edPiece));
      b.onclick = () => { S.edPiece = pc; for (const o of box.children) o.setAttribute('aria-pressed', String(o === b)); };
      box.appendChild(b);
    }
  }
  function allowed(pc, sq) {
    const sd = pc < 16 ? 0 : 1, t = pc & 7;
    const c = (sq & 15) - 3, r = (sq >> 4) - 3;
    const rr = sd === 0 ? r : 9 - r; // hàng tính từ phía Đen của bên đó (9 = hàng cuối của mình)
    if (t === X.KING) return X.IN_FORT[sq] && rr >= 7;
    if (t === X.ADVISOR) return X.IN_FORT[sq] && rr >= 7 && ((c + rr) % 2 === 0);
    if (t === X.BISHOP) return [[2, 9], [6, 9], [0, 7], [4, 7], [8, 7], [2, 5], [6, 5]].some(([a, b]) => a === c && b === rr);
    if (t === X.PAWN) return rr <= 4 || (rr <= 6 && c % 2 === 0);
    return true;
  }
  function editClick(sq) {
    const b = S.edBoard;
    const msg = $('edMsg');
    if (b[sq] && b[sq] === S.edPiece) { b[sq] = 0; msg.hidden = true; return render(); }
    if (!allowed(S.edPiece, sq)) { msg.hidden = false; msg.textContent = `${NAME(S.edPiece)} không thể đứng ở vị trí đó.`; return; }
    if ((S.edPiece & 7) === X.KING) for (let i = 0; i < 256; i++) if (b[i] === S.edPiece) b[i] = 0;
    b[sq] = S.edPiece; msg.hidden = true;
    render();
  }
  function startEdit() {
    if (S.editing) return;
    exitTrain(); engine.cancel();
    S.editing = true; S.edBoard = currentPos().board.slice(); S.edSide = currentPos().sd;
    setPressed('edRed', 'edBlack', S.edSide === 0);
    render();
  }
  function edFen() {
    const p = new X.Position(); p.board = S.edBoard; p.sd = S.edSide;
    return p.toFen();
  }
  function loadPosition(fen, moves) {
    const p = new X.Position().fromFen(fen);
    let rk = 0, bk = 0;
    for (let i = 0; i < 256; i++) { if (p.board[i] === 8) rk++; if (p.board[i] === 16) bk++; }
    if (rk !== 1 || bk !== 1) throw new Error('Mỗi bên phải có đúng một Tướng.');
    const opp = p.clone(); opp.changeSide();
    if (opp.checked()) throw new Error('Bên vừa đi xong đang bị chiếu, thế cờ này không hợp lệ. Hãy đổi bên đi trước.');
    const notes = [], cur = p.clone();
    for (const mv of moves || []) {
      if (!cur.legalMove(mv)) throw new Error(`Nước thứ ${notes.length + 1} (${X.moveToIccs(mv)}) không hợp lệ.`);
      notes.push(X.moveToVN(cur, mv)); cur.makeMove(mv);
    }
    exitTrain();
    S.startFen = p.toFen(); S.moves = (moves || []).slice(); S.notes = notes; S.view = null; S.review = null; renderReview();
  }
  $('edRed').onclick = () => { startEdit(); S.edSide = 0; setPressed('edRed', 'edBlack', true); render(); };
  $('edBlack').onclick = () => { startEdit(); S.edSide = 1; setPressed('edRed', 'edBlack', false); render(); };
  $('btnEdStart').onclick = () => { startEdit(); S.edBoard = new X.Position().fromFen(X.START_FEN).board.slice(); render(); };
  $('btnEdClear').onclick = () => { startEdit(); S.edBoard = new Uint8Array(256); S.edBoard[X.COORD(7, 12)] = 8; S.edBoard[X.COORD(6, 3)] = 16; render(); };
  $('btnEdDone').onclick = () => {
    if (!S.editing) { startEdit(); return; }
    const msg = $('edMsg');
    try {
      const fen = edFen();
      S.editing = false;
      loadPosition(fen, []);
      $('fenText').value = fen;
      msg.hidden = false; msg.textContent = 'Đã dùng thế cờ mới. Sang tab “Đánh cờ” để chơi tiếp hoặc phân tích.';
      afterChange();
    } catch (e) { S.editing = true; msg.hidden = false; msg.textContent = e.message; }
  };
  $('palette').addEventListener('click', startEdit);
  $('btnFenLoad').onclick = () => {
    const msg = $('fenMsg'); msg.hidden = false;
    try { S.editing = false; loadPosition($('fenText').value, []); msg.textContent = 'Đã nạp FEN.'; afterChange(); }
    catch (e) { msg.textContent = 'Không nạp được: ' + e.message; }
  };
  $('btnFenCopy').onclick = () => { $('fenText').value = currentPos().toFen(); copyText($('fenText').value, $('fenMsg')); };
  $('btnIccsLoad').onclick = () => {
    const msg = $('fenMsg'); msg.hidden = false;
    try {
      const toks = $('iccsText').value.trim().split(/[\s,;]+/).filter((t) => t && !/^\d+\.$/.test(t));
      const mvs = toks.map((t) => { const m = X.iccsToMove(t); if (!m) throw new Error(`“${t}” không phải ký hiệu ICCS (ví dụ h2e2).`); return m; });
      S.editing = false;
      // biên bản thường tính từ thế ban đầu; nếu không khớp thì thử từ FEN trong ô phía trên
      try { loadPosition(X.START_FEN, mvs); }
      catch (e1) { const fen = $('fenText').value.trim(); if (!fen) throw e1; try { loadPosition(fen, mvs); } catch (e2) { throw e1; } }
      msg.textContent = `Đã nạp ${mvs.length} nước. Sang tab “Học & phân tích” để chấm điểm ván.`;
      afterChange();
    } catch (e) { msg.textContent = 'Không nạp được: ' + e.message; }
  };
  $('btnIccsCopy').onclick = () => { $('iccsText').value = S.moves.map(X.moveToIccs).join(' '); copyText($('iccsText').value, $('fenMsg')); };

  // ---------- Lưu ván ----------
  function saveGame() { store.set('kythu.game', { fen: S.startFen, moves: S.moves.map(X.moveToIccs), mode: S.mode, human: S.human }); }
  function restore() {
    const g = store.get('kythu.game', null);
    S.time = store.get('kythu.time', 3000);
    $('thinkTime').value = String(S.time);
    if (!g) return;
    try {
      loadPosition(g.fen, g.moves.map(X.iccsToMove));
      S.mode = g.mode === 'analyze' ? 'analyze' : 'play';
      S.human = g.human === 1 ? 1 : 0; S.flipped = S.human === 1;
      setPressed('sideRed', 'sideBlack', S.human === 0);
      setPressed('modePlay', 'modeAnalyze', S.mode === 'play');
      $('sideRow').hidden = S.mode !== 'play';
    } catch (e) { S.startFen = X.START_FEN; S.moves = []; S.notes = []; }
  }

  // Ván mẫu khi mở lần đầu: một khai cuộc Pháo đầu đối Bình phong mã
  function seedSample() {
    if (store.get('kythu.game', null)) return;
    try { loadPosition(X.START_FEN, 'h2e2 h9g7 h0g2 i9h9 i0h0 b9c7'.split(' ').map(X.iccsToMove)); } catch (e) { }
  }

  // ---------- Khởi động ----------
  buildPalette();
  restore();
  seedSample();
  renderLearnInfo();
  render();
  engine.init().then(() => {
    $('engineMode').textContent = engine.mode === 'worker' ? 'Máy tính ở luồng riêng, giao diện không bị đứng.' : 'Máy tính trên luồng chính (tối đa 4 giây).';
    afterChange();
  });
})();
