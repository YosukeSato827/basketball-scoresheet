// 任意チーム数トーナメント（9チーム等）の検証
// - シード自動配置が PDF（高専大会2026 女子）の構造と一致するか
// - 余り枠が表示・選択肢から除外されるか
// - 入力欄が参加チーム数ぶん表示され、既存データを復元できるか
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
  <input id="bracket-count-input" value="9">
  <span id="bracket-count-note"></span>
  <div id="bracket-slot-hint"></div>
  <div id="bracket-slots-wrap"></div>
  <div id="out"></div>
  <div class="modal-overlay" id="modal-slot-team">
    <p id="slot-team-note"></p>
    <div id="slot-team-list"></div>
    <input id="slot-team-manual">
  </div>
</body></html>`);
const ctx = { console, document: dom.window.document, window: dom.window, IS_ARCHIVE: false };
vm.createContext(ctx);
vm.runInContext(src.split('\n').filter(l => l.startsWith('const esc =')).join('\n'), ctx);
vm.runInContext(`const escAttr = s => esc(s).replace(/"/g, '&quot;').replace(/'/g, '&#39;');`, ctx);
vm.runInContext('const showToast = () => {}; const confirm = () => true; let bracketTabBrackets = []; let bracketRosterNames = [];', ctx);
vm.runInContext([
  'bracketSizeForCount', 'expandEntriesToBracket', 'renderBracketSlotInputs', 'onBracketCountChange',
  'autoSeedBracketSlots', 'drawBracketEditPreview', 'openSlotTeamModal', 'assignSlotTeam',
  'closeSlotTeamModal', 'clearBracketSlots', 'openModalOverlay',
  'resolveEntryName', 'computeBracket', 'bracketRoundName', 'renderBracketHTML', 'listBracketSlots',
  '_gameScorePair', 'rankLeagueTeams', 'leagueMatchId', 'computeLeagueGroup', 'fmtSchedule',
  'bracketTeamCount', 'bracketSizeLabel',
].map(extractFn).join('\n'), ctx);

const run = c => vm.runInContext(c, ctx);
const checks = [];
const t = (n, ok, extra) => { checks.push([n, ok]); if (!ok && extra) console.log('   →', JSON.stringify(extra)); };
const $ = s => dom.window.document.querySelectorAll(s);

// ===== 1. 枠数の計算 =====
t('9チーム→16枠', run('bracketSizeForCount(9)') === 16);
t('5チーム→8枠', run('bracketSizeForCount(5)') === 8);
t('8チーム→8枠', run('bracketSizeForCount(8)') === 8);
t('12チーム→16枠', run('bracketSizeForCount(12)') === 16);

// ===== 2. 9チームのシード配置（PDF女子と同じ構造） =====
run(`
  var women = ['松江高専（女子）','旭川高専（女子）','神戸市立高専（女子）','函館高専（女子）',
               '久留米高専（女子）','鈴鹿高専（女子）','秋田高専（女子）','長野高専（女子）','新居浜高専（女子）'];
  var slots9 = expandEntriesToBracket(women, 16);
  var wb = { id: 'W1', type: 'tournament', size: 16, teamCount: 9, entries: slots9 };
  var rounds9 = computeBracket(wb, [], []);
`);
const slots9 = run('slots9');
t('16枠に展開', slots9.length === 16);
t('先頭2枠が1回戦ペア（松江・旭川）',
  slots9[0] === '松江高専（女子）' && slots9[1] === '旭川高専（女子）', slots9);
t('残り7チームは片側のみ（シード）',
  slots9[2] === '神戸市立高専（女子）' && slots9[3] === '' &&
  slots9[4] === '函館高専（女子）' && slots9[5] === '' &&
  slots9[14] === '新居浜高専（女子）' && slots9[15] === '', slots9);

const r1 = run(`rounds9[0].map(m => ({ a: m.a, b: m.b, bye: m.bye, empty: !!m.empty }))`);
t('1回戦の実試合は1つだけ',
  r1.filter(m => !m.empty && !m.bye).length === 1 &&
  r1.filter(m => !m.empty && !m.bye)[0].a === '松江高専（女子）');
t('シード7枠は不戦勝扱い', r1.filter(m => m.bye).length === 7, r1);
t('余り枠は無し（16枠すべて使用）', r1.filter(m => m.empty).length === 0);

const r2 = run(`rounds9[1].map(m => m.a + ' vs ' + m.b)`);
t('2回戦は4試合＝PDFの構造',
  r2.length === 4 &&
  r2[0] === ' vs 神戸市立高専（女子）' &&   // 1回戦勝者未定 vs 神戸市立
  r2[1] === '函館高専（女子） vs 久留米高専（女子）' &&
  r2[2] === '鈴鹿高専（女子） vs 秋田高専（女子）' &&
  r2[3] === '長野高専（女子） vs 新居浜高専（女子）', r2);
t('準決勝2試合・決勝1試合', run('rounds9[2].length') === 2 && run('rounds9[3].length') === 1);

// ===== 3. 余り枠の非表示（5チーム→8枠、余りなし／3チーム→4枠で余り1枠） =====
run(`
  var t3 = expandEntriesToBracket(['甲','乙','丙'], 4);
  var rounds3 = computeBracket({ id: 'X', size: 4, entries: t3 }, [], []);
  document.getElementById('out').innerHTML = renderBracketHTML({ id: 'X', size: 4, entries: t3 }, [], false, false, []);
`);
t('3チーム→1回戦は1試合＋シード1（余り枠なし）',
  run('rounds3[0].filter(m => !m.empty).length') === 2);
t('描画される試合数が正しい', $('#out .br-match').length === 3); // 1回戦2枠 + 決勝1

// 余り枠が生じるケース：16枠に5チーム分だけ入れた既存データ
run(`
  var sparse = ['A','B','C','','','','','','','','','','','','',''];
  var roundsSparse = computeBracket({ id: 'Y', size: 16, entries: sparse }, [], []);
  document.getElementById('out').innerHTML = renderBracketHTML({ id: 'Y', size: 16, entries: sparse }, [], false, false, []);
`);
t('未使用の枠は empty 判定', run('roundsSparse[0].filter(m => m.empty).length') === 6);
// 線でつなぐレイアウトでは、未使用枠も場所だけ確保して非表示にする（位置ずれ防止）
// 16枠に3チームのみ配置：全15枠のうち使用は5枠（1回戦2＋2回戦1＋準決勝1＋決勝1）、残り10枠が非表示
t('未使用枠は非表示クラス付きで描画される',
  $('#out .br-match').length === 15 && $('#out .br-match.br-empty').length === 10,
  { total: $('#out .br-match').length, empty: $('#out .br-match.br-empty').length });
t('未使用ペアも非表示クラス', $('#out .br-pair.br-pair-empty').length >= 2,
  { emptyPairs: $('#out .br-pair.br-pair-empty').length });
t('枠選択リストにも余り枠は出ない',
  run(`listBracketSlots({ id: 'Y', size: 16, entries: sparse }, [], []).length`) === run(`roundsSparse.flat().filter(m => !m.empty).length`));

// ===== 4. 編集画面はトーナメント表そのもの（枠タップで配置） =====
run(`
  bracketRosterNames = ['松江高専（女子）','旭川高専（女子）','神戸市立高専（女子）','函館高専（女子）',
                        '久留米高専（女子）','鈴鹿高専（女子）','秋田高専（女子）','長野高専（女子）','新居浜高専（女子）'];
  document.getElementById('bracket-count-input').value = '9';
  renderBracketSlotInputs(null);
`);
t('編集画面にトーナメント表が描画される', $('#bracket-slots-wrap .bracket-wrap').length === 1);
t('1回戦の全枠（16スロット）が配置可能', $('#bracket-slots-wrap .br-slot-edit').length === 16);
t('空欄には「＋ チームを配置」', $('#bracket-slots-wrap .br-slot-add').length === 16);
t('2回戦以降の枠は配置対象外',
  [...$('#bracket-slots-wrap .br-round')].length === 4 &&
  [...$('#bracket-slots-wrap .br-round')][1].querySelectorAll('.br-slot-edit').length === 0);
t('枠数の注記', dom.window.document.getElementById('bracket-count-note').textContent.includes('16枠'));

// 枠タップ→チーム選択→反映
run(`openSlotTeamModal(0);`);
t('チーム選択モーダルが開く',
  dom.window.document.getElementById('modal-slot-team').classList.contains('open'));
t('選択肢に参加チームが並ぶ', $('#slot-team-list .timer-device-row').length === 9);
t('対象枠の説明', dom.window.document.getElementById('slot-team-note').textContent.includes('第1試合の上'));
run(`assignSlotTeam('松江高専（女子）');`);
t('選んだチームが枠に入る',
  run(`bracketEntriesDraft[0]`) === '松江高専（女子）' &&
  !dom.window.document.getElementById('modal-slot-team').classList.contains('open'));
t('配置後は表に名前が出る',
  [...$('#bracket-slots-wrap .br-name')].some(e => e.textContent.includes('松江高専（女子）')));
t('配置済みチーム数の表示',
  dom.window.document.getElementById('bracket-count-note').textContent.includes('配置済み 1チーム'));

// 既に配置したチームは他の枠の選択肢から消える
run(`openSlotTeamModal(1);`);
t('配置済みチームは選択肢から除外', $('#slot-team-list .timer-device-row').length === 8);
run(`assignSlotTeam('旭川高専（女子）');`);

// 手入力（未登録チーム／リーグ通過枠）
run(`assignSlotTeam; openSlotTeamModal(2); assignSlotTeam('未登録の高専');`);
t('手入力のチームも配置できる', run(`bracketEntriesDraft[2]`) === '未登録の高専');

// 枠を空にする
run(`openSlotTeamModal(2); assignSlotTeam('');`);
t('枠を空に戻せる', run(`bracketEntriesDraft[2]`) === '');

// 配置クリア
run(`clearBracketSlots();`);
t('配置クリアで全枠が空', run(`bracketEntriesDraft.filter(Boolean).length`) === 0);

// ===== 5. PDF（高専大会2026 女子）の実際の配置を再現できる =====
// 1回戦4試合＋神戸市立だけが2回戦から（松江-旭川の勝者と対戦）
run(`
  var pdfEntries = [
    '松江高専（女子）','旭川高専（女子）',    // 第1試合（1回戦）
    '神戸市立高専（女子）','',               // 第2試合（シード）
    '函館高専（女子）','久留米高専（女子）',   // 第3試合（1回戦）
    '','',                                  // 未使用
    '鈴鹿高専（女子）','秋田高専（女子）',     // 第5試合（1回戦）
    '','',                                  // 未使用
    '長野高専（女子）','新居浜高専（女子）',   // 第7試合（1回戦）
    '',''                                   // 未使用
  ];
  var pdfB = { id: 'W2', type: 'tournament', size: 16, teamCount: 9, entries: pdfEntries };
  var pdfRounds = computeBracket(pdfB, [], []);
`);
const pr1 = run(`pdfRounds[0].map(m => ({ a: m.a, b: m.b, bye: !!m.bye, empty: !!m.empty }))`);
t('PDF配置：1回戦は4試合',
  pr1.filter(m => !m.empty && !m.bye).length === 4, pr1.filter(m => !m.empty && !m.bye));
t('PDF配置：神戸市立のみシード',
  pr1.filter(m => m.bye).length === 1 && pr1.find(m => m.bye).a === '神戸市立高専（女子）');
t('PDF配置：未使用枠は3つ', pr1.filter(m => m.empty).length === 3);
const pr2 = run(`pdfRounds[1].map(m => ({ a: m.a, b: m.b, empty: !!m.empty }))`);
t('PDF配置：2回戦で松江/旭川の勝者が神戸市立と対戦',
  pr2[0].b === '神戸市立高専（女子）' && !pr2[0].empty, pr2);
t('PDF配置：準決勝2・決勝1（試合前でも表示）',
  run('pdfRounds[2].filter(m => !m.empty).length') === 2 &&
  run('pdfRounds[3].filter(m => !m.empty).length') === 1,
  { semi: run('pdfRounds[2].map(m => ({a: m.a, b: m.b, empty: !!m.empty}))'), final: run('pdfRounds[3].map(m => ({empty: !!m.empty}))') });
t('PDF配置：2回戦も全4枠が使用中と判定（勝者未定でも消えない）',
  run('pdfRounds[1].filter(m => !m.empty).length') === 4,
  run('pdfRounds[1].map(m => ({a: m.a, b: m.b, empty: !!m.empty}))'));

// スコア未入力の8チーム表：全ラウンドが表示されること（回帰）
run(`
  var fresh = computeBracket({ id: 'F', size: 8, entries: ['A','B','C','D','E','F','G','H'] }, [], []);
`);
t('8チーム未実施でも全枠表示',
  run('fresh[0].filter(m => !m.empty).length') === 4 &&
  run('fresh[1].filter(m => !m.empty).length') === 2 &&
  run('fresh[2].filter(m => !m.empty).length') === 1);

// ===== 6. 自動配置ボタン =====
run(`
  document.getElementById('bracket-count-input').value = '9';
  renderBracketSlotInputs(null);
  var names = ['松江高専（女子）','旭川高専（女子）','神戸市立高専（女子）','函館高専（女子）',
               '久留米高専（女子）','鈴鹿高専（女子）','秋田高専（女子）','長野高専（女子）','新居浜高専（女子）'];
  names.forEach((n, i) => { bracketEntriesDraft[i] = n; });
  autoSeedBracketSlots();
`);
const seeded = run('bracketEntriesDraft');
t('自動配置：先頭ペアが1回戦',
  seeded[0] === '松江高専（女子）' && seeded[1] === '旭川高専（女子）', seeded.slice(0, 4));
t('自動配置：残りはシード（片側のみ）',
  seeded[2] === '神戸市立高専（女子）' && seeded[3] === '' && seeded[4] === '函館高専（女子）' && seeded[5] === '');

// ===== 7. 既存データの復元（配置をそのまま） =====
run(`document.getElementById('bracket-count-input').value = '9'; renderBracketSlotInputs(pdfEntries);`);
const restored = run('bracketEntriesDraft');
t('既存配置をそのまま復元',
  restored.length === 16 && restored[0] === '松江高専（女子）' && restored[3] === '' &&
  restored[4] === '函館高専（女子）', restored.slice(0, 6));
t('復元した表に配置済みチームが表示される',
  [...$('#bracket-slots-wrap .br-name')].filter(e => e.textContent.includes('高専')).length >= 9);

// 枠数変更でも配置を維持
run(`
  document.getElementById('bracket-count-input').value = '20';
  onBracketCountChange();
`);
t('枠数変更で32枠に拡張', run('bracketEntriesDraft.length') === 32);
t('拡張後も配置が維持される', run('bracketEntriesDraft[0]') === '松江高専（女子）');
t('拡張後の表も配置編集可能', $('#bracket-slots-wrap .br-slot-edit').length === 32);

// ===== 8. 見出しのチーム数表記（枠数ではなく実際の出場数） =====
t('9チーム/16枠 → 「9チーム」',
  run(`bracketSizeLabel({ type: 'tournament', size: 16, teamCount: 9, entries: pdfEntries })`) === '9チーム');
t('teamCount 未保存の旧データは配置数から算出',
  run(`bracketSizeLabel({ type: 'tournament', size: 16, entries: pdfEntries })`) === '9チーム');
t('8チーム/8枠 → 「8チーム」',
  run(`bracketSizeLabel({ type: 'tournament', size: 8, teamCount: 8, entries: ['A','B','C','D','E','F','G','H'] })`) === '8チーム');
t('未配置は枠数表記',
  run(`bracketSizeLabel({ type: 'tournament', size: 8, entries: ['','','','','','','',''] })`) === '8枠');
t('リーグはブロック数＋チーム数',
  run(`bracketSizeLabel({ type: 'league', groups: [
    { name: 'A', teams: ['a','b','c'] }, { name: 'B', teams: ['d','e','f'] },
    { name: 'C', teams: ['g','h','i'] }, { name: 'D', teams: ['j','k','l'] } ] })`) === '4ブロック・12チーム');
t('チーム数の集計', run(`bracketTeamCount({ type: 'tournament', size: 16, entries: pdfEntries })`) === 9);

// ===== 9. 接続線のレイアウト（線が切れる不具合の再発防止） =====
// カードの高さは「試合予定の行」の有無で変わる。flex + space-around だと
// 中心位置が高さに引きずられ、25%/50%/75% で引いている線がカードから外れる。
// grid の 1fr（等分スロット）＋ align-items:center なら高さに左右されない。
const cssOf = sel => {
  const i = src.indexOf(sel + ' {');
  return i < 0 ? '' : src.slice(i, src.indexOf('}', i));
};
const cssMatches = cssOf('.br-round-matches');
const cssPair    = cssOf('.br-pair');
t('.br-round-matches が等分スロットのグリッド',
  /display:\s*grid/.test(cssMatches) && /grid-auto-rows:\s*1fr/.test(cssMatches), cssMatches);
t('.br-pair が等分スロットのグリッド',
  /display:\s*grid/.test(cssPair) && /grid-auto-rows:\s*1fr/.test(cssPair), cssPair);
t('.br-pair はカードをスロット中央に置く', /align-items:\s*center/.test(cssPair), cssPair);
t('space-around を使っていない（カードの高さで中心がずれるため）',
  !/space-around/.test(cssMatches) && !/space-around/.test(cssPair), cssMatches + ' | ' + cssPair);
t('線は 25%/50%/75% のまま（スロット中央＝カード中央）',
  /\.br-pair:not\(\.br-pair-single\):not\(\.br-pair-empty\)::before/.test(src) &&
  /top:\s*25%;\s*height:\s*50%/.test(src));

let pass = true;
for (const [n, ok] of checks) { console.log((ok ? '✅' : '❌') + ' ' + n); if (!ok) pass = false; }
process.exit(pass ? 0 : 1);
