// jsdom によるビューア／モーダルのDOM検証（ブラウザペイン不要）
// - 確定スコアのみの試合カード（スコア表示・終了ラベル・Q内訳非表示・勝者強調）
// - タイマーストリップのスコア向き（flip）反映
// - タイマーモーダルの各セクション表示（game モード）
const fs = require('fs');
const vm = require('vm');
const { JSDOM } = require('jsdom');

const src = fs.readFileSync(process.argv[2], 'utf8');

function extractFn(name) {
  const start = src.indexOf(`function ${name}(`);
  if (start < 0) throw new Error(`function not found: ${name}`);
  let depth = 0, i = src.indexOf('{', start);
  for (let j = i; j < src.length; j++) {
    if (src[j] === '{') depth++;
    else if (src[j] === '}') { depth--; if (depth === 0) return src.slice(start, j + 1); }
  }
  throw new Error('unbalanced: ' + name);
}

// モーダルHTMLを本物のソースから抽出
const modalStart = src.indexOf('<div class="modal-overlay" id="modal-timer-device"');
const modalEnd = src.indexOf('<!-- アプリ本体フレーム', modalStart);
const modalHTML = src.slice(modalStart, modalEnd);

const dom = new JSDOM(`<!doctype html><html><body>
  ${modalHTML}
  <div id="view-viewer">
    <span class="viewer-mode-tag">観戦ビュー</span>
    <div id="viewer-live-badge" style="display:none"></div>
    <span id="viewer-updated"></span>
    <div id="viewer-content"></div>
  </div>
</body></html>`);
const { document } = dom.window;

const ctx = {
  console, document, window: dom.window,
  IS_ARCHIVE: false,
  viewerActiveTab: 'games',
  viewerTabTouched: false,
  viewerRefreshSec: 5, viewerTimerAlwaysPoll: false, editorRefreshSec: 3,
  viewerLastFetchAt: 0,
  viewerFullAccess: true,   // 既存テストは制限なし表示を前提にする
  viewerLastTData: null, viewerLastGameDocs: [],
  viewerBrackets: [],
  viewerTimerUnsubscribe: null, viewerTimerIv: null,
  viewerTimerData: {}, viewerTimerReceivedAt: {},
  timerModalCtx: null,
  recTimerDeviceId: null, recTimerScoreFlip: false,
  isOnline: true,
  ensureViewerTimerSync: () => {},        // db購読はスタブ
  buildScoreGraphSVG: () => '',           // グラフ描画はこのテストの対象外
  showToast: () => {},
  db: null, firebase: null,
  Date: Date, Math: Math, JSON: JSON,
};
vm.createContext(ctx);

// esc / escAttr / qClass はソースの const 定義を個別に評価
const constLines = src.split('\n').filter(l =>
  l.startsWith('const esc =') || l.startsWith('const qClass ='));
vm.runInContext(constLines.join('\n'), ctx);
vm.runInContext(`const escAttr = s => esc(s).replace(/"/g, '&quot;').replace(/'/g, '&#39;');`, ctx);

const fns = [
  'parsePBP', 'parseEvent', 'extractPlayer', 'buildState',
  '_rawClockValue', '_parseGameClockSec', '_parseShotClockSec', '_fmtGameClock', '_fmtPeriod', '_extractRunning', '_timerDocMs',
  '_viewerApplyTimerData', 'renderViewerTimerStrips', 'timerDeviceUsedBy',
  'renderTournamentViewer', 'renderTimerModalSections', 'renderTimerDeviceList',
  'computeBracket', 'bracketRoundName', 'renderBracketHTML',
  'resolveEntryName', '_gameScorePair', 'rankLeagueTeams', 'leagueMatchId', 'computeLeagueGroup',
  'renderLeagueHTML', 'renderViewerBrackets', 'fmtSchedule',
  'bracketTeamCount', 'bracketSizeLabel', 'viewerCanSee',
];
vm.runInContext(fns.map(extractFn).join('\n'), ctx);

const results = {};

// ===== テスト1: ビューアカード（確定スコア＋flip ストリップ） =====
vm.runInContext(`
  const tData = { name: 'テスト大会', startDate: '2026-07-24', endDate: '', venue: '' };
  const mk = (id, d) => ({ id, data: () => d });
  renderTournamentViewer(tData, [
    mk('fake-final', { teamAName: 'アルファ', teamBName: 'ブラボー', gameNo: '99',
      pbpData: '', totalA: 66, totalB: 58, status: 'finished', updatedAt: new Date().toISOString() }),
    mk('fake-flip', { teamAName: 'チャーリー', teamBName: 'デルタ', gameNo: '98',
      pbpData: '', timerDeviceId: 'FLIPDEV', timerScoreFlip: true, status: 'live' }),
    mk('fake-noflip', { teamAName: 'エコー', teamBName: 'フォックス', gameNo: '97',
      pbpData: '', timerDeviceId: 'FLIPDEV', timerScoreFlip: false, status: 'live' }),
  ]);
  _viewerApplyTimerData('FLIPDEV', {
    gameClock: { display: '05:30', running: false },
    shotClock: { display: '14', running: false },
    period: '2',
    scores: { home: 10, guest: 20, isReversed: false }
  });
`, ctx);

// ===== テスト1b: タイマー取得試合のライブスコアライン（正規スコア欄表示） =====
const flipCard = document.querySelector('.vt-game-detail[data-game-id="fake-flip"]');
results.liveScoreline = {
  isLiveVariant: !!flipCard.querySelector('.vt-scoreline.vt-live'),
  noBlackStrip: !flipCard.querySelector('.vt-timer-strip'),
  hasNote: (flipCard.querySelector('.vt-live-note') || {}).textContent || null,
  scoreA: flipCard.querySelector('[data-live="a"]').textContent,   // flip=true → guest(20)
  scoreB: flipCard.querySelector('[data-live="b"]').textContent,   // flip=true → home(10)
  clock: flipCard.querySelector('.vt-live-clock').textContent,
  order: [...flipCard.querySelector('.vt-scoreline.vt-live').children].map(c => c.className.split(' ')[0]),
};

// 通常向き（flipなし）カードの値は、この時点で取得しておく（後続テストでDOMを差し替えるため）
{
  const c = document.querySelector('.vt-game-detail[data-game-id="fake-noflip"]');
  results.noflipScores = {
    a: c.querySelector('[data-live="a"]').textContent,
    b: c.querySelector('[data-live="b"]').textContent,
  };
}

// ===== テスト1c: トーナメント表のライブスコア＋時計 =====
{
  const brDiv = document.createElement('div');
  brDiv.id = 'br-test';
  document.body.appendChild(brDiv);
  vm.runInContext(`
    const brGames = [{ id: 'bg1', bracketId: 'bk1', bracketMatchId: 'r1m1',
      teamAName: 'ガンマ', teamBName: 'アルファ',  // ブラケット並び（アルファが先）と逆 → swap 検証
      timerDeviceId: 'FLIPDEV', timerScoreFlip: false, status: 'live', pbpData: '' }];
    const bk = { id: 'bk1', size: 4, entries: ['アルファ', 'ガンマ', 'ベータ', 'デルタ'] };
    document.getElementById('br-test').innerHTML = renderBracketHTML(bk, brGames, false, false);
    renderViewerTimerStrips();
  `, ctx);
  const slots = [...brDiv.querySelectorAll('.br-live-score')];
  results.bracket = {
    liveScoreCount: slots.length,
    // スロット1=アルファ（試合のteamB → side'b' → guest=20）、スロット2=ガンマ（teamA → home=10）
    sides: slots.map(s => s.dataset.side),
    values: slots.map(s => s.textContent),
    clock: (brDiv.querySelector('.br-timer-clock') || {}).textContent || null,
  };
}

// ===== テスト1d: 編集者一覧のライブスコア欄（updater単体） =====
{
  const gcDiv = document.createElement('div');
  gcDiv.innerHTML = `<div class="gc-score gc-score-live" data-timer-device="FLIPDEV" data-timer-flip="1">
    <span class="gc-live-score" data-live="score">– - –</span>
    <span class="gc-live-clock">⏱ --:--</span></div>`;
  document.body.appendChild(gcDiv);
  vm.runInContext('renderViewerTimerStrips();', ctx);
  results.gcLive = {
    score: gcDiv.querySelector('[data-live="score"]').textContent,
    clock: gcDiv.querySelector('.gc-live-clock').textContent,
  };
}

const finalCard = document.querySelector('.vt-game-detail[data-game-id="fake-final"]');
results.viewer = {
  score: finalCard.querySelector('.vt-scoreline').textContent.replace(/\s+/g, ' ').trim(),
  label: finalCard.querySelector('.vt-game-label').textContent.replace(/\s+/g, ' ').trim(),
  hasQRow: !!finalCard.querySelector('.vt-qrow'),
  winnerCount: finalCard.querySelectorAll('.vt-winner').length,
  strips: [...document.querySelectorAll('.vt-timer-strip')].map(s => ({
    game: s.closest('.vt-game-detail').dataset.gameId,
    flip: s.dataset.timerFlip,
    visible: s.style.display !== 'none',
    text: s.textContent,
  })),
};

// ===== テスト1e: 時計はローカルで進めない（更新間隔の設定どおりに動くこと） =====
// running: true を送ってくるタイマーでも、取得したときの値のまま表示し続ける。
// 以前はここで経過秒を引いていたため、同じ観戦ページの中に
// 「5秒ごとに動く試合」と「1秒ごとに動く試合」が混在していた
{
  const runDiv = document.createElement('div');
  runDiv.innerHTML = `<div class="vt-scoreline vt-live" data-timer-device="RUNDEV" data-timer-flip="0">
    <span data-live="a">–</span><span class="vt-live-clock">--:--</span><span data-live="b">–</span></div>`;
  document.body.appendChild(runDiv);
  vm.runInContext(`
    _viewerApplyTimerData('RUNDEV', {
      gameClock: { display: '7:20', running: true },
      shotClock: { display: '18', running: true },
      period: '3', scores: { home: 15, guest: 11, isReversed: false }
    });
  `, ctx);
  const justFetched = runDiv.querySelector('.vt-live-clock').textContent;
  // 取得から4秒経ってから描き直す（この間に通信は発生していない）
  vm.runInContext(`
    viewerTimerReceivedAt['RUNDEV'] = Date.now() - 4000;
    renderViewerTimerStrips();
  `, ctx);
  results.noInterpolation = {
    justFetched,
    after4s: runDiv.querySelector('.vt-live-clock').textContent,
  };
}

// ===== テスト1f: ライブ記録中でもタイマーの時計を出す（2026.08.28-2） =====
// 記録スコアは大きな数字のまま、その中央に時計を差し込む。
// 帯（黒ストリップ）は時計を繰り返さず、タイマー側スコアとショットクロックだけにする
vm.runInContext(`
  const recPbp = ['1\\t10:00\\t#4 2P成功\\t\\t',
                  '1\\t09:30\\t\\t\\t#7 3P成功',
                  '2\\t08:00\\t#4 2P成功\\t\\t'].join('\\n');
  renderTournamentViewer({ name: 'テスト大会' }, [
    { id: 'rec-timer', data: () => ({
        teamAName: 'ゴルフ', teamBName: 'ホテル', gameNo: '10',
        pbpData: recPbp, timerDeviceId: 'FLIPDEV', timerScoreFlip: false,
        status: 'live', updatedAt: new Date().toISOString() }) },
  ]);
  renderViewerTimerStrips();
`, ctx);
{
  const card = document.querySelector('.vt-game-detail[data-game-id="rec-timer"]');
  const line = card.querySelector('.vt-scoreline');
  const clk = line.querySelector('.vt-clock-inline');
  const strip = card.querySelector('.vt-timer-strip');
  results.recTimer = {
    clockVisible: !!clk && clk.style.display !== 'none',
    clock: clk ? clk.textContent : null,
    // 時計はスコアAとスコアBの間（＝中央）に入る
    order: [...line.children].map(c => c.className.split(' ')[0]),
    scoreA: line.querySelector('.vt-score-a').textContent,
    scoreB: line.querySelector('.vt-score-b').textContent,
    dashHidden: line.querySelector('.vt-dash').style.display === 'none',
    qHidden: line.querySelector('.vt-qlabel').style.display === 'none',
    stripVisible: !!strip && strip.style.display !== 'none',
    stripText: strip ? strip.textContent : '',
  };
  // 配信が止まったら（60秒以上未受信）時計は消え、「-」とクォーター表示が戻る
  vm.runInContext(`
    viewerTimerReceivedAt['FLIPDEV'] = Date.now() - 600000;
    renderViewerTimerStrips();
  `, ctx);
  results.recTimerStopped = {
    clockHidden: clk.style.display === 'none',
    dashBack: line.querySelector('.vt-dash').style.display !== 'none',
    qBack: line.querySelector('.vt-qlabel').style.display !== 'none',
    scoreKept: line.querySelector('.vt-score-a').textContent,
    stripHidden: strip.style.display === 'none',
  };
}

// ===== テスト1g: 速報URL（合言葉なし）は記録中でもタイマー側が正（2026.08.28-4） =====
// 会場のスコアボードを正とするため、大きなスコアもタイマーの値にする。
// タイマーが止まっている間だけ記録スコアに落として、注記でそれと分かるようにする
vm.runInContext(`
  viewerFullAccess = false;
  viewerTimerReceivedAt['FLIPDEV'] = Date.now();
  renderTournamentViewer({ name: 'テスト大会' }, [
    { id: 'rec-pub', data: () => ({
        teamAName: 'ゴルフ', teamBName: 'ホテル', gameNo: '10',
        pbpData: recPbp, timerDeviceId: 'FLIPDEV', timerScoreFlip: false,
        status: 'live', updatedAt: new Date().toISOString() }) },
  ]);
`, ctx);
{
  const card = document.querySelector('[data-game-id="rec-pub"]');
  const line = card.querySelector('.vt-scoreline');
  const note = card.querySelector('.vt-live-note');
  const val = sel => (line.querySelector(sel) || {}).textContent;
  results.pubTimer = {
    noDetail: card.classList.contains('vt-no-detail'),
    isLiveVariant: line.classList.contains('vt-live'),
    scoreA: val('[data-live="a"]'), scoreB: val('[data-live="b"]'),   // タイマー home10/guest20
    clock: val('.vt-live-clock'),
    noQRow: !card.querySelector('.vt-qrow'),
    noStrip: !card.querySelector('.vt-timer-strip'),
    noteLive: note.querySelector('.vt-note-live').style.display !== 'none',
    noteFallbackHidden: note.querySelector('.vt-note-fallback').style.display === 'none',
  };
  // 配信が止まったら記録スコア（4-3）に落として、注記を切り替える
  vm.runInContext(`
    viewerTimerReceivedAt['FLIPDEV'] = Date.now() - 600000;
    renderViewerTimerStrips();
  `, ctx);
  results.pubTimerStopped = {
    scoreA: val('[data-live="a"]'), scoreB: val('[data-live="b"]'),
    clock: val('.vt-live-clock'),
    noteFallback: note.querySelector('.vt-note-fallback').style.display !== 'none',
    noteLiveHidden: note.querySelector('.vt-note-live').style.display === 'none',
    dotHidden: note.querySelector('.vt-timer-live-dot').style.display === 'none',
  };
  vm.runInContext(`viewerFullAccess = true;`, ctx);
}

// ===== テスト2: モーダル（game モード・PBPなし・リンク済み） =====
vm.runInContext(`
  timerModalCtx = {
    mode: 'game', gameId: 'g1',
    game: { teamAName: 'アルファ', teamBName: 'ブラボー', gameNo: '7',
      timerDeviceId: 'DEV-1', timerScoreFlip: true, pbpData: '',
      totalA: 40, totalB: 44, status: 'finished' },
    linkedDeviceId: 'DEV-1', devices: null,
  };
  renderTimerModalSections();
  renderTimerDeviceList([
    { id: 'DEV-1', gameClock: { display: '00:00' }, scores: { home: 40, guest: 44 }, deviceTimestamp: Date.now() - 5000 },
    { id: 'DEV-2', gameClock: { display: '10:00' }, deviceTimestamp: Date.now() - 600000 },
  ]);
`, ctx);

const $ = id => document.getElementById(id);
results.modal = {
  title: $('timer-modal-title').textContent,
  note: $('timer-modal-note').textContent.slice(0, 40),
  flipVisible: $('timer-flip-section').style.display !== 'none',
  flipLabel0: $('timer-flip-label-0').textContent,
  flipChecked1: document.querySelector('input[name="timer-flip"][value="1"]').checked,
  resultVisible: $('timer-result-section').style.display !== 'none',
  resultCurrent: $('timer-result-current').textContent,
  finishBtnVisible: $('timer-finish-btn').style.display !== 'none',
  manualPrefill: [$('timer-manual-a').value, $('timer-manual-b').value],
  unlinkVisible: $('timer-device-unlink').style.display !== 'none',
  deviceRows: [...document.querySelectorAll('.timer-device-row')].map(r =>
    r.textContent.replace(/\s+/g, ' ').trim().slice(0, 60)),
};

// ===== テスト3: モーダル（recorder モード＝結果セクション非表示） =====
vm.runInContext(`
  timerModalCtx = {
    mode: 'recorder', gameId: 'g2',
    game: { teamAName: 'A', teamBName: 'B', pbpData: '', timerDeviceId: null },
    linkedDeviceId: null, devices: null,
  };
  renderTimerModalSections();
`, ctx);
results.recorderModal = {
  title: $('timer-modal-title').textContent,
  flipVisible: $('timer-flip-section').style.display !== 'none',
  resultVisible: $('timer-result-section').style.display !== 'none',
  unlinkVisible: $('timer-device-unlink').style.display !== 'none',
};

// ===== テスト4: 試合が0件でも組み合わせ（対戦表）を閲覧できる =====
vm.runInContext(`
  viewerBrackets = [
    { id: 'L1', type: 'league', name: '男子予選リーグ',
      groups: [{ name: 'Aブロック', teams: ['松江高専（男子）','仙台高専名取（男子）','鈴鹿高専（男子）'] }] },
    { id: 'T1', type: 'tournament', name: '女子トーナメント', size: 4, teamCount: 3,
      entries: ['函館高専（女子）','久留米高専（女子）','長野高専（女子）',''] },
  ];
  viewerActiveTab = 'games';
  viewerTabTouched = false;
  renderTournamentViewer({ name: '第61回全国高等専門学校体育大会', startDate: '2026-08-29', endDate: '2026-08-30', venue: '津市' }, []);
`, ctx);
results.noGames = {
  tabsShown: document.querySelectorAll('.viewer-tab').length,
  activeTab: (document.querySelector('.viewer-tab.active') || {}).textContent,
  leagueTables: document.querySelectorAll('.league-table').length,
  bracketMatches: document.querySelectorAll('.br-match').length,
  leagueTeams: [...document.querySelectorAll('.lg-team')].map(e => e.textContent),
};
// 試合タブに切り替えたときの表示
vm.runInContext(`viewerActiveTab = 'games'; viewerTabTouched = true; renderTournamentViewer(viewerLastTData, []);`, ctx);
results.noGamesGamesTab = {
  msg: (document.querySelector('.viewer-error p') || {}).textContent,
  hint: [...document.querySelectorAll('.viewer-error p')].map(e => e.textContent).join(' / '),
  tabsStillShown: document.querySelectorAll('.viewer-tab').length,
};

console.log(JSON.stringify(results, null, 2));

// ===== 判定 =====
const v = results.viewer, m = results.modal, rm = results.recorderModal;
const ls = results.liveScoreline, br = results.bracket, gc = results.gcLive;
// ===== テスト: タイマーの重複リンク警告（複数コート同時進行） =====
// 別コートのタイマーを誤って選ぶ事故を防ぐための警告。
// 禁止ではなく警告なので、警告が出ても選べることまで確認する
vm.runInContext(`
  timerModalCtx = {
    mode: 'game', gameId: 'gA',
    game: { teamAName: 'アルファ', teamBName: 'ブラボー', status: 'live' },
    linkedDeviceId: null, devices: null,
    deviceUsage: { 'DEV-2': ['Game 5 チャーリー vs デルタ'] },
  };
  renderTimerDeviceList([
    { id: 'DEV-1', gameClock: { display: '10:00' }, deviceTimestamp: Date.now() - 3000 },
    { id: 'DEV-2', gameClock: { display: '05:00' }, deviceTimestamp: Date.now() - 3000 },
  ]);
`, ctx);
{
  const rows = [...document.querySelectorAll('#timer-device-list .timer-device-row')];
  const rowOf = id => rows.find(r => r.dataset.device === id);
  const free = rowOf('DEV-1'), used = rowOf('DEV-2');
  const usedWarn = used && used.querySelector('.timer-device-dup');
  results.dup = {
    rowCount: rows.length,
    freeWarn: !!(free && free.querySelector('.timer-device-dup')),
    freeClass: !!(free && free.classList.contains('dup')),
    usedWarn: !!usedWarn,
    usedClass: !!(used && used.classList.contains('dup')),
    usedText: usedWarn ? usedWarn.textContent : '',
    usedClick: used ? (used.getAttribute('onclick') || '') : '',
  };
}

const checks = [
  ['確定スコア表示', v.score.includes('66') && v.score.includes('58')],
  ['終了ラベル（スコア行内）', v.score.includes('終了')],
  ['Q内訳非表示', !v.hasQRow],
  ['勝者強調あり', v.winnerCount >= 2],
  ['タイマー取得試合に黒ストリップなし', v.strips.length === 0 && ls.noBlackStrip],
  ['ライブスコアライン変種', ls.isLiveVariant],
  ['未確定の注記表示', (ls.hasNote || '').includes('未確定')],
  ['flipカード スコア 20/10', ls.scoreA === '20' && ls.scoreB === '10'],
  ['タイマーLIVEバッジ点灯', (() => { const c = flipCard.querySelector('.vt-chip-timer'); return c && c.style.display !== 'none' && c.textContent === 'LIVE'; })()],
  ['時計が中央＋Q表示', ls.order[2] === 'vt-live-clock' && ls.clock === '2Q 5:30'],
  ['タイマー速報カードにQ内訳なし', !flipCard.querySelector('.vt-qrow')],
  ['通常向きカード 10/20', results.noflipScores.a === '10' && results.noflipScores.b === '20'],
  ['ブラケット ライブスコア2枠', br.liveScoreCount === 2],
  ['ブラケット swap正常（アルファ=20/ガンマ=10）', br.sides[0] === 'b' && br.values[0] === '20' && br.sides[1] === 'a' && br.values[1] === '10'],
  ['ブラケット 時計＋Q表示', (br.clock || '').includes('2Q 5:30')],
  ['記録中の試合にも時計を出す',
    results.recTimer.clockVisible && results.recTimer.clock === '2Q 5:30', results.recTimer],
  ['記録中の時計はスコアの中央',
    results.recTimer.order[2] === 'vt-live-clock', results.recTimer.order],
  ['記録中でもスコアは記録側の数字（4-3）',
    results.recTimer.scoreA === '4' && results.recTimer.scoreB === '3', results.recTimer],
  ['時計が出ている間は「-」とQ表示を隠す',
    results.recTimer.dashHidden && results.recTimer.qHidden, results.recTimer],
  ['帯はタイマー側スコアとショットのみ（時計は重複させない）',
    results.recTimer.stripVisible &&
    results.recTimer.stripText.includes('SHOT 14') &&
    results.recTimer.stripText.includes('タイマー 10 - 20') &&
    !results.recTimer.stripText.includes('5:30'), results.recTimer.stripText],
  ['速報URL: 記録中でもタイマー表示（スコアも時計も）',
    results.pubTimer.noDetail && results.pubTimer.isLiveVariant &&
    results.pubTimer.scoreA === '10' && results.pubTimer.scoreB === '20' &&
    results.pubTimer.clock === '2Q 5:30', results.pubTimer],
  ['速報URL: 記録側のQ内訳と帯は出さない',
    results.pubTimer.noQRow && results.pubTimer.noStrip, results.pubTimer],
  ['速報URL: 注記はタイマー速報',
    results.pubTimer.noteLive && results.pubTimer.noteFallbackHidden, results.pubTimer],
  ['速報URL: タイマーが止まったら記録スコアに落とす',
    results.pubTimerStopped.scoreA === '4' && results.pubTimerStopped.scoreB === '3' &&
    results.pubTimerStopped.clock === '--:--', results.pubTimerStopped],
  ['速報URL: 落ちたことが注記で分かる',
    results.pubTimerStopped.noteFallback && results.pubTimerStopped.noteLiveHidden &&
    results.pubTimerStopped.dotHidden, results.pubTimerStopped],
  ['配信が止まったら時計を消して記録表示に戻す',
    results.recTimerStopped.clockHidden && results.recTimerStopped.dashBack &&
    results.recTimerStopped.qBack && results.recTimerStopped.scoreKept === '4' &&
    results.recTimerStopped.stripHidden, results.recTimerStopped],
  ['編集者一覧 ライブスコア＋Q表示', gc.score === '20 - 10' && gc.clock.includes('2Q 5:30')],
  ['取得直後の時計表示', results.noInterpolation.justFetched === '3Q 7:20', results.noInterpolation],
  ['時計をローカルで進めない（設定した間隔でだけ動く）',
    results.noInterpolation.after4s === '3Q 7:20', results.noInterpolation],
  ['モーダルtitle game', m.title.includes('タイマーとスコア')],
  ['向きセクション表示', m.flipVisible],
  ['flip=1選択済み', m.flipChecked1],
  ['結果セクション表示', m.resultVisible],
  ['確定スコア表記', m.resultCurrent.includes('40') && m.resultCurrent.includes('44') && m.resultCurrent.includes('試合終了')],
  ['🏁ボタン表示', m.finishBtnVisible],
  ['手動入力プリフィル', m.manualPrefill[0] === '40' && m.manualPrefill[1] === '44'],
  ['解除ボタン表示', m.unlinkVisible],
  ['デバイス一覧に登録済み表示', m.deviceRows[0].includes('登録済み')],
  ['recorderモード: 結果非表示', !rm.resultVisible],
  ['recorderモード: 未リンクで向き非表示', !rm.flipVisible],
  ['試合0件でもタブが表示される', results.noGames.tabsShown === 3],
  ['試合0件なら対戦表タブを初期表示', (results.noGames.activeTab || '').includes('対戦表')],
  ['試合0件でもリーグ星取表が見える',
    results.noGames.leagueTables === 1 && results.noGames.leagueTeams.length === 3],
  ['試合0件でもトーナメント表が見える', results.noGames.bracketMatches >= 2],
  ['試合タブでは未登録メッセージ＋対戦表への案内',
    (results.noGamesGamesTab.msg || '').includes('試合がまだ登録されていません') &&
    results.noGamesGamesTab.hint.includes('対戦表'),
    results.noGamesGamesTab],
  ['試合0件の試合タブでもタブは残る', results.noGamesGamesTab.tabsStillShown === 3],
  ['重複警告: 2台とも一覧に出る', results.dup.rowCount === 2, results.dup.rowCount],
  ['重複警告: 空きタイマーには警告を出さない', !results.dup.freeWarn && !results.dup.freeClass],
  ['重複警告: 使用中のタイマーに警告を出す', results.dup.usedWarn && results.dup.usedClass],
  ['重複警告: 相手の試合名を出す',
    results.dup.usedText.includes('Game 5 チャーリー vs デルタ'), results.dup.usedText],
  ['重複警告: 警告が出ても選択はできる',
    results.dup.usedClick.includes('selectTimerDevice'), results.dup.usedClick],
];
let pass = true;
for (const [name, ok] of checks) {
  console.log((ok ? '✅' : '❌') + ' ' + name);
  if (!ok) pass = false;
}
process.exit(pass ? 0 : 1);
