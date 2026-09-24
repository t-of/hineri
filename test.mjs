// 遊びの中身の確かめ。node test.mjs
import assert from 'node:assert/strict';
import { geometry, twistBoard, findTwist, winLines, judge, cpuMove } from './game.js';
import { Vector3, Quaternion } from './vendor/three.module.min.js';

const randomBoard = (g, fill = 0.6) => Int8Array.from({ length: g.count }, () => (Math.random() < fill ? 1 + (Math.random() < 0.5) : 0));
const same = (a, b) => a.every((v, k) => v === b[k]);
const twistBoardOr = (g, b, m, who) => { const b1 = b.slice(); b1[m.cell] = who; return m.twist ? twistBoard(g, b1, m.twist) : b1; };
// 確かめ用に素直に書いた「who の 2 手必勝があるか」（who の手 → 相手の全部の手 → who が 1 手で勝てる）
function oneMoveWin(g, b, who) {
  for (let c = 0; c < g.count; c++) if (!b[c]) for (const t of [null, ...g.twists]) {
    const b1 = b.slice(); b1[c] = who;
    if (winLines(g, b1, who).length || winLines(g, t ? twistBoard(g, b1, t) : b1, who).length) return true;
  }
  return false;
}
function hasWin2Test(g, b, who) {
  const opp = 3 - who;
  for (let c = 0; c < g.count; c++) if (!b[c]) for (const t of [null, ...g.twists]) {
    const b1 = b.slice(); b1[c] = who;
    if (winLines(g, b1, who).length) return true;
    const b2 = t ? twistBoard(g, b1, t) : b1, r = judge(g, b2, who);
    if (r) { if (r.winner === who) return true; continue; }
    if (!oneMoveWin(g, b2, who)) continue;
    let all = true;
    for (let c2 = 0; c2 < g.count && all; c2++) if (!b2[c2]) for (const t2 of [null, ...g.twists]) {
      const y1 = b2.slice(); y1[c2] = opp;
      if (winLines(g, y1, opp).length) { all = false; break; }
      const y2 = t2 ? twistBoard(g, y1, t2) : y1, r2 = judge(g, y2, opp);
      if (r2) { if (r2.winner === opp || r2.winner === 0) { all = false; break; } continue; }
      if (!oneMoveWin(g, y2, who)) { all = false; break; }
    }
    if (all) return true;
  }
  return false;
}

for (const N of [3, 4]) {
  const g = geometry(N);

  // マスの数は 6N²、(位置, 向き) はすべて違い、どれも表面にある
  assert.equal(g.count, 6 * N * N);
  assert.equal(new Set(g.pos.map((p, k) => `${p}|${g.nrm[k]}`)).size, g.count);
  g.pos.forEach((p, k) => { const a = g.nrm[k].findIndex((x) => x); assert.equal(p[a], g.nrm[k][a] > 0 ? N - 1 : 0); });
  assert.equal(g.lines.length, 6 * (2 * N + 2));
  assert.equal(g.twists.length, 6 * N);

  for (const t of g.twists) {
    // 並べ替えになっている（マスの数が変わらない）
    assert.equal(new Set(t.perm).size, g.count);
    const b = randomBoard(g);
    // 同じひねり 4 回で元に戻る
    let x = b;
    for (let r = 0; r < 4; r++) x = twistBoard(g, x, t);
    assert.ok(same(x, b), `4 回で戻らない axis=${t.axis} layer=${t.layer} s=${t.s}`);
    // +1 と −1 で元に戻る
    const back = findTwist(g, t.axis, t.layer, -t.s);
    assert.ok(same(twistBoard(g, twistBoard(g, b, t), back), b));
    // 動くのは層のマスだけで、端の層の面はその面の中で回る
    t.perm.forEach((to, k) => {
      if (g.pos[k][t.axis] !== t.layer) assert.equal(to, k);
      if (g.nrm[k][t.axis]) assert.deepEqual(g.nrm[to], g.nrm[k]);
      else if (g.pos[k][t.axis] === t.layer) assert.notDeepEqual(g.nrm[to], g.nrm[k]);
    });
    // 画面の回し方（main.js の angleOf: s=+1 は −90°）で回したマスが、perm の行き先に重なる
    const c = (N - 1) / 2, at = (k) => new Vector3(...g.pos[k].map((v, i) => v - c + g.nrm[k][i] / 2));
    const q = new Quaternion().setFromAxisAngle(new Vector3().setComponent(t.axis, 1), -t.s * Math.PI / 2);
    t.perm.forEach((to, k) => g.pos[k][t.axis] !== t.layer || assert.ok(at(k).applyQuaternion(q).distanceTo(at(to)) < 1e-6));
  }

  // 勝ちの判定: 手番の人を優先、相手の列だけなら相手、埋まれば引き分け
  const [l0, l1] = [g.lines[0], g.lines[g.lines.length - 1]];
  const both = new Int8Array(g.count);
  l0.forEach((k) => (both[k] = 1)); l1.forEach((k) => (both[k] = 2));
  assert.equal(judge(g, both, 2).winner, 2);
  assert.equal(judge(g, both, 1).winner, 1);
  const oppOnly = new Int8Array(g.count); l0.forEach((k) => (oppOnly[k] = 2));
  assert.equal(judge(g, oppOnly, 1).winner, 2);
  assert.equal(judge(g, new Int8Array(g.count), 1), null);
  // ひねって相手の列を作ってしまう: 相手の列を 1 つ戻したものからひねる
  const t = g.twists.find((tw) => l0.some((k) => g.pos[k][tw.axis] === tw.layer) && !l0.every((k) => g.pos[k][tw.axis] === tw.layer));
  const pre = twistBoard(g, oppOnly, findTwist(g, t.axis, t.layer, -t.s));
  assert.equal(winLines(g, pre, 2).length, 0);
  assert.equal(judge(g, twistBoard(g, pre, t), 1).winner, 2);

  // 引き分け: 列のない埋まった盤（見つかるまで乱数で作る）
  for (let tries = 0; tries < 5000; tries++) {
    const full = Int8Array.from({ length: g.count }, () => 1 + (Math.random() < 0.5));
    if (!winLines(g, full, 1).length && !winLines(g, full, 2).length) { assert.equal(judge(g, full, 1).winner, 0); break; }
  }

  // CPU: 置くだけで勝てる手を指す
  const two = new Int8Array(g.count); l0.slice(1).forEach((k) => (two[k] = 2));
  assert.equal(cpuMove(g, two, 2).cell, l0[0]);

  // CPU: 自分から負ける手（相手の列だけができる）を指さない。時間も測る
  let worst = 0;
  for (let r = 0; r < 20; r++) {
    let b;
    do b = randomBoard(g, 0.4); while (winLines(g, b, 1).length || winLines(g, b, 2).length);
    const t0 = performance.now();
    const m = cpuMove(g, b, 1);
    worst = Math.max(worst, performance.now() - t0);
    assert.equal(b[m.cell], 0);
    const b1 = b.slice(); b1[m.cell] = 1;
    const after = m.twist ? twistBoard(g, b1, m.twist) : b1;
    const r2 = judge(g, after, 1);
    assert.ok(!r2 || r2.winner !== 2, 'CPU が負ける手を指した');
  }
  // CPU: 相手に次の手で「2 手必勝」を残す手を避ける。
  // 下の盤は、前の CPU（相手の 1 手先だけ読む）が後手で指すと、先手に 2 手必勝を残していた局面
  if (N === 4) {
    const b = Int8Array.from('100010000000100000000000000000000000000000000000000000000000000000000000002000200000000000000000', Number);
    const m = cpuMove(g, b, 2);
    assert.ok(!hasWin2Test(g, twistBoardOr(g, b, m, 2), 1), 'CPU が相手の 2 手必勝を残した');
  }
  console.log(`N=${N}: ok（CPU いちばん遅い 1 手 ${worst.toFixed(0)}ms）`);
}
console.log('すべて合格');
