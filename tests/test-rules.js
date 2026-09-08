// firestore.rules の不変条件を検査する
//
// この検査が守るもの：ルールを手で書き換えたとき（本番はコンソールへの貼り付け運用）に
// 「うっかり緩めてしまった」ことを検出する。とくに
//   ・大会運営側のルールを触っていないこと（協会の運用を壊さない）
//   ・チーム側が isMember 以外で読めるようになっていないこと
//   ・招待トークンが列挙できるようになっていないこと
//
// この検査が守らないもの：Firestore が実際にそう振る舞うか。
// それを確かめるには Firestore エミュレータ（@firebase/rules-unit-testing）が要り、
// エミュレータには Java が必要。この端末には Java が入っていないため未導入。
// Java を入れられる環境ができたら、こちらは残したうえで実挙動テストを足すこと。
const fs = require('fs');
const path = require('path');

// run-all.js は index.html のパスを渡してくる。ルールは同じフォルダにある
const htmlPath  = process.argv[2];
const rulesPath = path.resolve(path.dirname(htmlPath), 'firestore.rules');
const raw = fs.readFileSync(rulesPath, 'utf8');

// コメントを落としてから構造を見る（コメント中の語で誤判定しないため）
const src = raw.replace(/\/\/[^\n]*/g, '');

let ok = 0, ng = 0;
function check(label, cond, hint) {
  if (cond) { console.log('✅ ' + label); ok++; }
  else { console.log('❌ ' + label + (hint ? '  → ' + hint : '')); ng++; }
}

// ---- match ブロックを入れ子ごと取り出す ----
function parseMatches(text) {
  const out = [];
  const re = /match\s+(\S+)\s*\{/g;
  let m;
  while ((m = re.exec(text)) !== null) {
    const bodyStart = m.index + m[0].length;
    let depth = 1, i = bodyStart;
    while (i < text.length && depth > 0) {
      if (text[i] === '{') depth++;
      else if (text[i] === '}') depth--;
      i++;
    }
    const body = text.slice(bodyStart, i - 1);
    out.push({ path: m[1], body, children: parseMatches(body) });
    re.lastIndex = i;   // 入れ子を二重に拾わない
  }
  return out;
}

const root = parseMatches(src);
const docs = root.find(b => b.path.indexOf('/documents') !== -1);

// 子ブロックを除いた「その階層だけの」本文
function ownBody(block) {
  if (!block) return '';
  let s = block.body;
  block.children.forEach(c => { s = s.replace(c.body, ''); });
  return s;
}
function find(parent, p) {
  return parent ? parent.children.find(b => b.path === p) : null;
}
// 空白をつぶして含有判定する（改行や字下げの違いで落ちないように）
function has(block, needle) {
  return ownBody(block).replace(/\s+/g, ' ').indexOf(needle.replace(/\s+/g, ' ')) !== -1;
}

console.log('--- 構造 ---');
check('/databases/{database}/documents ブロックがある', !!docs);
if (!docs) { console.log('\n合計: ' + ok + ' / 失敗 ' + ng); process.exit(1); }

// =====================================================
// 大会運営側：ここが変わっていたら協会の運用に影響が出る
// =====================================================
console.log('--- 大会運営側（変えてはいけない） ---');

[['/tournaments/{id}', 'tournaments'],
 ['/games/{id}',       'games'],
 ['/brackets/{id}',    'brackets']].forEach(([p, name]) => {
  const b = find(docs, p);
  check(name + ' は誰でも読める（観戦ページ用）', has(b, 'allow read: if true'),
        '観戦ページ・速報URLが未ログインで開けなくなる');
  check(name + ' の書き込みは編集者のみ', has(b, 'allow write: if canEdit()'));
});

const rt = find(docs, '/roster_teams/{id}');
check('roster_teams は誰でも読める', has(rt, 'allow read: if true'));
check('roster_teams は誰でも作成できる（公開登録ページ用）', has(rt, 'allow create: if true'));
check('roster_teams の削除は編集者のみ', has(rt, 'allow delete: if canEdit()'));
check('roster_teams の更新は editToken と tournamentId の改変を禁じている',
      has(rt, 'resource.data.editToken == request.resource.data.editToken')
   && has(rt, 'resource.data.tournamentId == request.resource.data.tournamentId'),
      '他チームの登録内容を書き換えられるようになる');

const ts = find(docs, '/timer_sync/{id}');
check('timer_sync は誰でも読める', has(ts, 'allow read: if true'));
check('timer_sync はクライアントから書けない', has(ts, 'allow write: if false'),
      'Lambda は Admin SDK なので影響しない。ここが true だと誰でも偽の速報を流せる');

const ac = find(docs, '/app_config/{id}');
check('app_config の読み取りはログイン必須', has(ac, 'allow read: if request.auth != null'));
check('app_config の書き込みは編集者のみ', has(ac, 'allow write: if canEdit()'));

// =====================================================
// 認証：メール＋パスワードを有効にしたときの穴
// =====================================================
console.log('--- 認証の判定 ---');
check('userEmail() が email_verified を必須にしている',
      /function\s+userEmail\s*\([^)]*\)\s*\{[^}]*email_verified/.test(src),
      'メール＋パスワードは確認前でもログインできる。これが無いと app_config/editors '
    + 'のアドレスを騙って編集権限を取れる');

// =====================================================
// チーム向け：テナント分離
// =====================================================
console.log('--- ScoreLink for Team ---');

const teams = find(docs, '/teams/{teamId}');
check('teams ブロックがある', !!teams);
check('teams の取得はメンバーのみ', has(teams, 'allow get: if isMember(teamId)'),
      '他チームのデータが読める');
check('teams は列挙できない', has(teams, 'allow list: if false'),
      '全チームの一覧を引ける');
check('teams の作成は自分を ownerUid にすることを強制している',
      has(teams, 'request.resource.data.ownerUid == request.auth.uid'),
      '他人を代表にしたチームを作れる');
check('teams の更新は代表のみ', has(teams, 'allow update: if isOwner(teamId)'));
check('teams の削除は代表のみ', has(teams, 'allow delete: if isOwner(teamId)'));
check('teams の更新で ownerUid を変えられない',
      has(teams, 'request.resource.data.ownerUid == resource.data.ownerUid'),
      '代表の座を奪える');

const members = find(teams, '/members/{uid}');
check('members ブロックがある', !!members);
check('members の読み取りはメンバーのみ', has(members, 'allow read: if isMember(teamId)'));
check('members は自分の1件しか作れない',
      has(members, 'request.auth.uid == uid'),
      '他人を勝手にチームへ入れられる');
check('members の参加経路は招待の検証を通る', has(members, 'inviteOk(teamId,'),
      '招待リンク無しで誰でも入れる');
check('members の役割変更は代表のみ', has(members, 'allow update: if isOwner(teamId)'),
      '一般メンバーが自分を代表に昇格できる');

const tPlayers = find(teams, '/players/{playerId}');
const tGames   = find(teams, '/games/{gameId}');
check('チームの選手名簿はメンバーのみ', has(tPlayers, 'allow read, write: if isMember(teamId)'));
check('チームの試合はメンバーのみ',     has(tGames,   'allow read, write: if isMember(teamId)'),
      'チームの記録が外部に漏れる');

const invites = find(docs, '/invites/{token}');
check('invites ブロックがある', !!invites);
check('invites は1件ずつなら誰でも読める（リンクを開いた人にチーム名を出すため）',
      has(invites, 'allow get: if true'));
check('invites は列挙できない', has(invites, 'allow list: if false'),
      'トークンを総当たりで集めて、どのチームにも入れるようになる');
check('invites の作成は代表のみ', has(invites, 'allow create: if isOwner('));
check('invites は書き換えられない', has(invites, 'allow update: if false'),
      '期限や teamId を書き換えられる');

const users = find(docs, '/users/{uid}');
check('users は本人のみ読み書きできる',
      has(users, 'request.auth != null && request.auth.uid == uid'));

// =====================================================
// 全体
// =====================================================
console.log('--- 全体 ---');
const last = docs.children[docs.children.length - 1];
check('最後に全拒否の catch-all がある',
      last && last.path === '/{document=**}' && has(last, 'allow read, write: if false'),
      '新しいコレクションが既定で開いてしまう');

// 危険な書き方が紛れ込んでいないか。roster_teams の create だけは公開登録ページ用の既知の例外
const dangerous = [];
function scan(block, chain) {
  const here = chain + ' ' + block.path;
  ownBody(block).split('\n').forEach(line => {
    const t = line.trim();
    if (!/^allow\s/.test(t)) return;
    if (!/if\s+true\s*;?\s*$/.test(t)) return;
    if (/allow\s+(read|get|list)\s*:/.test(t)) return;                 // 公開読み取りは設計どおり
    if (block.path === '/roster_teams/{id}' && /allow create/.test(t)) return; // 既知の例外
    dangerous.push(here.trim() + ' → ' + t);
  });
  block.children.forEach(c => scan(c, here));
}
scan(docs, '');
check('無条件に書ける場所が無い（roster_teams の公開登録を除く）',
      dangerous.length === 0, dangerous.join(' / '));

console.log('\n合計: ' + ok + (ng ? ' / 失敗 ' + ng : ''));
process.exit(ng ? 1 : 0);
