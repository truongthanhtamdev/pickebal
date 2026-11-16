/*
 * Engine cờ tướng (Xiangqi) — sinh nước, đánh giá, tìm kiếm alpha-beta.
 * Chạy được trên luồng chính, trong Web Worker, và trong Node (để test).
 *
 * Bàn cờ dùng mảng 16x16: sq = y*16 + x, với x = 3..11 (cột 0..8), y = 3..12 (hàng 0..9).
 * Hàng 0 là hàng cuối của Đen (phía trên), hàng 9 là hàng cuối của Đỏ (phía dưới).
 * Quân: Đỏ = 8 + loại, Đen = 16 + loại. Loại: 0 Tướng, 1 Sĩ, 2 Tượng, 3 Mã, 4 Xe, 5 Pháo, 6 Tốt.
 * Nước đi: src + dst * 256.
 */
(function (root) {
  'use strict';

  const KING = 0, ADVISOR = 1, BISHOP = 2, KNIGHT = 3, ROOK = 4, CANNON = 5, PAWN = 6;
  const MATE = 10000, WIN = MATE - 200, BAN = MATE - 100;
  const LIMIT_DEPTH = 64;

  const IN_BOARD = new Uint8Array(256);
  const IN_FORT = new Uint8Array(256);
  for (let y = 3; y <= 12; y++) for (let x = 3; x <= 11; x++) IN_BOARD[y * 16 + x] = 1;
  for (const y of [3, 4, 5, 10, 11, 12]) for (let x = 6; x <= 8; x++) IN_FORT[y * 16 + x] = 1;

  const KING_DELTA = [-16, -1, 1, 16];
  const ADVISOR_DELTA = [-17, -15, 15, 17];
  const KNIGHT_DELTA = [[-33, -31], [-18, 14], [-14, 18], [31, 33]];
  const KNIGHT_CHECK_DELTA = [[-33, -18], [-31, -14], [14, 31], [18, 33]];

  const SRC = (mv) => mv & 255;
  const DST = (mv) => mv >> 8;
  const MOVE = (s, d) => s + (d << 8);
  const SIDE_TAG = (sd) => 8 + (sd << 3);
  const OPP_SIDE_TAG = (sd) => 16 - (sd << 3);
  const SQUARE_FORWARD = (sq, sd) => sq - 16 + (sd << 5);
  const HOME_HALF = (sq, sd) => (sq & 0x80) !== (sd << 7);
  const AWAY_HALF = (sq, sd) => (sq & 0x80) === (sd << 7);
  const SAME_HALF = (a, b) => ((a ^ b) & 0x80) === 0;
  const FLIP = (sq) => 254 - sq;
  const COORD = (x, y) => x + (y << 4);

  // ---------- Giá trị quân + bảng vị trí (góc nhìn Đỏ, hàng 0 = phía Đen) ----------
  const MATERIAL = [0, 120, 120, 400, 900, 450, 60];
  const T = {};
  T[PAWN] = [
    [9, 9, 9, 11, 13, 11, 9, 9, 9],
    [19, 24, 34, 42, 44, 42, 34, 24, 19],
    [19, 24, 32, 37, 37, 37, 32, 24, 19],
    [19, 23, 27, 29, 30, 29, 27, 23, 19],
    [14, 18, 20, 27, 29, 27, 20, 18, 14],
    [7, 0, 13, 0, 16, 0, 13, 0, 7],
    [7, 0, 7, 0, 15, 0, 7, 0, 7],
    [0, 0, 0, 0, 0, 0, 0, 0, 0],
    [0, 0, 0, 0, 0, 0, 0, 0, 0],
    [0, 0, 0, 0, 0, 0, 0, 0, 0]];
  T[ROOK] = [
    [6, 8, 7, 13, 14, 13, 7, 8, 6],
    [6, 12, 9, 16, 33, 16, 9, 12, 6],
    [6, 8, 7, 14, 16, 14, 7, 8, 6],
    [6, 13, 13, 16, 16, 16, 13, 13, 6],
    [8, 11, 11, 14, 15, 14, 11, 11, 8],
    [8, 12, 12, 14, 15, 14, 12, 12, 8],
    [4, 9, 4, 12, 14, 12, 4, 9, 4],
    [-2, 8, 4, 12, 12, 12, 4, 8, -2],
    [5, 8, 6, 12, 0, 12, 6, 8, 5],
    [-6, 6, 4, 12, 0, 12, 4, 6, -6]];
  T[KNIGHT] = [
    [4, 8, 16, 12, 4, 12, 16, 8, 4],
    [4, 10, 28, 16, 8, 16, 28, 10, 4],
    [12, 14, 16, 20, 18, 20, 16, 14, 12],
    [8, 24, 18, 24, 20, 24, 18, 24, 8],
    [6, 16, 14, 18, 16, 18, 14, 16, 6],
    [4, 12, 16, 14, 12, 14, 16, 12, 4],
    [2, 6, 8, 6, 10, 6, 8, 6, 2],
    [4, 2, 8, 8, 4, 8, 8, 2, 4],
    [0, 2, 4, 4, -2, 4, 4, 2, 0],
    [0, -4, 0, 0, 0, 0, 0, -4, 0]];
  T[CANNON] = [
    [6, 4, 0, -10, -12, -10, 0, 4, 6],
    [2, 2, 0, -4, -14, -4, 0, 2, 2],
    [2, 2, 0, -10, -8, -10, 0, 2, 2],
    [0, 0, -2, 4, 10, 4, -2, 0, 0],
    [0, 0, 0, 2, 8, 2, 0, 0, 0],
    [-2, 0, 4, 2, 6, 2, 4, 0, -2],
    [0, 0, 0, 2, 4, 2, 0, 0, 0],
    [4, 0, 8, 6, 10, 6, 8, 0, 4],
    [0, 2, 4, 6, 6, 6, 4, 2, 0],
    [0, 0, 2, 6, 6, 6, 2, 0, 0]];
  const zero = () => Array.from({ length: 10 }, () => new Array(9).fill(0));
  T[ADVISOR] = zero(); T[ADVISOR][8][4] = 6; T[ADVISOR][9][3] = 0; T[ADVISOR][9][5] = 0; T[ADVISOR][7][3] = -2; T[ADVISOR][7][5] = -2;
  T[BISHOP] = zero(); T[BISHOP][7][4] = 6; T[BISHOP][9][2] = 1; T[BISHOP][9][6] = 1; T[BISHOP][5][2] = -3; T[BISHOP][5][6] = -3; T[BISHOP][7][0] = -2; T[BISHOP][7][8] = -2;
  T[KING] = zero(); T[KING][9][4] = 4; T[KING][9][3] = 0; T[KING][9][5] = 0; T[KING][8][4] = -8; T[KING][8][3] = -10; T[KING][8][5] = -10; T[KING][7][4] = -20; T[KING][7][3] = -22; T[KING][7][5] = -22;
  const SCALE = [1, 1, 1, 2, 2, 2, 3];

  const PST = [];
  for (let t = 0; t < 7; t++) {
    PST[t] = new Int16Array(256);
    for (let y = 3; y <= 12; y++) for (let x = 3; x <= 11; x++) {
      PST[t][COORD(x, y)] = MATERIAL[t] + T[t][y - 3][x - 3] * SCALE[t];
    }
  }

  // ---------- Zobrist ----------
  let seed = 0x2545F491;
  function rand32() { seed ^= seed << 13; seed ^= seed >>> 17; seed ^= seed << 5; return seed | 0; }
  const ZKEY = new Int32Array(23 * 256), ZLOCK = new Int32Array(23 * 256);
  for (let i = 0; i < 23 * 256; i++) { ZKEY[i] = rand32(); ZLOCK[i] = rand32(); }
  const ZKEY_SIDE = rand32(), ZLOCK_SIDE = rand32();

  const MVV = [5, 1, 1, 3, 4, 3, 2];

  const FEN_PIECE = { k: KING, a: ADVISOR, b: BISHOP, e: BISHOP, n: KNIGHT, h: KNIGHT, r: ROOK, c: CANNON, p: PAWN };
  const PIECE_FEN = 'kabnrcp';
  const START_FEN = 'rnbakabnr/9/1c5c1/p1p1p1p1p/9/9/P1P1P1P1P/1C5C1/9/RNBAKABNR w - - 0 1';

  class Position {
    constructor() { this.clear(); }

    clear() {
      this.board = new Uint8Array(256);
      this.sd = 0; this.vlRed = 0; this.vlBlack = 0;
      this.key = 0; this.lock = 0;
      this.mvList = [0]; this.pcList = [0]; this.keyList = [0]; this.chkList = [false];
      this.distance = 0;
    }

    addPiece(sq, pc, del) {
      this.board[sq] = del ? 0 : pc;
      const sign = del ? -1 : 1;
      if (pc < 16) this.vlRed += sign * PST[pc - 8][sq];
      else this.vlBlack += sign * PST[pc - 16][FLIP(sq)];
      this.key ^= ZKEY[pc * 256 + sq]; this.lock ^= ZLOCK[pc * 256 + sq];
    }

    changeSide() { this.sd = 1 - this.sd; this.key ^= ZKEY_SIDE; this.lock ^= ZLOCK_SIDE; }

    fromFen(fen) {
      this.clear();
      const parts = fen.trim().split(/\s+/);
      let y = 3, x = 3;
      for (const ch of parts[0]) {
        if (ch === '/') { y++; x = 3; if (y > 12) break; }
        else if (ch >= '1' && ch <= '9') x += ch.charCodeAt(0) - 48;
        else {
          const lower = ch.toLowerCase();
          if (!(lower in FEN_PIECE)) throw new Error('FEN có ký tự lạ: ' + ch);
          if (x <= 11) this.addPiece(COORD(x, y), (ch === lower ? 16 : 8) + FEN_PIECE[lower]);
          x++;
        }
      }
      if (parts[1] === 'b') this.changeSide();
      this.chkList = [this.checked()];
      return this;
    }

    toFen() {
      let s = '';
      for (let y = 3; y <= 12; y++) {
        let empty = 0;
        for (let x = 3; x <= 11; x++) {
          const pc = this.board[COORD(x, y)];
          if (pc === 0) { empty++; continue; }
          if (empty) { s += empty; empty = 0; }
          const c = PIECE_FEN[pc & 7];
          s += pc < 16 ? c.toUpperCase() : c;
        }
        if (empty) s += empty;
        if (y < 12) s += '/';
      }
      return s + (this.sd === 0 ? ' w' : ' b') + ' - - 0 1';
    }

    clone() {
      const p = new Position();
      p.board = this.board.slice(); p.sd = this.sd; p.vlRed = this.vlRed; p.vlBlack = this.vlBlack;
      p.key = this.key; p.lock = this.lock; p.mvList = this.mvList.slice(); p.pcList = this.pcList.slice();
      p.keyList = this.keyList.slice(); p.chkList = this.chkList.slice(); p.distance = 0;
      return p;
    }

    movePiece(mv) {
      const s = SRC(mv), d = DST(mv);
      const pcCap = this.board[d];
      if (pcCap) this.addPiece(d, pcCap, true);
      const pc = this.board[s];
      this.addPiece(s, pc, true);
      this.addPiece(d, pc);
      return pcCap;
    }

    undoMovePiece(mv, pcCap) {
      const s = SRC(mv), d = DST(mv);
      const pc = this.board[d];
      this.addPiece(d, pc, true);
      this.addPiece(s, pc);
      if (pcCap) this.addPiece(d, pcCap);
    }

    makeMove(mv) {
      const key = this.key;
      const pcCap = this.movePiece(mv);
      if (this.checked()) { this.undoMovePiece(mv, pcCap); return false; }
      this.changeSide();
      this.keyList.push(key); this.mvList.push(mv); this.pcList.push(pcCap);
      this.chkList.push(this.checked());
      this.distance++;
      return true;
    }

    undoMakeMove() {
      this.distance--;
      this.chkList.pop(); this.changeSide(); this.keyList.pop();
      this.undoMovePiece(this.mvList.pop(), this.pcList.pop());
    }

    nullMove() {
      this.mvList.push(0); this.pcList.push(0); this.keyList.push(this.key);
      this.changeSide(); this.chkList.push(false); this.distance++;
    }

    undoNullMove() {
      this.distance--; this.chkList.pop(); this.changeSide();
      this.keyList.pop(); this.pcList.pop(); this.mvList.pop();
    }

    inCheck() { return this.chkList[this.chkList.length - 1]; }
    captured() { return this.pcList[this.pcList.length - 1] !== 0; }
    evaluate() { return (this.sd === 0 ? this.vlRed - this.vlBlack : this.vlBlack - this.vlRed) + 3; }
    nullOkay() { return (this.sd === 0 ? this.vlRed : this.vlBlack) > 1400; }
    mateValue() { return this.distance - MATE; }
    banValue() { return this.distance - BAN; }
    drawValue() { return 0; }

    generateMoves(capOnly) {
      const mvs = [];
      const self = SIDE_TAG(this.sd), opp = OPP_SIDE_TAG(this.sd);
      const b = this.board;
      for (let s = 51; s < 205; s++) {
        const pc = b[s];
        if ((pc & self) === 0) continue;
        let d, pd;
        switch (pc - self) {
          case KING:
            for (let i = 0; i < 4; i++) {
              d = s + KING_DELTA[i]; if (!IN_FORT[d]) continue; pd = b[d];
              if (capOnly ? (pd & opp) : !(pd & self)) mvs.push(MOVE(s, d));
            }
            break;
          case ADVISOR:
            for (let i = 0; i < 4; i++) {
              d = s + ADVISOR_DELTA[i]; if (!IN_FORT[d]) continue; pd = b[d];
              if (capOnly ? (pd & opp) : !(pd & self)) mvs.push(MOVE(s, d));
            }
            break;
          case BISHOP:
            for (let i = 0; i < 4; i++) {
              d = s + ADVISOR_DELTA[i];
              if (!(IN_BOARD[d] && HOME_HALF(d, this.sd) && b[d] === 0)) continue;
              d += ADVISOR_DELTA[i]; pd = b[d];
              if (capOnly ? (pd & opp) : !(pd & self)) mvs.push(MOVE(s, d));
            }
            break;
          case KNIGHT:
            for (let i = 0; i < 4; i++) {
              if (b[s + KING_DELTA[i]] !== 0) continue;
              for (let j = 0; j < 2; j++) {
                d = s + KNIGHT_DELTA[i][j]; if (!IN_BOARD[d]) continue; pd = b[d];
                if (capOnly ? (pd & opp) : !(pd & self)) mvs.push(MOVE(s, d));
              }
            }
            break;
          case ROOK:
            for (let i = 0; i < 4; i++) {
              const dl = KING_DELTA[i];
              d = s + dl;
              while (IN_BOARD[d]) {
                pd = b[d];
                if (pd === 0) { if (!capOnly) mvs.push(MOVE(s, d)); }
                else { if (pd & opp) mvs.push(MOVE(s, d)); break; }
                d += dl;
              }
            }
            break;
          case CANNON:
            for (let i = 0; i < 4; i++) {
              const dl = KING_DELTA[i];
              d = s + dl;
              while (IN_BOARD[d]) {
                if (b[d] === 0) { if (!capOnly) mvs.push(MOVE(s, d)); } else break;
                d += dl;
              }
              d += dl;
              while (IN_BOARD[d]) {
                pd = b[d];
                if (pd !== 0) { if (pd & opp) mvs.push(MOVE(s, d)); break; }
                d += dl;
              }
            }
            break;
          case PAWN:
            d = SQUARE_FORWARD(s, this.sd);
            if (IN_BOARD[d]) { pd = b[d]; if (capOnly ? (pd & opp) : !(pd & self)) mvs.push(MOVE(s, d)); }
            if (AWAY_HALF(s, this.sd)) {
              for (const dl of [-1, 1]) {
                d = s + dl;
                if (IN_BOARD[d]) { pd = b[d]; if (capOnly ? (pd & opp) : !(pd & self)) mvs.push(MOVE(s, d)); }
              }
            }
            break;
        }
      }
      return mvs;
    }

    legalMove(mv) {
      const s = SRC(mv), d = DST(mv);
      const self = SIDE_TAG(this.sd);
      const pc = this.board[s];
      if (!(pc & self)) return false;
      if (this.board[d] & self) return false;
      return this.generateMoves(false).includes(mv) && this.isLegalAfter(mv);
    }

    isLegalAfter(mv) {
      const cap = this.movePiece(mv);
      const ok = !this.checked();
      this.undoMovePiece(mv, cap);
      return ok;
    }

    legalMoves() { return this.generateMoves(false).filter((mv) => this.isLegalAfter(mv)); }

    checked() {
      const self = SIDE_TAG(this.sd), opp = OPP_SIDE_TAG(this.sd);
      const b = this.board;
      for (let s = 51; s < 205; s++) {
        if (b[s] !== self + KING) continue;
        if (b[SQUARE_FORWARD(s, this.sd)] === opp + PAWN) return true;
        if (b[s - 1] === opp + PAWN || b[s + 1] === opp + PAWN) return true;
        for (let i = 0; i < 4; i++) {
          if (b[s + ADVISOR_DELTA[i]] !== 0) continue;
          for (let j = 0; j < 2; j++) if (b[s + KNIGHT_CHECK_DELTA[i][j]] === opp + KNIGHT) return true;
        }
        for (let i = 0; i < 4; i++) {
          const dl = KING_DELTA[i];
          let d = s + dl;
          while (IN_BOARD[d]) {
            const pd = b[d];
            if (pd !== 0) { if (pd === opp + ROOK || pd === opp + KING) return true; break; }
            d += dl;
          }
          d += dl;
          while (IN_BOARD[d]) {
            const pd = b[d];
            if (pd !== 0) { if (pd === opp + CANNON) return true; break; }
            d += dl;
          }
        }
        return false;
      }
      return false;
    }

    isMate() { return this.legalMoves().length === 0; }

    // Lặp lại thế cờ: trả về bit 1 = lặp, 2 = bên đi đang chiếu dai, 4 = đối phương chiếu dai
    repStatus(recur) {
      let selfSide = false, perpCheck = true, oppPerpCheck = true;
      let i = this.mvList.length - 1;
      while (this.mvList[i] > 0 && this.pcList[i] === 0) {
        if (selfSide) {
          perpCheck = perpCheck && this.chkList[i];
          if (this.keyList[i] === this.key) {
            recur--;
            if (recur === 0) return 1 + (perpCheck ? 2 : 0) + (oppPerpCheck ? 4 : 0);
          }
        } else oppPerpCheck = oppPerpCheck && this.chkList[i];
        selfSide = !selfSide; i--;
      }
      return 0;
    }

    repValue(rep) {
      const vl = ((rep & 2) ? this.banValue() : 0) + ((rep & 4) ? -this.banValue() : 0);
      return vl === 0 ? this.drawValue() : vl;
    }

    hasAttackers(sd) {
      const tag = SIDE_TAG(sd);
      for (let s = 51; s < 205; s++) {
        const pc = this.board[s];
        if ((pc & tag) && [KNIGHT, ROOK, CANNON, PAWN].includes(pc - tag)) return true;
      }
      return false;
    }
  }

  // ---------- Tìm kiếm ----------
  const HASH_BITS = 20, HASH_SIZE = 1 << HASH_BITS, HASH_MASK = HASH_SIZE - 1;
  const H_ALPHA = 1, H_BETA = 2, H_EXACT = 3;
  class StopSearch { }

  class Searcher {
    constructor() {
      this.hLock = new Int32Array(HASH_SIZE);
      this.hDepth = new Int8Array(HASH_SIZE);
      this.hFlag = new Uint8Array(HASH_SIZE);
      this.hVl = new Int16Array(HASH_SIZE);
      this.hMv = new Uint16Array(HASH_SIZE);
      this.history = new Int32Array(65536);
      this.killers = [];
      this.exclude = [];
    }

    probe(depth, alpha, beta) {
      const pos = this.pos, i = pos.key & HASH_MASK;
      if (this.hLock[i] !== pos.lock || this.hFlag[i] === 0) return { mv: 0, vl: null };
      const mv = this.hMv[i];
      let vl = this.hVl[i];
      let mateScore = false;
      if (vl > WIN) { if (vl < BAN) return { mv, vl: null }; vl -= pos.distance; mateScore = true; }
      else if (vl < -WIN) { if (vl > -BAN) return { mv, vl: null }; vl += pos.distance; mateScore = true; }
      if (this.hDepth[i] >= depth || mateScore) {
        const f = this.hFlag[i];
        if (f === H_BETA && vl >= beta) return { mv, vl };
        if (f === H_ALPHA && vl <= alpha) return { mv, vl };
        if (f === H_EXACT) return { mv, vl };
      }
      return { mv, vl: null };
    }

    record(flag, vl, depth, mv) {
      const pos = this.pos, i = pos.key & HASH_MASK;
      if (this.hLock[i] === pos.lock && this.hDepth[i] > depth && this.hFlag[i] !== 0) return;
      if (vl > WIN) { if (mv === 0 && vl <= BAN) return; vl += pos.distance; }
      else if (vl < -WIN) { if (mv === 0 && vl >= -BAN) return; vl -= pos.distance; }
      this.hLock[i] = pos.lock; this.hDepth[i] = depth; this.hFlag[i] = flag; this.hVl[i] = vl; this.hMv[i] = mv;
    }

    checkTime() {
      if ((++this.nodes & 2047) === 0 && Date.now() > this.deadline) throw new StopSearch();
    }

    quiesce(alpha, beta) {
      this.checkTime();
      const pos = this.pos;
      let vl = pos.mateValue();
      if (vl >= beta) return vl;
      const rep = pos.repStatus(1);
      if (rep > 0) return pos.repValue(rep);
      if (pos.distance >= LIMIT_DEPTH) return pos.evaluate();
      let best = -MATE;
      let mvs;
      if (pos.inCheck()) {
        mvs = pos.generateMoves(false);
        const h = this.history;
        mvs.sort((a, b) => h[b] - h[a]);
      } else {
        vl = pos.evaluate();
        if (vl > best) { if (vl >= beta) return vl; best = vl; if (vl > alpha) alpha = vl; }
        mvs = pos.generateMoves(true);
        const b = pos.board;
        const sc = (m) => (MVV[b[DST(m)] & 7] << 3) - MVV[b[SRC(m)] & 7];
        mvs.sort((x, y) => sc(y) - sc(x));
      }
      for (const mv of mvs) {
        if (!pos.makeMove(mv)) continue;
        vl = -this.quiesce(-beta, -alpha);
        pos.undoMakeMove();
        if (vl > best) {
          if (vl >= beta) return vl;
          best = vl; if (vl > alpha) alpha = vl;
        }
      }
      return best === -MATE ? pos.mateValue() : best;
    }

    orderMoves(mvs, hashMv, ply) {
      const b = this.pos.board, h = this.history;
      const k = this.killers[ply] || [0, 0];
      const scored = mvs.map((mv) => {
        let s;
        if (mv === hashMv) s = 1 << 30;
        else if (b[DST(mv)]) s = (1 << 26) + (MVV[b[DST(mv)] & 7] << 8) - MVV[b[SRC(mv)] & 7];
        else if (mv === k[0]) s = (1 << 25);
        else if (mv === k[1]) s = (1 << 25) - 1;
        else s = h[mv];
        return [s, mv];
      });
      scored.sort((x, y) => y[0] - x[0]);
      return scored;
    }

    search(depth, alpha, beta, noNull) {
      const pos = this.pos;
      const ply = pos.distance;
      if (ply > 0) {
        if (depth <= 0) return this.quiesce(alpha, beta);
        this.checkTime();
        const rep = pos.repStatus(1);
        if (rep > 0) return pos.repValue(rep);
        let vl = pos.mateValue();
        if (vl >= beta) return vl;
        if (ply >= LIMIT_DEPTH) return pos.evaluate();
      }
      const isPV = beta - alpha > 1;
      const probe = this.probe(depth, alpha, beta);
      if (ply > 0 && probe.vl !== null && !isPV) return probe.vl;
      const hashMv = ply === 0 && this.rootBest ? this.rootBest : probe.mv;

      const inCheck = pos.inCheck();
      if (ply > 0 && !noNull && !inCheck && !isPV && depth >= 2 && pos.nullOkay()) {
        const R = depth >= 6 ? 3 : 2;
        pos.nullMove();
        const vl = -this.search(depth - 1 - R, -beta, 1 - beta, true);
        pos.undoNullMove();
        if (vl >= beta) {
          if (depth < 5) return vl;
          const v2 = this.search(depth - R, beta - 1, beta, true);
          if (v2 >= beta) return vl;
        }
      }

      let gen = pos.generateMoves(false);
      if (ply === 0 && this.exclude.length) gen = gen.filter((m) => !this.exclude.includes(m));
      const moves = this.orderMoves(gen, hashMv, ply);
      let best = -MATE, bestMv = 0, flag = H_ALPHA, legal = 0;
      const killers = this.killers[ply] || [0, 0];
      for (const [score, mv] of moves) {
        const isCap = pos.board[DST(mv)] !== 0;
        if (!pos.makeMove(mv)) continue;
        const givesCheck = pos.inCheck();
        const newDepth = givesCheck ? depth : depth - 1;
        let vl;
        if (legal === 0) vl = -this.search(newDepth, -beta, -alpha, false);
        else {
          let red = 0;
          if (legal >= 3 && depth >= 3 && !inCheck && !givesCheck && !isCap && mv !== killers[0] && mv !== killers[1]) {
            red = 1 + (legal >= 10 && depth >= 6 ? 1 : 0);
          }
          vl = -this.search(newDepth - red, -alpha - 1, -alpha, false);
          if (vl > alpha && red) vl = -this.search(newDepth, -alpha - 1, -alpha, false);
          if (vl > alpha && vl < beta) vl = -this.search(newDepth, -beta, -alpha, false);
        }
        pos.undoMakeMove();
        legal++;
        if (vl > best) {
          best = vl;
          if (vl >= beta) { flag = H_BETA; bestMv = mv; break; }
          if (vl > alpha) { alpha = vl; flag = H_EXACT; bestMv = mv; if (ply === 0) { this.iterBest = mv; this.iterScore = vl; } }
        }
      }
      if (legal === 0) return pos.mateValue();
      if (!(ply === 0 && this.exclude.length)) this.record(flag, best, depth, bestMv);
      if (bestMv) {
        if (ply === 0 && flag === H_BETA) { this.iterBest = bestMv; this.iterScore = best; }
        if (pos.board[DST(bestMv)] === 0) {
          this.history[bestMv] += depth * depth;
          if (this.history[bestMv] > 1e8) for (let i = 0; i < 65536; i++) this.history[i] >>= 1;
          if (!this.killers[ply]) this.killers[ply] = [0, 0];
          const kk = this.killers[ply];
          if (kk[0] !== bestMv) { kk[1] = kk[0]; kk[0] = bestMv; }
        }
      }
      return best;
    }

    extractPV(first) {
      const pos = this.pos, pv = [];
      const seen = new Set();
      let mv = first, n = 0;
      while (mv && n < 30) {
        if (!pos.legalMove(mv)) break;
        pos.makeMove(mv); n++; pv.push(mv);
        if (seen.has(pos.key)) break;
        seen.add(pos.key);
        const i = pos.key & HASH_MASK;
        mv = (this.hLock[i] === pos.lock && this.hFlag[i]) ? this.hMv[i] : 0;
      }
      while (n-- > 0) pos.undoMakeMove();
      return pv;
    }

    /**
     * Tìm nước tốt nhất. opts: { time (ms), depth, onInfo(info), exclude: [mv] }
     * Trả về { move, score, depth, pv, nodes, time }
     */
    think(pos, opts) {
      opts = opts || {};
      this.pos = pos;
      pos.distance = 0;
      this.nodes = 0;
      this.killers = [];
      for (let i = 0; i < 65536; i++) this.history[i] >>= 2;
      const t0 = Date.now();
      this.deadline = t0 + (opts.time || 1000);
      const maxDepth = Math.min(opts.depth || LIMIT_DEPTH, LIMIT_DEPTH - 4);
      this.exclude = opts.exclude || [];
      const legal = pos.legalMoves().filter((m) => !this.exclude.includes(m));
      let result = { move: 0, score: 0, depth: 0, pv: [], nodes: 0, time: 0 };
      if (legal.length === 0) { result.score = this.exclude.length ? -MATE : pos.mateValue(); return result; }
      result.move = legal[0];
      this.rootBest = 0;
      if (legal.length === 1 && !opts.fullOnForced) {
        result.score = pos.evaluate(); result.pv = [legal[0]]; return result;
      }
      for (let d = 1; d <= maxDepth; d++) {
        this.iterBest = 0; this.iterScore = 0;
        try {
          const vl = this.search(d, -MATE, MATE, false);
          if (this.iterBest) { this.rootBest = this.iterBest; }
          result = {
            move: this.rootBest || result.move, score: vl, depth: d,
            pv: this.extractPV(this.rootBest || result.move), nodes: this.nodes, time: Date.now() - t0,
          };
          if (opts.onInfo) opts.onInfo(result);
          if (Math.abs(vl) > WIN && d > 2 * (MATE - Math.abs(vl)) + 2) break;
          if (Date.now() - t0 > (opts.time || 1000) * 0.55) break;
        } catch (e) {
          if (!(e instanceof StopSearch)) throw e;
          while (pos.distance > 0) {
            if (pos.mvList[pos.mvList.length - 1] === 0) pos.undoNullMove(); else pos.undoMakeMove();
          }
          if (this.iterBest && this.iterBest !== result.move) {
            result = { ...result, move: this.iterBest, score: this.iterScore, pv: this.extractPV(this.iterBest) };
          }
          break;
        }
      }
      result.nodes = this.nodes; result.time = Date.now() - t0;
      return result;
    }
  }

  // ---------- Ký hiệu ----------
  // Ký hiệu ICCS: cột a..i (trái sang phải phía Đỏ), hàng 0..9 (từ dưới Đỏ lên)
  function moveToIccs(mv) {
    const s = SRC(mv), d = DST(mv);
    const f = (sq) => String.fromCharCode(97 + (sq & 15) - 3) + (12 - (sq >> 4));
    return f(s) + f(d);
  }
  function iccsToMove(str) {
    const m = /^([a-i])([0-9])-?([a-i])([0-9])$/i.exec(str.trim());
    if (!m) return 0;
    const sq = (c, r) => COORD(c.toLowerCase().charCodeAt(0) - 97 + 3, 12 - Number(r));
    return MOVE(sq(m[1], m[2]), sq(m[3], m[4]));
  }

  const VN_LETTER = ['Tg', 'S', 'T', 'M', 'X', 'P', 'B'];
  const VN_NAME = ['Tướng', 'Sĩ', 'Tượng', 'Mã', 'Xe', 'Pháo', 'Tốt'];

  // Ký hiệu kiểu Việt Nam: P2-5 (bình), M8.7 (tiến), X1/2 (thoái); Xt/Xs = xe trước/sau
  function moveToVN(pos, mv) {
    const s = SRC(mv), d = DST(mv);
    const pc = pos.board[s];
    if (!pc) return '?';
    const sd = pc < 16 ? 0 : 1, type = pc & 7;
    const col = (sq) => (sq & 15) - 3, row = (sq) => (sq >> 4) - 3;
    const fileNo = (sq) => sd === 0 ? 9 - col(sq) : col(sq) + 1;
    let name = VN_LETTER[type];
    const same = [];
    for (let y = 3; y <= 12; y++) { const q = COORD(s & 15, y); if (pos.board[q] === pc) same.push(q); }
    if (same.length > 1 && type !== KING && type !== ADVISOR && type !== BISHOP) {
      // sắp xếp từ trước ra sau theo hướng tiến của bên đi
      same.sort((a, b) => sd === 0 ? row(a) - row(b) : row(b) - row(a));
      const idx = same.indexOf(s);
      if (same.length === 2) name += idx === 0 ? 't' : 's';
      else name += idx === 0 ? 't' : idx === same.length - 1 ? 's' : 'g';
    } else name += fileNo(s);
    const dy = row(d) - row(s);
    const forward = sd === 0 ? dy < 0 : dy > 0;
    if (dy === 0) return name + '-' + fileNo(d);
    const sym = forward ? '.' : '/';
    if (type === KNIGHT || type === ADVISOR || type === BISHOP) return name + sym + fileNo(d);
    return name + sym + Math.abs(dy);
  }

  function scoreText(score, sdToMove) {
    // điểm theo góc nhìn bên Đỏ
    const red = sdToMove === 0 ? score : -score;
    if (Math.abs(red) > WIN) {
      const plies = MATE - Math.abs(red);
      const moves = Math.max(1, Math.ceil(plies / 2));
      return (red > 0 ? 'Đỏ' : 'Đen') + ' chiếu bí sau ' + moves + ' nước';
    }
    return (red >= 0 ? '+' : '') + (red / 100).toFixed(2);
  }

  // Nhiều phương án: tìm nước tốt nhất, rồi loại nó ra để tìm nước tốt thứ hai, thứ ba...
  function multiPV(searcher, pos, time, n, onInfo) {
    const out = [], exclude = [];
    const total = Math.min(n, pos.legalMoves().length);
    for (let k = 0; k < total; k++) {
      const share = k === 0 ? time * 0.5 : (time * 0.5) / Math.max(1, total - 1);
      const r = searcher.think(pos, { time: Math.max(150, share), exclude: exclude.slice(), fullOnForced: true, onInfo: (info) => onInfo && onInfo(k, info) });
      if (!r.move) break;
      out.push(r); exclude.push(r.move);
      if (onInfo) onInfo(k, r);
    }
    return out;
  }

  const api = {
    multiPV,
    Position, Searcher, START_FEN, MATE, WIN, BAN,
    KING, ADVISOR, BISHOP, KNIGHT, ROOK, CANNON, PAWN,
    SRC, DST, MOVE, COORD, IN_BOARD, IN_FORT, HOME_HALF,
    moveToIccs, iccsToMove, moveToVN, scoreText, VN_NAME, VN_LETTER,
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.XQ = api;

  // ---------- Chế độ Web Worker ----------
  const isWorker = typeof WorkerGlobalScope !== 'undefined' && root instanceof WorkerGlobalScope;
  if (isWorker) {
    const searcher = new Searcher();
    root.onmessage = (e) => {
      const m = e.data;
      const pos = new Position().fromFen(m.fen);
      for (const mv of m.moves || []) pos.makeMove(mv);
      if (m.cmd === 'search') {
        const r = searcher.think(pos, {
          time: m.time, depth: m.depth, fullOnForced: !!m.full,
          onInfo: (info) => root.postMessage({ id: m.id, type: 'info', info }),
        });
        root.postMessage({ id: m.id, type: 'done', result: r });
      } else if (m.cmd === 'multi') {
        root.postMessage({ id: m.id, type: 'done', result: multiPV(searcher, pos, m.time, m.n, (k, info) => root.postMessage({ id: m.id, type: 'info', k, info })) });
      }
    };
  }
})(typeof self !== 'undefined' ? self : (typeof globalThis !== 'undefined' ? globalThis : this));
