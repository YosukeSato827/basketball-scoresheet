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
// 新しい値が一つも届かなくなった状態は「遅れ」ではなく「更新なし」（Bluetooth 切れ・2026.08.30-1）
t('15秒以上なにも届かなければ更新なし', status(null, 20000).text === '● 更新なし 20秒');
t('更新なしは遅れ表示より優先する', status(500, 180000).text === '● 更新なし 3分');
t('更新なしは offline 表示', status(500, 180000).cls.includes('offline'));
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


// ===== 運営画面の遅れ表示（観戦ページには出さないこと） =====
// 2026-08-24 の実測で、TimerLink端末の送信が詰まると時計が33秒遅れた。
// 運営がそれに画面で気づけるようにするための表示
{
  const escSrc = (() => {
    const i = src.indexOf('const esc = s =>');
    return src.slice(i, src.indexOf(String.fromCharCode(10), i));   // 行末まで（&amp; の ; で切らない）
  })();
  const dom2 = new JSDOM('<!doctype html><html><body>' +
    '<div class="gc-score gc-score-live" data-timer-device="dev1" data-timer-flip="0">' +
      '<span class="gc-live-score" data-live="score">-</span>' +
      '<span class="gc-live-clock">--:--</span>' +
      '<span class="gc-live-lag" style="display:none"></span>' +
    '</div>' +
    '<div class="vt-timer-strip gc-timer-strip" id="editor-strip" data-timer-device="dev1" data-timer-flip="0"></div>' +
    '<div class="vt-timer-strip" id="viewer-strip" data-timer-device="dev1" data-timer-flip="0"></div>' +
    '</body></html>');
  const doc2 = dom2.window.document;
  const ctx2 = {
    console, document: doc2, window: dom2.window,
    Date: { now: () => NOW }, Math, JSON, String, Number, Object,
    viewerTimerData: {}, viewerTimerReceivedAt: {},
    viewerTimerAlwaysPoll: true,   // 運営画面として描画する
    editorRefreshSec: 3, viewerRefreshSec: 10,
  };
  vm.createContext(ctx2);
  vm.runInContext(escSrc, ctx2);
  vm.runInContext(['_rawClockValue', '_parseGameClockSec', '_parseShotClockSec',
                   '_fmtGameClock', '_fmtPeriod', 'renderViewerTimerStrips']
                  .map(extractFn).join(String.fromCharCode(10)), ctx2);

  const render = (extra) => {
    ctx2.viewerTimerData.dev1 = Object.assign({
      gameClock: { display: '7:23' }, shotClock: { display: '14' },
      period: '2', scores: { home: 44, guest: 42 },
    }, extra);
    ctx2.viewerTimerReceivedAt.dev1 = NOW;   // 取得直後＝経過0秒
    vm.runInContext('renderViewerTimerStrips()', ctx2);
    const lagEl = doc2.querySelector('.gc-live-lag');
    return {
      badge: lagEl.style.display === 'none' ? null : lagEl.textContent,
      danger: lagEl.className.includes('danger'),
      editorStrip: doc2.getElementById('editor-strip').innerHTML,
      viewerStrip: doc2.getElementById('viewer-strip').innerHTML,
    };
  };

  console.log('14) 運営画面の遅れ表示');
  let r = render({ lagMs: 400 });
  t('遅れが小さければバッジを出さない', r.badge === null, String(r.badge));
  t('その場合スコアと時計は出ている', r.editorStrip.includes('7:23'));

  r = render({ lagMs: 7000 });
  t('7秒遅れならバッジを出す', r.badge === '● 7秒遅れ', String(r.badge));
  t('7秒なら警告色（danger ではない）', r.danger === false);

  r = render({ lagMs: 33000 });
  t('33秒遅れならバッジを出す', r.badge === '● 33秒遅れ', String(r.badge));
  t('10秒以上は danger 表示', r.danger === true);

  r = render({ lagMs: 200000 });
  t('1分を超えたら分で出す', r.badge === '● 3分遅れ', String(r.badge));

  r = render({});   // lagMs 無し（Lambda v3 以前）
  t('lagMs が無ければバッジを出さない', r.badge === null, String(r.badge));

  console.log('15) 観戦ページの帯には遅れを出さない');
  r = render({ lagMs: 33000 });
  t('運営画面の帯には遅れが出る', r.editorStrip.includes('遅れ'), r.editorStrip);
  t('観戦ページの帯には遅れが出ない', !r.viewerStrip.includes('遅れ'), r.viewerStrip);
  // 時計は観戦カードのスコア欄の中央に出すようにしたので、帯では繰り返さない（2026.08.28-2）
  t('観戦ページの帯に時計は繰り返さない', !r.viewerStrip.includes('7:23'), r.viewerStrip);
  t('運営画面の帯には時計が出ている', r.editorStrip.includes('7:23'), r.editorStrip);
  t('観戦ページの帯はタイマー側スコアと分かる表記',
    r.viewerStrip.includes('タイマー 44 - 42'), r.viewerStrip);
}

// ===== 16) 配信停止の検知（TimerLink の Bluetooth 切れ・2026.08.30-1）=====
// 配信が止まっても Firestore の取得自体は成功し続ける（同じ中身が返るだけ）ので、
// 「取得できた時刻」で鮮度を測っていると、止まった時計がいつまでも LIVE に見えていた。
// 「新しい値が届いた時刻」で測れているかを見る
{
  const escSrc = (() => {
    const i = src.indexOf('const esc = s =>');
    return src.slice(i, src.indexOf(String.fromCharCode(10), i));
  })();
  let T = 1787400000000;
  const dom3 = new JSDOM('<!doctype html><html><body>' +
    '<div class="gc-score gc-score-live" data-timer-device="dev1" data-timer-flip="0">' +
      '<span class="gc-live-score" data-live="score">-</span>' +
      '<span class="gc-live-clock">--:--</span>' +
      '<span class="gc-live-lag" style="display:none"></span>' +
    '</div>' +
    '<div class="vt-timer-strip gc-timer-strip" id="ed-strip" data-timer-device="dev1" data-timer-flip="0"></div>' +
    '<div class="vt-timer-strip" id="vw-strip" data-timer-device="dev1" data-timer-flip="0"></div>' +
    '</body></html>');
  const doc3 = dom3.window.document;
  const ctx3 = {
    console, document: doc3, window: dom3.window,
    Date: { now: () => T }, Math, JSON, String, Number, Object,
    viewerTimerData: {}, viewerTimerReceivedAt: {},
    viewerTimerAlwaysPoll: true,   // 運営画面として描画する（「更新なし」が出る側）
    editorRefreshSec: 3, viewerRefreshSec: 10,
  };
  vm.createContext(ctx3);
  vm.runInContext(escSrc, ctx3);
  vm.runInContext(['_rawClockValue', '_parseGameClockSec', '_parseShotClockSec',
                   '_fmtGameClock', '_fmtPeriod', '_timerDocMs', '_timerDataChanged',
                   '_viewerApplyTimerData', 'renderViewerTimerStrips']
                  .map(extractFn).join(String.fromCharCode(10)), ctx3);

  // Lambda が書いた時刻（updatedAt = serverTimestamp）を持つ timer_sync ドキュメント
  const mkData = (atMs, extra) => Object.assign({
    gameClock: { display: '7:23' }, shotClock: { display: '14' }, period: '2',
    scores: { home: 44, guest: 42 },
    updatedAt: { toDate: () => new Date(atMs) },
  }, extra);
  const apply = (data) => { ctx3.__d = data; vm.runInContext('_viewerApplyTimerData("dev1", __d)', ctx3); };
  const el3 = sel => doc3.querySelector(sel);
  const view = () => ({
    clock: el3('.gc-live-clock').textContent,
    score: el3('[data-live="score"]').textContent,
    warn: el3('.gc-live-lag').style.display === 'none' ? null : el3('.gc-live-lag').textContent,
    editorStrip: doc3.getElementById('ed-strip').style.display === 'none'
      ? null : doc3.getElementById('ed-strip').textContent,
    viewerStrip: doc3.getElementById('vw-strip').style.display === 'none'
      ? null : doc3.getElementById('vw-strip').textContent,
  });

  console.log('16) 配信停止の検知');
  apply(mkData(T));
  let v = view();
  t('届いた直後はライブ表示', v.clock === '2Q 7:23' && v.score === '44 - 42', JSON.stringify(v));
  t('その間は「更新なし」を出さない', v.warn === null, String(v.warn));

  // 20秒経過。取得は成功し続けるが中身は同じ＝配信は止まっている
  T += 20000; apply(mkData(T - 20000));
  v = view();
  t('同じ値を取り続けても鮮度は戻らない', v.warn === '● 更新なし 20秒', String(v.warn));
  t('停止と判定する前は時計を出したまま', v.clock === '2Q 7:23', v.clock);
  t('鮮度の起点は取得時刻ではなく更新時刻', ctx3.viewerTimerReceivedAt.dev1 === T - 20000);

  // 90秒を超えたら受信停止中。数字は最後に受信した値を残し、「更新なし」は出し続ける
  T += 100000; apply(mkData(T - 120000));
  v = view();
  t('停止しても最後に受信した値は残す', v.clock === '2Q 7:23' && v.score === '44 - 42', JSON.stringify(v));
  t('停止後も「更新なし」は出し続ける', v.warn === '● 更新なし 2分', String(v.warn));
  t('停止後も運営画面の帯に「更新なし」が出る', (v.editorStrip || '').includes('更新なし'), String(v.editorStrip));
  t('観戦ページの帯には「更新なし」を出さない', !(v.viewerStrip || '').includes('更新なし'), String(v.viewerStrip));
  t('観戦ページの帯は「受信停止中」で最後の値を残す',
    (v.viewerStrip || '').includes('受信停止中') && (v.viewerStrip || '').includes('タイマー 44 - 42'),
    String(v.viewerStrip));

  // 1時間を超えたら数字も消す（古いスコアを出し続けない）
  T += 3600000; apply(mkData(T - 3720000));
  v = view();
  t('1時間以上なにも届かなければ数字を消す', v.clock === '--:--' && v.score === '– - –', JSON.stringify(v));
  t('その場合も「更新なし」は出し続ける', (v.warn || '').includes('更新なし'), String(v.warn));
  t('1時間を超えたら観戦ページの帯は消える', v.viewerStrip === null, String(v.viewerStrip));

  // 新しい値が届けば復帰する
  T += 1000; apply(mkData(T, { gameClock: { display: '7:12' } }));
  v = view();
  t('新しい値が届けば復帰する', v.clock === '2Q 7:12' && v.warn === null, JSON.stringify(v));

  // 既に止まっているところへ後から開いた場合、初回の取得で停止と分かること
  ctx3.viewerTimerData = {}; ctx3.viewerTimerReceivedAt = {};
  apply(mkData(T - 300000));
  v = view();
  t('開いた時点で既に古ければ初回から停止扱い', (v.warn || '') === '● 更新なし 5分', String(v.warn));
  t('その場合も最後に受信した値は出す', v.clock === '2Q 7:23', v.clock);
}

let pass = true;
for (const [n, ok] of checks) { console.log((ok ? '✅' : '❌') + ' ' + n); if (!ok) pass = false; }
process.exit(pass ? 0 : 1);
