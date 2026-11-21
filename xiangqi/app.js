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
        if (await tryWorker(w)) { this.url = 'engine.js'; return this.attach(w); }
      } catch (e) { /* thử cách khác */ }
      try {
        const src = await (await fetch('engine.js')).text();
        const url = URL.createObjectURL(new Blob([src], { type: 'text/javascript' }));
        const w = new Worker(url);
        if (await tryWorker(w)) { this.url = url; return this.attach(w); }
      } catch (e) { /* luồng chính */ }
      this.mode = 'main';
      return this;
    }
    attach(w) {
      this.worker = w; this.mode = 'worker';
      w.onmessage = (e) => this.onMsg(e.data);
      w.onerror = () => { };
      return this;
    }
    onMsg(m) {
      const c = this.cur;
      if (!c || m.id !== c.id) return;
      if (m.type === 'info' && c.onInfo) c.onInfo(m.info, m.k || 0);
      if (m.type === 'done') { this.cur = null; c.resolve(m.result); }
    }
    cancel() {
      if (!this.cur) return;
      const c = this.cur; this.cur = null;
      if (this.worker) { this.worker.terminate(); this.attach(new Worker(this.url)); }
      c.resolve(null);
    }
    run(msg, onInfo) {
      this.cancel();
      return new Promise((resolve) => {
        const id = ++this.seq;
        this.cur = { id, resolve, onInfo };
        if (this.worker) { this.worker.postMessage({ ...msg, id }); return; }
        setTimeout(() => {
          if (!this.cur || this.cur.id !== id) return;
          if (!this.local) this.local = new X.Searcher();
          const pos = new X.Position().fromFen(msg.fen);
          for (const mv of msg.moves) pos.makeMove(mv);
          const time = Math.min(msg.time, 4000);
          const r = msg.cmd === 'multi'
            ? X.multiPV(this.local, pos, time, msg.n, (k, info) => onInfo && onInfo(info, k))
            : this.local.think(pos, { time, onInfo: (info) => onInfo && onInfo(info, 0), fullOnForced: !!msg.full });
          if (this.cur && this.cur.id === id) { this.cur = null; resolve(r); }
        }, 30);
      });
    }
    search(fen, moves, time, onInfo, full) { return this.run({ cmd: 'search', fen, moves, time, full: !!full }, onInfo); }
    multi(fen, moves, time, n, onInfo) { return this.run({ cmd: 'multi', fen, moves, time, n }, onInfo); }
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
    selected: -1, hint: null, analysis: null, review: null, thinking: false, op: null, opSide: 0, autoHint: true, autoFlip: false, autoPaused: false,
    anim: null, animKey: '', prevVi: -1,
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
    if (S.op) return S.op.pos;
    if (S.train) return S.train.pos;
    return buildPos(viewIndex());
  }

  function gameResult(pos) {
    if (pos.mvList.length > 400) return { winner: -1, text: 'Hoà — ván cờ đã quá 200 nước.' };
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
  const CELL = 56, OX = 36, OY = 46, BW = 520, BH = 596;
  const HAN = { 8: '帥', 9: '仕', 10: '相', 11: '傌', 12: '俥', 13: '炮', 14: '兵', 16: '將', 17: '士', 18: '象', 19: '馬', 20: '車', 21: '砲', 22: '卒' };
  const PIECE_PTS = [0, 2, 2, 4, 9, 4.5, 1];
  const CAND_COLORS = ['var(--jade)', '#3b82a6', '#8a6bb8'];
  const ANIM_MS = 240;
  let reduceMotion = false;
  try { reduceMotion = matchMedia('(prefers-reduced-motion: reduce)').matches; } catch (e) { }

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

  let layers = null, layersFlip = null;
  function ensureStatic() {
    if (layers && layersFlip === S.flipped) return layers;
    const svg = $('board');
    svg.textContent = '';
    const defs = el('defs', {}, svg);
    defs.innerHTML = `
      <linearGradient id="gFrame" x1="0" y1="0" x2="1" y2="1"><stop offset="0" style="stop-color:var(--frame-1)"/><stop offset="1" style="stop-color:var(--frame-2)"/></linearGradient>
      <linearGradient id="gWood" x1="0" y1="0" x2="0.3" y2="1"><stop offset="0" style="stop-color:var(--wood-1)"/><stop offset="1" style="stop-color:var(--wood-2)"/></linearGradient>
      <filter id="fGrain" x="0" y="0" width="100%" height="100%" color-interpolation-filters="sRGB">
        <feTurbulence type="fractalNoise" baseFrequency="0.004 0.09" numOctaves="3" seed="11"/>
        <feColorMatrix type="matrix" values="0 0 0 0 0.42  0 0 0 0 0.24  0 0 0 0 0.08  0 0 0 -1.1 0.62"/>
        <feComposite in2="SourceGraphic" operator="in"/>
      </filter>
      <radialGradient id="gPiece" cx="0.38" cy="0.3" r="0.78"><stop offset="0" style="stop-color:var(--ivory-1)"/><stop offset="1" style="stop-color:var(--ivory-2)"/></radialGradient>
      <linearGradient id="gRim" x1="0" y1="0" x2="0" y2="1"><stop offset="0" style="stop-color:var(--ivory-1)"/><stop offset="1" style="stop-color:var(--ivory-edge)"/></linearGradient>
      <filter id="fShadow" x="-40%" y="-40%" width="180%" height="190%"><feDropShadow dx="0" dy="2.6" stdDeviation="1.8" flood-color="#2a1404" flood-opacity="0.5"/></filter>
      <filter id="fLift" x="-50%" y="-50%" width="200%" height="220%"><feDropShadow dx="0" dy="8" stdDeviation="4" flood-color="#2a1404" flood-opacity="0.42"/></filter>
      <radialGradient id="gHalo"><stop offset="0.55" stop-color="#17855d" stop-opacity="0.45"/><stop offset="1" stop-color="#17855d" stop-opacity="0"/></radialGradient>`;
    // khung gỗ trắc + mặt gỗ
    el('rect', { x: 0, y: 0, width: BW, height: BH, rx: 18, fill: 'url(#gFrame)' }, svg);
    el('rect', { x: 9, y: 21, width: BW - 18, height: BH - 42, rx: 7, fill: 'none', stroke: 'var(--gold)', 'stroke-width': 1, opacity: .55 }, svg);
    el('rect', { x: 13, y: 25, width: BW - 26, height: BH - 50, rx: 5, fill: 'url(#gWood)' }, svg);
    el('rect', { x: 13, y: 25, width: BW - 26, height: BH - 50, rx: 5, fill: '#fff', filter: 'url(#fGrain)', opacity: .5 }, svg);
    const g = el('g', { stroke: 'var(--wood-line)', 'stroke-width': 1.3, fill: 'none', 'stroke-linecap': 'square' }, svg);
    el('rect', { x: OX - 6, y: OY - 6, width: 8 * CELL + 12, height: 9 * CELL + 12, 'stroke-width': 2.4 }, g);
    el('rect', { x: OX, y: OY, width: 8 * CELL, height: 9 * CELL, 'stroke-width': 1.5 }, g);
    for (let r = 1; r < 9; r++) el('line', { x1: OX, y1: OY + r * CELL, x2: OX + 8 * CELL, y2: OY + r * CELL }, g);
    for (let c = 1; c < 8; c++) {
      el('line', { x1: OX + c * CELL, y1: OY, x2: OX + c * CELL, y2: OY + 4 * CELL }, g);
      el('line', { x1: OX + c * CELL, y1: OY + 5 * CELL, x2: OX + c * CELL, y2: OY + 9 * CELL }, g);
    }
    for (const r0 of [0, 7]) {
      el('line', { x1: OX + 3 * CELL, y1: OY + r0 * CELL, x2: OX + 5 * CELL, y2: OY + (r0 + 2) * CELL }, g);
      el('line', { x1: OX + 5 * CELL, y1: OY + r0 * CELL, x2: OX + 3 * CELL, y2: OY + (r0 + 2) * CELL }, g);
    }
    const marks = [[1, 2], [7, 2], [1, 7], [7, 7], [0, 3], [2, 3], [4, 3], [6, 3], [8, 3], [0, 6], [2, 6], [4, 6], [6, 6], [8, 6]];
    for (const [c, r] of marks) {
      const x = OX + c * CELL, y = OY + r * CELL, d = 4, l = 9;
      for (const sx of [-1, 1]) for (const sy of [-1, 1]) {
        if ((c === 0 && sx < 0) || (c === 8 && sx > 0)) continue;
        el('polyline', { points: `${x + sx * (d + l)},${y + sy * d} ${x + sx * d},${y + sy * d} ${x + sx * d},${y + sy * (d + l)}`, 'stroke-width': 1.1 }, g);
      }
    }
    const t = el('g', { fill: 'var(--wood-line)', 'font-family': 'var(--font-han)', 'font-weight': 900, 'font-size': 27, 'text-anchor': 'middle', 'dominant-baseline': 'central', opacity: .62 }, svg);
    const ry = OY + 4.5 * CELL;
    [['楚', 1.4], ['河', 2.5], ['漢', 5.5], ['界', 6.6]].forEach(([ch, c]) => { el('text', { x: OX + c * CELL, y: ry }, t).textContent = ch; });
    // số cột: mỗi bên đánh số từ phải sang trái theo phía mình
    const n = el('g', { fill: 'var(--frame-text)', 'font-family': 'var(--font-mono)', 'font-weight': 700, 'font-size': 11, 'text-anchor': 'middle', 'dominant-baseline': 'central', opacity: .9 }, svg);
    for (let c = 0; c < 9; c++) {
      el('text', { x: OX + c * CELL, y: 11.5 }, n).textContent = c + 1;
      el('text', { x: OX + c * CELL, y: BH - 11.5 }, n).textContent = 9 - c;
    }
    const dyn = el('g', {}, svg);
    layers = { svg, dyn }; layersFlip = S.flipped;
    return layers;
  }

  function drawPiece(parent, pc, x, y, opts) {
    opts = opts || {};
    const isRed = pc < 16;
    const color = isRed ? 'var(--red)' : 'var(--ink)';
    const g = el('g', { class: 'pc', transform: `translate(${x},${y})` }, parent);
    const inner = el('g', opts.lift ? { transform: 'translate(0,-4) scale(1.06)' } : {}, g);
    if (opts.lift) el('circle', { r: 36, fill: 'url(#gHalo)' }, inner);
    const body = el('g', { filter: opts.lift ? 'url(#fLift)' : 'url(#fShadow)' }, inner);
    el('circle', { r: 25.5, fill: 'url(#gRim)' }, body);
    el('circle', { r: 23, fill: 'url(#gPiece)' }, body);
    el('circle', { r: 19.6, fill: 'none', stroke: color, 'stroke-width': 1.5, opacity: .8 }, inner);
    const tx = el('text', { 'text-anchor': 'middle', 'dominant-baseline': 'central', 'font-family': 'var(--font-han)', 'font-size': 26, 'font-weight': 900, fill: color, y: 1 }, inner);
    tx.textContent = HAN[pc];
    if (opts.check) el('circle', { r: 28.5, fill: 'none', stroke: 'var(--bad)', 'stroke-width': 3.5, class: 'checkring' }, g);
    return g;
  }

  function arrow(parent, mv, color, width, opacity, label, dashed) {
    const [x1, y1] = sqXY(X.SRC(mv)), [x2, y2] = sqXY(X.DST(mv));
    const dx = x2 - x1, dy = y2 - y1, len = Math.hypot(dx, dy);
    const ux = dx / len, uy = dy / len, px = -uy, py = ux;
    const sx = x1 + ux * 12, sy = y1 + uy * 12, ex = x2 - ux * 20, ey = y2 - uy * 20;
    const hx = x2 - ux * 6, hy = y2 - uy * 6, hw = width * 1.6 + 3;
    const g = el('g', { opacity, 'pointer-events': 'none' }, parent);
    const shaft = { x1: sx, y1: sy, x2: ex, y2: ey, 'stroke-linecap': 'round' };
    el('line', { ...shaft, stroke: 'rgba(255,255,255,.55)', 'stroke-width': width + 3, ...(dashed ? { 'stroke-dasharray': '2 9' } : {}) }, g);
    el('line', { ...shaft, stroke: color, 'stroke-width': width, ...(dashed ? { 'stroke-dasharray': '2 9' } : {}) }, g);
    el('polygon', { points: `${hx},${hy} ${ex + px * hw},${ey + py * hw} ${ex - px * hw},${ey - py * hw}`, fill: color, stroke: 'rgba(255,255,255,.55)', 'stroke-width': 1.5, 'stroke-linejoin': 'round' }, g);
    if (label) {
      const short = len < 80;
      const mx = short ? x1 + 19 : sx + (ex - sx) * 0.4, my = short ? y1 - 19 : sy + (ey - sy) * 0.4;
      el('circle', { cx: mx, cy: my, r: 10, fill: color, stroke: '#fff', 'stroke-width': 2 }, g);
      const t = el('text', { x: mx, y: my + 0.5, 'text-anchor': 'middle', 'dominant-baseline': 'central', fill: '#fff', 'font-family': 'var(--font-ui)', 'font-weight': 800, 'font-size': 12 }, g);
      t.textContent = label;
    }
  }

  function render() {
    const { dyn } = ensureStatic();
    dyn.textContent = '';
    const pos = S.editing ? null : currentPos();
    const board = S.editing ? S.edBoard : pos.board;
    const vi = S.op ? S.op.idx : viewIndex();
    const last = S.op ? S.op.last : S.train || S.editing ? 0 : (vi > 0 ? S.moves[vi - 1] : 0);

    // hoạt cảnh quân trượt khi vừa đi một nước
    const animKey = S.train ? 'train' : (S.op ? 'op' : '') + vi + ':' + last;
    if (animKey !== S.animKey) {
      if (last && S.prevVi === vi - 1 && !reduceMotion) S.anim = { key: animKey, mv: last, t0: performance.now() };
      S.animKey = animKey;
    }
    S.prevVi = S.train ? -1 : vi;

    if (last) {
      const [sx, sy] = sqXY(X.SRC(last)), [dx, dy] = sqXY(X.DST(last));
      el('circle', { cx: sx, cy: sy, r: 9, fill: 'none', stroke: 'var(--gold)', 'stroke-width': 2.5, opacity: .9 }, dyn);
      el('circle', { cx: dx, cy: dy, r: 30, fill: 'var(--gold)', opacity: .35 }, dyn);
    }
    const inCheckSide = !S.editing && pos.inCheck() ? pos.sd : -1;
    const pieceLayer = el('g', {}, dyn);
    let animated = null;
    for (let sq = 0; sq < 256; sq++) {
      const pc = board[sq];
      if (!pc || sq === S.selected) continue;
      const [x, y] = sqXY(sq);
      const isKingInCheck = (pc & 7) === X.KING && (pc < 16 ? 0 : 1) === inCheckSide;
      const g = drawPiece(pieceLayer, pc, x, y, { check: isKingInCheck });
      if (S.anim && S.anim.key === animKey && sq === X.DST(S.anim.mv)) animated = { g, x, y };
    }
    if (S.selected >= 0 && board[S.selected]) {
      const [x, y] = sqXY(S.selected);
      drawPiece(pieceLayer, board[S.selected], x, y, { lift: true });
    }
    if (animated && animated.g.animate) {
      const el0 = performance.now() - S.anim.t0;
      if (el0 < ANIM_MS) {
        const [sx, sy] = sqXY(X.SRC(S.anim.mv));
        const p = el0 / ANIM_MS;
        const fx = sx + (animated.x - sx) * p, fy = sy + (animated.y - sy) * p;
        pieceLayer.appendChild(animated.g);
        animated.g.animate([{ transform: `translate(${fx}px,${fy}px)` }, { transform: `translate(${animated.x}px,${animated.y}px)` }],
          { duration: ANIM_MS - el0, easing: 'cubic-bezier(.2,.75,.25,1)' });
      } else S.anim = null;
    }

    if (!S.editing && S.selected >= 0) {
      for (const mv of pos.legalMoves()) {
        if (X.SRC(mv) !== S.selected) continue;
        const [x, y] = sqXY(X.DST(mv));
        if (pos.board[X.DST(mv)]) el('circle', { cx: x, cy: y, r: 28, fill: 'none', stroke: 'var(--jade)', 'stroke-width': 3.5, 'stroke-dasharray': '7 5', 'pointer-events': 'none' }, dyn);
        else el('circle', { cx: x, cy: y, r: 8, fill: 'var(--jade)', stroke: '#fff', 'stroke-width': 2, opacity: .9, 'pointer-events': 'none' }, dyn);
      }
    }
    if (!S.editing && S.hint && S.hint.fenKey === posKey(pos)) {
      const cs = S.hint.cands, sel = S.hint.sel || 0;
      const many = cs.length > 1;
      for (let k = cs.length - 1; k >= 0; k--) if (k !== sel) arrow(dyn, cs[k].move, CAND_COLORS[k % 3], 5, .5, many ? String(k + 1) : '');
      const c = cs[sel];
      if (c) {
        if (c.pv && c.pv[1]) arrow(dyn, c.pv[1], 'var(--muted)', 4, .7, '', true);
        arrow(dyn, c.move, CAND_COLORS[sel % 3], 7.5, .95, many ? String(sel + 1) : '');
      }
    }
    renderStatus(pos);
  }

  // ---------- Thanh người chơi, trạng thái ----------
  function countPieces(board) {
    const n = [new Array(7).fill(0), new Array(7).fill(0)];
    for (let sq = 0; sq < 256; sq++) { const pc = board[sq]; if (pc) n[pc < 16 ? 0 : 1][pc & 7]++; }
    return n;
  }
  const sideName = (sd) => (S.op ? (sd === S.op.o.side ? 'Bạn' : 'Đối thủ (theo sách)') + (sd === 0 ? ' · Đỏ' : ' · Đen')
    : S.train || S.editing ? (sd === 0 ? 'Quân Đỏ' : 'Quân Đen')
    : S.mode === 'play' ? (sd === S.human ? 'Bạn' : 'Máy') + (sd === 0 ? ' · Đỏ' : ' · Đen')
    : S.mode === 'auto' ? (sd === 0 ? 'Máy · Đỏ' : 'Máy · Đen')
    : (sd === 0 ? 'Quân Đỏ' : 'Quân Đen'));

  function renderPlayers(pos) {
    const board = S.editing ? S.edBoard : pos.board;
    const now = countPieces(board);
    const start = S.editing ? now : countPieces(new X.Position().fromFen(S.op ? X.START_FEN : S.train ? S.train.fen : S.startFen).board);
    const pts = [0, 1].map((sd) => now[sd].reduce((a, c, t) => a + c * PIECE_PTS[t], 0));
    const over = !S.editing && !S.train && !S.op && gameResult(pos);
    const topSd = S.flipped ? 0 : 1;
    for (const [id, sd] of [['stripTop', topSd], ['stripBottom', 1 - topSd]]) {
      const opp = 1 - sd;
      let caps = '';
      for (const t of [X.ROOK, X.CANNON, X.KNIGHT, X.BISHOP, X.ADVISOR, X.PAWN]) {
        const lost = Math.max(0, start[opp][t] - now[opp][t]);
        for (let i = 0; i < lost; i++) caps += `<span class="${opp === 0 ? 'r' : 'b'}">${HAN[(opp === 0 ? 8 : 16) + t]}</span>`;
      }
      const diff = pts[sd] - pts[opp];
      if (diff > 0) caps += `<span class="adv">+${Number.isInteger(diff) ? diff : diff.toFixed(1)}</span>`;
      const active = !S.editing && !over && pos.sd === sd;
      let flags = '';
      if (active) {
        if (pos.inCheck()) flags += '<span class="flag check">Bị chiếu</span>';
        if (S.thinking) flags += `<span class="flag think">${(S.mode === 'play' && sd !== S.human) || (S.mode === 'auto' && !S.autoPaused) ? 'Đang nghĩ' : 'Đang tính'}</span>`;
        else flags += '<span class="flag turn">Đến lượt</span>';
      }
      const box = $(id);
      box.className = 'player' + (active ? ' active' : '');
      box.innerHTML = `<div class="avatar ${sd === 0 ? 'r' : 'b'}">${sd === 0 ? '帥' : '將'}</div>` +
        `<div class="pinfo"><div class="pname">${sideName(sd)} ${flags}</div><div class="captured" title="Quân đã ăn được">${caps || '<span class="muted" style="font-family:var(--font-ui);font-size:12px">Chưa ăn quân nào</span>'}</div></div>`;
    }
  }

  function setThinking(v) {
    S.thinking = v;
    if (!S.editing) renderPlayers(currentPos());
  }

  function renderStatus(pos) {
    renderPlayers(pos);
    if (S.editing) { $('turnText').textContent = 'Đang xếp cờ · chọn quân bên tab “Xếp cờ”'; return; }
    const tag = detectOpening();
    $('openingTag').hidden = !tag; $('openingTag').textContent = tag;
    let t = (pos.sd === 0 ? 'Đỏ' : 'Đen') + ' đi';
    if (S.op) {
      $('turnText').textContent = `${t} · bài khai cuộc, nước ${S.op.idx}/${S.op.o.moves.length}`;
      $('gameMsg').hidden = true; renderFacts(pos); renderMoveList();
      return;
    }
    if (S.train) t += ' · đang luyện tập';
    else if (S.view != null) t += ` · đang xem lại nước ${S.view}/${S.moves.length}`;
    else t += ` · nước thứ ${Math.floor(S.moves.length / 2) + 1}`;
    $('turnText').textContent = t;
    const res = S.train ? null : gameResult(pos);
    const gm = $('gameMsg');
    if (res) { gm.hidden = false; gm.textContent = res.text; } else gm.hidden = true;
    renderFacts(pos);
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

  // ---------- Đánh giá điểm & nước gợi ý ----------
  const TYPE_NAME = ['Tướng', 'Sĩ', 'Tượng', 'Mã', 'Xe', 'Pháo', 'Tốt'];
  function redScore(score, sd) { return sd === 0 ? score : -score; }
  function fmtScore(red) {
    if (Math.abs(red) > X.WIN) { const n = Math.max(1, Math.ceil((X.MATE - Math.abs(red)) / 2)); return (red > 0 ? '+' : '−') + 'M' + n; }
    const v = (Math.abs(red) / 100).toFixed(2);
    return (red > 0 ? '+' : red < 0 ? '−' : '') + v;
  }
  function verdict(red) {
    const a = Math.abs(red), who = red > 0 ? 'Đỏ' : 'Đen', other = red > 0 ? 'Đen' : 'Đỏ';
    if (a > X.WIN) { const n = Math.max(1, Math.ceil((X.MATE - a) / 2)); return [`${who} thắng`, `${who} chiếu bí được sau ${n} nước nếu đi đúng.`]; }
    if (a < 30) return ['Cân bằng', 'Hai bên ngang ngửa, chưa ai hơn ai.'];
    if (a < 100) return [`${who} nhỉnh hơn một chút`, `Hơn kém rất ít, ${other} vẫn chơi thoải mái.`];
    if (a < 250) return [`${who} có ưu thế`, `${other} cần chơi cẩn thận, tránh mất thêm.`];
    if (a < 600) return [`${who} ưu thế lớn`, `Tương đương hơn khoảng một quân Mã hoặc Pháo.`];
    return [`${who} gần như thắng`, `Chênh lệch rất lớn, ${other} khó gỡ.`];
  }

  // Những điều thấy được trên bàn, không cần máy tính: quân hơn kém, tốt qua sông, đang bị chiếu
  function renderFacts(pos) {
    const box = $('evalFacts');
    const n = countPieces(pos.board);
    const facts = [];
    const diffs = [];
    for (const t of [X.ROOK, X.KNIGHT, X.CANNON, X.PAWN, X.ADVISOR, X.BISHOP]) {
      const d = n[0][t] - n[1][t];
      if (d) diffs.push(`${d > 0 ? 'Đỏ' : 'Đen'} hơn ${Math.abs(d)} ${TYPE_NAME[t]}`);
    }
    facts.push(diffs.length ? diffs.join(', ') : 'Quân hai bên bằng nhau');
    let cross = [0, 0];
    for (let sq = 0; sq < 256; sq++) {
      const pc = pos.board[sq];
      if ((pc & 7) !== X.PAWN || !pc) continue;
      const sd = pc < 16 ? 0 : 1;
      if (!X.HOME_HALF(sq, sd)) cross[sd]++;
    }
    for (const sd of [0, 1]) if (cross[sd]) facts.push(`${sd === 0 ? 'Đỏ' : 'Đen'} có ${cross[sd]} tốt qua sông`);
    if (pos.inCheck()) facts.push(`${pos.sd === 0 ? 'Đỏ' : 'Đen'} đang bị chiếu`);
    facts.push(`${pos.legalMoves().length} nước đi hợp lệ`);
    box.innerHTML = facts.map((f) => `<span class="fact">${f}</span>`).join('');
  }

  function describeMove(pos, mv) {
    const cap = pos.board[X.DST(mv)];
    const pc = pos.board[X.SRC(mv)];
    const p = pos.clone(); p.makeMove(mv);
    const parts = [];
    if (p.legalMoves().length === 0) parts.push('chiếu bí');
    else if (p.inCheck()) parts.push('chiếu tướng');
    if (cap) parts.push('ăn ' + TYPE_NAME[cap & 7]);
    const sd = pc < 16 ? 0 : 1;
    if ((pc & 7) === X.PAWN && X.HOME_HALF(X.SRC(mv), sd) && !X.HOME_HALF(X.DST(mv), sd)) parts.push('tốt qua sông');
    if (!parts.length) {
      const t = pc & 7;
      const startRow = sd === 0 ? 12 : 3;
      if ((t === X.KNIGHT || t === X.ROOK) && (X.SRC(mv) >> 4) === startRow) parts.push('ra quân');
      else if (t === X.CANNON && ((X.DST(mv) & 15) === 7)) parts.push('pháo về giữa');
      else if (t === X.ADVISOR || t === X.BISHOP || t === X.KING) parts.push('củng cố phòng thủ');
    }
    return parts.join(', ');
  }

  function renderEvalCard(pos) {
    const big = $('evalBig');
    const h = S.hint && S.hint.fenKey === posKey(pos) && S.hint.scored ? S.hint : null;
    if (!h) {
      big.textContent = '—'; big.className = 'bignum even';
      $('evalWords').textContent = S.thinking ? 'Đang tính…' : 'Chưa chấm điểm';
      $('evalSub').textContent = S.thinking ? 'Máy đang tính các phương án.' : 'Bấm “Gợi ý nước đi” để máy chấm điểm thế cờ này.';
      return;
    }
    const red = redScore(h.cands[0].score, pos.sd);
    big.textContent = fmtScore(red);
    big.className = 'bignum ' + (Math.abs(red) < 30 ? 'even' : red > 0 ? 'red' : 'black');
    const [w, sub] = verdict(red);
    $('evalWords').textContent = w;
    $('evalSub').textContent = sub + ' (Điểm tính theo tốt: +1.00 ≈ Đỏ hơn một con tốt.)';
  }

  function renderCands(pos) {
    const box = $('cands');
    const h = S.hint && S.hint.fenKey === posKey(pos) ? S.hint : null;
    box.textContent = '';
    if (!h || !h.cands.length) {
      const d = document.createElement('div'); d.className = 'empty';
      d.textContent = S.thinking ? 'Máy đang tìm nước đi…' : 'Chưa có gợi ý. Bấm “Gợi ý nước đi”.';
      box.appendChild(d); return;
    }
    const bestRed = redScore(h.cands[0].score, pos.sd);
    h.cands.forEach((c, k) => {
      const b = document.createElement('button');
      b.type = 'button'; b.className = 'cand'; b.setAttribute('aria-pressed', String(k === (h.sel || 0)));
      const p = pos.clone(); const line = [];
      for (const mv of (c.pv || []).slice(0, 7)) { if (!p.legalMove(mv)) break; line.push(X.moveToVN(p, mv)); p.makeMove(mv); }
      const why = describeMove(pos, c.move);
      const red = redScore(c.score, pos.sd);
      let scoreTxt = h.scored ? fmtScore(red) : '';
      const gap = h.scored && k > 0 ? Math.abs(bestRed - red) : 0;
      b.innerHTML = `<span class="rank k${k % 3}">${k + 1}</span>` +
        `<span class="mv">${X.moveToVN(pos, c.move)}${why ? `<small class="why">${why}</small>` : ''}</span>` +
        `<span class="sc">${scoreTxt}</span>` +
        `<span class="line">${line.length > 1 ? 'Diễn biến: ' + line.slice(1).join('  ') : ''}${gap >= 5 && Math.abs(red) < X.WIN ? ` · kém nước 1 khoảng ${(gap / 100).toFixed(2)}` : ''}</span>`;
      b.onclick = () => { h.sel = k; render(); renderCands(pos); };
      box.appendChild(b);
    });
  }

  function showCands(pos, list, label) {
    if (!list || !list.length || !list[0].move) return;
    const key = posKey(pos);
    const sel = S.hint && S.hint.fenKey === key ? Math.min(S.hint.sel || 0, list.length - 1) : 0;
    S.hint = { fenKey: key, cands: list.map((r) => ({ move: r.move, score: r.score, pv: r.pv || [r.move], depth: r.depth })), sel, scored: true };
    const r = list[0];
    const nps = r.time ? Math.round(r.nodes / r.time) : 0;
    $('aMeta').textContent = label || (r.depth ? `độ sâu ${r.depth}${nps ? ` · ${nps}k thế/giây` : ''}` : '');
    $('candMeta').textContent = list.length > 1 ? `${list.length} phương án` : '';
    setEval(r.score, pos.sd);
    renderEvalCard(pos); renderCands(pos);
  }

  function clearAnalysis(msg) {
    S.hint = null;
    $('aMeta').textContent = msg || '';
    $('candMeta').textContent = '';
    const pos = currentPos();
    renderEvalCard(pos); renderCands(pos);
    const m = recall(pos);
    const mm = $('aMemory');
    if (m) { mm.hidden = false; mm.textContent = `Máy đã học thế này: ${X.moveToVN(pos, m.move)} (độ sâu ${m.depth}, ${fmtScore(redScore(m.score, pos.sd))}).`; }
    else mm.hidden = true;
  }

  async function analyze(time, multi) {
    const pos = currentPos();
    if (gameResult(pos) && !S.train) return null;
    const fen = S.train ? S.train.fen : S.startFen;
    const moves = S.train ? [] : S.moves.slice(0, viewIndex());
    const key = posKey(pos);
    const partial = [];
    setThinking(true); renderEvalCard(pos); renderCands(pos);
    let lastDraw = 0;
    const onInfo = (info, k) => {
      if (posKey(currentPos()) !== key) return;
      partial[k] = info;
      const list = []; for (const x of partial) { if (!x) break; list.push(x); }
      const now = performance.now();
      if (now - lastDraw < 120) return;
      lastDraw = now;
      showCands(pos, list); render();
    };
    const res = multi ? await engine.multi(fen, moves, time, 3, onInfo) : await engine.search(fen, moves, time, onInfo);
    if (!res) return null; // bị huỷ: lần phân tích mới đã thay chỗ
    setThinking(false);
    if (posKey(currentPos()) !== key) return null;
    const list = multi ? res : [res];
    if (!list.length || !list[0].move) return null;
    learn(pos, list[0]);
    showCands(pos, list);
    render();
    return list[0];
  }

  async function engineTurn() {
    const pos = currentPos();
    const engineSide = S.mode === 'play' ? pos.sd !== S.human : S.mode === 'auto' && !S.autoPaused;
    if (!engineSide || S.view != null || S.train || S.op || gameResult(pos)) return;
    const t0 = performance.now();
    const key = posKey(pos);
    let mv = bookMove(S.startFen, S.moves);
    if (mv && !pos.legalMove(mv)) mv = 0;
    let label = 'nước khai cuộc quen thuộc';
    if (!mv) {
      const mem = recall(pos);
      if (mem && mem.depth >= 9 && S.time <= 6000) { mv = mem.move; label = `nhớ từ lần phân tích trước (độ sâu ${mem.depth})`; showCands(pos, [{ ...mem, pv: [mem.move], nodes: 0, time: 0 }], label); }
    }
    if (!mv) {
      const r = await analyze(S.time, false);
      if (!r || posKey(currentPos()) !== key) return;
      mv = r.move;
      // máy tự đấu: giữ mỗi nước ít nhất 0,7 giây để người xem kịp theo dõi
      const wait = S.mode === 'auto' ? 700 - (performance.now() - t0) : 0;
      if (wait > 0) {
        setThinking(true);
        await new Promise((res) => setTimeout(res, wait));
        setThinking(false);
        if (posKey(currentPos()) !== key || (S.mode === 'auto' && S.autoPaused)) return;
      }
    } else {
      setThinking(true);
      await new Promise((res) => setTimeout(res, S.mode === 'auto' ? 700 : 400));
      setThinking(false);
      if (posKey(currentPos()) !== key || (S.mode === 'auto' && S.autoPaused)) return;
      $('aMeta').textContent = label;
    }
    doMove(mv, true);
  }

  // ---------- Đi quân ----------
  function doMove(mv, byEngine) {
    if (S.op) return opMove(mv);
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
    S.thinking = false;
    if (S.mode === 'two' && S.autoFlip && !S.train && !S.editing) S.flipped = currentPos().sd === 1;
    clearAnalysis('');
    render();
    saveGame();
    if (S.train || S.editing || S.op) return;
    const pos = currentPos();
    if (S.mode === 'auto') {
      if (!S.autoPaused && S.view == null) setTimeout(engineTurn, 60);
      else if (S.autoHint) setTimeout(() => analyze(S.time, true), 60);
      return;
    }
    const humanTurn = S.mode !== 'play' || S.view != null || pos.sd === S.human;
    if (S.mode === 'analyze' || (S.autoHint && humanTurn)) setTimeout(() => analyze(S.time, true), 60);
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
    if (S.op && S.op.drill && pos.sd !== S.op.o.side) return;
    if (!S.train && !S.op && gameResult(pos)) return;
    if (!S.train && !S.op && S.mode === 'play' && pos.sd !== S.human && S.view == null) return;
    if (!S.train && !S.op && S.mode === 'auto' && !S.autoPaused && S.view == null) return;
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
  function setSeg(ids, active) { for (const id of ids) $(id).setAttribute('aria-pressed', String(id === active)); }
  function syncControls() {
    setSeg(['modePlay', 'modeTwo', 'modeAuto', 'modeAnalyze'], { play: 'modePlay', two: 'modeTwo', auto: 'modeAuto', analyze: 'modeAnalyze' }[S.mode]);
    $('autoRow').hidden = S.mode !== 'auto';
    $('btnAutoPause').textContent = S.autoPaused ? 'Tiếp tục' : 'Tạm dừng';
    $('btnAutoPause').className = 'btn ' + (S.autoPaused ? 'jade' : '');
    setPressed('sideRed', 'sideBlack', S.human === 0);
    setPressed('flipOn', 'flipOff', S.autoFlip);
    $('sideRow').hidden = S.mode !== 'play';
    $('btnSwap').hidden = S.mode !== 'play';
    $('flipRow').hidden = S.mode !== 'two';
    renderModeHint();
  }
  function setMode(m) {
    S.mode = m;
    if (m === 'play') S.flipped = S.human === 1;
    syncControls();
    afterChange();
  }
  // Đổi bên giữa chừng: bạn nhận quân bên kia, máy cầm quân bạn vừa bỏ
  function setHuman(sd) {
    if (S.train) return;
    S.human = sd; S.flipped = sd === 1;
    syncControls();
    afterChange();
  }
  function renderModeHint() {
    const hint = S.autoHint ? ' Đến lượt nào, máy tự chấm điểm và gợi ý 3 nước tốt nhất cho bên đó.' : ' Bấm “Gợi ý nước đi” khi cần.';
    $('modeHint').textContent = S.mode === 'play'
      ? 'Bạn đi quân của mình, máy tự đáp lại. Bấm “Đổi bên” để đổi quân với máy bất cứ lúc nào.' + (S.autoHint ? ' Đến lượt bạn, máy tự gợi ý 3 nước tốt nhất.' : ' Bấm “Gợi ý nước đi” khi cần.')
      : S.mode === 'auto'
        ? 'Máy tự đi cho cả hai bên, bạn ngồi xem. Chỉnh “Máy nghĩ mỗi nước” để máy đánh nhanh hay chậm. Tạm dừng thì bạn có thể tự đi chen vào một nước, rồi bấm “Tiếp tục” để máy đánh tiếp từ thế đó.'
        : S.mode === 'two'
        ? 'Hai người đánh trên cùng một máy, hoặc bạn tự điều khiển cả hai bên. Bật “Tự xoay bàn” để bên đến lượt luôn ở phía dưới.' + hint
        : 'Bạn tự đi cho cả hai bên (ví dụ chép lại ván đang đánh ngoài đời). Máy luôn chấm điểm và gợi ý 3 nước tốt nhất.';
  }
  $('autoOn').onclick = () => { S.autoHint = true; store.set('kythu.autohint', true); setPressed('autoOn', 'autoOff', true); renderModeHint(); afterChange(); };
  $('autoOff').onclick = () => { S.autoHint = false; store.set('kythu.autohint', false); setPressed('autoOn', 'autoOff', false); renderModeHint(); engine.cancel(); setThinking(false); };
  $('modePlay').onclick = () => setMode('play');
  $('modeTwo').onclick = () => setMode('two');
  $('modeAuto').onclick = () => { S.autoPaused = false; S.flipped = false; setMode('auto'); };
  $('btnAutoPause').onclick = () => {
    S.autoPaused = !S.autoPaused;
    syncControls();
    if (S.autoPaused) { engine.cancel(); setThinking(false); clearAnalysis(''); render(); if (S.autoHint) analyze(S.time, true); }
    else afterChange();
  };
  $('btnAutoRestart').onclick = () => { S.autoPaused = false; syncControls(); $('btnNew').onclick(); };
  $('modeAnalyze').onclick = () => setMode('analyze');
  $('sideRed').onclick = () => setHuman(0);
  $('sideBlack').onclick = () => setHuman(1);
  $('btnSwap').onclick = () => setHuman(1 - S.human);
  $('flipOn').onclick = () => { S.autoFlip = true; store.set('kythu.autoflip', true); syncControls(); afterChange(); };
  $('flipOff').onclick = () => { S.autoFlip = false; store.set('kythu.autoflip', false); syncControls(); };
  $('thinkTime').onchange = (e) => { S.time = Number(e.target.value); store.set('kythu.time', S.time); };
  $('btnNew').onclick = () => { exitTrain(); S.startFen = X.START_FEN; S.moves = []; S.notes = []; S.view = null; S.review = null; renderReview(); afterChange(); };
  $('btnUndo').onclick = () => {
    if (S.train) return;
    if (S.mode === 'auto') { S.autoPaused = true; syncControls(); }
    let n = S.mode === 'play' ? (buildPos().sd === S.human ? 2 : 1) : 1;
    n = Math.min(n, S.moves.length);
    S.moves = S.moves.slice(0, S.moves.length - n); S.notes = S.notes.slice(0, S.moves.length);
    S.view = null; S.review = null; renderReview();
    afterChange();
  };
  $('btnHint').onclick = () => analyze(S.time, true);
  $('btnPlayBest').onclick = () => {
    const pos = currentPos();
    if (S.hint && S.hint.fenKey === posKey(pos) && !S.thinking) doMove(S.hint.cands[S.hint.sel || 0].move);
    else analyze(S.time, true).then((r) => { if (r && S.hint) doMove(S.hint.cands[S.hint.sel || 0].move); });
  };
  $('btnFlip').onclick = () => { S.flipped = !S.flipped; render(); };
  $('btnFirst').onclick = () => goto(0);
  $('btnPrev').onclick = () => goto(viewIndex() - 1);
  $('btnNext').onclick = () => goto(viewIndex() + 1);
  $('btnLast').onclick = () => goto(S.moves.length);

  for (const b of document.querySelectorAll('.tabs button')) {
    b.onclick = () => {
      for (const o of document.querySelectorAll('.tabs button')) o.setAttribute('aria-selected', String(o === b));
      for (const t of ['play', 'open', 'learn', 'edit']) $('pane-' + t).hidden = t !== b.dataset.tab;
      if (b.dataset.tab !== 'open' && S.op) exitOp();
      if (b.dataset.tab === 'open') renderOpList();
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
      const isHumanMove = S.mode === 'two' || S.mode === 'analyze' || (S.mode === 'play' && mover === S.human);
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
      row.onclick = () => { goto(i); setTimeout(() => { const pos = currentPos(); if (it.best) { engine.cancel(); setThinking(false); showCands(pos, [{ ...it, move: it.best, nodes: 0, time: 0 }], `từ phân tích ván`); render(); } }, 80); };
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
      S.hint = { fenKey: posKey(pos), cands: [{ move: best, score: 0, pv: [best] }], sel: 0, scored: false };
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
    if (S.mode === 'two' && S.autoFlip) S.flipped = currentPos().sd === 1;
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

  // ---------- Học khai cuộc ----------
  const OPL = window.XQ_OPENINGS || { OPENINGS: [], PRINCIPLES: [] };
  const OP_KEY = 'kythu.openings.v1';
  let opStats = store.get(OP_KEY, {});
  let opToken = 0;
  const mirrorMv = (mv) => { const f = (sq) => X.COORD(14 - (sq & 15), sq >> 4); return X.MOVE(f(X.SRC(mv)), f(X.DST(mv))); };
  const opBook = (op, i) => { const m = X.iccsToMove(op.o.moves[i][0]); return op.mirror ? mirrorMv(m) : m; };
  const opUserMoves = (o) => o.moves.filter((_, i) => i % 2 === o.side).length;

  function renderOpList() {
    const box = $('opList');
    box.textContent = '';
    setPressed('opRed', 'opBlack', S.opSide === 0);
    $('opSideHint').textContent = S.opSide === 0
      ? 'Đi tiên (cầm Đỏ): nên học Pháo đầu trước, rồi cách đánh khi Đen đáp bằng Bình phong mã, Thuận pháo hay Phản cung mã.'
      : 'Đi sau (cầm Đen): nên học Bình phong mã để chống Pháo đầu trước, sau đó Thuận pháo và cách đáp Tiên nhân chỉ lộ.';
    for (const o of OPL.OPENINGS.filter((x) => x.side === S.opSide)) {
      const st = opStats[o.id] || { runs: 0, perfect: 0, best: 0 };
      const b = document.createElement('button');
      b.type = 'button'; b.className = 'opcard';
      if (S.op && S.op.o.id === o.id) b.setAttribute('aria-current', 'true');
      const mastered = st.perfect >= 2;
      b.innerHTML = `<span class="optop"><strong>${o.name}</strong><span class="lvl ${o.level === 'Cơ bản' ? 'basic' : 'adv'}">${o.level}</span>${mastered ? '<span class="lvl done">Đã thuộc</span>' : ''}</span>` +
        `<span class="opdesc">${o.desc}</span>` +
        `<span class="opmeta">${o.moves.length} nước · bạn đi ${opUserMoves(o)} nước · ${st.runs ? `đã luyện ${st.runs} lần, đúng nhất ${st.best}%` : 'chưa luyện'}</span>` +
        `<span class="opbar"><i style="width:${st.best}%"></i></span>`;
      b.onclick = () => startOp(o, false);
      box.appendChild(b);
    }
  }

  function opNotes(op) {
    const p = new X.Position().fromFen(X.START_FEN), out = [];
    for (let i = 0; i < op.o.moves.length; i++) { const mv = opBook(op, i); out.push(X.moveToVN(p, mv)); p.makeMove(mv); }
    return out;
  }

  function startOp(o, drill) {
    exitTrain();
    engine.cancel(); setThinking(false);
    const prevFlip = S.op ? S.op.prevFlip : S.flipped;
    S.op = { o, drill, prevFlip, mirror: false };
    S.flipped = o.side === 1;
    S.selected = -1;
    opReset();
  }

  function opReset() {
    const op = S.op;
    opToken++;
    Object.assign(op, { pos: new X.Position().fromFen(X.START_FEN), idx: 0, last: 0, played: [], wrong: 0, errors: 0, done: false, mirror: false, msg: null });
    op.notes = opNotes(op);
    S.hint = null;
    renderOpPanel(); render();
    opAuto();
  }

  // Máy đi các nước của đối phương theo sách khi đang luyện
  function opAuto() {
    const op = S.op;
    if (!op || !op.drill || op.done || op.idx >= op.o.moves.length || op.pos.sd === op.o.side) return;
    const tok = opToken;
    setTimeout(() => {
      if (S.op !== op || tok !== opToken || op.done) return;
      opPlay(opBook(op, op.idx));
      renderOpPanel(); render();
      opAuto();
    }, 650);
  }

  function opPlay(mv) {
    const op = S.op;
    op.pos.makeMove(mv); op.last = mv; op.played.push(mv); op.idx++;
    op.wrong = 0;
    if (op.idx >= op.o.moves.length) opFinish();
  }

  function opGoto(n) {
    const op = S.op;
    opToken++;
    n = Math.max(0, Math.min(op.o.moves.length, n));
    op.pos = new X.Position().fromFen(X.START_FEN); op.played = []; op.idx = 0; op.last = 0; op.done = false; op.msg = null;
    for (let i = 0; i < n; i++) { const mv = opBook(op, i); op.pos.makeMove(mv); op.played.push(mv); op.last = mv; op.idx++; }
    op.done = op.idx >= op.o.moves.length;
    renderOpPanel(); render();
  }

  function opMove(mv) {
    const op = S.op;
    if (op.done) return;
    let expected = opBook(op, op.idx);
    // Pháo đầu bên trái (P8-5) cũng đúng: lật đối xứng cả bài
    if (op.idx === 0 && !op.mirror && mv !== expected && mirrorMv(expected) === mv) { op.mirror = true; op.notes = opNotes(op); expected = mv; }
    const note = X.moveToVN(op.pos, mv), want = op.notes[op.idx];
    if (!op.drill) {
      if (mv === expected) { opPlay(mv); op.msg = null; }
      else op.msg = { bad: true, text: `${note} không phải nước trong bài. Bài này đi ${want}. Bấm “Nước tiếp” hoặc đi đúng nước có mũi tên.` };
      S.selected = -1; renderOpPanel(); render();
      return;
    }
    if (op.pos.sd !== op.o.side) return;
    if (mv === expected) {
      const i = op.idx;
      const firstTry = op.wrong === 0;
      opPlay(mv);
      op.msg = { bad: false, text: `${firstTry ? 'Đúng!' : 'Được rồi.'} ${want}: ${op.o.moves[i][1]}` };
      S.selected = -1; renderOpPanel(); render();
      opAuto();
      return;
    }
    if (op.wrong === 0) op.errors++;
    op.wrong++;
    const srcPc = op.pos.board[X.SRC(expected)];
    const fileHint = want.charAt(X.VN_LETTER[srcPc & 7].length);
    const where = /\d/.test(fileHint) ? ` ở cột ${fileHint}` : fileHint === 't' ? ' phía trước' : fileHint === 's' ? ' phía sau' : fileHint === 'g' ? ' ở giữa' : '';
    if (op.wrong >= 2) op.msg = { bad: true, text: `Chưa đúng. Nước đúng là ${want} (mũi tên xanh): ${op.o.moves[op.idx][1]}` };
    else op.msg = { bad: true, text: `${note} chưa phải nước chuẩn. Gợi ý: hãy đi ${X.VN_NAME[srcPc & 7]}${where}. Thử lại nhé.` };
    S.selected = -1; renderOpPanel(); render();
  }

  function opFinish() {
    const op = S.op;
    op.done = true;
    if (!op.drill) return;
    const total = opUserMoves(op.o);
    const pct = Math.round(100 * Math.max(0, total - op.errors) / total);
    const st = opStats[op.o.id] || { runs: 0, perfect: 0, best: 0 };
    st.runs++; if (op.errors === 0) st.perfect++; st.best = Math.max(st.best, pct);
    opStats[op.o.id] = st; store.set(OP_KEY, opStats);
    op.result = { pct, total, errors: op.errors, mastered: st.perfect >= 2 };
  }

  function renderOpPanel() {
    const op = S.op;
    $('opPanel').hidden = !op;
    $('opList').hidden = !!op;
    $('opSideRow').hidden = !!op;
    if (!op) return;
    const len = op.o.moves.length;
    $('opTitle').textContent = op.o.name;
    $('opProgress').textContent = `nước ${op.idx}/${len}`;
    setPressed('opView', 'opDrill', !op.drill);
    $('opViewCtl').hidden = op.drill;
    $('opDoneCtl').hidden = !(op.done && op.drill);
    $('opPrev').disabled = op.idx === 0; $('opNext').disabled = op.idx >= len;
    // lời giảng
    const note = $('opNote');
    let html = '';
    if (op.drill) {
      if (op.done && op.result) {
        const r = op.result;
        html = `<strong>Hoàn thành bài!</strong> Bạn đi đúng ngay ${r.total - r.errors}/${r.total} nước (${r.pct}%).` +
          (r.errors === 0 ? (r.mastered ? ' Bạn đã thuộc bài này.' : ' Không sai nước nào. Luyện thêm một lần không sai nữa là thuộc bài.') : ' Luyện lại để nhớ các nước còn sai.');
      } else if (op.msg) html = op.msg.text;
      else html = op.pos.sd === op.o.side ? `Đến lượt bạn (${op.o.side === 0 ? 'Đỏ' : 'Đen'}). Hãy đi nước chuẩn của khai cuộc.` : 'Đối thủ đang đi theo sách…';
      if (!op.done && op.pos.sd === op.o.side && op.msg && !op.msg.bad) html += `<br><span class="muted">Đến lượt bạn đi tiếp.</span>`;
    } else {
      if (op.msg) html = op.msg.text;
      else if (op.idx === 0) html = `${op.o.desc}<br><span class="muted">Bấm “Nước tiếp” hoặc đi đúng nước có mũi tên trên bàn.</span>`;
      else html = `<strong>${Math.ceil(op.idx / 2)}${op.idx % 2 ? '.' : '…'} ${op.notes[op.idx - 1]}</strong> · ${op.o.moves[op.idx - 1][1]}`;
      if (op.done) html += '<br><strong>Hết bài.</strong> Chuyển sang “Luyện tập” để tự đi lại từ đầu.';
    }
    note.className = 'opnote' + (op.msg && op.msg.bad ? ' bad' : '');
    note.innerHTML = html;
    // mũi tên: xem bài luôn chỉ nước tiếp; luyện tập chỉ hiện sau 2 lần sai
    const showArrow = !op.done && op.idx < len && (!op.drill || op.wrong >= 2);
    S.hint = showArrow ? { fenKey: posKey(op.pos), cands: [{ move: opBook(op, op.idx), score: 0, pv: [opBook(op, op.idx)] }], sel: 0, scored: false } : null;
    // danh sách nước trong bài
    const ol = $('opLine');
    ol.textContent = '';
    for (let i = 0; i < len; i += 2) {
      const no = document.createElement('span'); no.className = 'no'; no.textContent = (i / 2 + 1) + '.'; ol.appendChild(no);
      for (let j = i; j < i + 2; j++) {
        const sp = document.createElement('span');
        if (j < len) {
          const hidden = op.drill && j >= op.idx;
          sp.textContent = hidden ? '···' : op.notes[j];
          sp.className = 'mv' + (j % 2 === op.o.side ? ' mine' : '') + (j === op.idx - 1 ? ' cur' : '') + (hidden ? ' hid' : '');
          if (!op.drill) { sp.onclick = () => opGoto(j + 1); sp.title = op.o.moves[j][1]; }
        }
        ol.appendChild(sp);
      }
    }
  }

  function exitOp() {
    if (!S.op) return;
    opToken++;
    S.flipped = S.op.prevFlip;
    S.op = null; S.hint = null; S.selected = -1;
    renderOpPanel();
    afterChange();
  }

  function opContinue() {
    const op = S.op;
    const moves = op.played.slice(), side = op.o.side;
    opToken++;
    S.op = null; S.hint = null;
    try { loadPosition(X.START_FEN, moves); } catch (e) { return; }
    S.mode = 'play'; S.human = side; S.flipped = side === 1;
    syncControls(); renderOpPanel();
    $('tab-play').click();
    afterChange();
  }

  // Nhận ra khai cuộc trong ván đang đánh và chỉ nước sách tiếp theo
  function detectOpening() {
    if (S.op || S.train || S.editing || S.startFen !== X.START_FEN) return '';
    const played = S.moves.slice(0, viewIndex());
    if (played.length < 2) return '';
    let best = null;
    for (const o of OPL.OPENINGS) for (const mir of [false, true]) {
      let k = 0;
      while (k < played.length && k < o.moves.length) {
        let m = X.iccsToMove(o.moves[k][0]); if (mir) m = mirrorMv(m);
        if (m !== played[k]) break;
        k++;
      }
      if (k >= 2 && (!best || k > best.k)) best = { o, k, mir };
    }
    if (!best) return '';
    const { o, k, mir } = best;
    if (k === played.length && k < o.moves.length) {
      let m = X.iccsToMove(o.moves[k][0]); if (mir) m = mirrorMv(m);
      return `Khai cuộc: ${o.family} · nước theo sách tiếp theo: ${X.moveToVN(currentPos(), m)}`;
    }
    if (k === played.length || (k === o.moves.length && played.length - k <= 6)) return `Khai cuộc: ${o.family} · đã đi hết bài trong sách`;
    if (played.length - k <= 6) return `Khai cuộc: ${o.family} · ra khỏi sách ở nước thứ ${Math.floor(k / 2) + 1}`;
    return '';
  }

  $('opRed').onclick = () => { S.opSide = 0; renderOpList(); };
  $('opBlack').onclick = () => { S.opSide = 1; renderOpList(); };
  $('opView').onclick = () => { if (S.op && S.op.drill) { S.op.drill = false; opReset(); } };
  $('opDrill').onclick = () => { if (S.op && !S.op.drill) { S.op.drill = true; opReset(); } };
  $('opPrev').onclick = () => opGoto(S.op.idx - 1);
  $('opNext').onclick = () => opGoto(S.op.idx + 1);
  $('opRestart').onclick = () => opGoto(0);
  $('opAgain').onclick = () => opReset();
  $('opContinue').onclick = opContinue;
  $('opBack').onclick = () => { exitOp(); renderOpList(); };
  $('opPrinciples').innerHTML = OPL.PRINCIPLES.map((p) => `<li>${p}</li>`).join('');

  // ---------- Lưu ván ----------
  function saveGame() { store.set('kythu.game', { fen: S.startFen, moves: S.moves.map(X.moveToIccs), mode: S.mode, human: S.human }); }
  function restore() {
    const g = store.get('kythu.game', null);
    S.time = store.get('kythu.time', 3000);
    S.autoHint = store.get('kythu.autohint', true) !== false;
    S.autoFlip = store.get('kythu.autoflip', false) === true;
    setPressed('autoOn', 'autoOff', S.autoHint);
    $('thinkTime').value = String(S.time);
    if (!g) return;
    try {
      loadPosition(g.fen, g.moves.map(X.iccsToMove));
      S.mode = ['analyze', 'two', 'auto'].includes(g.mode) ? g.mode : 'play';
      S.autoPaused = S.mode === 'auto';
      S.human = g.human === 1 ? 1 : 0; S.flipped = S.mode === 'play' && S.human === 1;
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
  syncControls();
  render();
  engine.init().then(() => {
    $('engineMode').textContent = engine.mode === 'worker' ? 'Máy tính ở luồng riêng, giao diện không bị đứng.' : 'Máy tính trên luồng chính (tối đa 4 giây).';
    afterChange();
  });
})();
