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

## バージョン番号（指摘が多い箇所）

`APP_VERSION` は **必ず作業当日の日付** `YYYY.MM.DD-N`。同日中の再リリースのみ連番を進める。

**書き換える前に必ず `date '+%Y-%m-%d'`（Bash）で実日付を確認する。**
システムプロンプトの日付はセッション開始時点の値で、長時間の作業では実日付とずれる（過去に10日ずれたまま13回リリースした）。
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
- 通信量対策：タイマーは購読ではなく定期取得（既定10秒）。試合詳細は開いたときに生成する

## テスト

`tests/` に jsdom ベースの検証スクリプト。**index.html から関数を抽出して実行**する方式なので、
関数名を変えたらテスト側の抽出リストも直す。

```powershell
cd tests; npm install    # 初回のみ（jsdom）
node test-visibility.js "..\index.html"    # 個別実行
node run-all.js                            # まとめて実行
```

内容：公開範囲・トーナメント/リーグ・試合予定とLIVE表示・閲覧ページ描画。約160項目。

## 進行中のこと

- **第61回全国高等専門学校体育大会（2026-08-29〜30）で実運用予定**。参加21チーム登録済み
- Firebase Storage のセキュリティルールを公開したか要確認（未公開だと写真アップロードが失敗する）
- 大会前に通し確認：複数端末での同時記録／タイマー連携／オフライン復帰／観戦URLの共有
