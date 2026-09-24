// 盤とルールと CPU。描画から切り離してあり、node test.mjs で確かめられる。
//
// マスは 6N² 個。マス k の位置 pos[k]=[x,y,z]（各 0〜N−1）と外向きの向き nrm[k]（±1 が 1 つ）は固定で、
// 盤は「マス k に何があるか」（0 空 / 1 先手 / 2 後手）の配列。ひねりは盤の中身の並べ替え（perm）で表す。

// 軸 a 以外の 2 軸 (i, j)。a=x → (y,z)、a=y → (z,x)、a=z → (x,y)
const IJ = [[1, 2], [2, 0], [0, 1]];
const cache = {};

export function geometry(N) {
  if (cache[N]) return cache[N];
  const N2 = N * N;
  const count = 6 * N2;
  const index = (p, n) => {
    const a = n[0] ? 0 : n[1] ? 1 : 2;
    const [i, j] = IJ[a];
    return (a * 2 + (n[a] > 0 ? 1 : 0)) * N2 + p[i] * N + p[j];
  };

  // 面 f = 軸*2 + (正の側なら 1)。面の中は (u, v) = (p[i], p[j])
  const pos = [], nrm = [], lines = [];
  for (let f = 0; f < 6; f++) {
    const a = f >> 1, plus = f & 1, [i, j] = IJ[a];
    for (let u = 0; u < N; u++) for (let v = 0; v < N; v++) {
      const p = [0, 0, 0], n = [0, 0, 0];
      p[a] = plus ? N - 1 : 0; p[i] = u; p[j] = v;
      n[a] = plus ? 1 : -1;
      pos.push(p); nrm.push(n);
    }
    // 面の中の列だけ（辺を越える列は数えない）: 横 N、縦 N、斜め 2
    const base = f * N2, at = (u, v) => base + u * N + v, r = [...Array(N).keys()];
    for (const u of r) lines.push(r.map((v) => at(u, v)));
    for (const v of r) lines.push(r.map((u) => at(u, v)));
    lines.push(r.map((u) => at(u, u)));
    lines.push(r.map((u) => at(u, N - 1 - u)));
  }

  // ひねり（軸 a、層 layer、向き s）: マス k の中身は perm[k] へ動く
  const twists = [];
  for (let a = 0; a < 3; a++) for (let layer = 0; layer < N; layer++) for (const s of [1, -1]) {
    const [i, j] = IJ[a];
    const perm = new Int16Array(count);
    for (let k = 0; k < count; k++) {
      const p = pos[k], n = nrm[k];
      if (p[a] !== layer) { perm[k] = k; continue; }
      const p2 = [...p], n2 = [...n];
      if (s === 1) { p2[i] = p[j]; p2[j] = N - 1 - p[i]; n2[i] = n[j]; n2[j] = -n[i]; }
      else { p2[i] = N - 1 - p[j]; p2[j] = p[i]; n2[i] = -n[j]; n2[j] = n[i]; }
      perm[k] = index(p2, n2);
    }
    twists.push({ axis: a, layer, s, perm });
  }

  return (cache[N] = { N, count, pos, nrm, lines, twists });
}

export function findTwist(g, axis, layer, s) {
  return g.twists.find((t) => t.axis === axis && t.layer === layer && t.s === s);
}

// 別の入れ物に作る（同じ配列を書き換えると行き先が元のマスを上書きする）
export function twistBoard(g, board, t) {
  const out = new Int8Array(board.length);
  for (let k = 0; k < board.length; k++) out[t.perm[k]] = board[k];
  return out;
}

export function winLines(g, board, who) {
  return g.lines.filter((l) => l.every((k) => board[k] === who));
}
const hasLine = (g, board, who) => g.lines.some((l) => l.every((k) => board[k] === who));

// ひねった（またはひねらなかった）直後の判定。手番の人を優先する。
// → { winner: 1|2, lines } / { winner: 0 }（引き分け） / null（続く）
export function judge(g, board, mover) {
  const mine = winLines(g, board, mover);
  if (mine.length) return { winner: mover, lines: mine };
  const other = winLines(g, board, 3 - mover);
  if (other.length) return { winner: 3 - mover, lines: other };
  if (!board.includes(0)) return { winner: 0, lines: [] };
  return null;
}

// ---- CPU（ふつう） ----

function evaluate(g, b, me) {
  let score = 0;
  for (const l of g.lines) {
    let m = 0, o = 0;
    for (const k of l) { if (b[k] === me) m++; else if (b[k]) o++; }
    if (m && !o) score += 4 ** m;
    else if (o && !m) score -= 1.2 * 4 ** o;
  }
  return score;
}

const empties = (b) => { const e = []; for (let k = 0; k < b.length; k++) if (!b[k]) e.push(k); return e; };

// who が次の 1 手（置く＋ひねる）で勝てるか
function canWin(g, b, who) {
  for (const c of empties(b)) {
    const b1 = b.slice(); b1[c] = who;
    if (hasLine(g, b1, who)) return true;
    for (const t of g.twists) if (hasLine(g, twistBoard(g, b1, t), who)) return true;
  }
  return false;
}

// → { cell, twist: ひねり or null }
export function cpuMove(g, board, me, rng = Math.random) {
  const opp = 3 - me;
  const cells = empties(board);
  // 1. 置くだけで勝てる手
  for (const c of cells) {
    const b = board.slice(); b[c] = me;
    if (hasLine(g, b, me)) return { cell: c, twist: null };
  }
  const wins = [], cands = [];
  for (const c of cells) {
    const b1 = board.slice(); b1[c] = me;
    for (const t of [null, ...g.twists]) {
      const b2 = t ? twistBoard(g, b1, t) : b1;
      if (hasLine(g, b2, me)) wins.push({ cell: c, twist: t });         // 1. ひねって勝てる
      else if (!hasLine(g, b2, opp)) cands.push({ cell: c, twist: t, b: b2, score: evaluate(g, b2, me) + rng() * 1e-6 }); // 2. 負ける手は捨てる
    }
  }
  if (wins.length) return wins[Math.floor(rng() * wins.length)];
  // 3〜5. 評価値で並べ（同点は乱数で散らす）、上位 12 手から相手が次に勝てない最初の手
  cands.sort((x, y) => y.score - x.score);
  const pick = cands.slice(0, 12).find((m) => !canWin(g, m.b, opp)) || cands[0];
  return { cell: pick.cell, twist: pick.twist };
}
