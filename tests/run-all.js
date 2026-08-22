// すべての検証をまとめて実行する
//   使い方: cd tests && node run-all.js  （初回のみ npm install）
const { execFileSync } = require('child_process');
const path = require('path');

const html = path.resolve(__dirname, '..', 'index.html');
const files = [
  'debug-check.js',        // 構文・未定義参照などの静的チェック
  'test-visibility.js',    // 公開範囲（速報URL／詳細URL）
  'test-bracket-count.js', // トーナメント（任意チーム数・配置編集）
  'test-schedule.js',      // 試合予定とLIVE表示
  'test-viewer-dom.js',    // 観戦ページの描画
  'test-viewer-refresh.js',// 観戦ページの自動更新間隔（下限5秒）
  'test-timer-delay.js',   // 記録画面のタイマー同期（遅れ表示・補間）
  'test-league.js',        // 予選リーグの順位計算
  'test-league-editor.js', // リーグのブロック編集
];

let ng = 0;
for (const f of files) {
  let out = '';
  try {
    out = execFileSync(process.execPath, [path.join(__dirname, f), html], { encoding: 'utf8' });
  } catch (e) {
    out = (e.stdout || '') + (e.stderr || '');
  }
  const ok = (out.match(/✅/g) || []).length;
  const bad = (out.match(/❌/g) || []).length;
  const err = /Error|not defined/.test(out) && ok === 0;
  if (bad || err) {
    ng++;
    console.log(`✗ ${f}  合格 ${ok} / 失敗 ${bad}`);
    out.split('\n').filter(l => l.includes('❌') || /Error|not defined/.test(l)).slice(0, 5)
      .forEach(l => console.log('   ' + l.trim()));
  } else {
    console.log(`✓ ${f}  ${ok ? '合格 ' + ok : 'チェック完了'}`);
  }
}
console.log(ng ? `\n${ng} 件の問題があります` : '\nすべて合格');
process.exit(ng ? 1 : 0);
