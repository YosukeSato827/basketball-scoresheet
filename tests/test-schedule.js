// 試合予定（日付・開始時刻・コート）の表示検証
const fs = require('fs');
const vm = require('vm');
const { JSDOM } = require('jsdom');

const src = fs.readFileSync(process.argv[2], 'utf8');
function extractFn(name) {
  const start = src.indexOf(`function ${name}(`);
  if (start < 0) throw new Error(`not found: ${name}`);
  let depth = 0, i = src.indexOf('{', start);
  for (let j = i; j < src.length; j++) {
    if (src[j] === '{') depth++;
    else if (src[j] === '}') { depth--; if (depth === 0) return src.slice(start, j + 1); }
  }
  throw new Error('unbalanced: ' + name);
}

const dom = new JSDOM('<!doctype html><html><body><div id="out"></div></body></html>');
const ctx = { console, document: dom.window.document, window: dom.window, IS_ARCHIVE: false,
  viewerRefreshSec: 5 };
vm.createContext(ctx);
vm.runInContext(src.split('\n').filter(l => l.startsWith('const esc =')).join('\n'), ctx);
vm.runInContext(`const escAttr = s => esc(s).replace(/"/g, '&quot;').replace(/'/g, '&#39;');`, ctx);
vm.runInContext([
  'fmtSchedule', 'resolveEntryName', 'computeBracket', 'bracketRoundName', 'renderBracketHTML',
  '_gameScorePair', 'rankLeagueTeams', 'leagueMatchId', 'computeLeagueGroup', 'renderLeagueHTML',
  '_rawClockValue', '_parseGameClockSec', '_parseShotClockSec', '_fmtGameClock', '_fmtPeriod', '_extractRunning',
].map(extractFn).join('\n'), ctx);

const run = c => vm.runInContext(c, ctx);
const $ = s => dom.window.document.querySelectorAll(s);
const checks = [];
const t = (n, ok, extra) => { checks.push([n, ok]); if (!ok && extra !== undefined) console.log('   →', JSON.stringify(extra)); };

// ===== 1. 表示フォーマット =====
t('日付＋時刻＋コート', run(`fmtSchedule({ date: '2026-08-29', time: '9:00', court: 'Aコート' })`) === '8/29 9:00 Aコート');
t('日付のみ', run(`fmtSchedule({ date: '2026-08-29' })`) === '8/29');
t('時刻＋コートのみ', run(`fmtSchedule({ time: '10:40', court: 'Cコート' })`) === '10:40 Cコート');
t('未設定は空', run(`fmtSchedule(null)`) === '' && run(`fmtSchedule({})`) === '');

// ===== 2. トーナメント表：試合前は予定を表示 =====
run(`
  var b = { id: 'T1', type: 'tournament', size: 4,
    entries: ['松江高専','旭川高専','函館高専','久留米高専'],
    schedule: {
      'r1m1': { date: '2026-08-29', time: '9:00',  court: 'Cコート' },
      'r1m2': { date: '2026-08-29', time: '10:40', court: 'Cコート' },
      'r2m1': { date: '2026-08-30', time: '12:20', court: 'Aコート' },
    } };
  document.getElementById('out').innerHTML = renderBracketHTML(b, [], false, false, []);
`);
const scheds = [...$('#out .br-sched')].map(e => e.textContent.trim());
t('未実施の枠に予定が出る（3枠）', scheds.length === 3, scheds);
t('予定の内容', scheds[0].includes('8/29 9:00 Cコート') && scheds[2].includes('8/30 12:20 Aコート'), scheds);

// ===== 3. スコアが入ったら予定は消える =====
run(`
  var gamesDone = [{ id: 'g1', bracketId: 'T1', bracketMatchId: 'r1m1',
    teamAName: '松江高専', teamBName: '旭川高専', totalA: 70, totalB: 60, status: 'finished' }];
  document.getElementById('out').innerHTML = renderBracketHTML(b, gamesDone, false, false, []);
`);
const scheds2 = [...$('#out .br-sched')].map(e => e.textContent.trim());
t('確定した試合の予定は非表示（残り2枠）', scheds2.length === 2, scheds2);
t('消えたのは第1試合', !scheds2.some(s => s.includes('9:00')), scheds2);

// ===== 4. タイマー連携中（ライブ）も予定を隠す =====
run(`
  var gamesLive = [{ id: 'g2', bracketId: 'T1', bracketMatchId: 'r1m2',
    teamAName: '函館高専', teamBName: '久留米高専', timerDeviceId: 'DEV1', status: 'live' }];
  document.getElementById('out').innerHTML = renderBracketHTML(b, gamesLive, false, false, []);
`);
const scheds3 = [...$('#out .br-sched')].map(e => e.textContent.trim());
t('ライブ中の枠は予定を隠す', !scheds3.some(s => s.includes('10:40')), scheds3);
t('他の枠の予定は残る', scheds3.length === 2, scheds3);

// ===== 5. 配置編集中は予定を出さない（表が見づらくなるため） =====
run(`document.getElementById('out').innerHTML = renderBracketHTML(b, [], false, false, [], true);`);
t('配置編集モードでは予定非表示', $('#out .br-sched').length === 0);

// ===== 6. リーグ星取表：未実施マスに予定 =====
run(`
  var lg = { id: 'L1', type: 'league', name: '男子予選',
    groups: [{ name: 'Aブロック', teams: ['松江高専','仙台高専名取','鈴鹿高専'] }],
    schedule: {
      'g1p1-2': { date: '2026-08-29', time: '9:00', court: 'Aコート' },
      'g1p1-3': { time: '10:40', court: 'Bコート' },
    } };
  document.getElementById('out').innerHTML = renderLeagueHTML(lg, [], false, false);
`);
const lgScheds = [...$('#out .lg-sched')].map(e => e.textContent.trim());
// クロス表なので同じ試合が2マス（対称）に出る
t('リーグの未実施マスに予定', lgScheds.length === 4, lgScheds);
t('リーグ予定の内容', lgScheds.filter(s => s.includes('9:00 Aコート')).length === 2, lgScheds);

// 試合が終わったマスは予定でなくスコア表示
run(`
  var lgGames = [{ id: 'lg1', bracketId: 'L1', bracketMatchId: 'g1p1-2',
    teamAName: '松江高専', teamBName: '仙台高専名取', totalA: 80, totalB: 70, status: 'finished' }];
  document.getElementById('out').innerHTML = renderLeagueHTML(lg, lgGames, false, false);
`);
const lgScheds2 = [...$('#out .lg-sched')].map(e => e.textContent.trim());
t('終了した対戦の予定は消える', !lgScheds2.some(s => s.includes('9:00')), lgScheds2);
t('スコアが表示される', [...$('#out .lg-score')].some(e => e.textContent.includes('80-70')));

// ===== 7. 対戦表のLIVEマーク =====
// 更新関数（renderViewerTimerStrips）とライブ状態を用意
vm.runInContext('let viewerTimerData = {}; let viewerTimerReceivedAt = {};', ctx);
vm.runInContext(extractFn('renderViewerTimerStrips'), ctx);
run(`
  viewerTimerData['DEV1'] = { gameClock: { display: '07:23', running: false }, shotClock: { display: '18' },
                              period: '2', scores: { home: 45, guest: 42 } };
  viewerTimerReceivedAt['DEV1'] = Date.now();
  // トーナメント：タイマー連携中の試合
  document.getElementById('out').innerHTML = renderBracketHTML(b, [
    { id: 'g9', bracketId: 'T1', bracketMatchId: 'r1m1', teamAName: '松江高専', teamBName: '旭川高専',
      timerDeviceId: 'DEV1', status: 'live' }
  ], false, false, []);
  renderViewerTimerStrips();
`);
const brChip = dom.window.document.querySelector('#out .br-timer-clock');
t('トーナメント：LIVE＋時計を表示',
  brChip && brChip.style.display !== 'none' && brChip.textContent.includes('LIVE') && brChip.textContent.includes('2Q 7:23'),
  brChip && brChip.textContent);

// 配信が止まったら非表示
run(`viewerTimerReceivedAt['DEV1'] = Date.now() - 120000; renderViewerTimerStrips();`);
t('配信が止まればLIVE非表示',
  dom.window.document.querySelector('#out .br-timer-clock').style.display === 'none');

// リーグ：タイマー連携中のマスにLIVEバッジ
run(`
  viewerTimerReceivedAt['DEV1'] = Date.now();
  document.getElementById('out').innerHTML = renderLeagueHTML(lg, [
    { id: 'lg9', bracketId: 'L1', bracketMatchId: 'g1p1-2', teamAName: '松江高専', teamBName: '仙台高専名取',
      timerDeviceId: 'DEV1', status: 'live' }
  ], false, false);
  renderViewerTimerStrips();
`);
const lgBadges = [...$('#out .lg-live-badge')].filter(e => e.style.display !== 'none');
t('リーグ：ライブ中のマスにLIVEバッジ（対称2マス）', lgBadges.length === 2, lgBadges.length);

// デジタル記録中（スコアあり・未終了・直近更新）のマスにもLIVE
run(`
  document.getElementById('out').innerHTML = renderLeagueHTML(lg, [
    { id: 'lg10', bracketId: 'L1', bracketMatchId: 'g1p1-3', teamAName: '松江高専', teamBName: '鈴鹿高専',
      totalA: 30, totalB: 28, status: 'live', updatedAt: new Date().toISOString() }
  ], false, false);
`);
t('リーグ：記録中の対戦にLIVEバッジ', $('#out .lg-live-badge').length === 2, $('#out .lg-live-badge').length);
t('リーグ：記録中もスコアは表示', [...$('#out .lg-score')].some(e => e.textContent.includes('30-28')));

// 終了した試合にはLIVEを出さない
run(`
  document.getElementById('out').innerHTML = renderLeagueHTML(lg, [
    { id: 'lg11', bracketId: 'L1', bracketMatchId: 'g1p1-3', teamAName: '松江高専', teamBName: '鈴鹿高専',
      totalA: 30, totalB: 28, status: 'finished', updatedAt: new Date().toISOString() }
  ], false, false);
`);
t('終了済みはLIVEを出さない', $('#out .lg-live-badge').length === 0);
t('終了済みは○●マーク', [...$('#out .lg-mark')].some(e => e.textContent === '○'));

let pass = true;
for (const [n, ok] of checks) { console.log((ok ? '✅' : '❌') + ' ' + n); if (!ok) pass = false; }
process.exit(pass ? 0 : 1);
