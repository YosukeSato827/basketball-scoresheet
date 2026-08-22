// 記録画面のタイマー同期：遅れ表示と補間の検証
// - 古い値が毎秒届き続けている状態を「LIVE」と誤表示しないこと（2026.08.22-1）
// - 配信経路の遅れ（lagMs）を補間の起点に反映すること。ただし大きすぎる遅れは補外しない
const fs = require('fs');
const vm = require('vm');
const { JSDOM } = require('jsdom');

const src = fs.readFileSync(process.argv[2], 'utf8');
const checks = [];
const t = (n, ok) => checks.push([n, ok]);

function extractFn(name) {
  const start = src.indexOf(`function ${name}(`);
  if (start < 0) throw new Error(`function not found: ${name}`);
  let depth = 0;
  for (let j = src.indexOf('{', start); j < src.length; j++) {
    if (src[j] === '{') depth++;
    else if (src[j] === '}') { depth--; if (depth === 0) return src.slice(start, j + 1); }
  }
  throw new Error('unbalanced: ' + name);
}

const NOW = 1787365534176;
const dom = new JSDOM(`<!doctype html><html><body>
  <span id="timer-sync-status"></span>
  <div id="rec-timer-display"></div>
  <div id="rec-shot-clock"></div>
</body></html>`);
const doc = dom.window.document;

const ctx = {
  console, document: doc, window: dom.window,
  Date: { now: () => NOW },   // 時刻を固定して判定を安定させる
  Math, JSON,
  timerSyncMode: true, timerLastUpdatedAt: NOW, timerSyncLagMs: null,
  timerSyncState: { gameSec: null, shotSec: null, running: false, receivedAt: 0 },
  recTimerSyncDisplay: '',
};
vm.createContext(ctx);
vm.runInContext(['updateTimerSyncStatus', 'renderSyncedTimer', '_fmtGameClock']
  .map(extractFn).join('\n'), ctx);

// ---- 1) 状態表示 ----
const status = (lagMs, sinceRecvMs) => {
  ctx.timerSyncMode = true;
  ctx.timerSyncLagMs = lagMs;
  ctx.timerLastUpdatedAt = NOW - sinceRecvMs;
  vm.runInContext('updateTimerSyncStatus()', ctx);
  const el = doc.getElementById('timer-sync-status');
  return { text: el.textContent, cls: el.className };
};
// lagMs が無い場合（Lambda v3 以前）は従来どおり「受信からの経過」
t('lagMsなし・受信直後 → LIVE', status(null, 100).text === '● LIVE');
t('lagMsなし・5秒経過 → 5秒前', status(null, 5000).text === '● 5秒前');
// lagMs がある場合は「実機からの遅れ」。ここが今回の要点
t('lagMs 0.5秒・受信直後 → LIVE', status(500, 100).text === '● LIVE');
t('配信が26秒遅れなら受信直後でも遅れとして出る', status(26000, 100).text === '● 26秒遅れ');
t('26秒遅れは offline 表示', status(26000, 100).cls.includes('offline'));
t('配信4秒＋受信後2秒＝6秒遅れ', status(4000, 2000).text === '● 6秒遅れ');
t('6秒遅れは stale 表示', status(4000, 2000).cls.includes('stale'));
t('1分を超えたら分で出す', status(200000, 0).text === '● 3分遅れ');
t('受信が無ければ待機中', (() => {
  ctx.timerLastUpdatedAt = null;
  vm.runInContext('updateTimerSyncStatus()', ctx);
  return doc.getElementById('timer-sync-status').textContent === '待機中…';
})());
t('同期OFFなら空欄', (() => {
  ctx.timerSyncMode = false;
  vm.runInContext('updateTimerSyncStatus()', ctx);
  return doc.getElementById('timer-sync-status').textContent === '';
})());

// ---- 2) 補間（ローカル減算）----
const render = (lagMs, gameSec, running, sinceRecvMs) => {
  ctx.timerSyncLagMs = lagMs;
  ctx.timerSyncState = { gameSec, shotSec: null, running, receivedAt: NOW - sinceRecvMs };
  vm.runInContext('renderSyncedTimer()', ctx);
  return doc.getElementById('rec-timer-display').textContent;
};
t('停止中は補間しない', render(2000, 100, false, 5000) === '1:40');
t('lagMsなし → 受信からの経過だけ引く', render(null, 100, true, 3000) === '1:37');
t('lagMs 1秒ぶんも上乗せして引く', render(1000, 100, true, 3000) === '1:36');
t('3秒までの遅れは補正する', render(3000, 100, true, 0) === '1:37');
t('3秒を超える遅れは補正しない', render(26000, 100, true, 0) === '1:40');
t('負のlagMsは無視する', render(-5000, 100, true, 0) === '1:40');
t('0秒未満にはならない', render(null, 2, true, 10000) === '0:00');

let pass = true;
for (const [n, ok] of checks) { console.log((ok ? '✅' : '❌') + ' ' + n); if (!ok) pass = false; }
process.exit(pass ? 0 : 1);
