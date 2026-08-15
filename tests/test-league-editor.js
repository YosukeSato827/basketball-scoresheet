// リーグのブロック編集UI（参加チーム選択・手入力・削除・保存形式）の検証
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

const dom = new JSDOM('<!doctype html><html><body><div id="league-groups-wrap"></div></body></html>');
const promptCalls = [];
const ctx = {
  console, document: dom.window.document, window: dom.window,
  prompt: (msg) => { promptCalls.push(msg); return ctx.__promptAnswer; },
  __promptAnswer: null,
};
vm.createContext(ctx);
vm.runInContext(src.split('\n').filter(l => l.startsWith('const esc =')).join('\n'), ctx);
vm.runInContext('let leagueGroupDraft = []; let bracketRosterNames = [];', ctx);
vm.runInContext([
  'drawLeagueGroupInputs', 'renderLeagueGroupInputs', 'addTeamToGroup',
  'addManualTeamToGroup', 'removeTeamFromGroup', 'addLeagueGroup', 'removeLeagueGroup',
].map(extractFn).join('\n'), ctx);

const run = c => vm.runInContext(c, ctx);
const checks = [];
const t = (n, ok) => checks.push([n, ok]);
const $ = s => dom.window.document.querySelectorAll(s);

// 参加チーム（今回登録した高専大会のロスターを模す）
run(`bracketRosterNames = ['松江高専（男子）','仙台高専名取（男子）','鈴鹿高専（男子）','豊田高専（男子）','苫小牧高専（男子）','鶴岡高専（男子）'];`);
run(`renderLeagueGroupInputs(null);`);

// 1. 初期状態
t('初期ブロック1件・チーム未選択',
  $('.league-group-edit').length === 1 && $('.league-team-empty').length === 1);
t('選択肢に参加チームが並ぶ', $('.league-team-add select option').length === 7); // 先頭ダミー＋6
t('手入力ボタンがある', $('.league-team-add button').length === 1);

// 2. 参加チームから追加
run(`addTeamToGroup(0, '松江高専（男子）'); addTeamToGroup(0, '仙台高専名取（男子）');`);
t('チップが2件表示', $('.league-team-chip').length === 2);
t('チップ内容が正しい', $('.league-team-chip')[0].textContent.includes('松江高専（男子）'));
t('選択済みは選択肢から消える', $('.league-team-add select option').length === 5); // 6-2+ダミー

// 3. 重複追加は無視
run(`addTeamToGroup(0, '松江高専（男子）');`);
t('同一チームの重複追加を防ぐ', $('.league-team-chip').length === 2);

// 4. 手入力で未登録チームを追加
ctx.__promptAnswer = '未登録高専';
run(`addManualTeamToGroup(0);`);
t('手入力でpromptが開く', promptCalls.length === 1);
t('未登録チームが追加される',
  $('.league-team-chip').length === 3 && $('.league-team-chip')[2].textContent.includes('未登録高専'));

// キャンセル時は追加しない
ctx.__promptAnswer = null;
run(`addManualTeamToGroup(0);`);
t('手入力キャンセルで追加されない', $('.league-team-chip').length === 3);

// 5. ブロック追加＋他ブロックで使用中のチームは選べない
run(`addLeagueGroup();`);
t('ブロックが2件になる', $('.league-group-edit').length === 2);
const g2opts = [...$('.league-group-edit')[1].querySelectorAll('option')].map(o => o.value);
t('他ブロック使用中のチームは選択肢外',
  !g2opts.includes('松江高専（男子）') && g2opts.includes('鈴鹿高専（男子）'));
t('2ブロック目の名前が自動採番', run(`leagueGroupDraft[1].name`) === 'Bブロック');

// 6. チップの×で削除
run(`removeTeamFromGroup(0, 0);`);
t('チームを削除できる',
  run(`leagueGroupDraft[0].teams.length`) === 2 &&
  !run(`leagueGroupDraft[0].teams.includes('松江高専（男子）')`));

// 7. 既存リーグの編集（groups → draft 復元）
run(`renderLeagueGroupInputs([
  { name: 'Aブロック', teams: ['松江高専（男子）','仙台高専名取（男子）','鈴鹿高専（男子）'] },
  { name: 'Bブロック', teams: ['豊田高専（男子）'] }
]);`);
t('既存リーグを読み込むとチップ復元',
  $('.league-group-edit').length === 2 && $('.league-team-chip').length === 4);
t('保存用データ形式が teams 配列',
  Array.isArray(run(`leagueGroupDraft[0].teams`)) && run(`leagueGroupDraft[0].teams[0]`) === '松江高専（男子）');

// 8. ブロック削除
run(`removeLeagueGroup(1);`);
t('ブロックを削除できる', $('.league-group-edit').length === 1);

let pass = true;
for (const [n, ok] of checks) { console.log((ok ? '✅' : '❌') + ' ' + n); if (!ok) pass = false; }
process.exit(pass ? 0 : 1);
