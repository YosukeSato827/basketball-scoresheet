// 観戦ページ／運営画面の更新間隔の検証
// - 観戦ページ：選択肢から「1秒ごと」が消え、保存済みの旧設定も5秒に引き上がること
// - 運営画面：観戦ページとは別の間隔（editorRefreshSec）で取得すること
const fs = require('fs');
const vm = require('vm');

const src = fs.readFileSync(process.argv[2], 'utf8');
const checks = [];
const t = (name, ok) => checks.push([name, ok]);

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

// ---- 1) 更新バーの選択肢 ----
const opts = src.split('\n').filter(l => l.includes('<option value=') && l.includes('自動更新'));
t('自動更新の選択肢は3つ', opts.length === 3);
t('「1秒ごと」の選択肢が無い', !opts.some(l => l.includes('1秒ごと')));
t('最短は「5秒ごと」', opts.some(l => l.includes('5秒ごと')));
t('通信量の注意書きが5秒に付いている', opts.some(l => l.includes('5秒ごと') && l.includes('通信量 多')));

// ---- 2) 選択肢と既定値の定数 ----
const mOpts = src.match(/const VIEWER_REFRESH_OPTIONS = \[([^\]]*)\];/);
const mDef  = src.match(/const VIEWER_DEFAULT_REFRESH_SEC = (\d+);/);
t('選択肢の定数が定義されている', !!mOpts);
t('選択肢は 0/5/10/30（1秒は含まない）', !!mOpts && mOpts[1].replace(/\s/g, '') === '0,5,10,30');
t('既定は10秒', !!mDef && mDef[1] === '10');

// ---- 3) 端末に保存された設定の復元 ----
const initStart = src.indexOf('let viewerRefreshSec = (() => {');
const initEnd = src.indexOf('})();', initStart) + 5;
const initSrc = src.slice(initStart, initEnd).replace('let viewerRefreshSec =', 'restored =');
const restore = (saved) => {
  const ctx = { restored: null, VIEWER_REFRESH_OPTIONS: [0, 5, 10, 30],
                VIEWER_DEFAULT_REFRESH_SEC: 10, localStorage: { getItem: () => saved } };
  vm.createContext(ctx);
  vm.runInContext(initSrc, ctx);
  return ctx.restored;
};
t('保存なし → 既定の10秒', restore(null) === 10);
t('旧「1秒」→ 既定の10秒に戻す', restore('1') === 10);
t('5秒 → そのまま', restore('5') === 5);
t('10秒 → そのまま', restore('10') === 10);
t('30秒 → そのまま', restore('30') === 30);
t('0（手動）→ そのまま', restore('0') === 0);
t('旧15秒 → 既定の10秒', restore('15') === 10);
t('壊れた値 → 既定の10秒', restore('abc') === 10);

// ---- 4) 設定変更時のクランプ ----
const setFn = extractFn('setViewerRefreshMode');
const setMode = (v) => {
  const stored = {};
  const ctx = {
    viewerRefreshSec: 10, VIEWER_REFRESH_OPTIONS: [0, 5, 10, 30], VIEWER_DEFAULT_REFRESH_SEC: 10,
    localStorage: { setItem: (k, val) => { stored[k] = val; } },
    startViewerGamesListener: () => {}, viewerUnsubscribe: null,
    ensureViewerTimerSync: () => {}, viewerLastGameDocs: [], viewerLastTData: null,
    renderTournamentViewer: () => {}, track: () => {}, showToast: () => {},
  };
  vm.createContext(ctx);
  vm.runInContext(setFn, ctx);
  vm.runInContext(`setViewerRefreshMode(${JSON.stringify(v)})`, ctx);
  return { sec: ctx.viewerRefreshSec, saved: stored.viewerRefreshSec };
};
t('1を渡しても既定の10秒に戻す', setMode(1).sec === 10);
t('戻した後の値が保存される', setMode(1).saved === '10');
t('文字列の"3"も既定の10秒に戻す', setMode('3').sec === 10);
t('5はそのまま', setMode(5).sec === 5);
t('10はそのまま', setMode(10).sec === 10);
t('30はそのまま', setMode(30).sec === 30);
t('0（手動）は0のまま', setMode(0).sec === 0);
t('手動を選ぶと0が保存される', setMode(0).saved === '0');

// ---- 5) 運営画面の間隔（観戦ページとは別に持つ）----
const eInitStart = src.indexOf('let editorRefreshSec = (() => {');
const eInitEnd = src.indexOf('})();', eInitStart) + 5;
const eInitSrc = src.slice(eInitStart, eInitEnd).replace('let editorRefreshSec =', 'restored =');
const eRestore = (saved) => {
  const ctx = { restored: null, EDITOR_REFRESH_OPTIONS: [1, 3, 5, 10, 30],
                EDITOR_DEFAULT_REFRESH_SEC: 3, localStorage: { getItem: () => saved } };
  vm.createContext(ctx);
  vm.runInContext(eInitSrc, ctx);
  return ctx.restored;
};
t('運営：保存なし → 既定の3秒', eRestore(null) === 3);
t('運営：1秒も選べる（観戦の下限に縛られない）', eRestore('1') === 1);
t('運営：30秒 → そのまま', eRestore('30') === 30);
t('運営：想定外の値 → 既定の3秒', eRestore('7') === 3);

const setEditor = (v) => {
  const stored = {};
  const ctx = {
    editorRefreshSec: 3, EDITOR_REFRESH_OPTIONS: [1, 3, 5, 10, 30], EDITOR_DEFAULT_REFRESH_SEC: 3,
    localStorage: { setItem: (k, val) => { stored[k] = val; } },
    ensureViewerTimerSync: () => {}, viewerTimerSourceDocs: [], showToast: () => {},
  };
  vm.createContext(ctx);
  vm.runInContext(extractFn('setEditorRefreshMode'), ctx);
  vm.runInContext(`setEditorRefreshMode(${JSON.stringify(v)})`, ctx);
  return { sec: ctx.editorRefreshSec, saved: stored.editorRefreshSec };
};
t('運営：1を選べる', setEditor(1).sec === 1);
t('運営：選んだ値が保存される', setEditor(10).saved === '10');
t('運営：想定外の値は既定に丸める', setEditor(7).sec === 3);

// ---- 6) 取得間隔の切り替え（運営画面 vs 観戦ページ）----
// viewerTimerPollKey は「対象デバイス@間隔」なので、そこから採用された間隔が読める
const pollKey = (opts, viewerSec, editorSec) => {
  const ctx = {
    IS_ARCHIVE: false, viewerRefreshSec: viewerSec, editorRefreshSec: editorSec,
    viewerTimerAlwaysPoll: false, viewerTimerSourceDocs: [],
    viewerTimerPollIv: null, viewerTimerPollKey: '', viewerTimerIv: null,
    viewerTimerData: {}, viewerTimerReceivedAt: {},
    fetchViewerTimers: () => {}, renderViewerTimerStrips: () => {},
    setInterval: () => 1, clearInterval: () => {},
  };
  vm.createContext(ctx);
  vm.runInContext(extractFn('viewerActiveTimerDevices'), ctx);
  vm.runInContext(extractFn('ensureViewerTimerSync'), ctx);
  vm.runInContext(`ensureViewerTimerSync([{ timerDeviceId: 'dev1', status: 'live' }], ${JSON.stringify(opts)})`, ctx);
  return ctx.viewerTimerPollKey;
};
t('運営画面は運営の間隔を使う', pollKey({ alwaysPoll: true }, 10, 3) === 'dev1@3');
t('観戦ページは閲覧者の間隔を使う', pollKey(null, 10, 3) === 'dev1@10');
t('観戦ページの「手動」は取得なし', pollKey(null, 0, 3) === 'dev1@0');
t('観戦が手動でも運営画面は動く', pollKey({ alwaysPoll: true }, 0, 1) === 'dev1@1');
t('終了済みの試合は取得対象にしない', (() => {
  const ctx = {
    IS_ARCHIVE: false, viewerRefreshSec: 10, editorRefreshSec: 3,
    viewerTimerAlwaysPoll: false, viewerTimerSourceDocs: [],
    viewerTimerPollIv: null, viewerTimerPollKey: '', viewerTimerIv: null,
    viewerTimerData: {}, viewerTimerReceivedAt: {},
    fetchViewerTimers: () => {}, renderViewerTimerStrips: () => {},
    setInterval: () => 1, clearInterval: () => {},
  };
  vm.createContext(ctx);
  vm.runInContext(extractFn('viewerActiveTimerDevices'), ctx);
  vm.runInContext(extractFn('ensureViewerTimerSync'), ctx);
  vm.runInContext(`ensureViewerTimerSync([{ timerDeviceId: 'dev1', status: 'finished' }], { alwaysPoll: true })`, ctx);
  return ctx.viewerTimerPollKey === '';
})());

let pass = true;
for (const [n, ok] of checks) { console.log((ok ? '✅' : '❌') + ' ' + n); if (!ok) pass = false; }
process.exit(pass ? 0 : 1);
