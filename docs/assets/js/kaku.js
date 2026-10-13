/*
 * 結び屋 書く画面（社長専用）
 *
 * 題・狙いの言葉・本文から、読みもののページ（JavaScript を使わない HTML）を作り、
 * 一覧（docs/yomimono/index.html）と docs/sitemap.xml を書き換えて、
 * GitHub に作業用の枝と提案（プルリクエスト）を作る。マージすると公開される。
 *
 * 保存には、社長のスマホか PC に入れた GitHub の鍵（細かい権限の個人用トークン）が要る。
 * 鍵と書きかけは、そのブラウザの中（localStorage）にだけ残す（スマホと PC では別々）。
 */
(function () {
  'use strict';

  var OWNER = 'mikotorei';
  var REPO = 'musubiya';
  var BASE = 'main';
  var SITE = 'https://musubiya-miko.com';
  var API = 'https://api.github.com';

  var LIST_PATH = 'docs/yomimono/index.html';
  var SITEMAP_PATH = 'docs/sitemap.xml';
  var LIST_START = '<!-- 読みもの一覧ここから';
  var LIST_END = '<!-- 読みもの一覧ここまで -->';

  var HIKOSHIKI = 'このページは、OnceWorld を遊んだみこが書いた非公式の読みものです。ゲームの運営（合同会社PONIX）とは関係ありません。';

  // 狙いの言葉の中で、本文では正式な名前で書くもの（ゲームの名前は「OnceWorld」と書く決まり）
  var SEISHIKI = { 'ワンスワ': 'OnceWorld' };
  var HEAD_LENGTH = 100;

  // 先に登録しておく書きかけ（URL は決まっている）
  var KAKIKAKE = [
    { id: 'onceworld-pet', slug: 'onceworld-pet', title: 'ペットについて', nerai: 'ワンスワ ペット' },
    {
      id: 'onceworld-site', slug: 'onceworld-site', title: '攻略サイトを作った話', nerai: 'ワンスワ 攻略サイト',
      leadLink: { before: 'この話で作った攻略サイト：', text: '巫女とワンスワ攻略', url: 'https://mikotorei.github.io/onceworld-alpha/' }
    },
    { id: 'onceworld-joban-1', slug: 'onceworld-joban-1', title: 'プレイしていた時の考え方 part1', nerai: 'ワンスワ 序盤' }
  ];

  var STORE_KEY = 'musubiya-kaku-v1';
  var TOKEN_KEY = 'musubiya-kaku-token';

  // ---------- 文字の下ごしらえ ----------

  function esc(s) {
    return String(s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function linkify(escaped) {
    return escaped.replace(/https?:\/\/[A-Za-z0-9\-._~:/?#[\]@!$&*+,;=%]+/g, function (url) {
      var tail = '';
      var m = url.match(/[.,;:!?)\]]+$/);
      if (m) { tail = m[0]; url = url.slice(0, -tail.length); }
      return '<a href="' + url + '">' + url + '</a>' + tail;
    });
  }

  // 本文 → HTML（空行で段落、「■」で始まる行は小見出し、URL はリンク）
  function bodyToHtml(text) {
    var lines = String(text).replace(/\r\n?/g, '\n').split('\n');
    var out = [];
    var para = [];
    function flush() {
      if (para.length) {
        out.push('<p>' + para.map(function (l) { return linkify(esc(l)); }).join('<br>') + '</p>');
        para = [];
      }
    }
    lines.forEach(function (raw) {
      var line = raw.replace(/\s+$/, '');
      if (!line.trim()) { flush(); return; }
      var h = line.match(/^\s*■\s*(.*)$/);
      if (h) {
        flush();
        if (h[1].trim()) out.push('<h2>' + esc(h[1].trim()) + '</h2>');
        return;
      }
      para.push(line.trim());
    });
    flush();
    return out.join('\n        ');
  }

  // 本文 → 1 行の文字（説明文と、狙いの言葉の確認に使う）。日本語の行の間には空白を入れない
  function plainText(text) {
    var lines = String(text)
      .replace(/\r\n?/g, '\n')
      .split('\n')
      .map(function (l) { return l.replace(/^\s*■\s*/, '').replace(/\s+/g, ' ').trim(); })
      .filter(Boolean);
    return lines.reduce(function (acc, l) {
      if (!acc) return l;
      var ascii = /[\x21-\x7e]$/.test(acc) && /^[\x21-\x7e]/.test(l);
      return acc + (ascii ? ' ' : '') + l;
    }, '');
  }

  function describe(text) {
    var t = plainText(text);
    return t.length > 110 ? t.slice(0, 110) + '…' : t;
  }

  // 狙いの言葉が題と本文の頭に入っているか。入っていない言葉を返す（空なら知らせない）
  function checkNerai(title, nerai, body) {
    var target = (String(title) + ' ' + plainText(body).slice(0, HEAD_LENGTH)).toLowerCase();
    return String(nerai).split(/[\s　]+/).filter(Boolean).map(function (w) {
      return SEISHIKI[w] || w;
    }).filter(function (w) {
      return target.indexOf(w.toLowerCase()) === -1;
    });
  }

  // ---------- 日付 ----------

  function today() {
    // 日本の日付（YYYY-MM-DD）
    var d = new Date(Date.now() + 9 * 3600 * 1000);
    return d.toISOString().slice(0, 10);
  }

  function jaDate(iso) {
    var p = iso.split('-');
    return Number(p[0]) + '年' + Number(p[1]) + '月' + Number(p[2]) + '日';
  }

  // ---------- 読みもののページの型 ----------

  function analyticsTag() {
    return [
      '  <!-- Google アナリティクス（計測のみ。表示には使わない） -->',
      '  <script async src="https://www.googletagmanager.com/gtag/js?id=G-XVP6Q1BMXK"></script>',
      '  <script>',
      '    window.dataLayer = window.dataLayer || [];',
      '    function gtag(){dataLayer.push(arguments);}',
      "    gtag('js', new Date());",
      "    gtag('config', 'G-XVP6Q1BMXK');",
      '  </script>'
    ].join('\n');
  }

  function buildArticle(page, opts) {
    opts = opts || {};
    var url = SITE + '/yomimono/' + page.slug + '.html';
    var lead = '';
    if (page.leadLink) {
      lead = '\n      <p class="yomi-lead-link">' + esc(page.leadLink.before) +
        '<a href="' + esc(page.leadLink.url) + '">' + esc(page.leadLink.text) + '</a></p>';
    }
    return [
      '<!doctype html>',
      '<html lang="ja">',
      '<head>',
      '  <meta charset="utf-8">',
      '  <meta name="viewport" content="width=device-width, initial-scale=1">',
      '  <title>' + esc(page.title) + ' ｜ 結び屋</title>',
      '  <meta name="description" content="' + esc(page.description) + '">',
      '  <!-- 狙いの言葉（画面には出さない） -->',
      '  <meta name="musubiya:nerai" content="' + esc(page.nerai) + '">',
      '  <meta property="og:type" content="article">',
      '  <meta property="og:site_name" content="結び屋">',
      '  <meta property="og:title" content="' + esc(page.title) + ' ｜ 結び屋">',
      '  <meta property="og:description" content="' + esc(page.description) + '">',
      '  <meta property="og:url" content="' + url + '">',
      '  <meta property="og:locale" content="ja_JP">',
      '  <meta name="theme-color" content="#F5F0E6">',
      '  <link rel="canonical" href="' + url + '">',
      '  <link rel="icon" href="../favicon.svg" type="image/svg+xml">',
      '  <link rel="apple-touch-icon" href="../apple-touch-icon.svg">',
      '  <link rel="preconnect" href="https://fonts.googleapis.com">',
      '  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>',
      '  <link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Shippori+Mincho+B1:wght@600;800&family=Zen+Kaku+Gothic+New:wght@400;500;700&display=swap">',
      '  <link rel="stylesheet" href="../assets/css/style.css">',
      '  <link rel="stylesheet" href="../assets/css/yomimono.css">',
      opts.analytics === false ? '' : '\n' + analyticsTag(),
      '</head>',
      '<body>',
      '',
      '  <header class="site-header">',
      '    <div class="wrap header-inner">',
      '      <a class="brand" href="../" aria-label="結び屋 ホーム">',
      '        <span class="seal-square" aria-hidden="true">結</span>',
      '        <span class="brand-name">結び屋</span>',
      '      </a>',
      '      <nav class="site-nav" aria-label="目次">',
      '        <ul>',
      '          <li><a href="../">ホーム</a></li>',
      '          <li><a href="./">読みもの</a></li>',
      '          <li><a href="../#support">応援</a></li>',
      '        </ul>',
      '      </nav>',
      '    </div>',
      '  </header>',
      '',
      '  <main class="yomi-main">',
      '    <article class="wrap yomi-wrap">',
      '      <p class="yomi-kicker"><a href="./">読みもの</a></p>',
      '      <h1 class="yomi-title">' + esc(page.title) + '</h1>',
      '      <p class="yomi-date"><time datetime="' + page.date + '">' + jaDate(page.date) + '</time></p>',
      '      <p class="yomi-hikoshiki">' + HIKOSHIKI + '</p>' + lead,
      '',
      '      <div class="yomi-body">',
      '        ' + page.bodyHtml,
      '      </div>',
      '',
      '      <!-- 広告の場所（まだ何も置かない。広告は読みもののページだけに置く） -->',
      '',
      '      <section class="yomi-support" aria-labelledby="support-title">',
      '        <h2 class="yomi-support-title" id="support-title">結び屋を応援する</h2>',
      '        <p class="yomi-support-text">読みものや道具が役に立ったら、結び屋のホームの「応援」から。道具は無料のまま、払わなくても使えます。</p>',
      '        <a class="yomi-support-link" href="../#support">結び屋の「応援」へ<span aria-hidden="true"> →</span></a>',
      '      </section>',
      '',
      '      <p class="yomi-back"><a href="./">読みもの一覧へ戻る</a></p>',
      '    </article>',
      '  </main>',
      '',
      '  <footer class="site-footer">',
      '    <div class="wrap">',
      '      <p>© 結び屋　作り手 みこ</p>',
      '      <p class="footer-note">このサイトでは、アクセスの傾向を知るために Google アナリティクスを使っています。Google アナリティクスは Cookie を使いますが、個人を特定する情報は集めていません。<a href="https://policies.google.com/technologies/partner-sites?hl=ja">Google によるデータの使用について</a></p>',
      '    </div>',
      '  </footer>',
      '',
      '</body>',
      '</html>',
      ''
    ].join('\n');
  }

  // ---------- 一覧 ----------

  function listEntries(listHtml) {
    var s = listHtml.indexOf(LIST_START);
    var e = listHtml.indexOf(LIST_END);
    if (s === -1 || e === -1 || e < s) throw new Error('一覧の印が見つかりません');
    var region = listHtml.slice(s, e);
    var entries = [];
    var re = /<li data-slug="([^"]+)" data-date="(\d{4}-\d{2}-\d{2})">.*?<\/li>/g;
    var m;
    while ((m = re.exec(region))) entries.push({ slug: m[1], date: m[2], html: m[0] });
    return entries;
  }

  function listEntryHtml(page) {
    return '<li data-slug="' + esc(page.slug) + '" data-date="' + page.date + '">' +
      '<a href="' + esc(page.slug) + '.html">' + esc(page.title) + '</a>' +
      '<p class="yomi-list-date">' + jaDate(page.date) + '</p>' +
      '<p class="yomi-list-text">' + esc(page.description) + '</p></li>';
  }

  function updateList(listHtml, page) {
    var entries = listEntries(listHtml).filter(function (x) { return x.slug !== page.slug; });
    entries.push({ slug: page.slug, date: page.date, html: listEntryHtml(page) });
    entries.sort(function (a, b) {
      return a.date === b.date ? (a.slug < b.slug ? 1 : -1) : (a.date < b.date ? 1 : -1);
    });
    var s = listHtml.indexOf(LIST_START);
    var startEnd = listHtml.indexOf('-->', s) + 3;
    var e = listHtml.indexOf(LIST_END);
    var inner = '\n      <ul class="yomi-list">\n' +
      entries.map(function (x) { return '        ' + x.html; }).join('\n') +
      '\n      </ul>\n      ';
    return listHtml.slice(0, startEnd) + inner + listHtml.slice(e);
  }

  // ---------- sitemap ----------

  function updateSitemap(xml, locs, date) {
    locs.forEach(function (loc) {
      var re = new RegExp('(<loc>' + loc.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&') + '</loc>\\s*<lastmod>)[^<]*(</lastmod>)');
      if (re.test(xml)) {
        xml = xml.replace(re, '$1' + date + '$2');
      } else {
        xml = xml.replace('</urlset>', '  <url>\n    <loc>' + loc + '</loc>\n    <lastmod>' + date + '</lastmod>\n  </url>\n</urlset>');
      }
    });
    return xml;
  }

  // ---------- 新しく書くページの URL ----------

  function newSlug(taken, date) {
    var base = date.replace(/-/g, '');
    var slug = base;
    var n = 2;
    while (taken.indexOf(slug) !== -1) slug = base + '-' + (n++);
    return slug;
  }

  // ---------- 保存（GitHub） ----------

  function b64ToText(b64) {
    var bin = atob(String(b64).replace(/\s/g, ''));
    var bytes = new Uint8Array(bin.length);
    for (var i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return new TextDecoder('utf-8').decode(bytes);
  }

  function gh(token, method, path, body) {
    return fetch(API + path, {
      method: method,
      headers: {
        'Accept': 'application/vnd.github+json',
        'Authorization': 'Bearer ' + token,
        'X-GitHub-Api-Version': '2022-11-28',
        'Content-Type': 'application/json'
      },
      body: body ? JSON.stringify(body) : undefined
    }).then(function (res) {
      return res.text().then(function (t) {
        var data = t ? JSON.parse(t) : null;
        if (!res.ok) {
          var err = new Error((data && data.message) || ('HTTP ' + res.status));
          err.status = res.status;
          throw err;
        }
        return data;
      });
    });
  }

  function getText(token, path, ref) {
    return gh(token, 'GET', '/repos/' + OWNER + '/' + REPO + '/contents/' + path + '?ref=' + ref)
      .then(function (d) { return b64ToText(d.content); });
  }

  function stamp() {
    var d = new Date(Date.now() + 9 * 3600 * 1000);
    return d.toISOString().replace(/[-:T]/g, '').slice(0, 14);
  }

  // draft: { title, nerai, body, slug?, leadLink? }。戻り値：{ prUrl, slug }
  function save(token, draft) {
    var repo = '/repos/' + OWNER + '/' + REPO;
    var headSha, treeSha, listHtml, sitemap, page;
    return gh(token, 'GET', repo + '/git/ref/heads/' + BASE)
      .then(function (r) {
        headSha = r.object.sha;
        return gh(token, 'GET', repo + '/git/commits/' + headSha);
      })
      .then(function (c) {
        treeSha = c.tree.sha;
        return Promise.all([getText(token, LIST_PATH, headSha), getText(token, SITEMAP_PATH, headSha)]);
      })
      .then(function (texts) {
        listHtml = texts[0];
        sitemap = texts[1];
        var entries = listEntries(listHtml);
        var date = today();
        var slug = draft.slug;
        if (!slug) {
          var taken = entries.map(function (x) { return x.slug; })
            .concat(KAKIKAKE.map(function (k) { return k.slug; }));
          slug = newSlug(taken, date);
        }
        var existing = entries.filter(function (x) { return x.slug === slug; })[0];
        page = {
          slug: slug,
          title: draft.title.trim(),
          nerai: draft.nerai.trim(),
          date: existing ? existing.date : date, // 書いた日は、最初に公開した日のまま
          description: describe(draft.body),
          bodyHtml: bodyToHtml(draft.body),
          leadLink: draft.leadLink
        };
        var files = [
          { path: 'docs/yomimono/' + slug + '.html', content: buildArticle(page) },
          { path: LIST_PATH, content: updateList(listHtml, page) },
          { path: SITEMAP_PATH, content: updateSitemap(sitemap, [SITE + '/yomimono/', SITE + '/yomimono/' + slug + '.html'], date) }
        ];
        return gh(token, 'POST', repo + '/git/trees', {
          base_tree: treeSha,
          tree: files.map(function (f) { return { path: f.path, mode: '100644', type: 'blob', content: f.content }; })
        });
      })
      .then(function (tree) {
        return gh(token, 'POST', repo + '/git/commits', {
          message: '読みもの「' + page.title + '」を書く画面から保存',
          tree: tree.sha,
          parents: [headSha]
        });
      })
      .then(function (commit) {
        var branch = 'yomimono/' + page.slug + '-' + stamp();
        return gh(token, 'POST', repo + '/git/refs', { ref: 'refs/heads/' + branch, sha: commit.sha })
          .then(function () { return branch; });
      })
      .then(function (branch) {
        return gh(token, 'POST', repo + '/pulls', {
          title: '読みもの「' + page.title + '」を公開する',
          head: branch,
          base: BASE,
          body: [
            '書く画面から保存しました。マージすると公開されます。',
            '',
            '- ページ：`docs/yomimono/' + page.slug + '.html`（' + SITE + '/yomimono/' + page.slug + '.html）',
            '- 一覧（`docs/yomimono/index.html`）と `docs/sitemap.xml` も書き換えています'
          ].join('\n')
        });
      })
      .then(function (pr) { return { prUrl: pr.html_url, slug: page.slug }; });
  }

  // ---------- 画面 ----------

  function storeGet(key) {
    try { return window.localStorage.getItem(key); } catch (e) { return null; }
  }
  function storeSet(key, value) {
    try { window.localStorage.setItem(key, value); return true; } catch (e) { return false; }
  }
  function storeDel(key) {
    try { window.localStorage.removeItem(key); } catch (e) { /* 何もしない */ }
  }

  function loadState() {
    var s = null;
    try { s = JSON.parse(storeGet(STORE_KEY) || 'null'); } catch (e) { s = null; }
    if (!s || typeof s !== 'object') s = {};
    if (!s.drafts) s.drafts = {};
    KAKIKAKE.forEach(function (k) {
      if (!s.drafts[k.id]) s.drafts[k.id] = { title: k.title, nerai: k.nerai, body: '' };
    });
    if (!s.current || !s.drafts[s.current]) s.current = KAKIKAKE[0].id;
    return s;
  }

  function kakikake(id) {
    return KAKIKAKE.filter(function (k) { return k.id === id; })[0];
  }

  function init() {
    var $ = function (id) { return document.getElementById(id); };
    var state = loadState();
    var timer = null;

    function persist() {
      if (storeSet(STORE_KEY, JSON.stringify(state))) {
        var d = new Date();
        $('autosave-note').textContent = 'このブラウザに残しました（' + d.getHours() + '時' + ('0' + d.getMinutes()).slice(-2) + '分）。';
      } else {
        $('autosave-note').textContent = 'このブラウザでは自動で残せません。保存する前に画面を閉じないでください。';
      }
    }

    function refreshKey() {
      var has = !!storeGet(TOKEN_KEY);
      $('key-empty').hidden = has;
      $('key-set').hidden = !has;
    }

    function refreshSelect() {
      var sel = $('draft-select');
      sel.innerHTML = '';
      KAKIKAKE.forEach(function (k) {
        var o = document.createElement('option');
        o.value = k.id;
        o.textContent = '書きかけ：' + k.title;
        sel.appendChild(o);
      });
      Object.keys(state.drafts).forEach(function (id) {
        if (kakikake(id)) return;
        var o = document.createElement('option');
        o.value = id;
        o.textContent = '新しく書いたもの：' + (state.drafts[id].title || '（題なし）');
        sel.appendChild(o);
      });
      var n = document.createElement('option');
      n.value = '__new__';
      n.textContent = '＋ 新しく書く';
      sel.appendChild(n);
      sel.value = state.current;
    }

    function current() { return state.drafts[state.current]; }

    function showDraft() {
      var d = current();
      $('f-title').value = d.title || '';
      $('f-nerai').value = d.nerai || '';
      $('f-body').value = d.body || '';
      var k = kakikake(state.current);
      var note = $('lead-link-note');
      if (k && k.leadLink) {
        note.hidden = false;
        note.textContent = 'このページの本文の頭には「' + k.leadLink.before + k.leadLink.text + '」のリンクが自動で入ります。';
      } else {
        note.hidden = true;
      }
      $('draft-clear').textContent = k ? '書いた内容を消す' : 'この下書きを消す';
      refreshCheck();
      if (!$('preview').hidden) refreshPreview();
    }

    function refreshCheck() {
      var d = current();
      var box = $('nerai-check');
      var missing = d.nerai ? checkNerai(d.title || '', d.nerai, d.body || '') : [];
      if (missing.length) {
        box.hidden = false;
        box.textContent = '題と本文の頭（' + HEAD_LENGTH + '字）に「' + missing.join('」「') +
          '」が入っていません。このまま保存することもできます。';
      } else {
        box.hidden = true;
      }
    }

    function draftForSave() {
      var d = current();
      var k = kakikake(state.current);
      return {
        title: d.title || '',
        nerai: d.nerai || '',
        body: d.body || '',
        slug: k ? k.slug : d.slug,
        leadLink: k ? k.leadLink : undefined
      };
    }

    function refreshPreview() {
      var d = draftForSave();
      var page = {
        slug: d.slug || 'mihon',
        title: d.title || '（題）',
        nerai: d.nerai,
        date: today(),
        description: describe(d.body),
        bodyHtml: bodyToHtml(d.body),
        leadLink: d.leadLink
      };
      var html = buildArticle(page, { analytics: false })
        .replace('<head>', '<head>\n  <base href="' + esc(window.location.href) + '">');
      $('preview').srcdoc = html;
    }

    function onInput() {
      var d = current();
      d.title = $('f-title').value;
      d.nerai = $('f-nerai').value;
      d.body = $('f-body').value;
      d.updated = Date.now();
      refreshCheck();
      clearTimeout(timer);
      timer = setTimeout(function () {
        persist();
        if (!kakikake(state.current)) refreshSelect();
        if (!$('preview').hidden) refreshPreview();
      }, 600);
    }

    function setStatus(text, kind, link) {
      var el = $('status');
      el.className = 'kaku-status' + (kind ? ' is-' + kind : '');
      el.textContent = text;
      if (link) {
        el.appendChild(document.createTextNode(' '));
        var a = document.createElement('a');
        a.href = link;
        a.target = '_blank';
        a.rel = 'noopener';
        a.textContent = '提案を開く';
        el.appendChild(a);
      }
    }

    ['f-title', 'f-nerai', 'f-body'].forEach(function (id) {
      $(id).addEventListener('input', onInput);
    });
    // 画面を閉じる・切り替えるときにも残す
    window.addEventListener('pagehide', function () { clearTimeout(timer); persist(); });
    document.addEventListener('visibilitychange', function () {
      if (document.visibilityState === 'hidden') { clearTimeout(timer); persist(); }
    });

    $('draft-select').addEventListener('change', function () {
      clearTimeout(timer);
      persist();
      var v = this.value;
      if (v === '__new__') {
        v = 'new-' + Date.now();
        state.drafts[v] = { title: '', nerai: '', body: '' };
      }
      state.current = v;
      persist();
      refreshSelect();
      showDraft();
      setStatus('');
    });

    $('draft-clear').addEventListener('click', function () {
      var k = kakikake(state.current);
      if (!window.confirm(k ? '「' + k.title + '」に書いた内容を消します。よろしいですか。' : 'この下書きを消します。よろしいですか。')) return;
      if (k) {
        state.drafts[k.id] = { title: k.title, nerai: k.nerai, body: '' };
      } else {
        delete state.drafts[state.current];
        state.current = KAKIKAKE[0].id;
      }
      persist();
      refreshSelect();
      showDraft();
    });

    $('preview-toggle').addEventListener('click', function () {
      var f = $('preview');
      f.hidden = !f.hidden;
      this.textContent = f.hidden ? '見本を見る' : '見本を閉じる';
      if (!f.hidden) refreshPreview();
    });

    $('key-save').addEventListener('click', function () {
      var v = $('key-input').value.trim();
      if (!v) return;
      if (!storeSet(TOKEN_KEY, v)) {
        setStatus('このブラウザには鍵を残せません。プライベートモードを切ってください。', 'warn');
        return;
      }
      $('key-input').value = '';
      refreshKey();
      setStatus('鍵を入れました。', 'ok');
    });

    $('key-clear').addEventListener('click', function () {
      if (!window.confirm('このブラウザから鍵を消します。よろしいですか。')) return;
      storeDel(TOKEN_KEY);
      refreshKey();
      setStatus('鍵を消しました。');
    });

    $('save').addEventListener('click', function () {
      var token = storeGet(TOKEN_KEY);
      var d = draftForSave();
      if (!token) { setStatus('先に「保存の鍵」を入れてください。', 'warn'); return; }
      if (!d.title.trim() || !d.body.trim()) { setStatus('題と本文を入れてください。', 'warn'); return; }
      var btn = this;
      btn.disabled = true;
      clearTimeout(timer);
      persist();
      setStatus('保存しています…');
      save(token, d).then(function (r) {
        var cur = current();
        if (!kakikake(state.current)) cur.slug = r.slug; // 次に保存したときも同じページを書き換える
        cur.savedAt = Date.now();
        persist();
        setStatus('提案を作りました。開いて「Merge pull request」を押すと公開されます。', 'ok', r.prUrl);
      }).catch(function (err) {
        var msg = '保存できませんでした。';
        if (err.status === 401) msg += '鍵が違うか、期限が切れています。';
        else if (err.status === 403 || err.status === 404) msg += '鍵の権限が足りません（Contents と Pull requests の書き込みが要ります）。';
        else msg += '電波の良いところで、もう一度押してください。（' + err.message + '）';
        setStatus(msg, 'warn');
      }).then(function () { btn.disabled = false; });
    });

    refreshKey();
    refreshSelect();
    showDraft();
  }

  // 試験用に中身を出しておく
  window.Kaku = {
    bodyToHtml: bodyToHtml, describe: describe, checkNerai: checkNerai, buildArticle: buildArticle,
    listEntries: listEntries, updateList: updateList, updateSitemap: updateSitemap, newSlug: newSlug,
    save: save, KAKIKAKE: KAKIKAKE
  };

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
