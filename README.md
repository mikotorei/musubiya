# 結び屋（musubiya）

作り手みこのホームページ。みこが作ったゲームと道具の置き場です。

- 公開先：https://musubiya-miko.com/ （GitHub Pages。公開元は `main` の `/docs`）
- 作り：HTML と CSS の静的サイト（ビルド不要）。JavaScript は計測（Google アナリティクス）にだけ使う
- **公開されるのは `docs/` の中だけ**です。それ以外の場所のファイルは公開されません

## ファイル

| ファイル | 役割 |
| --- | --- |
| `docs/index.html` | ホーム |
| `docs/assets/css/style.css` | 見た目 |
| `docs/CNAME` | 独自ドメインの設定 |
| `docs/sitemap.xml` | 検索エンジン向けのページ一覧 |
| `docs/robots.txt` | 検索エンジン向けの巡回の許可と `sitemap.xml` の場所 |
| `docs/.nojekyll` | GitHub Pages の Jekyll 処理を止める |
| `CLAUDE.md` | 作業の決まりごと（担当の職務規定を含む） |
| `journal/` | 作業日誌 |
| `.github/ISSUE_TEMPLATE/instruction.yml` | 指示書の Issue フォーム |
| `.github/workflows/worker.yml`・`worker-done.yml` | 担当（指示書に「着手可」が付いたら Claude Code が作業して提案を出す仕組み） |
| `worker/` | 担当の手順とテスト（miko-hub と同じ中身） |
| `.gitignore` | 担当の作業ファイルなどを入れない |

## 指示の出し方

1. Issues → New issue →「指示書」で書く（ラベル「案」が付く）
2. 任せてよければ、社長がラベル「着手可」を付ける
3. 担当が作業して提案（プルリクエスト）を出し、ラベルが「承認待ち」になる
4. 提案を見て反映すると「完了」、反映せずに閉じると「案」に戻る

サイトの仕事はすべて事前承認です。提案を反映するまで公開されません。決まりの詳細は `CLAUDE.md` と、miko-hub の CLAUDE.md の「担当」の節にあります。

## 手元で見る

`docs/index.html` をブラウザで開くだけで見られます。

## よくある差し替え

- 制作中のゲームの名前：`docs/index.html` の「タイトル未定」を 1 か所差し替える（目印のコメントあり）
- ページを足したり中身を大きく変えたりしたとき：`docs/sitemap.xml` の `<url>` と `<lastmod>` を直す
