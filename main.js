// ひねり並べ。描画と操作。ルールと CPU は game.js（node test.mjs で確かめる）。
import * as THREE from './vendor/three.module.min.js';
import { geometry, twistBoard, findTwist, winLines, judge, cpuMove } from './game.js';

// localStorage はほかのアプリと共有される（同じ t-of.github.io のため）。
// キーは必ず 'hineri.' で始める。
const STORE = 'hineri.';

function load(key, fallback) {
  try {
    const v = localStorage.getItem(STORE + key);
    return v == null ? fallback : JSON.parse(v);
  } catch { return fallback; }
}
function save(key, value) {
  try { localStorage.setItem(STORE + key, JSON.stringify(value)); } catch { /* 保存できなくても遊べる */ }
}

WebAppKit.init({ title: 'ひねり並べ', text: '立方体の面に印を置き、置いたあとに列を 1 回だけひねれる目並べ。ひねれば相手の列を崩すことも、自分の列を作ることもできる。CPU 対戦・ふたり対戦。' });

if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('./sw.js');
}

// 音を使うときは、鳴らす前と音の設定を切り替えたときにこれを呼ぶ（RULES.md §5「音」）。初版は音なし。
function setAudioSession(soundOn) {
  try { if (navigator.audioSession) navigator.audioSession.type = soundOn ? 'playback' : 'auto'; } catch { /* 対応していない */ }
}

// ---- 調整のつまみ ----
const TWIST_TILES = 2;        // 指がマス何個分動いたら 90° か
const TAP_PX = 8;             // これ未満の動きはタップ
const TWIST_START_PX = 10;    // ひねりの向きを決める動き
const VIEW_RAD_PER_PX = 0.008;
const REDUCED = matchMedia('(prefers-reduced-motion: reduce)').matches;
const TWIST_MS = REDUCED ? 120 : 300;

const COLOR = { bg: '#0e1220', tile: '#ece6d9', groove: '#c7bfae', p1: '#e5533d', p2: '#2f6fdb', gold: '#ffd35c' };
const MARK = { 1: '●', 2: '■' };

// ---- 保存 ----
const settings = Object.assign({ v: 1, mode: 'cpu', size: 3, cpuSide: 'first', seenHelp: false }, load('settings', {}));
if (![3, 4].includes(settings.size)) settings.size = 3;
const stats = load('stats', null)?.v === 1 ? load('stats') : { v: 1, cpu: {} };
for (const n of ['3', '4']) stats.cpu[n] = Object.assign({ win: 0, lose: 0, draw: 0 }, stats.cpu[n]);

// ---- 状態 ----
const S = {
  screen: 'title',   // title / play / over
  mode: 'cpu', N: settings.size, human: 1,
  g: null, board: null, turn: 1,
  phase: 'place',    // place / twist / busy（アニメーション中・CPU の番）
  tent: -1, last: -1, placed: 0, win: new Set(), tok: 0,
};

// ---- Three.js ----
const $ = (id) => document.getElementById(id);
const canvas = $('view');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
const scene = new THREE.Scene();
scene.background = new THREE.Color(COLOR.bg);
const FOV = 30;
const camera = new THREE.PerspectiveCamera(FOV, 1, 0.1, 100);
scene.add(new THREE.AmbientLight(0xffffff, 1.5));
const sun = new THREE.DirectionalLight(0xffffff, 1.6);
sun.position.set(-2, 4, 5);
scene.add(sun);
const root = new THREE.Group();     // 立方体全体。視点の回転はこれを回す
const pivot = new THREE.Group();    // ひねっている層だけを一時的に入れる
scene.add(root);
root.add(pivot);
const HOME = new THREE.Quaternion().setFromEuler(new THREE.Euler(0.6, -Math.PI / 4, 0, 'XYZ'));
root.quaternion.copy(HOME);

let tiles = [], cubies = [];
const plane = new THREE.PlaneGeometry(1, 1);
const cubieGeo = new THREE.BoxGeometry(0.999, 0.999, 0.999);
const cubieMat = new THREE.MeshLambertMaterial({ color: COLOR.groove });
const Z = new THREE.Vector3(0, 0, 1);

// 中身は溝の色の小さな箱（表面の位置ごとに 1 つ）。層を回すと箱も一緒に回るので、
// 45° のときも回っている層のマスが中身に隠れず、隙間は溝の色に見える
function buildCube(N) {
  for (const m of tiles) { m.removeFromParent(); m.material.dispose(); }
  for (const m of cubies) m.removeFromParent();
  S.g = geometry(N);
  const c = (N - 1) / 2;
  const seen = new Set();
  cubies = [];
  for (const p of S.g.pos) {
    if (seen.has(`${p}`)) continue;
    seen.add(`${p}`);
    const m = new THREE.Mesh(cubieGeo, cubieMat);
    m.position.set(p[0] - c, p[1] - c, p[2] - c);
    m.userData.p = p;
    root.add(m);
    cubies.push(m);
  }
  tiles = S.g.pos.map((p, k) => {
    const n = S.g.nrm[k];
    const m = new THREE.Mesh(plane, new THREE.MeshLambertMaterial({ map: tileTex(0, 0, false, false), alphaTest: 0.5 }));
    m.position.set(p[0] - c + n[0] / 2, p[1] - c + n[1] / 2, p[2] - c + n[2] / 2);
    m.quaternion.setFromUnitVectors(Z, new THREE.Vector3(...n));
    m.userData.k = k;
    root.add(m);
    return m;
  });
}

// マスの絵。状態の組み合わせごとに 1 枚作って使い回す
const texCache = new Map();
function tileTex(v, tent, last, win) {
  const key = `${v}${tent}${+last}${+win}`;
  if (texCache.has(key)) return texCache.get(key);
  const W = 128, cv = document.createElement('canvas');
  cv.width = cv.height = W;
  const x = cv.getContext('2d');
  const rr = (m, r) => { x.beginPath(); x.roundRect(m, m, W - 2 * m, W - 2 * m, r); };
  rr(5, 18); x.fillStyle = COLOR.tile; x.fill();
  if (win) { x.fillStyle = v === 1 ? 'rgba(229,83,61,0.3)' : 'rgba(47,111,219,0.3)'; x.fill(); }
  const mk = v || tent;
  if (mk) {
    x.globalAlpha = v ? 1 : 0.4;
    x.fillStyle = mk === 1 ? COLOR.p1 : COLOR.p2;
    x.beginPath();
    if (mk === 1) x.arc(W / 2, W / 2, W * 0.29, 0, Math.PI * 2);
    else x.roundRect(W * 0.23, W * 0.23, W * 0.54, W * 0.54, W * 0.1);
    x.fill();
    x.globalAlpha = 1;
  }
  if (tent) {  // 仮置き: 白い点線の枠（明るいマスの上でも見えるよう下に影）
    x.setLineDash([12, 9]); rr(14, 12);
    x.lineWidth = 11; x.strokeStyle = 'rgba(14,18,32,0.6)'; x.stroke();
    x.lineWidth = 5; x.strokeStyle = '#fff'; x.stroke();
    x.setLineDash([]);
  }
  if (last) {  // 最後に置いたマス: 金の細い枠
    rr(11, 14);
    x.lineWidth = 10; x.strokeStyle = '#a07a12'; x.stroke();
    x.lineWidth = 5; x.strokeStyle = COLOR.gold; x.stroke();
  }
  const t = new THREE.CanvasTexture(cv);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = renderer.capabilities.getMaxAnisotropy();
  texCache.set(key, t);
  return t;
}

function paint() {
  const winColor = new THREE.Color(S.winner === 2 ? COLOR.p2 : COLOR.p1);
  tiles.forEach((m, k) => {
    m.material.map = tileTex(S.board[k], k === S.tent ? S.turn : 0, k === S.last, S.win.has(k));
    if (S.win.has(k)) { m.material.emissive.copy(winColor); m.material.emissiveIntensity = 0.35; }
    else if (m.parent !== pivot) m.material.emissive.setHex(0);
  });
  kick();
}

// ---- 画面の大きさと立方体の位置 ----
// [立方体の外接球の直径 / 画面幅, 中心の高さ / 画面の高さ]
const FRAME = { title: [0.6, 0.35], play: [0.92, 0.48], over: [0.76, 0.36] };
function frameView() {
  const w = innerWidth, h = innerHeight;
  renderer.setSize(w, h, false);
  camera.aspect = w / h;
  const [size, cy] = FRAME[S.screen];
  const target = Math.min(size * w, 0.56 * h);
  const d = (S.N * 0.87 * h) / (Math.tan((FOV * Math.PI) / 360) * target);
  camera.position.set(0, 0, d);
  camera.near = d / 10;
  camera.far = d * 3;
  camera.setViewOffset(w, h, 0, (0.5 - cy) * h, w, h);
  camera.updateProjectionMatrix();
  kick();
}
addEventListener('resize', frameView);

// ---- 描くのは動きがあるときだけ ----
let raf = 0, lastT = 0, anim = null;
const Y = new THREE.Vector3(0, 1, 0), tmpQ = new THREE.Quaternion();
function kick() { if (!raf) raf = requestAnimationFrame(frame); }
function frame(now) {
  raf = 0;
  const dt = lastT ? Math.min(50, now - lastT) : 16;
  lastT = now;
  let more = false;
  if (anim) {
    const t = Math.min(1, (now - anim.t0) / anim.dur);
    const e = 1 - (1 - t) ** 3;   // 終わりをゆるめる
    pivot.quaternion.setFromAxisAngle(anim.axis, anim.from + (anim.to - anim.from) * e);
    if (t === 1) { const a = anim; anim = null; a.done(); }
    more = true;
  }
  if (S.screen === 'title' && !REDUCED) {
    root.quaternion.premultiply(tmpQ.setFromAxisAngle(Y, dt * 0.00035));
    more = true;
  }
  if (S.screen === 'over' && S.win.size && !REDUCED) {
    const k = 0.3 + 0.22 * Math.sin(now / 280);
    for (const i of S.win) tiles[i].material.emissiveIntensity = k;
    more = true;
  }
  renderer.render(scene, camera);
  if (more || pointers.size) raf = requestAnimationFrame(frame);
  else lastT = 0;
}

// ---- 層をひねる ----
let layerAxis = null;
function beginLayer(axis, layer) {
  layerAxis = new THREE.Vector3().setComponent(axis, 1);
  pivot.quaternion.identity();
  // pivot は回っていないので、移しても位置はそのまま
  for (const m of cubies) if (m.userData.p[axis] === layer) pivot.add(m);
  tiles.forEach((m, k) => {
    if (S.g.pos[k][axis] !== layer) return;
    pivot.add(m);
    m.material.emissive.setHex(0xffffff);   // 動く層を少し明るく
    m.material.emissiveIntensity = 0.1;
  });
  kick();
}
function endLayer() {
  anim = null;
  for (const m of [...pivot.children]) {
    root.add(m);
    if (m.userData.k != null) m.material.emissive.setHex(0);
  }
  pivot.quaternion.identity();
  kick();
}
function turnLayer(from, to) {
  return new Promise((done) => { anim = { axis: layerAxis, from, to, t0: performance.now(), dur: TWIST_MS, done }; kick(); });
}
// 見た目の角度 −90° が s=+1（game.js の式）にあたる
const angleOf = (s) => -s * Math.PI / 2;

function commitTwist(t) {
  S.board = twistBoard(S.g, S.board, t);
  if (S.last >= 0) S.last = t.perm[S.last];
  endLayer();
  paint();
}

// ---- 対局 ----
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const isCpuTurn = () => S.mode === 'cpu' && S.turn !== S.human;
const humanCan = () => S.screen === 'play' && S.phase !== 'busy' && !isCpuTurn();

function startGame(mode) {
  S.tok++;
  endLayer();
  S.mode = mode;
  S.N = settings.size;
  S.human = settings.cpuSide === 'first' ? 1 : 2;
  settings.mode = mode;
  save('settings', settings);
  if (!S.g || S.g.N !== S.N) buildCube(S.N);
  S.board = new Int8Array(S.g.count);
  Object.assign(S, { screen: 'play', turn: 1, phase: 'place', tent: -1, last: -1, placed: 0, win: new Set(), winner: 0 });
  root.quaternion.copy(HOME);
  frameView();
  paint();
  ui();
  if (isCpuTurn()) cpuPlay();
}

function toTitle() {
  S.tok++;
  endLayer();
  S.screen = 'title';
  if (!S.g || S.g.N !== settings.size) { S.N = settings.size; buildCube(S.N); }
  S.board = new Int8Array(S.g.count);
  Object.assign(S, { tent: -1, last: -1, win: new Set() });
  frameView();
  paint();
  ui();
}

// 置く。置いただけで勝てば true
function place(k) {
  S.board[k] = S.turn;
  S.last = k;
  S.tent = -1;
  S.placed++;
  const lines = winLines(S.g, S.board, S.turn);
  if (lines.length) { finish({ winner: S.turn, lines }); return true; }
  S.phase = 'twist';
  paint();
  ui();
  return false;
}

function endTurn() {
  const r = judge(S.g, S.board, S.turn);
  if (r) return finish(r);
  S.turn = 3 - S.turn;
  S.phase = 'place';
  S.tent = -1;
  paint();
  ui();
  if (isCpuTurn()) cpuPlay();
}

async function cpuPlay() {
  const tok = S.tok;
  S.phase = 'busy';
  ui();
  await wait(40);   // 「考え中…」を先に描かせる
  if (tok !== S.tok) return;
  const m = cpuMove(S.g, S.board, S.turn);
  S.tent = m.cell;  // 置くマスを光らせてから置く
  paint();
  await wait(300);
  if (tok !== S.tok || place(m.cell)) return;
  S.phase = 'busy';
  ui();
  await wait(400);
  if (tok !== S.tok) return;
  if (m.twist) {
    beginLayer(m.twist.axis, m.twist.layer);
    await turnLayer(0, angleOf(m.twist.s));
    if (tok !== S.tok) return;
    commitTwist(m.twist);
  }
  endTurn();
}

function finish(r) {
  const mover = S.turn;
  S.screen = 'over';
  S.phase = 'busy';
  S.winner = r.winner;
  S.win = new Set(r.lines.flat());
  let head, share;
  const size = `${S.N}×${S.N}`;
  if (S.mode === 'cpu') {
    const res = r.winner === 0 ? 'draw' : r.winner === S.human ? 'win' : 'lose';
    stats.cpu[S.N][res]++;
    save('stats', stats);
    head = { win: 'あなたの勝ち', lose: 'あなたの負け', draw: '引き分け' }[res];
    share = res === 'win' ? `ひねり並べ（${size}）で CPU に ${S.placed} 手で勝った！`
      : `ひねり並べ（${size}）で CPU と対戦。${res === 'draw' ? '引き分けだった' : '負けた'}`;
  } else {
    head = r.winner === 0 ? '引き分け' : `${r.winner === 1 ? '先手' : '後手'}の勝ち`;
    share = r.winner === 0 ? `ひねり並べ（${size}）でふたり対戦。引き分けだった`
      : `ひねり並べ（${size}）で ${MARK[r.winner]} が ${S.placed} 手で勝った！`;
  }
  const mark = document.createElement('span');
  mark.className = `c${r.winner}`;
  mark.textContent = S.mode === 'pvp' && r.winner ? `${MARK[r.winner]} ` : '';
  $('resText').replaceChildren(mark, head);
  $('resSub').textContent = `${S.placed} 手` + (r.winner && r.winner !== mover ? '・ひねって相手の列ができた' : '');
  $('shareBtn').onclick = () => WebAppKit.share({ text: share });
  frameView();
  paint();
  ui();
}

// ---- 画面の文字とボタン ----
function ui() {
  const title = S.screen === 'title';
  $('title').hidden = !title;
  $('top').hidden = title;
  $('bottom').hidden = S.screen !== 'play';
  $('sheet').hidden = S.screen !== 'over';

  if (title) {
    for (const b of $('sizeSeg').children) b.setAttribute('aria-pressed', String(+b.dataset.v === settings.size));
    for (const b of $('sideSeg').children) b.setAttribute('aria-pressed', String(b.dataset.v === settings.cpuSide));
    const played = ['3', '4'].filter((n) => { const s = stats.cpu[n]; return s.win + s.lose + s.draw; });
    $('stats').textContent = played.length
      ? 'CPU 戦 ' + played.map((n) => { const s = stats.cpu[n]; return `${n}×${n} ${s.win}勝 ${s.lose}敗 ${s.draw}分`; }).join('　')
      : '';
    return;
  }

  if (S.screen === 'over') {
    $('stMark').className = S.winner ? `mark p${S.winner}` : 'mark';
    $('stText').textContent = 'おわり';
    return;
  }
  $('stMark').className = `mark p${S.turn}`;
  const cpu = isCpuTurn();
  const who = S.mode === 'cpu' ? (cpu ? 'CPU' : 'あなた') : S.turn === 1 ? '先手' : '後手';
  $('stText').textContent = `${who}の番・${cpu ? '考え中…' : S.phase === 'twist' ? 'ひねる？' : '置く'}`;
  const act = $('actBtn');
  act.style.visibility = cpu ? 'hidden' : '';
  if (cpu) $('hint').textContent = 'CPU が考えています';
  else if (S.phase === 'twist') { $('hint').textContent = 'マスをなぞると、その列をひねれる'; act.textContent = '回さない'; act.disabled = false; }
  else if (S.phase === 'place') {
    $('hint').textContent = S.tent < 0 ? '空いたマスをタップして仮置き' : 'もう一度タップか「ここに置く」で置く';
    act.textContent = 'ここに置く';
    act.disabled = S.tent < 0;
  }
}

$('actBtn').onclick = () => {
  if (!humanCan()) return;
  if (S.phase === 'place' && S.tent >= 0) place(S.tent);
  else if (S.phase === 'twist') endTurn();
};
$('sizeSeg').onclick = (e) => {
  const v = +e.target.dataset?.v;
  if (!v) return;
  settings.size = v;
  save('settings', settings);
  toTitle();
};
$('sideSeg').onclick = (e) => {
  const v = e.target.dataset?.v;
  if (!v) return;
  settings.cpuSide = v;
  save('settings', settings);
  ui();
};
$('cpuBtn').onclick = () => startGame('cpu');
$('pvpBtn').onclick = () => startGame('pvp');
$('againBtn').onclick = () => startGame(S.mode);
$('toTitleBtn').onclick = toTitle;
$('viewBtn').onclick = () => { root.quaternion.copy(HOME); kick(); };
$('menuBtn').onclick = () => $('menu').showModal();
$('menuClose').onclick = () => $('menu').close();
$('restartBtn').onclick = () => {
  if (S.screen === 'play' && !confirm('最初からやり直す？')) return;
  $('menu').close();
  startGame(S.mode);
};
$('quitBtn').onclick = () => {
  if (S.screen === 'play' && !confirm('対局をやめてタイトルに戻る？')) return;
  $('menu').close();
  toTitle();
};
const openHelp = () => { $('menu').close(); $('help').showModal(); };
$('helpBtn').onclick = openHelp;
$('menuHelpBtn').onclick = openHelp;
$('helpClose').onclick = () => $('help').close();
$('help').addEventListener('close', () => {
  if (!settings.seenHelp) { settings.seenHelp = true; save('settings', settings); }
});

// ---- 指の操作 ----
// 触り始めた場所と段階で分ける: 何もない所・置く段階の立方体 → 視点 / 空きマスのタップ → 仮置き・置く /
// ひねる段階のマス → その層を指について回す / 2 本指 → いつでも視点
const pointers = new Map();
const raycaster = new THREE.Raycaster();
let gesture = null;

function pick(x, y) {
  const r = canvas.getBoundingClientRect();
  raycaster.setFromCamera(new THREE.Vector2(((x - r.left) / r.width) * 2 - 1, -((y - r.top) / r.height) * 2 + 1), camera);
  const hit = raycaster.intersectObjects(tiles, false)[0];
  if (!hit) return null;
  return { k: hit.object.userData.k, local: root.worldToLocal(hit.point.clone()) };
}
function toScreen(v) {
  const p = v.clone().applyMatrix4(root.matrixWorld).project(camera);
  return { x: ((p.x + 1) / 2) * innerWidth, y: ((1 - p.y) / 2) * innerHeight };
}
function rotateView(dx, dy) {
  root.quaternion.premultiply(tmpQ.setFromEuler(new THREE.Euler(dy * VIEW_RAD_PER_PX, dx * VIEW_RAD_PER_PX, 0)));
  kick();
}

// 触ったマスの面以外の 2 軸 × 正負から、「回したとき触った点が画面で動く向き」が指の動きに一番合う軸を選ぶ
function startTwist(gs, mx, my) {
  const P = gs.hit.local;
  const fa = S.g.nrm[gs.hit.k].findIndex((v) => v);
  root.updateMatrixWorld();
  let best = null;
  for (const a of [0, 1, 2]) {
    if (a === fa) continue;
    const vel = new THREE.Vector3().setComponent(a, 1).cross(P);   // +1 rad 回したときの点の速さ
    const s0 = toScreen(P), s1 = toScreen(P.clone().addScaledVector(vel, 0.01));
    const dx = (s1.x - s0.x) / 0.01, dy = (s1.y - s0.y) / 0.01, len = Math.hypot(dx, dy);
    if (len < 1e-3) continue;
    const score = Math.abs(dx * mx + dy * my) / len;
    if (!best || score > best.score) best = { a, score, dir: { x: dx / len, y: dy / len }, tilePx: len / vel.length() };
  }
  if (!best) return;
  Object.assign(gs, { kind: 'twist', axis: best.a, layer: S.g.pos[gs.hit.k][best.a], dir: best.dir, tilePx: best.tilePx, angle: 0 });
  beginLayer(gs.axis, gs.layer);
}

function cancelTwist(gs) {
  const tok = S.tok;
  S.phase = 'busy';
  turnLayer(gs.angle, 0).then(() => {
    if (tok !== S.tok) return;
    endLayer();
    S.phase = 'twist';
    ui();
  });
}

canvas.addEventListener('pointerdown', (e) => {
  canvas.setPointerCapture(e.pointerId);
  pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
  if (pointers.size === 2) {
    if (gesture?.kind === 'twist') cancelTwist(gesture);
    gesture = { kind: 'view2' };
  } else if (pointers.size === 1) {
    gesture = { kind: 'pending', id: e.pointerId, x0: e.clientX, y0: e.clientY, hit: S.screen === 'play' ? pick(e.clientX, e.clientY) : null };
  }
  kick();
});

canvas.addEventListener('pointermove', (e) => {
  const p = pointers.get(e.pointerId);
  if (!p) return;
  const dx = e.clientX - p.x, dy = e.clientY - p.y;
  p.x = e.clientX; p.y = e.clientY;
  const gs = gesture;
  if (!gs) return;
  if (gs.kind === 'view2') { rotateView(dx / 2, dy / 2); return; }
  if (gs.id !== e.pointerId) return;
  const mx = e.clientX - gs.x0, my = e.clientY - gs.y0, dist = Math.hypot(mx, my);
  if (gs.kind === 'pending') {
    if (gs.hit && S.phase === 'twist' && humanCan()) { if (dist >= TWIST_START_PX) startTwist(gs, mx, my); }
    else if (dist >= TAP_PX) gs.kind = 'view';
  }
  if (gs.kind === 'view') rotateView(dx, dy);
  else if (gs.kind === 'twist') {
    const along = mx * gs.dir.x + my * gs.dir.y;
    gs.angle = Math.max(-1, Math.min(1, along / (TWIST_TILES * gs.tilePx))) * Math.PI / 2;
    pivot.quaternion.setFromAxisAngle(layerAxis, gs.angle);
    kick();
  }
});

function release(e, cancelled) {
  if (!pointers.delete(e.pointerId)) return;
  const gs = gesture;
  if (!gs || (gs.kind !== 'view2' && gs.id !== e.pointerId)) return;
  if (gs.kind === 'view2') { if (!pointers.size) gesture = null; return; }
  gesture = null;
  if (gs.kind === 'twist') {
    if (cancelled || Math.abs(gs.angle) < Math.PI / 4) return cancelTwist(gs);
    const s = gs.angle > 0 ? -1 : 1;
    const t = findTwist(S.g, gs.axis, gs.layer, s);
    const tok = S.tok;
    S.phase = 'busy';
    turnLayer(gs.angle, angleOf(s)).then(() => {
      if (tok !== S.tok) return;
      commitTwist(t);
      endTurn();
    });
    return;
  }
  // タップ: 置く段階の空きマス → 仮置き、仮置きしたマスをもう一度 → 置く
  if (!cancelled && gs.kind === 'pending' && gs.hit && S.phase === 'place' && humanCan()) {
    const k = gs.hit.k;
    if (S.board[k]) return;
    if (S.tent === k) place(k);
    else { S.tent = k; paint(); ui(); }
  }
}
canvas.addEventListener('pointerup', (e) => release(e, false));
canvas.addEventListener('pointercancel', (e) => release(e, true));

// ---- はじめ ----
buildCube(S.N);
S.board = new Int8Array(S.g.count);
frameView();
paint();
ui();
if (!settings.seenHelp) $('help').showModal();
