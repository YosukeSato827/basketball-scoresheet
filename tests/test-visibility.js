// 閲覧URL2種類（速報URL／詳細URL）の表示範囲を検証
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

const dom = new JSDOM(`<!doctype html><html><body>
  <div id="view-viewer">
    <span class="viewer-mode-tag"></span>
    <div id="viewer-live-badge" style="display:none"></div>
    <span id="viewer-updated"></span>
    <div id="viewer-content"></div>
  </div>
</body></html>`, { url: 'https://molten-scorelink.web.app/?view=T1' });

const ctx = {
  console, document: dom.window.document, window: dom.window, location: dom.window.location,
  URLSearchParams: dom.window.URLSearchParams,
  IS_ARCHIVE: false, viewerActiveTab: 'games', viewerTabTouched: false,
  viewerRefreshSec: 10, viewerTimerAlwaysPoll: false, editorRefreshSec: 3,
  viewerLastFetchAt: 0, viewerFullAccess: false,
  viewerLastTData: null, viewerLastGameDocs: [], viewerTournamentId: 'T1',
  viewerBrackets: [], viewerTimerData: {}, viewerTimerReceivedAt: {}, viewerRankMetric: 'pts',
  ensureViewerTimerSync: () => {}, renderViewerTimerStrips: () => {}, showToast: () => {},
  db: null, firebase: null,
};
vm.createContext(ctx);
vm.runInContext(src.split('\n').filter(l => l.startsWith('const esc =') || l.startsWith('const qClass =')).join('\n'), ctx);
vm.runInContext(`const escAttr = s => esc(s).replace(/"/g, '&quot;').replace(/'/g, '&#39;');`, ctx);
vm.runInContext([
  'parsePBP', 'parseEvent', 'extractPlayer', 'buildState', 'buildScoreGraphSVG', 'buildScoreTimeline',
  'viewerCanSee', 'renderTournamentViewer', 'buildViewerGameBody', 'renderViewerBrackets',
  'renderViewerStats', 'computeStatsFromDocs', 'renderViewerBoxScore', 'renderViewerScoresheet',
  'renderFullBoxScoreHTML', 'computeGameFullStats', 'buildGameBoxScore', 'fmtSchedule',
  'bracketTeamCount', 'bracketSizeLabel',
  'resolveEntryName', 'computeBracket', 'bracketRoundName', 'renderBracketHTML', 'listBracketSlots',
  '_gameScorePair', 'rankLeagueTeams', 'leagueMatchId', 'computeLeagueGroup', 'renderLeagueHTML',
  '_rawClockValue', '_parseGameClockSec', '_parseShotClockSec', '_fmtGameClock', '_fmtPeriod', '_extractRunning',
].map(extractFn).join('\n'), ctx);

const run = c => vm.runInContext(c, ctx);
const $ = s => dom.window.document.querySelectorAll(s);
const text = () => dom.window.document.getElementById('viewer-content').textContent;
const checks = [];
const t = (n, ok, extra) => { checks.push([n, ok]); if (!ok && extra !== undefined) console.log('   →', JSON.stringify(extra)); };

// テストデータ：個人名入りのPBPを持つ終了済みの試合＋トーナメント表
const setup = (fullAccess) => run(`
  viewerFullAccess = ${fullAccess ? 'true' : 'false'};
  viewerActiveTab = 'games';
  viewerBrackets = [{ id: 'B1', type: 'tournament', name: '決勝T', size: 4, teamCount: 4,
    entries: ['A高専','B高専','C高専','D高専'] }];
  var tData = { name: 'テスト大会', startDate: '2026-08-29' };
  var docs = [{ id: 'g1', data: () => ({
    tournamentId: 'T1', bracketId: 'B1', bracketMatchId: 'r1m1',
    teamAName: 'A高専', teamBName: 'B高専', gameNo: '1', status: 'finished',
    totalA: 70, totalB: 60,
    // 形式：クォーター \\t 時刻 \\t A側イベント \\t (空) \\t B側イベント
    pbpData: '1\\t9:30\\t#4 山田太郎 2P成功\\t\\t\\n1\\t8:10\\t\\t\\t#5 田中花子 3P成功',
    playersA: [{num:'4',name:'山田太郎'}], playersB: [{num:'5',name:'田中花子'}],
  })}];
  renderTournamentViewer(tData, docs);
`);
const scoreShown = () => [...$('.vt-score-a')].some(e => /^\d+$/.test(e.textContent.trim()));

// ===== 1. 速報URL（キーなし）=====
setup(false);
t('速報URL：合計スコアは見える', scoreShown(), [...$('.vt-score-a')].map(e => e.textContent.trim()));
t('速報URL：試合カードを開けない', $('details.vt-game-detail').length === 0 && $('.vt-no-detail').length === 1);
t('速報URL：個人名が出ない', !text().includes('山田太郎') && !text().includes('田中花子'), text().slice(0, 200));
t('速報URL：成績タブがない', ![...$('.viewer-tab')].some(e => e.textContent.includes('成績')));
t('速報URL：詳細版の帯を出さない', $('.viewer-staff-note').length === 0);

run(`viewerActiveTab = 'bracket'; renderTournamentViewer(viewerLastTData, viewerLastGameDocs);`);
t('速報URL：対戦表は見える', $('.br-match').length > 0);
t('速報URL：対戦表にスコアが出る',
  [...$('.br-score')].some(e => e.textContent.trim() === '70'),
  [...$('.br-score')].map(e => e.textContent.trim()));

// ===== 2. 詳細URL（キー一致）=====
setup(true);
t('詳細URL：合計スコアが見える', scoreShown());
t('詳細URL：試合カードを開ける', $('details.vt-game-detail').length === 1);
t('詳細URL：成績タブがある', [...$('.viewer-tab')].some(e => e.textContent.includes('成績')));
t('詳細URL：表示中の案内が出る', $('.viewer-staff-note').length === 1);

// 詳細を開いたときに生成される中身（ボックススコア）に個人名が入る
run(`
  var d = viewerLastGameDocs[0].data();
  var plays = parsePBP(d.pbpData);
  document.querySelector('.vt-game-body').innerHTML =
    renderViewerBoxScore(plays, d.teamAName, d.teamBName, d.playersA, d.playersB);
`);
t('詳細URL：個人名・個人スコアが出る',
  text().includes('山田太郎') && text().includes('田中花子'));

// 成績タブ（個人ランキング）
run(`viewerActiveTab = 'stats'; renderTournamentViewer(viewerLastTData, viewerLastGameDocs);`);
t('詳細URL：成績タブに個人名が並ぶ', text().includes('山田太郎'), text().slice(0, 200));

// ===== 3. 判定関数の単体確認 =====
run(`viewerFullAccess = false;`);
t('速報URL：score のみ許可',
  run(`[viewerCanSee('score'), viewerCanSee('detail'), viewerCanSee('stats')].join(',')`) === 'true,false,false');
run(`viewerFullAccess = true;`);
t('詳細URL：すべて許可',
  run(`[viewerCanSee('score'), viewerCanSee('detail'), viewerCanSee('stats')].join(',')`) === 'true,true,true');
run(`viewerFullAccess = false; IS_ARCHIVE = true;`);
t('アーカイブHTMLは常にすべて表示', run(`viewerCanSee('detail')`) === true);
run(`IS_ARCHIVE = false;`);

// ===== 4. 紙のスコアシート写真は速報URLでも見られる =====
const setupWithPhoto = (fullAccess) => run(`
  viewerFullAccess = ${fullAccess ? 'true' : 'false'};
  viewerActiveTab = 'games';
  var tData2 = { name: 'テスト大会' };
  var docs2 = [{ id: 'g2', data: () => ({
    tournamentId: 'T1', teamAName: 'A高専', teamBName: 'B高専', gameNo: '2', status: 'finished',
    totalA: 55, totalB: 50, pbpData: '',
    sheetPhotos: [
      { url: 'https://example.com/sheet1.jpg', path: 'score_sheets/g2/1.jpg' },
      { url: 'https://example.com/sheet2.jpg', path: 'score_sheets/g2/2.jpg' },
    ],
  })}];
  renderTournamentViewer(tData2, docs2);
`);

// 記録用紙には選手名が写るため、速報URLでは写真も見せない
setupWithPhoto(false);
t('速報URL：写真があってもカードは開けない', $('details.vt-game-detail').length === 0 && $('.vt-no-detail').length === 1);
t('速報URL：記録用紙のマークを出さない', $('.vt-photo-chip').length === 0);
run(`
  var d2 = viewerLastGameDocs[0].data();
  var tmp = document.createElement('div');
  tmp.id = 'photo-probe';
  tmp.innerHTML = buildViewerGameBody(d2, viewerLastTData);
  document.body.appendChild(tmp);
`);
t('速報URL：写真は生成されない', $('#photo-probe .vt-photo-thumb').length === 0);
t('速報URL：非公開の案内を出す',
  dom.window.document.getElementById('photo-probe').textContent.includes('公開されていません'),
  dom.window.document.getElementById('photo-probe').textContent.slice(0, 80));
run(`document.getElementById('photo-probe').remove();`);

setupWithPhoto(true);
t('詳細URL：写真がある試合はカードを開ける', $('details.vt-game-detail').length === 1);
t('詳細URL：記録用紙のマークが出る', $('.vt-photo-chip').length === 1);
run(`
  var d3 = viewerLastGameDocs[0].data();
  document.querySelector('.vt-game-body').innerHTML = buildViewerGameBody(d3, viewerLastTData);
`);
t('詳細URL：写真が2枚表示される', $('.vt-photo-thumb').length === 2);
t('詳細URL：写真セクションの見出し', text().includes('スコアシート（記録用紙）'));

// 写真なしの試合は、速報URLでは従来どおり開けない
setup(false);
t('写真なし＋速報URL：カードは開けないまま', $('details.vt-game-detail').length === 0);

let pass = true;
for (const [n, ok] of checks) { console.log((ok ? '✅' : '❌') + ' ' + n); if (!ok) pass = false; }
process.exit(pass ? 0 : 1);
