// スコアシート写真のアップロード：複数枚・進捗表示・バックグラウンド継続の検証（2026.08.30-2）
// - input.files（呼び出し側が空にできる「生きた一覧」）を渡されても全枚数を受け付けること
// - 送信中にモーダルを閉じても残りが送られること
// - 進み具合をパーセントで出すこと
const fs = require('fs');
const vm = require('vm');
const { JSDOM } = require('jsdom');

const src = fs.readFileSync(process.argv[2], 'utf8');
const checks = [];
const t = (n, ok) => checks.push([n, ok]);

// async function にも対応した抽出（`async` を落とすと await が構文エラーになる）
function extractFn(name) {
  const start = src.indexOf(`function ${name}(`);
  if (start < 0) throw new Error(`function not found: ${name}`);
  const head = src.slice(Math.max(0, start - 6), start);
  const from = head.endsWith('async ') ? start - 6 : start;
  let depth = 0;
  for (let j = src.indexOf('{', start); j < src.length; j++) {
    if (src[j] === '{') depth++;
    else if (src[j] === '}') { depth--; if (depth === 0) return src.slice(from, j + 1); }
  }
  throw new Error('unbalanced: ' + name);
}

// ---- 1) ファイル選択の受け渡し（HTML側） ----------------------------------
// this.value='' は input.files を空にする。FileList のまま非同期処理へ渡すと
// 2枚目以降が消えるので、属性の時点で配列に写している必要がある
const onchange = (src.match(/id="sheet-photo-input"[\s\S]{0,240}?onchange="([^"]*)"/) || [])[1] || '';
t('input の onchange が FileList を配列に写している', /Array\.from\(this\.files\)/.test(onchange));
t('input の onchange が this.value をクリアしている', /this\.value=''/.test(onchange));

// ---- 2) 実際に動かす ------------------------------------------------------
const dom = new JSDOM(`<!doctype html><html><body>
  <div id="photo-upload-status"><span id="photo-upload-text"></span><span id="photo-upload-fill"></span></div>
  <div id="sheet-photo-progress" style="display:none"></div>
  <div id="sheet-photo-list"></div>
</body></html>`);
const doc = dom.window.document;
const wait = ms => new Promise(r => dom.window.setTimeout(r, ms));

const log = { puts: [], unions: [], toasts: [], wakeReq: 0, wakeRel: 0 };

// Storage の put を模す。実時間をかけて4段階で進捗を出してから完了する
// （進捗の途中を観測できるように、マイクロタスクではなくタイマーで進める）
function fakePut(path) {
  return {
    on(_evt, next, _err, done) {
      let sent = 0;
      const step = () => {
        sent += 50;
        next({ bytesTransferred: sent, totalBytes: 200 });
        if (sent >= 200) { log.puts.push(path); done(); }
        else dom.window.setTimeout(step, 8);
      };
      dom.window.setTimeout(step, 8);
    }
  };
}

const ctx = {
  console, document: doc, window: dom.window,
  Date, Math, JSON, Promise, Array, Object, String, Number, Error,
  setTimeout: dom.window.setTimeout.bind(dom.window),
  navigator: {},                       // wakeLock 非対応の端末でも落ちないこと
  isOnline: true,
  currentTournamentId: 'T1',
  storage: { ref: path => ({ put: () => fakePut(path), getDownloadURL: async () => 'https://x/' + path }) },
  db: {
    collection: () => ({
      doc: id => ({ update: async payload => { log.unions.push({ id, payload }); } })
    })
  },
  firebase: { firestore: { FieldValue: { arrayUnion: e => ({ union: e }), arrayRemove: e => ({ remove: e }) } } },
  showToast: m => log.toasts.push(m),
  track: () => {},
  escAttr: s => String(s),
  compressImageFile: async file => ({ size: file.size }),   // canvas は使わない
  sheetPhotoGameId: 'G1',
  sheetPhotoGame: { sheetPhotos: [] },
  photoUploadQueue: [],
  photoUploadRunning: false,
  photoUploadTotal: 0, photoUploadDone: 0, photoUploadFailed: 0,
  photoUploadRatio: 0, photoUploadPhase: '', photoUploadWakeLock: null,
};
vm.createContext(ctx);
vm.runInContext(
  ['acquirePhotoWakeLock', 'releasePhotoWakeLock', 'renderPhotoUploadProgress',
   'renderSheetPhotoList', 'uploadSheetPhotos', 'waitForOnline',
   'runPhotoUploadQueue', 'uploadOneSheetPhoto'].map(extractFn).join('\n'), ctx);

const callUpload = vm.runInContext('uploadSheetPhotos', ctx);

// input.files と同じ「呼び出し側が空にできる生きた一覧」を作る
function liveFileList(n) {
  const list = { length: n };
  for (let i = 0; i < n; i++) list[i] = { name: `s${i}.jpg`, size: 1000 + i };
  list[Symbol.iterator] = Array.prototype[Symbol.iterator];
  list.clear = () => { for (let i = 0; i < list.length; i++) delete list[i]; list.length = 0; };
  return list;
}

const snap = () => ({
  badge: doc.getElementById('photo-upload-text').textContent,
  prog:  doc.getElementById('sheet-photo-progress').textContent,
  shown: doc.getElementById('photo-upload-status').className.indexOf('show') >= 0,
  fill:  doc.getElementById('photo-upload-fill').style.width,
});

// 送信が終わるまで一定間隔で見張り、その間の表示を集める
async function drain(onFirstSample) {
  const seen = [];
  for (let i = 0; i < 600 && ctx.photoUploadRunning; i++) {
    await wait(2);
    if (!ctx.photoUploadRunning) break;
    seen.push(snap());
    if (seen.length === 1 && onFirstSample) onFirstSample();
  }
  return seen;
}

(async () => {
  // --- 2枚まとめて選ぶ。渡した直後に input を空にする（従来はここで1枚消えた） ---
  const files = liveFileList(2);
  callUpload(files);
  files.clear();

  t('2枚とも待ち行列に入る', ctx.photoUploadTotal === 2);
  t('受け付けた時点で送信が始まっている', ctx.photoUploadRunning === true);

  // 送信が始まったら、その途中でモーダルを閉じる（バックグラウンド継続の確認）
  const seen = await drain(() => { ctx.sheetPhotoGameId = null; ctx.sheetPhotoGame = null; });

  t('送信中は進捗を出し続ける', seen.length > 3 && seen.every(s => s.shown));
  t('進捗にパーセントが出る', seen.every(s => /\d+%/.test(s.badge)));
  t('1枚目を送っている間は 1/2 と出る', seen.some(s => /1\/2/.test(s.badge)));
  t('2枚目を送っている間は 2/2 と出る', seen.some(s => /2\/2/.test(s.badge)));
  t('パーセントは戻らない', (() => {
    const pcts = seen.map(s => parseInt(s.badge.match(/(\d+)%/)[1], 10));
    return pcts.every((p, i) => i === 0 || p >= pcts[i - 1]);
  })());
  t('進捗バーの幅がパーセントと一致する',
    seen.every(s => s.fill === s.badge.match(/(\d+)%/)[1] + '%'));
  t('モーダル内の行にも同じ内容を出す', seen.every(s => s.prog === s.badge));

  t('モーダルを閉じても2枚とも送信される', log.puts.length === 2);
  t('保存先が1枚ごとに別になる', log.puts[0] !== log.puts[1]);
  t('保存先が対象の試合の下になる', log.puts.every(p => p.startsWith('score_sheets/G1/')));
  t('試合データへの反映も2回', log.unions.length === 2);
  t('反映は閉じた後も元の試合に向く', log.unions.every(u => u.id === 'G1'));
  t('反映は arrayUnion（配列ごと上書きしない）',
    log.unions.every(u => u.payload.sheetPhotos && u.payload.sheetPhotos.union));
  t('完了の知らせは2枚', log.toasts.some(m => /2枚保存/.test(m)));
  t('完了後は進捗を消す', !snap().shown);
  t('完了後はモーダル内の行も消す', doc.getElementById('sheet-photo-progress').style.display === 'none');
  t('wakeLock 非対応の端末でも完走する', ctx.photoUploadWakeLock === null);

  // --- 未送信ぶんは一覧に「保存中...」として出す ---
  ctx.sheetPhotoGameId = 'G1';
  ctx.sheetPhotoGame = { sheetPhotos: [] };
  ctx.photoUploadQueue.push({ gameId: 'G1', file: {} }, { gameId: 'G2', file: {} });
  vm.runInContext('renderSheetPhotoList()', ctx);
  const html = doc.getElementById('sheet-photo-list').innerHTML;
  t('別の試合ぶんは数えず、この試合の未送信だけ枠を出す',
    (html.match(/sheet-photo-pending/g) || []).length === 1);
  ctx.photoUploadQueue.length = 0;

  // --- 送信中は画面を消灯させない（対応端末） ---
  log.puts.length = 0; log.unions.length = 0; log.toasts.length = 0;
  ctx.navigator = {
    wakeLock: { request: async () => { log.wakeReq++; return {
      addEventListener: () => {}, release: () => { log.wakeRel++; }
    }; } }
  };
  callUpload(liveFileList(1));
  await drain();
  t('送信中に wakeLock を取る', log.wakeReq === 1);
  t('送信が終わったら wakeLock を返す', log.wakeRel === 1 && ctx.photoUploadWakeLock === null);

  // --- オフラインでも受け付けて、復帰を待ってから送る ---
  log.puts.length = 0; log.unions.length = 0; log.toasts.length = 0;
  ctx.isOnline = false;
  callUpload(liveFileList(1));
  await wait(60);
  t('オフライン中は送信しない', log.puts.length === 0);
  t('オフライン中も待ち行列に残す', ctx.photoUploadRunning === true);
  ctx.isOnline = true;
  await drain();
  t('オンライン復帰後に送信される', log.puts.length === 1);

  let pass = true;
  for (const [n, ok] of checks) { console.log((ok ? '✅' : '❌') + ' ' + n); if (!ok) pass = false; }
  process.exit(pass ? 0 : 1);
})();
