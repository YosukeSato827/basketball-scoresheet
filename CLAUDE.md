# molten ScoreLink 開発メモ

バスケットボールのスコア記録・速報アプリ。**`index.html` 1ファイル**で完結（約28万文字）。
ビルド不要。編集したらそのまま配信する。

## 配信（変更したら必ず両方）

```powershell
git add index.html; git commit -m "..."; git push          # GitHub Pages
Copy-Item "index.html" "hosting-public\index.html" -Force; firebase deploy --only hosting
```

- 本番URL: https://molten-scorelink.web.app/ （協会への配布はこちら。恒久URL）
- GitHub Pages: https://yosukesato827.github.io/basketball-scoresheet/
- `hosting-public/` は配信用の作業フォルダ（.gitignore 済み）。index.html だけをコピーする

**スマホ／クラウド（claude.ai/code）から作業する場合**：`firebase deploy` は洋輔さんのPCの
Firebase 認証に依存しているため実行できない。push までで止めて、**GitHub Pages の方で実機確認**する
（push の1分ほど後に反映）。本番URLへの配信はPCに戻ってから。
スマホでのUI調整はこの流れで回すこと。「両方に配信」はPC作業時のルール。

## バージョン番号（指摘が多い箇所）

`APP_VERSION` は **必ず作業当日の日付** `YYYY.MM.DD-N`。同日中の再リリースのみ連番を進める。

**書き換える前に必ず PowerShell の `Get-Date -Format "yyyy-MM-dd"` で実日付を確認する。**
システムプロンプトの日付はセッション開始時点の値で、長時間の作業では実日付とずれる（過去に10日ずれたまま13回リリースした）。

**Bash の `date` は当てにならない。** サンドボックスで実行されると実日付と1日ずれた値を返すことがある
（2026-08-18 に `2026-08-17` を返し、それを信じて2回リリースした）。
Windows のシステム時計を見る PowerShell 側を正とする。疑わしいときは両方を突き合わせる。

`APP_CHANGELOG` の先頭にも同じバージョンでエントリを追加する。

## 構成

| 要素 | 内容 |
|------|------|
| Firestore | tournaments / games / roster_teams / brackets / timer_sync / app_config |
| 認証 | Google ログイン。編集権限は `app_config/editors` のメール許可リスト |
| Storage | `score_sheets/{gameId}/` に紙のスコアシート写真（US-EAST1・無料枠） |
| 分析 | Google アナリティクス（gtag直接。測定ID `G-QB7HSCG2Z5`） |
| プラン | Blaze（従量課金）／予算アラート月1,000円 |
| タイマー連携 | TimerLink → AWS IoT → Lambda → Firestore `timer_sync/{deviceId}` |

## 設計の考え方

- **スコアは常にクライアント側で再計算**する。`games.pbpData`（タブ区切りの1行1イベント）が正で、
  スコアシート・ボックススコア・順位・対戦表はすべて描画時に算出する
- PBP形式: `クォーター \t 時刻 \t A側イベント \t (空) \t B側イベント`
- 閲覧URLは2種類。`?view=大会ID` は合計スコアまで、`?view=...&key=合言葉` は個人名・スコアシート・写真まで
- 通信量対策：タイマーは購読ではなく定期取得。試合詳細は開いたときに生成する。
  **取得間隔は画面ごとに別設定**（2026.08.22-1 で分離）。観戦ページ `viewerRefreshSec` は
  既定10秒・**下限5秒**（1秒は廃止。閲覧者1人につき「稼働中のコート数」ぶんの読み取りが
  毎秒発生するため）。運営画面 `editorRefreshSec` は既定3秒で1秒も選べる（運営は数人なので
  観戦者向けの制限を共有しない）。**記録画面だけは `onSnapshot` の購読**なので即時に届く
- **観戦ページの時計は端末側で秒を進めない（補間しない）。取得したときの値をそのまま出す。**
  `TimerLink-node_0007` のように動作中でも `isCounting`（→ `gameClock.running`）を false で送ってくる
  機種があり、running を見て補間すると同じページに「5秒ごとに動く試合」と「1秒ごとに動く試合」が
  混在する。閲覧者は更新間隔を自分で選んでいるので、その設定どおりに動くことを優先する（2026.08.18-1）
- `ensureViewerTimerSync()` は**取得対象と間隔が同じなら何もしない**（`viewerTimerPollKey` で判定）。
  試合データが届くたびの再描画から呼ばれるので、毎回組み直すと設定より短い周期で通信する
- **`status: 'finished'` の試合はタイマー速報・LIVE表示の対象外**。観戦ページは
  `timerDeviceId` があり かつ 未終了の試合だけを取得対象にする（対象0件なら取得ループ自体を回さない）。
  「タイマーをリンクしたのに何も出ない」ときは、まず試合が終了済みでないかを疑う。
  終了は試合カードの「終了取消」で戻せる（2026.08.16-2 で追加。それ以前は戻す手段が無かった）
- 記録画面の時計と観戦ページのタイマー表示は別系統。試合一覧からのリンクは観戦ページ用で、
  記録画面に出すには記録画面側で「タイマー同期」をONにする

### 「読み込み中...」で固まる系の対処（2026.08.18-1 / -2）

Firestore は接続が詰まっても `onSnapshot` のエラー側を呼ばないことがあり、
画面が「読み込み中...」のまま無言で止まる。**新しく画面を足すときは必ず逃げ道を用意する。**

- `loadTournaments` / `loadGames` は10秒のウォッチドッグ付き。無反応なら
  `showLoadStuckMessage()` で「再試行／ページを再読み込み」を出す。
  再試行は `reconnectFirestore()`（disableNetwork → enableNetwork、各3秒でタイムアウト）を挟む
- **`await db....get()` を素で書かない。** 必ず `withTimeout()` を通す。
  起動時の記録セッション復元がこれで固まると、その先の `loadTournaments()` に到達せず
  大会一覧が永遠に「読み込み中...」になる
- **オフライン永続化（`enablePersistence`）は `?view=` / `?register=` では呼ばない。**
  読み取り専用でキャッシュが要らない上に、同じ端末で複数タブを開くと IndexedDB を
  取り合って最初の取得が返らなくなる（iPhone で発生）
- gstatic の Firebase 本体が読めなかった場合も案内を出す（黙って全スクリプトが止まるため）
- **10秒応答がなければ `recoverWithoutPersistence()` が自動で走る**（2026.08.18-2 / -3）。
  `db.terminate()` → `db = firebase.firestore()` で作り直し、**永続化なし**＋
  **`settings({ experimentalForceLongPolling: true })`** で読み直す。
  compat SDK は terminate 後の `firebase.firestore()` で新しいインスタンスを返す（実機確認済み）。
  1回だけ試す（`dbRebuiltWithoutPersistence`）
- 固まったときの案内には**切り分け用の状態表示**を出す（`showLoadStuckMessage`）。
  最後の手段として `clearLocalCacheAndReload()`（terminate → clearPersistence → reload）のボタンも置く

| 表示 | 読み方 |
|------|--------|
| `オフライン保存: 未応答` | IndexedDB で詰まっている |
| `認証の初期化: 未応答` | Auth SDK 側で止まっている（Firestore は資格情報待ちで接続を開かない） |
| `直接通信テスト: HTTP 200` | 回線は Firestore に届いている＝**SDKの通信方式**の問題 |
| `直接通信テスト: 届かない` | 回線側で塞がれている |

### タイマー速報が「だんだん」遅れる件（2026-08-22・原因特定・Lambda v4 で対処）

配信を続けるほど時計が遅れ、**遅れが毎秒0.75秒ずつ増える**。観戦・記録の両画面で同じに出る。
**両方で同じなら Firestore の中身が古い**ということなので、アプリ側を疑う前にパイプラインを見る。

- 原因は Lambda がメッセージ1件ごとに `timer_sync/{deviceId}` を上書きしていたこと。
  **Firestore は同一ドキュメントへの持続書き込みが毎秒1回が上限**で、超過分は
  **Lambda の非同期呼び出しキュー**（最大6時間保持・古くても捨てない）に溜まる。
  実測のドレイン比は 1/4（送信4Hz・書込1Hz）。40分流すと約30分遅れになる
- 対処は `timekeeperToFirestore_v4.zip`。古いメッセージを書かずに捨て、デバイスごとに
  0.8秒間隔へ間引く。20件連続で捨てたら1件通す（端末の時計ズレで無音化するのを防ぐ）
- **v4 は `lagMs` / `uplinkMs` / `queueMs` をドキュメントに書く。再発時はまずこれを見る**

| 表示 | 読み方 |
|------|--------|
| `lagMs` が 1500 以下 | 正常 |
| `queueMs` が大きい | AWS側で滞留（IoT Rule SQL に `timestamp() AS iotTs` が必要） |
| `uplinkMs` が大きい | 端末→IoT で滞留。TimerLink アプリ・回線側の問題で Lambda では直せない |

- **記録画面の「● LIVE」だけを見て判断しないこと。** 2026.08.22-1 より前は
  「最後に受信してからの経過」を出していたため、古い値が毎秒届き続ける今回の症状では
  26秒遅れていても「● LIVE」と表示された。現在は `lagMs` を使って「● N秒遅れ」を出す
- 切り分けは **TimerLink 実機の表示とアプリを並べて数字を比べる**のが確実

### iPhone で開けない件（2026-08-18・原因未特定）

iPhone の Chrome でタブ6個の状態で molten-scorelink.web.app（運営ページ）を開くと、
`onSnapshot` が最初の1件も返さず、エラーも投げないまま無反応になった。

**分かっていること**

- **Chrome を立ち上げ直したら直った**。以後はログインの有無に関係なく開ける。
  ブラウザ側に残る一時的な状態が詰まっていたもので、データ・ルールの問題ではない
- **オフライン永続化は原因ではない**。`オフライン保存 無効（自動復旧）` まで進んでも読めなかった。
  **IndexedDB 説は棄却済み**（同じ推測を繰り返さないこと）
- **ログインの有無も無関係**。一時「ログイン後だけ開ける」ように見えたが、
  ブラウザ再起動後はどちらでも開けるので、詰まった状態の見え方の違いでしかなかった

**再発したら**

1. エラー画面の状態表示（5項目）を控える。`直接通信テスト` と `認証の初期化` が要
2. 応急処置は**ブラウザを完全に終了して開き直す**。タブは減らしておく

## テスト

`tests/` に jsdom ベースの検証スクリプト。**index.html から関数を抽出して実行**する方式なので、
関数名を変えたらテスト側の抽出リストも直す。

```powershell
cd tests; npm install    # 初回のみ（jsdom）
node test-visibility.js "..\index.html"    # 個別実行
node run-all.js                            # まとめて実行
```

内容：公開範囲・トーナメント/リーグ・試合予定とLIVE表示・閲覧ページ描画。約160項目。

## セキュリティルール

`firestore.rules` / `storage.rules` を firebase.json に紐付け済み。デプロイは
`firebase deploy --only firestore,storage`（`--dry-run` を付けると構文チェックだけ）。

コンソールを開かずに現行ルールを確認する方法（2026-08-16 に実施）：
未ログインの curl でレスポンスコードを見る。**403＝ルールが拒否／404＝ルールは許可（対象が無いだけ）**。

```bash
B=https://firebasestorage.googleapis.com/v0/b/molten-scorelink.firebasestorage.app/o
curl -s "$B/score_sheets%2Fxxx%2Fy.jpg"   # 404 なら read 許可＝正常
curl -s -X DELETE "$B/score_sheets%2Fxxx%2Fy.jpg"  # 403 なら匿名の書き込み拒否＝正常
```

- Storage は `score_sheets/{試合ID}/{ファイル名}` の2階層だけ read 許可。他は全拒否（検証済み）
- **Storage のルールからは `firestore.get()` で Firestore を参照できる**。実際そうしていて、
  アップロードは `app_config/editors` の許可リストに載っているアカウントだけ。画像・10MBまで。
  削除時は `request.resource` が null になるので `request.resource == null ||` で条件を回避している
- `storage.rules` はコンソールの本文と一致させた控え（2026-08-16 突き合わせ済み）。
  **外からの挙動調査だけでルール本文を推測しないこと。** read の条件は 403/404 で判別できるが、
  write の条件は観測できない。一度それで書き起こして、本番より大幅に緩い内容になった

### 把握している制約（実証実験中は許容と判断・2026-08-16）

- **紙のスコアシート写真は実質的に公開状態**。`games` が公開読み取りで、その `sheetPhotos` に
  トークン付きの写真URLがそのまま入っているため、大会IDが分かれば未ログインでも画像を取得できる
  （HTTP 200 で取得できることを確認済み）。アプリのUI上は詳細URL限定だが、データとしては見える
- **Storage のルールを厳しくしても解決しない**。`getDownloadURL()` のトークン付きURLは
  セキュリティルールを迂回して配信されるため。対処するなら公開される `games` ドキュメントに
  写真URLを置かない設計に変える必要があり、アプリの改修を伴う

## 進行中のこと

- **第61回全国高等専門学校体育大会（2026-08-29〜30）で実運用予定**。参加21チーム登録済み
  （男子12＝4ブロック×3、女子9。大会ID `oYw9D12X88cReAISgOiR`）
- 試合予定は `games` ではなく **bracket の `schedule` マップ**（スロットID→date/time/court）に入る。
  `games` ドキュメントは記録を始めた時点で作られるので、大会前に0件なのは正常
- **男子予選リーグは各ブロック3試合のうち、時刻が入るのは第1試合だけ**（日付・コートは全件入力済み）。
  **これは未入力ではなく正しい状態。** 3チームの総当たりで、第1試合の勝敗によって
  以降の組み合わせと開始時刻が変わるため、事前には確定できない。当日 bracket の
  `schedule` を編集して埋めていく運用になる。公式の枠は 9:00 / 10:40 / 12:20 / 14:00 / 15:40 / 17:20。
  観戦ページには「8/29 Aコート」と時刻なしで出る（仕様どおり）
- 大会前に通し確認：複数端末での同時記録／タイマー連携／オフライン復帰／観戦URLの共有
