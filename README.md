# 結び屋（musubiya）

作り手みこのホームページ。みこが作ったゲームと道具の置き場です。

- 公開先：https://musubiya-miko.com/ （GitHub Pages）
- 作り：HTML と CSS の静的サイト（ビルド不要）。JavaScript は計測（Google アナリティクス）にだけ使う

## ファイル

| ファイル | 役割 |
| --- | --- |
| `index.html` | ホーム |
| `assets/css/style.css` | 見た目 |
| `CNAME` | 独自ドメインの設定 |
| `sitemap.xml` | 検索エンジン向けのページ一覧 |
| `robots.txt` | 検索エンジン向けの巡回の許可と `sitemap.xml` の場所 |
| `.nojekyll` | GitHub Pages の Jekyll 処理を止める |
| `CLAUDE.md` | 作業の決まりごと |
| `journal/` | 作業日誌 |

## 手元で見る

`index.html` をブラウザで開くだけで見られます。

## よくある差し替え

- 制作中のゲームの名前：`index.html` の「タイトル未定」を 1 か所差し替える（目印のコメントあり）
- ページを足したり中身を大きく変えたりしたとき：`sitemap.xml` の `<url>` と `<lastmod>` を直す
