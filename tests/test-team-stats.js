// ScoreLink for Team の成績集計と選手名簿の検証（2026.09.09-1）
// - 通算成績は保存済みの合計ではなく pbpData から数え直すこと
// - 作っただけで記録の無い試合を引き分けに数えないこと
// - 名簿に載っているだけの選手を「出場」に数えないこと
// - 名簿の重複・背番号なしを保存前に落とすこと
const fs = require('fs');
const vm = require('vm');

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

const ctx = { console };
vm.createContext(ctx);
vm.runInContext([
  'extractPlayer', 'parseEvent', 'parsePBP', 'buildState', 'computeGameFullStats',
  'parsePlayers', 'playersToText',
  'teamGameSide', 'computeTeamSeasonStats', 'normalizeRoster', 'rosterDupNums',
].map(extractFn).join('\n'), ctx);
const run = (code) => vm.runInContext(code, ctx);

// PBP は「Q \t 時刻 \t A側 \t (空) \t B側」。イベント文字列は #背番号+名前+種別
const evA = (num, name, ev) => `#${num}${name}${ev}`;
const line = (q, a, b) => `${q}\t10:00\t${a || ''}\t\t${b || ''}`;

const roster = [{ num: '4', name: '佐藤' }, { num: '5', name: '田中' }, { num: '6', name: '鈴木' }];

// ===== 1. 自チームがどちら側か =====
t('ourSide があればそれに従う',
  run(`teamGameSide({ ourSide: 'B', teamAName: 'モルテン', teamBName: '相手' }, 'モルテン')`) === 'B');
t('ourSide が無くても相手名が一致すればB側',
  run(`teamGameSide({ teamAName: '桜高校', teamBName: 'モルテン' }, 'モルテン')`) === 'B');
t('既定はA側（試合は必ずA＝自チームで作る）',
  run(`teamGameSide({ teamAName: 'モルテン', teamBName: '桜高校' }, 'モルテン')`) === 'A');
t('両方が同名でもA側に倒す',
  run(`teamGameSide({ teamAName: 'モルテン', teamBName: 'モルテン' }, 'モルテン')`) === 'A');

// ===== 2. 通算成績（勝敗・得失点） =====
ctx.games = [
  { // 勝ち: 8-2
    id: 'g1', gameDate: '2026-09-01', ourSide: 'A',
    teamAName: 'モルテン', teamBName: '桜高校', playersA: roster, playersB: [],
    pbpData: [
      line(1, evA('4', '佐藤', '3P成功'), ''),
      line(1, evA('4', '佐藤', '3P成功'), ''),
      line(2, evA('5', '田中', '2P成功'), ''),
      line(2, '', evA('10', '', '2P成功')),
    ].join('\n'),
    totalA: 999, totalB: 999   // 保存値は使わず PBP から数え直すこと
  },
  { // 負け: 2-3。佐藤はファウルだけ（得点0でも出場に数える）
    id: 'g2', gameDate: '2026-08-20', ourSide: 'A',
    teamAName: 'モルテン', teamBName: '楓高校', playersA: roster, playersB: [],
    pbpData: [
      line(1, evA('5', '田中', '2P成功'), ''),
      line(1, evA('4', '佐藤', 'Pファウル'), ''),
      line(2, '', evA('10', '', '3P成功')),
    ].join('\n')
  },
  { // 作っただけで未記録
    id: 'g3', gameDate: '2026-09-05', ourSide: 'A',
    teamAName: 'モルテン', teamBName: '梅高校', playersA: roster, playersB: [],
    pbpData: '', totalA: 0, totalB: 0
  },
];
const r = run(`computeTeamSeasonStats(games, 'モルテン')`);

t('記録のある2試合だけを成績に数える', r.summary.games === 2);
t('勝敗は 1勝1敗0分', r.summary.wins === 1 && r.summary.losses === 1 && r.summary.draws === 0);
t('得点・失点は PBP から数え直す（保存値の999を使わない）', r.summary.pf === 10 && r.summary.pa === 5);
t('未記録の試合も一覧には出す（3件）', r.results.length === 3);
t('未記録の試合はスコアなし・勝敗なし',
  (() => { const g3 = r.results.find(x => x.id === 'g3'); return g3 && g3.pf === null && g3.result === null; })());
t('勝敗の印が試合ごとに付く',
  r.results.find(x => x.id === 'g1').result === 'win' && r.results.find(x => x.id === 'g2').result === 'lose');
t('相手チーム名を拾う', r.results.find(x => x.id === 'g2').opp === '楓高校');

// ===== 3. 選手別成績 =====
const P = Object.fromEntries(r.players.map(p => [p.num, p]));
t('佐藤は2試合・6得点・1ファウル', P['4'].games === 2 && P['4'].pts === 6 && P['4'].fouls === 1);
t('田中は2試合・4得点', P['5'].games === 2 && P['5'].pts === 4);
t('名簿にいるだけの鈴木は出場0（全試合出場にしない）', P['6'].games === 0 && P['6'].pts === 0);
t('3Pの本数を数える', P['4'].fgm3 === 2 && P['4'].fgm2 === 0);
t('相手チームの選手は入らない', !P['10']);
t('スコアシートモードだけなら成功率もチームプレーも出さない',
  r.hasShotDetail === false && r.hasTeamPlay === false);

// ===== 4. B側が自チームのとき =====
ctx.gamesB = [{
  id: 'b1', gameDate: '2026-09-02',
  teamAName: '桜高校', teamBName: 'モルテン', playersA: [], playersB: roster,
  pbpData: [
    line(1, '', evA('4', '佐藤', '3P成功')),
    line(1, evA('9', '', '2P成功'), ''),
  ].join('\n')
}];
const rb = run(`computeTeamSeasonStats(gamesB, 'モルテン')`);
t('B側でも自チームの得点が pf になる（3-2で勝ち）',
  rb.summary.pf === 3 && rb.summary.pa === 2 && rb.summary.wins === 1);
t('B側でも自チームの選手だけ集計する',
  rb.players.length === 3 && rb.players.find(p => p.num === '4').pts === 3);
t('B側の対戦相手はA側のチーム名', rb.results[0].opp === '桜高校');

// ===== 5. スタッツモードで記録した試合 =====
ctx.gamesS = [{
  id: 's1', gameDate: '2026-09-03', ourSide: 'A',
  teamAName: 'モルテン', teamBName: '桜高校', playersA: roster, playersB: [],
  pbpData: [
    line(1, evA('4', '佐藤', '3P成功'), ''),
    line(1, evA('4', '佐藤', '3P失敗'), ''),
    line(1, evA('5', '田中', 'DREB'), ''),
    line(1, evA('5', '田中', 'AST'), ''),
    line(2, '', evA('10', '', '2P成功')),
  ].join('\n')
}];
const rs = run(`computeTeamSeasonStats(gamesS, 'モルテン')`);
const S = Object.fromEntries(rs.players.map(p => [p.num, p]));
t('試投が記録されていれば成功率を出す対象になる', rs.hasShotDetail === true);
t('リバウンド・アシストがあればチームプレーの列を出す対象になる', rs.hasTeamPlay === true);
t('3Pは 1/2 で数える', S['4'].fgm3 === 1 && S['4'].fga3 === 2);
t('得点の無い選手もリバウンドがあれば出場に数える', S['5'].games === 1 && S['5'].pts === 0 && S['5'].dreb === 1);

// ===== 6. 引き分け =====
ctx.gamesD = [{
  id: 'd1', gameDate: '2026-09-04', ourSide: 'A',
  teamAName: 'モルテン', teamBName: '桜高校', playersA: roster, playersB: [],
  pbpData: [line(1, evA('4', '佐藤', '2P成功'), ''), line(1, '', evA('10', '', '2P成功'))].join('\n')
}];
t('同点は引き分けに数える', run(`computeTeamSeasonStats(gamesD, 'モルテン').summary.draws`) === 1);

// ===== 7. 記録画面を通さず合計だけある試合 =====
ctx.gamesT = [{
  id: 't1', gameDate: '2026-09-06', ourSide: 'A',
  teamAName: 'モルテン', teamBName: '桜高校', pbpData: '', totalA: 60, totalB: 55
}];
const rt = run(`computeTeamSeasonStats(gamesT, 'モルテン')`);
t('PBPが無くても合計が入っていれば勝敗に数える',
  rt.summary.games === 1 && rt.summary.wins === 1 && rt.summary.pf === 60);
t('PBPが無ければ個人成績は作らない', rt.players.length === 0);

// ===== 8. 名簿の整え方 =====
const nr = run(`normalizeRoster([
  { num: ' 4 ', name: ' 佐藤 洋輔 ' },
  { num: '', name: '' },
  { num: '5', name: '田中' },
  { num: '4', name: 'あとから同じ番号' },
  { num: '', name: '番号なし' }
])`);
t('前後の空白を落とす', nr.list[0].num === '4' && nr.list[0].name === '佐藤 洋輔');
t('空行は黙って捨てる', nr.list.length === 2);
t('重複した背番号は先の1人だけ残す',
  nr.list[0].name === '佐藤 洋輔' && nr.dup.length === 1 && nr.dup[0] === '4');
t('背番号のない行は保存せず件数を返す', nr.noNum === 1);
t('num を数値で渡されても文字列にそろえる',
  run(`normalizeRoster([{ num: 7, name: '数値' }]).list[0].num`) === '7');
t('null や undefined でも落ちない',
  run(`normalizeRoster(null).list.length`) === 0 && run(`normalizeRoster([null]).list.length`) === 0);

const dup = run(`Array.from(rosterDupNums([{num:'4'},{num:'5'},{num:'4'},{num:''},{num:''}]))`);
t('画面の重複表示は重なった背番号だけを返す', dup.length === 1 && dup[0] === '4');

// ===== 9. 大会側の名簿形式と行き来できる =====
t('parsePlayers と同じ形（num / name）で保存する',
  run(`(() => {
    const a = parsePlayers('4 佐藤 洋輔\\n5 田中 太郎');
    const b = normalizeRoster(a).list;
    return playersToText(b) === '4 佐藤 洋輔\\n5 田中 太郎';
  })()`) === true);

// ===== 10. 画面側の配線 =====
t('成績タブのボタンがある', /data-tab="stats"[^>]*setTeamTab\('stats'\)/.test(src));
t('renderTeamHome が成績タブを描画する', /teamHomeTab === 'stats'\)\s*renderStatsTab\(\)/.test(src));
t('タブを離れるときに名簿の入力を控える', /setTeamTab\(tab\)\s*\{[\s\S]{0,200}syncRosterFromDOM\(\)/.test(src));
t('入力のたびに行を作り直さない（フォーカス飛び防止）',
  /function onRosterInput\(\)\s*\{[^}]*updateRosterHints\(\)/.test(src)
  && !/function onRosterInput\(\)\s*\{[^}]*renderRosterEditor\(\)/.test(src));
t('新しい試合に ourSide を持たせる', /ourSide:\s*'A'/.test(src));
t('成績タブは並べ替えのたびに Firestore を読まない',
  /function setTeamStatsMetric[\s\S]{0,200}renderStatsTab\(\)/.test(src)
  && /if \(!teamStatsGames\)/.test(src));
t('チームを開き直したら成績と名簿を読み直す',
  /teamStatsGames\s*=\s*null;[\s\S]{0,120}teamRosterLoadedFor\s*=\s*null;/.test(src));

// ---- 結果 ----
let ng = 0;
for (const [name, ok] of checks) {
  console.log((ok ? '✅' : '❌') + ' ' + name);
  if (!ok) ng++;
}
console.log(`\n${checks.length - ng} / ${checks.length} 合格`);
process.exit(ng ? 1 : 0);
