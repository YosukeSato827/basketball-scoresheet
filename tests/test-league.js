// 予選リーグ機能の検証（順位計算・タイブレーク・星取表・トーナメント連携）
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

const dom = new JSDOM('<!doctype html><html><body><div id="out"></div></body></html>');
const ctx = { console, document: dom.window.document, window: dom.window, IS_ARCHIVE: false };
vm.createContext(ctx);
vm.runInContext(src.split('\n').filter(l => l.startsWith('const esc =')).join('\n'), ctx);
vm.runInContext(`const escAttr = s => esc(s).replace(/"/g, '&quot;').replace(/'/g, '&#39;');`, ctx);
vm.runInContext([
  '_gameScorePair', 'rankLeagueTeams', 'leagueMatchId', 'computeLeagueGroup', 'renderLeagueHTML',
  'listBracketSlots', 'resolveEntryName', 'computeBracket', 'bracketRoundName', 'renderBracketHTML',
].map(extractFn).join('\n'), ctx);

const run = (code) => vm.runInContext(code, ctx);
const results = {};
const checks = [];
const t = (name, ok) => checks.push([name, ok]);

// ===== 1. 基本の順位計算（3チーム総当たり・全試合終了） =====
run(`
  var group = { name: 'Aブロック', teams: ['松江高専', '仙台高専名取', '鈴鹿高専'] };
  // g1p1-2: 松江 80-70 仙台 / g1p1-3: 松江 60-75 鈴鹿 / g1p2-3: 仙台 90-60 鈴鹿
  var games = [
    { id: 'x1', bracketId: 'L1', bracketMatchId: 'g1p1-2', teamAName: '松江高専', teamBName: '仙台高専名取', totalA: 80, totalB: 70 },
    { id: 'x2', bracketId: 'L1', bracketMatchId: 'g1p1-3', teamAName: '鈴鹿高専', teamBName: '松江高専', totalA: 75, totalB: 60 },
    { id: 'x3', bracketId: 'L1', bracketMatchId: 'g1p2-3', teamAName: '仙台高専名取', teamBName: '鈴鹿高専', totalA: 90, totalB: 60 },
  ];
  var r1 = computeLeagueGroup(group, games, 'L1', 0);
`);
const r1 = run('({ finished: r1.finished, done: r1.doneMatches, total: r1.totalMatches, ranked: r1.ranked.map(s => `${s.name}:${s.w}-${s.l}:${s.pf-s.pa}:${s.rank}位`) })');
results.basic = r1;
// 全チーム1勝1敗 → 得失点差: 松江(80-70,60-75)=-5 / 仙台(70-80,90-60)=+20 / 鈴鹿(75-60,60-90)=-15
t('3試合すべて終了と判定', r1.finished === true && r1.done === 3 && r1.total === 3);
t('得失点差で順位（仙台1位・松江2位・鈴鹿3位）',
  r1.ranked[0].startsWith('仙台高専名取') && r1.ranked[1].startsWith('松江高専') && r1.ranked[2].startsWith('鈴鹿高専'));

// ===== 2. 直接対決によるタイブレーク（得失点差より優先） =====
run(`
  var group2 = { name: 'Bブロック', teams: ['P', 'Q', 'R'] };
  // P 51-50 Q（直接対決P勝ち）、P 40-60 R、Q 90-40 R
  // 勝敗: P 1-1, Q 1-1, R 1-1 / 得失点差: P -19, Q +51, R -32
  // 直接対決はP>Q だが3すくみのため得失点差で決まる（Q 1位）
  var games2 = [
    { bracketId: 'L2', bracketMatchId: 'g1p1-2', teamAName: 'P', teamBName: 'Q', totalA: 51, totalB: 50 },
    { bracketId: 'L2', bracketMatchId: 'g1p1-3', teamAName: 'P', teamBName: 'R', totalA: 40, totalB: 60 },
    { bracketId: 'L2', bracketMatchId: 'g1p2-3', teamAName: 'Q', teamBName: 'R', totalA: 90, totalB: 40 },
  ];
  var r2 = computeLeagueGroup(group2, games2, 'L2', 0);
`);
results.tiebreak = run('r2.ranked.map(s => `${s.name}:${s.w}-${s.l}:${s.pf-s.pa}`)');
t('3すくみは得失点差で順位（Q1位・P2位・R3位）',
  results.tiebreak[0].startsWith('Q') && results.tiebreak[1].startsWith('P') && results.tiebreak[2].startsWith('R'));

// ===== 3. 2チーム同率は直接対決優先 =====
run(`
  var group3 = { name: 'Cブロック', teams: ['X', 'Y', 'Z'] };
  // X 50-60 Y（Y勝ち）、X 99-40 Z、Y 70-60 Z → X 1-1(+49), Y 2-0, Z 0-2
  var games3 = [
    { bracketId: 'L3', bracketMatchId: 'g1p1-2', teamAName: 'X', teamBName: 'Y', totalA: 50, totalB: 60 },
    { bracketId: 'L3', bracketMatchId: 'g1p1-3', teamAName: 'X', teamBName: 'Z', totalA: 99, totalB: 40 },
    { bracketId: 'L3', bracketMatchId: 'g1p2-3', teamAName: 'Y', teamBName: 'Z', totalA: 70, totalB: 60 },
  ];
  var r3 = computeLeagueGroup(group3, games3, 'L3', 0);
`);
results.winsFirst = run('r3.ranked.map(s => `${s.name}:${s.w}-${s.l}`)');
t('勝数優先（Y2勝が1位）', results.winsFirst[0] === 'Y:2-0');

// ===== 4. 進行中（未終了）は finished=false =====
run(`
  var r4 = computeLeagueGroup(group, [games[0]], 'L1', 0);
`);
results.partial = run('({ finished: r4.finished, done: r4.doneMatches })');
t('1試合のみ＝未終了', results.partial.finished === false && results.partial.done === 1);

// ===== 5. 星取表HTML =====
run(`
  var league = { id: 'L1', type: 'league', name: '男子予選リーグ', groups: [group] };
  document.getElementById('out').innerHTML = renderLeagueHTML(league, games, true, false);
`);
const table = dom.window.document.querySelector('.league-table');
const cellTexts = [...dom.window.document.querySelectorAll('.lg-cell')].map(c => c.textContent.trim());
results.tableCells = cellTexts;
results.rankCells = [...dom.window.document.querySelectorAll('.lg-rank')].map(c => c.textContent.trim());
t('星取表が生成される', !!table);
t('対戦セルに○●とスコア', cellTexts.some(x => x.includes('○') && x.includes('80-70')) && cellTexts.some(x => x.includes('●')));
t('順位列が確定表示（暫定なし）', results.rankCells.length === 3 && results.rankCells.every(x => !x.includes('暫定')));
t('編集モードでマスがクリック可能',
  dom.window.document.querySelectorAll('.lg-editable').length > 0 &&
  dom.window.document.querySelector('.lg-editable').getAttribute('onclick').includes("openBracketLinkModal('L1','g1p"));

// ===== 6. 枠一覧（listBracketSlots）=====
results.slots = run(`listBracketSlots(league, games, [league]).map(s => s.id + '|' + s.label + '|' + (s.game ? 'linked' : '-'))`);
t('リーグ枠3件・IDと表示', results.slots.length === 3 && results.slots[0].startsWith('g1p1-2|Aブロック：松江高専 vs 仙台高専名取|linked'));

// ===== 7. トーナメントへの順位反映 =====
run(`
  var tour = { id: 'T1', type: 'tournament', size: 4, entries: ['Aブロック1位', 'Aブロック2位', 'Aブロック3位', ''] };
  var rounds = computeBracket(tour, games, [league]);
`);
results.resolved = run('rounds[0].map(m => m.a + " vs " + m.b)');
t('リーグ確定後にチーム名へ置換', results.resolved[0] === '仙台高専名取 vs 松江高専');

// 未確定リーグの場合はプレースホルダのまま
run(`
  var leaguePartial = { id: 'L9', type: 'league', name: '進行中', groups: [{ name: 'Zブロック', teams: ['甲','乙','丙'] }] };
  var rounds2 = computeBracket({ id: 'T2', type: 'tournament', size: 4, entries: ['Zブロック1位','Zブロック2位','',''] }, [], [leaguePartial]);
`);
results.unresolved = run('rounds2[0].map(m => m.a + " vs " + m.b)');
t('リーグ未終了ならプレースホルダ維持', results.unresolved[0] === 'Zブロック1位 vs Zブロック2位');
t('プレースホルダ同士は不戦勝にならない', run('rounds2[0][0].bye') === false);

console.log(JSON.stringify(results, null, 1));
let pass = true;
for (const [name, ok] of checks) { console.log((ok ? '✅' : '❌') + ' ' + name); if (!ok) pass = false; }
process.exit(pass ? 0 : 1);
