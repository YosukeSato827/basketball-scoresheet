const fs = require('fs');
const path = process.argv[2];
const html = fs.readFileSync(path, 'utf8');

// 1. JS構文
const s = html.match(/<script>([\s\S]*?)<\/script>/);
try { new Function(s[1]); console.log('1. JS構文: OK (' + s[1].length + ' chars)'); }
catch (e) { console.log('1. JS構文 ERROR: ' + e.message); }

// 2. イベントハンドラ未定義関数
const evRe = /on(?:click|change|input)="([a-zA-Z_]\w*)\(/g;
const fns = new Set(); let m;
while ((m = evRe.exec(html))) { fns.add(m[1]); }
const defRe = /function\s+([a-zA-Z_]\w*)\s*\(/g;
const defs = new Set();
while ((m = defRe.exec(html))) { defs.add(m[1]); }
const missing = [...fns].filter(f => !defs.has(f));
console.log('2. イベント未定義関数: ' + (missing.length === 0 ? 'なし OK' : missing.join(', ')));

// 3. getElementById 参照の存在
const idRe = /getElementById\(['"]([\w-]+)['"]\)/g;
const refs = new Set();
while ((m = idRe.exec(html))) { refs.add(m[1]); }
const htmlPart = html.split('<script>')[0];
const idDefRe = /\sid="([\w-]+)"/g;
const ids = new Set();
while ((m = idDefRe.exec(htmlPart))) { ids.add(m[1]); }
const missIds = [...refs].filter(r => !ids.has(r));
console.log('3. 静的HTMLに無いID参照: ' + (missIds.length === 0 ? 'なし OK' : missIds.join(', ')));

// 4. 重複関数定義
const counts = {};
defRe.lastIndex = 0;
while ((m = defRe.exec(html))) { counts[m[1]] = (counts[m[1]] || 0) + 1; }
const dups = Object.entries(counts).filter(([k, v]) => v > 1);
console.log('4. 重複関数定義: ' + (dups.length === 0 ? 'なし OK' : dups.map(([k, v]) => k + 'x' + v).join(', ')));

// 5. 呼び出しの見当たらない関数（出現1回=定義のみ）
const deadCand = [];
for (const fn of defs) {
  const uses = (html.split(fn).length - 1);
  if (uses <= 1) deadCand.push(fn);
}
console.log('5. 呼び出しなし関数: ' + (deadCand.length === 0 ? 'なし OK' : deadCand.join(', ')));

// 6. CSS重複セレクタ（トップレベル、3回以上）
const cssPart = (html.match(/<style>([\s\S]*?)<\/style>/) || [,''])[1];
const cssRe = /^(\.[\w-]+|#[\w-]+)\s*\{/gm;
const cssCounts = {};
while ((m = cssRe.exec(cssPart))) { cssCounts[m[1]] = (cssCounts[m[1]] || 0) + 1; }
const cssDups = Object.entries(cssCounts).filter(([k, v]) => v >= 3);
console.log('6. CSS 3回以上重複セレクタ: ' + (cssDups.length === 0 ? 'なし OK' : cssDups.map(([k, v]) => k + 'x' + v).join(', ')));

// 7. トップレベル変数の重複宣言
const varRe = /^(?:let|const)\s+([a-zA-Z_]\w*)/gm;
const vcounts = {};
while ((m = varRe.exec(s[1]))) { vcounts[m[1]] = (vcounts[m[1]] || 0) + 1; }
const vdups = Object.entries(vcounts).filter(([k, v]) => v > 1);
console.log('7. 重複変数宣言: ' + (vdups.length === 0 ? 'なし OK' : vdups.map(([k, v]) => k + 'x' + v).join(', ')));
