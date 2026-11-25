/* aired — dashboard (vanilla JS, no framework).
 * Views: #pages, #connect, #billing, #account. Pages are loaded once, then
 * searched, filtered and grouped in the browser. Plan strip and claim banner
 * logic is unchanged from the single-page dashboard. */

(function () {
  'use strict';

  var UNSORTED_KEY = '__unsorted__';
  var UNSORTED_LABEL = 'Not in a project';
  var PAGE_CAP = 1000;           // most pages the dashboard loads at once
  var SOON_MS = 7 * 86400e3;     // "Expiring soon" = within a week

  var SVG_NS = 'http://www.w3.org/2000/svg';
  var ICONS = {
    doc: '<path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"/><path d="M14 3v5h5"/>',
    chart: '<path d="M4 20V10M10 20V4M16 20v-7M22 20H2"/>',
    slides: '<rect x="3" y="4" width="18" height="12" rx="2"/><path d="M8 20h8M12 16v4"/>',
    game: '<rect x="2" y="7" width="20" height="11" rx="4"/><path d="M7 11v3M5.5 12.5h3M15.5 12h.01M18 13.5h.01"/>',
    site: '<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3a14 14 0 0 1 0 18M12 3a14 14 0 0 0 0 18"/>',
    lock: '<rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/>',
    clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
    globe: '<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3a14 14 0 0 1 0 18M12 3a14 14 0 0 0 0 18"/>',
    eye: '<path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/>',
    size: '<path d="M4 7h16M4 12h16M4 17h10"/>',
    stop: '<circle cx="12" cy="12" r="9"/><path d="M8 12h8"/>',
    folder: '<path d="M3 7h6l2 2h10v10H3z"/>',
    chev: '<path d="m9 6 6 6-6 6"/>',
    open: '<path d="M14 4h6v6M20 4l-9 9M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5"/>',
    more: '<circle cx="5" cy="12" r="1.3"/><circle cx="12" cy="12" r="1.3"/><circle cx="19" cy="12" r="1.3"/>',
    trash: '<path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3"/>',
    copy: '<rect x="9" y="9" width="11" height="11" rx="2"/><path d="M5 15V5a2 2 0 0 1 2-2h8"/>',
    flag: '<path d="M5 21V4M5 4h12l-2 4 2 4H5"/>',
  };

  // Icons are fixed strings from ICONS, never page data.
  function icon(name) {
    var svg = document.createElementNS(SVG_NS, 'svg');
    svg.setAttribute('viewBox', '0 0 24 24');
    svg.setAttribute('fill', 'none');
    svg.setAttribute('stroke', 'currentColor');
    svg.setAttribute('stroke-width', '1.8');
    svg.setAttribute('stroke-linecap', 'round');
    svg.setAttribute('stroke-linejoin', 'round');
    svg.setAttribute('aria-hidden', 'true');
    svg.innerHTML = ICONS[name];
    return svg;
  }

  function el(tag, className, text) {
    var node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  }

  function plural(n, word) {
    return n.toLocaleString() + ' ' + word + (n === 1 ? '' : 's');
  }

  // "3 days ago"
  function relativeAge(isoString) {
    if (!isoString) return '';
    var diff = Math.floor((Date.now() - new Date(isoString).getTime()) / 1000);
    if (isNaN(diff)) return '';
    if (diff < 60) return 'just now';
    if (diff < 3600) return plural(Math.floor(diff / 60), 'minute') + ' ago';
    if (diff < 86400) return plural(Math.floor(diff / 3600), 'hour') + ' ago';
    if (diff < 86400 * 30) return plural(Math.floor(diff / 86400), 'day') + ' ago';
    if (diff < 86400 * 365) return plural(Math.floor(diff / (86400 * 30)), 'month') + ' ago';
    return plural(Math.floor(diff / (86400 * 365)), 'year') + ' ago';
  }

  // ── What a page is, in words ──
  function viewsOf(page) { return typeof page.readCount === 'number' ? page.readCount : 0; }
  function limitReached(page) { return typeof page.reads === 'number' && page.reads > 0 && viewsOf(page) >= page.reads; }
  function expiresMs(page) {
    if (page.permanent || !page.expiresAt) return null;
    var t = new Date(page.expiresAt).getTime();
    return isNaN(t) ? null : t;
  }
  function isExpired(page) {
    var t = expiresMs(page);
    return (t !== null && t <= Date.now()) || limitReached(page);
  }
  function isExpiringSoon(page) {
    var t = expiresMs(page);
    return !isExpired(page) && t !== null && t - Date.now() < SOON_MS;
  }

  // How long the page stays up. Returns { text, tone, title }.
  function expiryWords(page) {
    if (limitReached(page)) return { text: 'View limit reached', tone: 'soon', title: '' };
    var t = expiresMs(page);
    if (t === null) return { text: 'Never expires', tone: 'good', title: '' };
    var at = new Date(t);
    var left = Math.floor((t - Date.now()) / 1000);
    var title = 'Expires ' + at.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
    if (left <= 0) return { text: 'Expired ' + at.toLocaleDateString(undefined, { day: 'numeric', month: 'short' }), tone: 'soon', title: title };
    if (left < 3600) return { text: 'Expires in ' + plural(Math.max(1, Math.floor(left / 60)), 'minute'), tone: 'soon', title: title };
    if (left < 86400) return { text: 'Expires in ' + plural(Math.floor(left / 3600), 'hour'), tone: 'soon', title: title };
    if (left < 86400 * 14) return { text: 'Expires in ' + plural(Math.round(left / 86400), 'day'), tone: '', title: title };
    return { text: 'Expires ' + at.toLocaleDateString(undefined, { day: 'numeric', month: 'short' }), tone: '', title: title };
  }

  function sizeWords(bytes) {
    if (typeof bytes !== 'number' || bytes < 0) return '';
    if (bytes < 1024) return 'Under 1 KB';
    if (bytes < 1024 * 1024) return Math.round(bytes / 1024) + ' KB';
    return (bytes / (1024 * 1024)).toFixed(1).replace(/\.0$/, '') + ' MB';
  }

  // A kind icon from the title, so a list of pages is easy to scan.
  function kindOf(page) {
    var t = (page.title || '').toLowerCase();
    if (/\b(deck|slides?|presentation|pitch|keynote)\b/.test(t)) return 'slides';
    if (/\b(report|dashboard|analytics|metrics|kpis?|results|performance|stats)\b/.test(t)) return 'chart';
    if (/\b(game|snake|tetris|quiz|puzzle|play)\b/.test(t)) return 'game';
    if (/\b(landing|site|website|homepage|menu|portfolio)\b/.test(t)) return 'site';
    return 'doc';
  }

  function chip(iconName, text, tone, title) {
    var c = el('span', 'chip' + (tone ? ' ' + tone : ''));
    c.appendChild(icon(iconName));
    c.appendChild(document.createTextNode(text));
    if (title) c.title = title;
    return c;
  }

  function announce(message) {
    var live = document.getElementById('action-status');
    if (!live) return;
    live.textContent = '';
    setTimeout(function () { live.textContent = message; }, 50);
  }

  function copyText(text) {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      return navigator.clipboard.writeText(text).catch(fallback);
    }
    return Promise.resolve(fallback());
    function fallback() {
      var ta = document.createElement('textarea');
      ta.value = text;
      ta.style.position = 'fixed';
      ta.style.left = '-9999px';
      document.body.appendChild(ta);
      ta.select();
      try { document.execCommand('copy'); } catch (_e) {}
      document.body.removeChild(ta);
    }
  }

  // Copy buttons anywhere on the dashboard: <button data-copy="text">.
  function initCopyButtons() {
    document.addEventListener('click', function (e) {
      var btn = e.target.closest && e.target.closest('[data-copy]');
      if (!btn) return;
      var label = btn.querySelector('[data-copy-label]') || btn;
      var orig = label.getAttribute('data-orig') || label.textContent;
      label.setAttribute('data-orig', orig);
      copyText(btn.getAttribute('data-copy')).then(function () {
        btn.classList.add('copied');
        label.textContent = 'Copied';
        announce('Copied');
        setTimeout(function () { btn.classList.remove('copied'); label.textContent = orig; }, 1800);
      });
    });
  }

  // ── Views (#pages, #connect, #billing, #account) ──
  var VIEWS = ['pages', 'connect', 'billing', 'account'];
  var VIEW_TITLES = { pages: 'Pages', connect: 'Connect your AI tools', billing: 'Plan & billing', account: 'Account' };

  function currentView() {
    var h = (window.location.hash || '').replace('#', '');
    return VIEWS.indexOf(h) === -1 ? 'pages' : h;
  }

  function showView(name, focus) {
    VIEWS.forEach(function (v) {
      var sec = document.getElementById('view-' + v);
      if (sec) sec.hidden = v !== name;
    });
    document.querySelectorAll('[data-nav]').forEach(function (a) {
      var on = a.getAttribute('data-nav') === name;
      a.classList.toggle('on', on);
      if (on) a.setAttribute('aria-current', 'page');
      else a.removeAttribute('aria-current');
    });
    document.title = 'aired — ' + VIEW_TITLES[name].toLowerCase();
    if (focus) {
      var h = document.querySelector('#view-' + name + ' h1');
      if (h) { h.tabIndex = -1; h.focus({ preventScroll: true }); }
      window.scrollTo(0, 0);
    }
  }

  function initViews() {
    window.addEventListener('hashchange', function () { showView(currentView(), true); });
    showView(currentView(), false);
  }

  // ── Fetch helper ──
  function fetchJson(url) {
    return fetch(url, { credentials: 'same-origin' }).then(function (res) {
      if (!res.ok) throw new Error('Request failed: ' + res.status);
      return res.json();
    });
  }

  // ── Pages: load everything once, then filter in the browser ──
  var pages = {
    all: [],          // [{...page, group}]
    projects: [],     // names, in the order the API returned them
    truncated: false,
    loaded: false,
    filter: 'all',
    query: '',
    collapsed: {},    // group key -> true
  };

  var FILTERS = [
    { key: 'all', label: 'All', test: function () { return true; } },
    { key: 'active', label: 'Active', test: function (p) { return !isExpired(p); } },
    { key: 'soon', label: 'Expiring soon', test: isExpiringSoon },
    { key: 'pin', label: 'PIN-protected', test: function (p) { return !!p.hasPin; } },
    { key: 'expired', label: 'Expired', test: isExpired },
  ];

  // Follow a project's cursor to the end (bounded by PAGE_CAP overall).
  function fetchGroup(key, budget) {
    var rows = [];
    function step(cursor, depth) {
      var url = '/api/me/pages?project=' + encodeURIComponent(key) + '&limit=50';
      if (cursor) url += '&cursor=' + encodeURIComponent(cursor);
      return fetchJson(url).then(function (data) {
        var got = data.pages || [];
        for (var i = 0; i < got.length; i++) { got[i].group = key; rows.push(got[i]); }
        if (data.cursor && rows.length < budget && depth < 60) return step(data.cursor, depth + 1);
        if (data.cursor) pages.truncated = true;
        return rows;
      });
    }
    return step(null, 0);
  }

  function loadDashboard() {
    return fetchJson('/api/me/projects').then(function (data) {
      var projects = (data && data.projects) || [];
      pages.projects = projects.map(function (p) { return p.name; });
      var keys = pages.projects.concat([UNSORTED_KEY]);
      pages.truncated = false;
      return Promise.all(keys.map(function (k) { return fetchGroup(k, PAGE_CAP); }));
    }).then(function (groups) {
      var seen = {};
      var all = [];
      groups.forEach(function (rows) {
        rows.forEach(function (p) {
          if (seen[p.id] || all.length >= PAGE_CAP) return;
          seen[p.id] = true;
          all.push(p);
        });
      });
      all.sort(function (a, b) { return (b.createdAt || '').localeCompare(a.createdAt || ''); });
      pages.all = all;
      pages.loaded = true;
      renderPages();
    }).catch(function () {
      showLoadError();
    });
  }

  function showLoadError() {
    var list = document.getElementById('page-list');
    if (!list) return;
    document.getElementById('pages-tools').hidden = true;
    document.getElementById('empty-state').classList.add('hidden');
    list.textContent = '';
    var wrap = el('div', 'panel load-err');
    wrap.id = 'load-error';
    wrap.appendChild(el('p', '', 'Could not load your pages.'));
    var retry = el('button', 'btn sm', 'Try again');
    retry.type = 'button';
    retry.addEventListener('click', function () {
      retry.disabled = true;
      retry.textContent = 'Loading…';
      loadDashboard();
    });
    wrap.appendChild(retry);
    list.appendChild(wrap);
  }

  // ── Summary tiles ──
  function renderSummary() {
    var live = 0, views = 0, soon = 0;
    pages.all.forEach(function (p) {
      if (!isExpired(p)) live++;
      views += viewsOf(p);
      if (isExpiringSoon(p)) soon++;
    });
    setTile('live', live.toLocaleString(), pages.truncated ? 'First ' + PAGE_CAP.toLocaleString() + ' pages' : plural(pages.all.length, 'page') + ' in total');
    setTile('views', views.toLocaleString(), 'Across all your pages');
    setTile('soon', soon.toLocaleString(), soon ? 'Show them' : 'Nothing expires this week');
    var count = document.getElementById('page-count');
    if (count) count.textContent = pages.all.length ? plural(pages.all.length, 'page') + (pages.projects.length ? ' in ' + plural(pages.projects.length, 'project') : '') : '';
  }

  function setTile(key, value, sub) {
    var v = document.querySelector('[data-tile="' + key + '"] b');
    var s = document.querySelector('[data-tile="' + key + '"] small');
    if (v) v.textContent = value;
    if (s) s.textContent = sub;
  }

  // Plan tile on the Pages view; renderPlan calls this too.
  function setPlanTile(status) {
    if (!status || !status.enabled) { setTile('plan', 'Free', 'Everything here is free'); return; }
    if (status.plan === 'pro') { setTile('plan', 'Pro', status.cancelAtPeriodEnd ? 'Ends ' + formatDate(status.renewsAt) : 'Manage billing'); return; }
    if (status.status === 'past_due' || status.status === 'unpaid') { setTile('plan', 'Free', 'Payment failed. Update card'); return; }
    setTile('plan', 'Free', 'See what Pro adds');
  }

  // ── Filters + search ──
  function renderFilters() {
    var bar = document.getElementById('page-filters');
    if (!bar) return;
    bar.textContent = '';
    FILTERS.forEach(function (f) {
      var n = pages.all.filter(f.test).length;
      var b = el('button', 'fchip' + (pages.filter === f.key ? ' on' : ''));
      b.type = 'button';
      b.setAttribute('aria-pressed', pages.filter === f.key ? 'true' : 'false');
      b.appendChild(document.createTextNode(f.label));
      b.appendChild(el('span', 'n', String(n)));
      b.addEventListener('click', function () {
        pages.filter = f.key;
        renderPages();
      });
      bar.appendChild(b);
    });
  }

  function visiblePages() {
    var f = FILTERS.filter(function (x) { return x.key === pages.filter; })[0] || FILTERS[0];
    var q = pages.query.trim().toLowerCase();
    return pages.all.filter(function (p) {
      if (!f.test(p)) return false;
      if (!q) return true;
      return ((p.title || '') + ' ' + p.id + ' ' + (p.group === UNSORTED_KEY ? '' : p.group)).toLowerCase().indexOf(q) !== -1;
    });
  }

  function renderPages() {
    var list = document.getElementById('page-list');
    var tools = document.getElementById('pages-tools');
    var empty = document.getElementById('empty-state');
    var hero = document.getElementById('hero-publish');
    if (!list) return;
    var none = pages.all.length === 0;
    if (hero) hero.textContent = none ? 'Publish a page' : 'Publish';
    tools.hidden = none;
    empty.classList.toggle('hidden', !none);
    renderSummary();
    list.textContent = '';
    if (none) return;
    renderFilters();

    var shown = visiblePages();
    if (!shown.length) {
      var nm = el('div', 'panel nomatch');
      nm.appendChild(el('p', '', pages.query ? 'No pages match “' + pages.query.trim() + '”.' : 'No pages here.'));
      var clear = el('button', 'btn sm', 'Show all pages');
      clear.type = 'button';
      clear.addEventListener('click', function () {
        pages.filter = 'all';
        pages.query = '';
        document.getElementById('page-search').value = '';
        renderPages();
      });
      nm.appendChild(clear);
      list.appendChild(nm);
      return;
    }

    // Group by project when there are projects; otherwise one list.
    var order = pages.projects.length ? pages.projects.concat([UNSORTED_KEY]) : [UNSORTED_KEY];
    order.forEach(function (key) {
      var rows = shown.filter(function (p) { return p.group === key; });
      if (!rows.length) return;
      list.appendChild(renderGroup(key, rows));
    });
    if (pages.truncated) list.appendChild(el('p', 'gfoot', 'Showing your newest ' + PAGE_CAP.toLocaleString() + ' pages.'));
  }

  function groupLabel(key) {
    if (key !== UNSORTED_KEY) return key;
    return pages.projects.length ? UNSORTED_LABEL : 'All pages';
  }

  function renderGroup(key, rows) {
    var section = el('section', 'panel pgroup');
    var id = 'g-' + Math.random().toString(36).slice(2, 8);
    var collapsed = !!pages.collapsed[key];
    var head = el('button', 'ghead');
    head.type = 'button';
    head.setAttribute('aria-expanded', collapsed ? 'false' : 'true');
    head.setAttribute('aria-controls', id);
    var chev = icon('chev');
    chev.setAttribute('class', 'chev');
    var gic = el('span', 'gic');
    gic.appendChild(icon(key === UNSORTED_KEY ? 'doc' : 'folder'));
    var name = el('span', 'gname', groupLabel(key));
    var count = el('span', 'gcount', String(rows.length));
    head.appendChild(chev);
    head.appendChild(gic);
    head.appendChild(name);
    head.appendChild(count);
    var ul = el('ul', 'prows');
    ul.id = id;
    ul.hidden = collapsed;
    rows.forEach(function (p) { ul.appendChild(renderRow(p)); });
    head.addEventListener('click', function () {
      var open = head.getAttribute('aria-expanded') !== 'true';
      head.setAttribute('aria-expanded', open ? 'true' : 'false');
      ul.hidden = !open;
      pages.collapsed[key] = !open;
    });
    section.appendChild(head);
    section.appendChild(ul);
    return section;
  }

  // ── One page row ──
  function renderRow(page) {
    var li = el('li', 'prow' + (isExpired(page) ? ' gone' : ''));
    li.setAttribute('data-page-id', page.id);
    var url = window.location.origin + '/p/' + page.id;

    var thumb = el('span', 'thumb k-' + kindOf(page));
    thumb.appendChild(icon(kindOf(page)));
    if (page.hasPin) {
      var lock = el('span', 'tlock');
      lock.appendChild(icon('lock'));
      thumb.appendChild(lock);
    }

    var info = el('div', 'pinfo');
    var title = el('a', 'ttl', page.title || 'Untitled page');
    title.href = '/p/' + page.id;
    title.target = '_blank';
    title.rel = 'noopener noreferrer';
    var sub = el('p', 'sub');
    sub.appendChild(el('span', 'mono', window.location.host + '/p/' + page.id));
    var age = relativeAge(page.createdAt);
    if (age) sub.appendChild(document.createTextNode(' · Published ' + age));

    var chips = el('div', 'chips');
    var exp = expiryWords(page);
    chips.appendChild(chip('clock', exp.text, exp.tone, exp.title));
    chips.appendChild(page.hasPin ? chip('lock', 'Needs a PIN') : chip('globe', 'Anyone with the link'));
    var v = viewsOf(page);
    if (typeof page.reads === 'number' && page.reads > 0) {
      var left = Math.max(0, page.reads - v);
      chips.appendChild(chip('eye', plural(v, 'view') + ' of ' + page.reads.toLocaleString(), left <= Math.max(1, Math.ceil(page.reads * 0.1)) ? 'soon' : '', left + ' left before it stops opening'));
    } else {
      chips.appendChild(chip('eye', plural(v, 'view')));
    }
    var size = sizeWords(page.size);
    if (size) chips.appendChild(chip('size', size));

    info.appendChild(title);
    info.appendChild(sub);
    info.appendChild(chips);

    // Actions: Copy link, Open, and a menu with Delete.
    var acts = el('div', 'acts');
    var copyBtn = el('button', 'btn sm');
    copyBtn.type = 'button';
    copyBtn.setAttribute('data-copy', url);
    copyBtn.setAttribute('aria-label', 'Copy link to ' + (page.title || page.id));
    copyBtn.appendChild(icon('copy'));
    var copyLabel = el('span', '', 'Copy link');
    copyLabel.setAttribute('data-copy-label', '');
    copyBtn.appendChild(copyLabel);

    var open = el('a', 'btn sm ghost iconbtn');
    open.href = '/p/' + page.id;
    open.target = '_blank';
    open.rel = 'noopener noreferrer';
    open.setAttribute('aria-label', 'Open ' + (page.title || page.id) + ' in a new tab');
    open.title = 'Open';
    open.appendChild(icon('open'));

    acts.appendChild(copyBtn);
    acts.appendChild(open);
    acts.appendChild(rowMenu(page, li));

    li.appendChild(thumb);
    li.appendChild(info);
    li.appendChild(acts);
    return li;
  }

  // The "…" menu: Delete (two clicks), and report-a-problem.
  var openMenu = null;
  function closeMenu() {
    if (!openMenu) return;
    openMenu.panel.hidden = true;
    openMenu.button.setAttribute('aria-expanded', 'false');
    openMenu.reset();
    openMenu = null;
  }
  document.addEventListener('click', function (e) {
    if (openMenu && !openMenu.wrap.contains(e.target)) closeMenu();
  });
  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape' && openMenu) { var b = openMenu.button; closeMenu(); b.focus(); }
  });

  function rowMenu(page, li) {
    var wrap = el('div', 'menu');
    var btn = el('button', 'btn sm ghost iconbtn');
    btn.type = 'button';
    btn.setAttribute('aria-haspopup', 'true');
    btn.setAttribute('aria-expanded', 'false');
    btn.setAttribute('aria-label', 'More for ' + (page.title || page.id));
    btn.appendChild(icon('more'));
    var panel = el('div', 'menu-panel');
    panel.hidden = true;

    var report = el('a', 'mitem');
    report.href = '/abuse?id=' + encodeURIComponent(page.id);
    report.appendChild(icon('flag'));
    report.appendChild(document.createTextNode('Report a problem'));

    var del = el('button', 'mitem danger');
    del.type = 'button';
    del.appendChild(icon('trash'));
    var delLabel = el('span', '', 'Delete page');
    del.appendChild(delLabel);
    var state = 'idle';
    var timer = null;
    function reset() {
      if (state === 'deleting') return;
      state = 'idle';
      if (timer) { clearTimeout(timer); timer = null; }
      delLabel.textContent = 'Delete page';
      del.classList.remove('confirm');
      del.disabled = false;
    }
    del.addEventListener('click', function () {
      if (state === 'idle') {
        state = 'confirm';
        delLabel.textContent = 'Click again to delete';
        del.classList.add('confirm');
        announce('Click again to delete ' + (page.title || page.id) + '. This can’t be undone.');
        timer = setTimeout(reset, 4000);
        return;
      }
      if (state !== 'confirm') return;
      if (timer) { clearTimeout(timer); timer = null; }
      state = 'deleting';
      del.disabled = true;
      delLabel.textContent = 'Deleting…';
      fetch('/api/pages/' + page.id, {
        method: 'DELETE',
        headers: { 'X-Aired-Request': '1' },
        credentials: 'same-origin',
      }).then(function (res) {
        state = 'idle';
        if (!res.ok) { reset(); delLabel.textContent = 'Could not delete. Try again'; return; }
        closeMenu();
        pages.all = pages.all.filter(function (p) { return p.id !== page.id; });
        announce('Deleted');
        renderPages();
      }).catch(function () {
        state = 'idle';
        reset();
        delLabel.textContent = 'Could not delete. Try again';
      });
    });

    panel.appendChild(report);
    panel.appendChild(el('div', 'msep'));
    panel.appendChild(del);
    btn.addEventListener('click', function (e) {
      e.stopPropagation();
      if (openMenu && openMenu.wrap === wrap) { closeMenu(); return; }
      closeMenu();
      panel.hidden = false;
      btn.setAttribute('aria-expanded', 'true');
      openMenu = { wrap: wrap, panel: panel, button: btn, reset: reset };
      del.focus();
    });
    wrap.appendChild(btn);
    wrap.appendChild(panel);
    return wrap;
  }

  function initPagesTools() {
    var search = document.getElementById('page-search');
    if (search) {
      search.addEventListener('input', function () {
        pages.query = search.value;
        renderPages();
      });
    }
    var soonTile = document.querySelector('[data-tile="soon"]');
    if (soonTile) soonTile.addEventListener('click', function () {
      pages.filter = 'soon';
      renderPages();
      var bar = document.getElementById('page-filters');
      if (bar) bar.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    });
  }

  // ── Account: sign out, delete account ──
  function initAccount(user) {
    var initial = ((user.name || user.login || '?').trim().charAt(0) || '?').toUpperCase();
    document.querySelectorAll('[data-initial]').forEach(function (n) { n.textContent = initial; });
    document.querySelectorAll('[data-login]').forEach(function (n) { n.textContent = '@' + user.login; });
    var name = document.getElementById('acct-name');
    if (name) name.textContent = user.name || '@' + user.login;
    var email = document.getElementById('acct-email');
    if (email) {
      if (user.email) { email.textContent = user.email; email.parentNode.hidden = false; }
    }
    var since = document.getElementById('acct-since');
    if (since && user.createdAt) {
      var d = new Date(user.createdAt);
      if (!isNaN(d.getTime())) { since.textContent = d.toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' }); since.parentNode.hidden = false; }
    }

    document.querySelectorAll('[data-sign-out]').forEach(function (b) {
      b.addEventListener('click', function () {
        b.disabled = true;
        fetch('/auth/logout', {
          method: 'POST',
          headers: { 'X-Aired-Request': '1' },
          credentials: 'same-origin',
        }).then(function (res) {
          return res.json().catch(function () { return {}; });
        }).then(function (data) {
          // Signed in through AuthKit: end that session too (it comes back to /).
          var next = data && typeof data.redirect === 'string' && /^https:\/\/api\.workos\.com\//.test(data.redirect) ? data.redirect : '/';
          window.location.href = next;
        }).catch(function () {
          window.location.href = '/';
        });
      });
    });

    var start = document.getElementById('del-start');
    var form = document.getElementById('del-form');
    var input = document.getElementById('del-confirm');
    var go = document.getElementById('del-go');
    var cancel = document.getElementById('del-cancel');
    var err = document.getElementById('del-error');
    if (!start || !form) return;
    function sync() { go.disabled = input.value.trim().toUpperCase() !== 'DELETE'; }
    start.addEventListener('click', function () {
      start.hidden = true;
      form.hidden = false;
      input.focus();
    });
    cancel.addEventListener('click', function () {
      form.hidden = true;
      start.hidden = false;
      input.value = '';
      err.hidden = true;
      sync();
      start.focus();
    });
    input.addEventListener('input', sync);
    form.addEventListener('submit', function (e) {
      e.preventDefault();
      if (go.disabled) return;
      go.disabled = true;
      cancel.disabled = true;
      go.textContent = 'Deleting…';
      err.hidden = true;
      fetch('/api/me', {
        method: 'DELETE',
        headers: { 'X-Aired-Request': '1' },
        credentials: 'same-origin',
      }).then(function (res) {
        return res.json().catch(function () { return {}; }).then(function (data) {
          if (res.ok) {
            var next = data && typeof data.redirect === 'string' && /^https:\/\/api\.workos\.com\//.test(data.redirect) ? data.redirect : '/';
            window.location.href = next;
            return;
          }
          throw new Error((data && data.error) || 'Could not delete your account. Try again.');
        });
      }).catch(function (e2) {
        err.textContent = e2.message || 'Could not delete your account. Try again.';
        err.hidden = false;
        go.textContent = 'Delete my account';
        cancel.disabled = false;
        sync();
      });
    });
    sync();
  }

  // ── Plan strip (shown only when billing is on) ──
  // Free → "Get Pro" (yearly checkout); Pro → renewal date + "Manage billing".
  // Plan state comes from /api/billing/status; only the webhook changes it.
  var PRIMARY_BTN_CLASS = 'btn solid sm';
  var SECONDARY_BTN_CLASS = 'btn sm';
  var UPGRADE_POLL_MS = 2000;
  var UPGRADE_POLL_LIMIT_MS = 30000;

  var plan = {
    mode: null,      // 'checkout' | 'portal' | null (no button)
    state: 'idle',   // idle | pending | error
  };

  var PLAN_ACTIONS = {
    checkout: {
      label: 'Get Pro',
      pending: 'Opening checkout…',
      error: 'Could not open checkout. Try again.',
    },
    portal: {
      label: 'Manage billing',
      pending: 'Opening billing…',
      error: 'Could not open billing. Try again.',
    },
  };

  function formatDate(iso) {
    if (!iso) return '';
    var d = new Date(iso);
    if (isNaN(d.getTime())) return '';
    return d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
  }

  function setText(id, text) {
    var el = document.getElementById(id);
    if (!el) return;
    el.textContent = text || '';
    if (text) el.classList.remove('hidden');
    else el.classList.add('hidden');
  }

  function setPlanButton() {
    var btn = document.getElementById('plan-action');
    if (!btn) return;
    // Auto-renewal notice next to the buy button only.
    var renew = document.getElementById('plan-renew');
    if (renew) renew.classList.toggle('hidden', plan.mode !== 'checkout');
    if (!plan.mode) {
      btn.className = 'hidden';
      btn.disabled = false;
      btn.removeAttribute('aria-busy');
      return;
    }
    var action = PLAN_ACTIONS[plan.mode];
    btn.className = plan.mode === 'checkout' ? PRIMARY_BTN_CLASS : SECONDARY_BTN_CLASS;
    btn.disabled = plan.state === 'pending';
    if (plan.state === 'pending') {
      btn.setAttribute('aria-busy', 'true');
      btn.textContent = action.pending;
    } else {
      btn.removeAttribute('aria-busy');
      btn.textContent = plan.state === 'error' ? 'Try again' : action.label;
    }
  }

  function setPlanState(next, errorText) {
    plan.state = next;
    setText('plan-error', next === 'error' ? errorText : '');
    setPlanButton();
  }

  // status: the /api/billing/status body. detail overrides the helper line.
  function renderPlan(status, detail) {
    var strip = document.getElementById('plan-strip');
    if (!strip) return;
    setPlanTile(status);
    var off = document.getElementById('plan-off');
    if (off) off.classList.toggle('hidden', !!(status && status.enabled));
    if (!status || !status.enabled) {
      strip.classList.add('hidden');
      return;
    }

    var label;
    var helper = '';
    if (status.plan === 'pro') {
      var date = formatDate(status.renewsAt);
      label = 'Pro plan';
      if (date) label += status.cancelAtPeriodEnd ? ' · ends ' + date : ' · renews ' + date;
      if (status.status === 'past_due') helper = 'Last payment failed. Update your card in billing';
      plan.mode = 'portal';
    } else if (status.status === 'past_due' || status.status === 'unpaid') {
      // Pro lapsed because a payment failed: the fix is the card, not a new checkout.
      label = 'Free plan';
      helper = 'Your last payment failed. Update your card to get Pro back.';
      plan.mode = 'portal';
    } else {
      label = 'Free plan';
      helper = 'Pro takes the aired badge off your pages and lets them be up to 10 MB. $108 a year.';
      plan.mode = 'checkout';
    }

    setText('plan-label', label);
    setText('plan-detail', detail !== undefined ? detail : helper);
    strip.classList.toggle('is-pro', status.plan === 'pro');
    setPlanState('idle');
    strip.classList.remove('hidden');
  }

  // A message-only strip (no button), used while confirming an upgrade.
  function renderPlanMessage(label, detail) {
    var strip = document.getElementById('plan-strip');
    if (!strip) return;
    plan.mode = null;
    setText('plan-label', label);
    setText('plan-detail', detail);
    setPlanState('idle');
    strip.classList.remove('hidden');
  }

  // Stripe's return URL carries ?upgraded=1. Drop it once handled so a reload
  // doesn't poll again.
  function clearUpgradedParam() {
    var params = new URLSearchParams(window.location.search);
    if (!params.has('upgraded')) return;
    params.delete('upgraded');
    var qs = params.toString();
    try {
      window.history.replaceState(null, '', window.location.pathname + (qs ? '?' + qs : '') + window.location.hash);
    } catch (_e) {}
  }

  function isNavigableUrl(url) {
    if (typeof url !== 'string') return false;
    try {
      var u = new URL(url);
      return u.protocol === 'https:' || u.protocol === 'http:';
    } catch (_e) {
      return false;
    }
  }

  function loadPlanStatus() {
    return fetchJson('/api/billing/status');
  }

  function runPlanAction() {
    var mode = plan.mode;
    if (!mode || plan.state === 'pending') return;
    var action = PLAN_ACTIONS[mode];
    setPlanState('pending');
    announce(action.pending);

    var init = {
      method: 'POST',
      headers: { 'X-Aired-Request': '1' },
      credentials: 'same-origin',
    };
    if (mode === 'checkout') {
      init.headers['Content-Type'] = 'application/json';
      init.body = JSON.stringify({ interval: 'year' });
    }

    fetch('/api/billing/' + mode, init).then(function (res) {
      return res.json().catch(function () { return {}; }).then(function (data) {
        if (res.ok && data && isNavigableUrl(data.url)) {
          // Stay pending while the browser leaves for Stripe.
          window.location.assign(data.url);
          return;
        }
        if (res.status === 401) {
          window.location.href = '/auth/login?return=/dashboard';
          return;
        }
        if (mode === 'checkout' && res.status === 409) {
          // Checkout was refused because a subscription already exists. Show the
          // real state rather than an error; only claim Pro when it is Pro.
          var message = (data && typeof data.error === 'string') ? data.error : '';
          return loadPlanStatus().then(function (status) {
            if (data && data.code === 'payment_failed') {
              renderPlan(status, message);
              if (plan.mode !== 'portal') { plan.mode = 'portal'; setPlanButton(); }
              announce(message);
            } else if (status && status.plan === 'pro') {
              renderPlan(status);
              announce("You're on Pro");
            } else {
              renderPlan(status, message);
              announce(message);
            }
          });
        }
        if (mode === 'portal' && res.status === 404) {
          setPlanState('error', 'No billing account yet.');
          announce('No billing account yet.');
          return;
        }
        throw new Error('Request failed: ' + res.status);
      });
    }).catch(function () {
      setPlanState('error', action.error);
      announce(action.error);
    });
  }

  // After checkout the webhook may land a few seconds later; poll until it does.
  function pollUpgrade() {
    var started = Date.now();
    renderPlanMessage('Payment received', 'Confirming your plan…');

    function finish(status) {
      clearUpgradedParam();
      if (status) {
        renderPlan(status, "You're on Pro");
        announce("You're on Pro");
      } else {
        renderPlanMessage('Payment received. Refresh in a minute.', '');
        announce('Payment received. Refresh in a minute.');
      }
    }

    function tick() {
      loadPlanStatus().then(function (status) {
        if (status && !status.enabled) {
          clearUpgradedParam();
          renderPlan(status);
          return;
        }
        if (status && status.plan === 'pro') {
          finish(status);
          return;
        }
        next();
      }).catch(next);
    }

    function next() {
      if (Date.now() - started + UPGRADE_POLL_MS > UPGRADE_POLL_LIMIT_MS) {
        finish(null);
        return;
      }
      setTimeout(tick, UPGRADE_POLL_MS);
    }

    tick();
  }

  function initPlan() {
    var btn = document.getElementById('plan-action');
    if (btn) btn.addEventListener('click', runPlanAction);

    // Back from Stripe via the bfcache: the page is restored mid-"pending".
    window.addEventListener('pageshow', function (e) {
      if (e.persisted && plan.state === 'pending') setPlanState('idle');
    });

    var upgraded = new URLSearchParams(window.location.search).get('upgraded') === '1';

    loadPlanStatus().then(function (status) {
      if (!status || !status.enabled) {
        if (upgraded) clearUpgradedParam();
        renderPlan(status);
        return;
      }
      if (!upgraded) {
        renderPlan(status);
        // /upgrade sends a user whose payment failed here with ?billing=payment_failed.
        var params = new URLSearchParams(window.location.search);
        if (params.get('billing') === 'payment_failed') {
          if (plan.mode !== 'portal') { plan.mode = 'portal'; setPlanButton(); }
          setText('plan-detail', 'Your last payment failed. Update your card in Manage billing.');
          params.delete('billing');
          var qs = params.toString();
          try {
            window.history.replaceState(null, '', window.location.pathname + (qs ? '?' + qs : '') + window.location.hash);
          } catch (_e) {}
        }
      } else if (status.plan === 'pro') {
        clearUpgradedParam();
        renderPlan(status, "You're on Pro");
        announce("You're on Pro");
      } else {
        pollUpgrade();
      }
    }).catch(function () {
      // Billing info is secondary: leave the strip hidden unless we were sent
      // back from checkout, where polling keeps trying.
      if (upgraded) pollUpgrade();
    });
  }

  // ── Browser-held pages: offer to add them after sign-in ──
  // Task 2.1 keeps signed-out publishes in localStorage["aired.pages"] as
  // [{id, token, title, url, createdAt}]. Nothing is sent without a click.
  var PAGES_KEY = 'aired.pages';
  var DISMISSED_KEY = 'aired.pages.dismissed';
  var CLAIM_CHUNK = 100;
  // claim-batch only ever says "claim failed" today; if it starts saying the page
  // is gone or owned elsewhere, drop the entry so it stops coming back.
  var CLAIM_GONE_RE = /not found|no longer exist|does not exist|gone|expired|deleted|already (claimed|owned)|owned by|another (user|account)/i;

  var claim = {
    state: 'idle',   // idle | pending | partial | error
    entries: [],
  };

  function readStoredPages() {
    try {
      var list = JSON.parse(window.localStorage.getItem(PAGES_KEY) || '[]');
      return Array.isArray(list) ? list : [];
    } catch (_e) {
      return [];
    }
  }

  // Valid entries only (string id + token), de-duplicated by id.
  function readClaimEntries() {
    var seen = {};
    var out = [];
    var list = readStoredPages();
    for (var i = 0; i < list.length; i++) {
      var e = list[i];
      if (!e || typeof e !== 'object') continue;
      if (typeof e.id !== 'string' || !e.id || typeof e.token !== 'string' || !e.token) continue;
      if (seen[e.id]) continue;
      seen[e.id] = true;
      out.push(e);
    }
    return out;
  }

  function removeStoredPages(ids) {
    if (!ids.length) return;
    var drop = {};
    for (var i = 0; i < ids.length; i++) drop[ids[i]] = true;
    try {
      var kept = readStoredPages().filter(function (e) {
        return !(e && typeof e === 'object' && drop[e.id]);
      });
      window.localStorage.setItem(PAGES_KEY, JSON.stringify(kept));
    } catch (_e) {}
  }

  function idsKey(entries) {
    return entries.map(function (e) { return e.id; }).sort().join(',');
  }

  function readDismissed() {
    try {
      var raw = window.localStorage.getItem(DISMISSED_KEY) || '';
      return raw ? raw.split(',') : [];
    } catch (_e) {
      return [];
    }
  }

  function pagesPhrase(n) {
    return n + (n === 1 ? ' page' : ' pages');
  }

  function claimTitle(entry) {
    return (entry && typeof entry.title === 'string' && entry.title) || (entry && entry.id) || '';
  }

  function renderClaim(failures, errorText) {
    var banner = document.getElementById('claim-banner');
    if (!banner) return;
    var addBtn = document.getElementById('claim-add');
    var dismissBtn = document.getElementById('claim-dismiss');
    var pending = claim.state === 'pending';
    var n = claim.entries.length;

    if (n > 0) {
      setText('claim-label', pagesPhrase(n) + ' published in this browser without an account');
    } else {
      setText('claim-label', 'Some pages could not be added');
    }
    setText('claim-detail', n > 0 ? 'Add them to your account to manage them here.' : '');
    setText('claim-error', errorText || '');

    var list = document.getElementById('claim-failures');
    if (list) {
      list.innerHTML = '';
      var items = failures || [];
      for (var i = 0; i < items.length; i++) {
        var li = document.createElement('li');
        li.textContent = "Couldn't add " + items[i];
        list.appendChild(li);
      }
      if (items.length) list.classList.remove('hidden');
      else list.classList.add('hidden');
    }

    if (addBtn) {
      if (n === 0) {
        addBtn.classList.add('hidden');
      } else {
        addBtn.classList.remove('hidden');
        addBtn.disabled = pending;
        if (pending) addBtn.setAttribute('aria-busy', 'true');
        else addBtn.removeAttribute('aria-busy');
        addBtn.textContent = pending ? 'Adding…' : (claim.state === 'idle' ? 'Add to my account' : 'Try again');
      }
    }
    if (dismissBtn) {
      dismissBtn.disabled = pending;
      dismissBtn.textContent = n === 0 ? 'Dismiss' : 'Not now';
    }
    banner.classList.remove('hidden');
  }

  function hideClaim() {
    var banner = document.getElementById('claim-banner');
    if (banner) banner.classList.add('hidden');
    // Leave the controls idle so nothing stale shows if the banner returns.
    var addBtn = document.getElementById('claim-add');
    var dismissBtn = document.getElementById('claim-dismiss');
    if (addBtn) {
      addBtn.disabled = false;
      addBtn.removeAttribute('aria-busy');
      addBtn.textContent = 'Add to my account';
    }
    if (dismissBtn) {
      dismissBtn.disabled = false;
      dismissBtn.textContent = 'Not now';
    }
  }

  function dismissClaim() {
    if (claim.state === 'pending') return;
    var entries = readClaimEntries();
    if (entries.length) {
      try { window.localStorage.setItem(DISMISSED_KEY, idsKey(entries)); } catch (_e) {}
    }
    hideClaim();
  }

  function postClaimChunk(chunk) {
    return fetch('/api/me/claim-batch', {
      method: 'POST',
      headers: { 'X-Aired-Request': '1', 'Content-Type': 'application/json' },
      credentials: 'same-origin',
      body: JSON.stringify({
        items: chunk.map(function (e) { return { id: e.id, update_token: e.token }; }),
      }),
    });
  }

  function runClaim() {
    if (claim.state === 'pending') return;
    var entries = readClaimEntries();
    if (!entries.length) { hideClaim(); return; }

    var byId = {};
    for (var i = 0; i < entries.length; i++) byId[entries[i].id] = entries[i];

    claim.state = 'pending';
    claim.entries = entries;
    renderClaim([], '');
    announce('Adding ' + pagesPhrase(entries.length) + '…');

    var added = 0;
    var failures = [];
    var problem = ''; // set when the run stops early (rate limit or request error)

    function chunkAt(start) {
      if (start >= entries.length || problem) return Promise.resolve();
      var chunk = entries.slice(start, start + CLAIM_CHUNK);
      return postClaimChunk(chunk).then(function (res) {
        if (res.status === 429) {
          problem = 'Try again in an hour.';
          return;
        }
        if (!res.ok) throw new Error('Request failed: ' + res.status);
        return res.json().then(function (data) {
          var claimed = (data && Array.isArray(data.claimed)) ? data.claimed : [];
          var failed = (data && Array.isArray(data.failed)) ? data.failed : [];
          var drop = claimed.slice();
          added += claimed.length;
          for (var j = 0; j < failed.length; j++) {
            var f = failed[j] || {};
            failures.push(claimTitle(byId[f.id]) || (typeof f.id === 'string' ? f.id : ''));
            if (typeof f.reason === 'string' && CLAIM_GONE_RE.test(f.reason)) drop.push(f.id);
          }
          // Persist per chunk so a later failure never re-sends claimed pages.
          removeStoredPages(drop);
        });
      }).then(function () {
        return chunkAt(start + CLAIM_CHUNK);
      });
    }

    chunkAt(0).catch(function () {
      problem = 'Could not add pages. Try again.';
    }).then(function () {
      claim.entries = readClaimEntries();
      var addedText = added > 0 ? 'Added ' + pagesPhrase(added) : '';

      if (added > 0) loadDashboard();

      if (problem) {
        claim.state = 'error';
        renderClaim(failures, problem);
        announce((addedText ? addedText + '. ' : '') + problem);
      } else if (failures.length) {
        claim.state = 'partial';
        renderClaim(failures, '');
        announce((addedText ? addedText + '. ' : '') + failures.length + ' could not be added');
      } else {
        claim.state = 'idle';
        hideClaim();
        announce(addedText || 'Nothing to add');
      }
    });
  }

  function initClaim() {
    var addBtn = document.getElementById('claim-add');
    var dismissBtn = document.getElementById('claim-dismiss');
    if (!addBtn || !dismissBtn) return;
    addBtn.addEventListener('click', runClaim);
    dismissBtn.addEventListener('click', dismissClaim);

    var entries = readClaimEntries();
    if (!entries.length) return;
    // Stay hidden if every saved page was already dismissed; new ones bring it back.
    var dismissed = readDismissed();
    var allDismissed = entries.every(function (e) { return dismissed.indexOf(e.id) !== -1; });
    if (allDismissed) return;
    claim.entries = entries;
    renderClaim([], '');
  }

  // ── Init ──
  document.addEventListener('DOMContentLoaded', function () {
    // Back from Stripe, or sent here after a failed payment: open Plan & billing.
    var params = new URLSearchParams(window.location.search);
    if ((params.get('upgraded') === '1' || params.has('billing')) && !window.location.hash) {
      try { window.history.replaceState(null, '', window.location.pathname + window.location.search + '#billing'); } catch (_e) {}
    }
    initViews();
    initCopyButtons();
    init();
  });

  async function init() {
    var meRes;
    try {
      meRes = await fetch('/api/me', { credentials: 'same-origin' });
    } catch (_err) {
      showLoadError();
      return;
    }

    if (meRes.status === 401) {
      window.location.href = '/auth/login?return=/dashboard';
      return;
    }

    var user;
    try {
      user = await meRes.json();
    } catch (_err) {
      return;
    }

    initAccount(user);
    initPlan();
    initClaim();
    initPagesTools();
    await loadDashboard();
  }
})();
