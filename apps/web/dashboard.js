/* aired — dashboard page logic (vanilla JS, no framework) */

(function () {
  'use strict';

  var UNSORTED_KEY = '__unsorted__';
  var UNSORTED_LABEL = 'Not in a project';

  var SVG_NS = 'http://www.w3.org/2000/svg';
  var ICONS = {
    doc: '<path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"/><path d="M14 3v5h5"/>',
    lock: '<rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/>',
    clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
    globe: '<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3a14 14 0 0 1 0 18M12 3a14 14 0 0 0 0 18"/>',
    eye: '<path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/>',
    size: '<path d="M4 7h16M4 12h16M4 17h10"/>',
    stop: '<circle cx="12" cy="12" r="9"/><path d="M8 12h8"/>',
    folder: '<path d="M3 7h6l2 2h10v10H3z"/>',
    chev: '<path d="m9 6 6 6-6 6"/>',
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

  function plural(n, word) {
    return n + ' ' + word + (n === 1 ? '' : 's');
  }

  // "Published 3 days ago"
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

  // How long the page stays up, in words. Returns { text, tone, title }.
  function expiryWords(page) {
    if (page.permanent || !page.expiresAt) return { text: 'Never expires', tone: 'good', title: '' };
    var at = new Date(page.expiresAt);
    var left = Math.floor((at.getTime() - Date.now()) / 1000);
    var title = isNaN(at.getTime()) ? '' : 'Expires ' + at.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
    if (isNaN(left)) return { text: 'Expires soon', tone: '', title: '' };
    if (left <= 0) return { text: 'Expired', tone: 'soon', title: title };
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

  function chip(iconName, text, tone, title) {
    var el = document.createElement('span');
    el.className = 'chip' + (tone ? ' ' + tone : '');
    el.appendChild(icon(iconName));
    el.appendChild(document.createTextNode(text));
    if (title) el.title = title;
    return el;
  }

  function announce(message) {
    var live = document.getElementById('action-status');
    if (!live) return;
    live.textContent = '';
    setTimeout(function () { live.textContent = message; }, 50);
  }

  // renderRow builds a single page row. onRemoved (optional) is invoked after a
  // successful delete so the enclosing group can update its count / prune itself.
  function renderRow(page, onRemoved) {
    var li = document.createElement('li');
    li.className = 'prow';
    li.setAttribute('data-page-id', page.id);

    var thumb = document.createElement('span');
    thumb.className = 'thumb';
    thumb.appendChild(icon(page.hasPin ? 'lock' : 'doc'));

    var info = document.createElement('div');
    info.style.minWidth = '0';

    var titleLink = document.createElement('a');
    titleLink.className = 'ttl focus-ring';
    titleLink.href = '/p/' + page.id;
    titleLink.target = '_blank';
    titleLink.rel = 'noopener noreferrer';
    titleLink.textContent = page.title || 'Untitled page';

    var metaEl = document.createElement('p');
    metaEl.className = 'sub';
    var urlSpan = document.createElement('span');
    urlSpan.className = 'mono';
    urlSpan.textContent = window.location.host + '/p/' + page.id;
    metaEl.appendChild(urlSpan);
    if (page.createdAt) {
      var age = relativeAge(page.createdAt);
      if (age) metaEl.appendChild(document.createTextNode(' · Published ' + age));
    }

    // Plain-language facts: views, expiry, who can open it, view limit, size.
    var chips = document.createElement('div');
    chips.className = 'chips';
    var viewCount = typeof page.readCount === 'number' ? page.readCount : 0;
    chips.appendChild(chip('eye', plural(viewCount, 'view')));
    var exp = expiryWords(page);
    chips.appendChild(chip('clock', exp.text, exp.tone, exp.title));
    chips.appendChild(page.hasPin ? chip('lock', 'Needs a PIN') : chip('globe', 'Anyone with the link'));
    if (typeof page.reads === 'number' && page.reads > 0) {
      var left = Math.max(0, page.reads - viewCount);
      chips.appendChild(chip('stop', 'Stops after ' + plural(page.reads, 'view') + ' · ' + left + ' left', left <= Math.max(1, Math.ceil(page.reads * 0.1)) ? 'soon' : ''));
    } else {
      chips.appendChild(chip('stop', 'No view limit'));
    }
    var size = sizeWords(page.size);
    if (size) chips.appendChild(chip('size', size));

    info.appendChild(titleLink);
    info.appendChild(metaEl);
    info.appendChild(chips);

    var acts = document.createElement('div');
    acts.className = 'acts';

    var copyBtn = document.createElement('button');
    copyBtn.type = 'button';
    var copyBaseClass = 'btn sm';
    copyBtn.className = copyBaseClass;
    copyBtn.setAttribute('aria-label', 'Copy link to ' + (page.title || page.id));
    copyBtn.textContent = 'Copy link';

    var copyTimer = null;
    function setCopied() {
      copyBtn.className = copyBaseClass + ' copied';
      copyBtn.textContent = 'Copied';
      announce('Copied');
      if (copyTimer) clearTimeout(copyTimer);
      copyTimer = setTimeout(function () {
        copyBtn.className = copyBaseClass;
        copyBtn.textContent = 'Copy link';
      }, 1800);
    }

    copyBtn.addEventListener('click', function () {
      var url = window.location.origin + '/p/' + page.id;
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(url).then(setCopied).catch(fallbackCopy);
      } else {
        fallbackCopy();
      }
      function fallbackCopy() {
        var ta = document.createElement('textarea');
        ta.value = url;
        ta.style.position = 'fixed';
        ta.style.left = '-9999px';
        document.body.appendChild(ta);
        ta.select();
        try { document.execCommand('copy'); } catch (_e) {}
        document.body.removeChild(ta);
        setCopied();
      }
    });

    var deleteBtn = document.createElement('button');
    deleteBtn.type = 'button';
    var deleteBaseClass = 'btn sm ghost';
    deleteBtn.className = deleteBaseClass;
    deleteBtn.setAttribute('aria-label', 'Delete ' + (page.title || page.id));
    deleteBtn.textContent = 'Delete';

    var deleteTimer = null;
    var deleteState = 'idle'; // idle | confirm | deleting

    function revertDelete() {
      deleteState = 'idle';
      if (deleteTimer) { clearTimeout(deleteTimer); deleteTimer = null; }
      deleteBtn.textContent = 'Delete';
      deleteBtn.className = deleteBaseClass;
      deleteBtn.disabled = false;
    }

    deleteBtn.addEventListener('click', function () {
      if (deleteState === 'idle') {
        deleteState = 'confirm';
        deleteBtn.textContent = 'Click to confirm';
        deleteBtn.className = 'btn sm confirm';
        deleteTimer = setTimeout(revertDelete, 3000);
      } else if (deleteState === 'confirm') {
        if (deleteTimer) { clearTimeout(deleteTimer); deleteTimer = null; }
        deleteState = 'deleting';
        deleteBtn.disabled = true;
        deleteBtn.textContent = 'Deleting…';
        deleteBtn.className = 'btn sm confirm';

        fetch('/api/pages/' + page.id, {
          method: 'DELETE',
          headers: { 'X-Aired-Request': '1' },
          credentials: 'same-origin',
        }).then(function (res) {
          if (res.ok) {
            li.remove();
            announce('Deleted');
            updatePageCount(-1);
            if (typeof onRemoved === 'function') onRemoved();
          } else {
            revertDelete();
          }
        }).catch(revertDelete);
      }
    });

    acts.appendChild(copyBtn);
    acts.appendChild(deleteBtn);

    li.appendChild(thumb);
    li.appendChild(info);
    li.appendChild(acts);

    return li;
  }

  // ── Page count tracker (total across all groups) ──
  var currentPageCount = null;
  var projectCount = 0;

  function setPageCount(n) {
    currentPageCount = n;
    renderPageCount();
  }

  function updatePageCount(delta) {
    if (currentPageCount === null) return;
    currentPageCount = Math.max(0, currentPageCount + delta);
    renderPageCount();
  }

  function renderPageCount() {
    var countEl = document.getElementById('page-count');
    if (countEl) {
      if (currentPageCount === null) {
        countEl.textContent = '';
      } else {
        var pageLabel = ' · ' + plural(currentPageCount, 'page');
        if (projectCount > 0) {
          pageLabel += ' in ' + plural(projectCount, 'project');
        }
        countEl.textContent = pageLabel;
      }
    }

    var heroPublish = document.getElementById('hero-publish');
    if (heroPublish && currentPageCount !== null) {
      heroPublish.textContent = currentPageCount === 0 ? 'Publish a page' : 'Publish another';
    }

    var emptyState = document.getElementById('empty-state');
    if (emptyState && currentPageCount !== null) {
      if (currentPageCount === 0) {
        emptyState.classList.remove('hidden');
      } else {
        emptyState.classList.add('hidden');
      }
    }
  }

  // ── Fetch helper ──
  function fetchJson(url) {
    return fetch(url, { credentials: 'same-origin' }).then(function (res) {
      if (!res.ok) throw new Error('Request failed: ' + res.status);
      return res.json();
    });
  }

  // ── Collapsible project group ──
  var groupSeq = 0;

  // group: { key, label, count (header number), prefetched (rows[]|null), cursor }
  function renderGroup(container, group, expandInitially) {
    var ulId = 'group-ul-' + (groupSeq++);

    var labelId = ulId + '-label';

    var section = document.createElement('section');
    section.className = 'project-group panel pgroup';
    section.setAttribute('data-project', group.key);
    // Give the section an accessible name so it's a meaningful landmark, not a
    // generic unlabeled region.
    section.setAttribute('aria-labelledby', labelId);

    var header = document.createElement('button');
    header.type = 'button';
    header.className = 'group-header ghead';
    header.setAttribute('aria-expanded', 'false');
    header.setAttribute('aria-controls', ulId);

    var chevron = icon('chev');
    chevron.setAttribute('class', 'chev');

    var gic = document.createElement('span');
    gic.className = 'gic';
    gic.appendChild(icon(group.key === UNSORTED_KEY ? 'doc' : 'folder'));

    var nameEl = document.createElement('span');
    nameEl.id = labelId;
    nameEl.className = 'gname';
    nameEl.textContent = group.label;

    var countEl = document.createElement('span');
    countEl.className = 'group-count gcount';
    countEl.textContent = String(group.count);

    header.appendChild(chevron);
    header.appendChild(gic);
    header.appendChild(nameEl);
    header.appendChild(countEl);

    var ul = document.createElement('ul');
    ul.id = ulId;
    ul.className = 'prows';
    ul.hidden = true;

    section.appendChild(header);
    section.appendChild(ul);
    container.appendChild(section);

    var state = {
      key: group.key,
      isUnsorted: group.key === UNSORTED_KEY,
      count: group.count,
      countEl: countEl,
      ul: ul,
      cursor: group.cursor || null,
      loaded: false,
      loading: false,
      expanded: false,
    };

    function setCount(n) {
      state.count = Math.max(0, n);
      countEl.textContent = String(state.count);
      // Prune an emptied group entirely (once).
      if (state.count === 0 && ul.children.length === 0 && !state.pruned) {
        state.pruned = true;
        section.remove();
        // Keep the "· N projects" summary honest as named groups disappear.
        if (!state.isUnsorted && projectCount > 0) {
          projectCount--;
          renderPageCount();
        }
      }
    }

    function onRowRemoved() {
      setCount(state.count - 1);
    }

    function appendRows(rows) {
      for (var i = 0; i < rows.length; i++) {
        ul.appendChild(renderRow(rows[i], onRowRemoved));
      }
    }

    function renderLoadMore() {
      var existing = ul.parentNode.querySelector('[data-load-more="' + ulId + '"]');
      if (existing) existing.remove();
      if (!state.cursor) return;

      var btn = document.createElement('button');
      btn.type = 'button';
      btn.setAttribute('data-load-more', ulId);
      btn.className = 'loadmore';
      btn.textContent = 'Show more pages';
      btn.addEventListener('click', function () {
        btn.textContent = 'Loading…';
        btn.disabled = true;
        loadPage(true).then(function () {
          btn.remove();
          renderLoadMore();
        }).catch(function () {
          btn.textContent = 'Show more pages';
          btn.disabled = false;
        });
      });
      ul.parentNode.insertBefore(btn, ul.nextSibling);
    }

    // Fetch one page of rows. `append` distinguishes load-more from first load.
    function loadPage(append) {
      if (state.loading) return Promise.resolve();
      state.loading = true;
      return fetchOnce(append, 0).then(function () {
        state.loading = false;
        renderLoadMore();
      }).catch(function (err) {
        state.loading = false;
        throw err;
      });
    }

    // The Unsorted group reads the FLAT index and post-filters project===null, so a
    // 20-item page can yield zero rows while more remain. Follow the cursor past
    // those empty pages (bounded) so unsorted/legacy pages stay reachable.
    function fetchOnce(append, depth) {
      var url = '/api/me/pages?project=' + encodeURIComponent(state.key) + '&limit=20';
      if (append && state.cursor) {
        url += '&cursor=' + encodeURIComponent(state.cursor);
      }
      return fetchJson(url).then(function (data) {
        var rows = data.pages || [];
        appendRows(rows);
        state.cursor = data.cursor || null;
        // Named groups were already counted upfront via the manifest totals, so
        // loading their rows must NOT add to the global count again. Only the
        // Unsorted group's rows beyond its prefetched first page are new here.
        if (state.isUnsorted) {
          setCount(ul.children.length);
          currentPageCount += rows.length;
          renderPageCount();
          if (rows.length === 0 && state.cursor && depth < 25) {
            return fetchOnce(true, depth + 1);
          }
        }
      });
    }

    function ensureLoaded() {
      if (state.loaded) return Promise.resolve();
      state.loaded = true;

      // Unsorted may carry prefetched first-page rows from the dashboard probe.
      if (group.prefetched && group.prefetched.length > 0) {
        appendRows(group.prefetched);
        renderLoadMore();
        return Promise.resolve();
      }
      // No prefetched rows: load from the cursor (Unsorted, prefetch was empty but
      // more pages remain) or from the first page (named groups, prefetched null).
      return loadPage(group.prefetched ? true : false).catch(function () {
        // Surface a minimal inline failure inside the group.
        var p = document.createElement('li');
        p.className = 'gnote';
        p.textContent = 'Could not load these pages. Refresh to try again.';
        ul.appendChild(p);
      });
    }

    function setExpanded(next) {
      state.expanded = next;
      header.setAttribute('aria-expanded', next ? 'true' : 'false');
      ul.hidden = !next;
      if (next) ensureLoaded();
    }

    header.addEventListener('click', function () {
      setExpanded(!state.expanded);
    });

    if (expandInitially) {
      setExpanded(true);
    }

    return state;
  }

  // ── Error state with retry ──
  function showLoadError() {
    var container = document.getElementById('project-groups');
    if (!container) return;
    container.innerHTML = '';

    var emptyState = document.getElementById('empty-state');
    if (emptyState) emptyState.classList.add('hidden');

    var wrap = document.createElement('div');
    wrap.id = 'load-error';
    wrap.className = 'panel load-err';

    var msg = document.createElement('p');
    msg.textContent = 'Could not load your pages.';

    var retry = document.createElement('button');
    retry.type = 'button';
    retry.className = 'btn sm';
    retry.textContent = 'Retry';
    retry.addEventListener('click', function () {
      retry.disabled = true;
      retry.textContent = 'Loading…';
      loadDashboard();
    });

    wrap.appendChild(msg);
    wrap.appendChild(retry);
    container.appendChild(wrap);
  }

  // ── Dashboard loader: projects + unsorted probe → grouped sections ──
  function loadDashboard() {
    var container = document.getElementById('project-groups');

    return Promise.all([
      fetchJson('/api/me/projects'),
      // Probe unsorted: tells us whether the group exists + gives its first rows.
      fetchJson('/api/me/pages?project=' + UNSORTED_KEY + '&limit=20'),
    ]).then(function (results) {
      var projects = (results[0] && results[0].projects) || [];
      var unsortedData = results[1] || { pages: [] };
      var unsortedRows = unsortedData.pages || [];

      if (!container) return;
      container.innerHTML = '';

      projectCount = projects.length;

      var namedTotal = 0;
      for (var i = 0; i < projects.length; i++) {
        namedTotal += (typeof projects[i].count === 'number' ? projects[i].count : 0);
      }
      setPageCount(namedTotal + unsortedRows.length);

      // Nothing at all → empty state (renderPageCount already toggles it on 0).
      // A non-null unsorted cursor means more pages exist further down, so it is
      // not actually empty even when the probe's first page filtered to zero rows.
      if (projects.length === 0 && unsortedRows.length === 0 && !unsortedData.cursor) {
        return;
      }

      // Expand the first group so the page isn't all-collapsed on arrival.
      var expandIndex = 0;
      var rendered = 0;

      for (var j = 0; j < projects.length; j++) {
        renderGroup(container, {
          key: projects[j].name,
          label: projects[j].name,
          count: projects[j].count,
          prefetched: null,
          cursor: null,
        }, rendered === expandIndex);
        rendered++;
      }

      // Render Unsorted when it has rows OR a cursor: a non-null cursor with zero
      // rows means unsorted/legacy pages exist further down the flat index (the
      // first page happened to be all project-tagged). Without this, those pages
      // would be invisible. The group's loader follows the cursor on expand.
      if (unsortedRows.length > 0 || unsortedData.cursor) {
        renderGroup(container, {
          key: UNSORTED_KEY,
          label: projects.length ? UNSORTED_LABEL : 'All pages',
          count: unsortedRows.length,
          prefetched: unsortedRows,
          cursor: unsortedData.cursor || null,
        }, rendered === expandIndex);
        rendered++;
      }
    }).catch(function () {
      showLoadError();
    });
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
          window.location.href = '/auth/github?return=/dashboard';
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
      window.location.href = '/auth/github?return=/dashboard';
      return;
    }

    var user;
    try {
      user = await meRes.json();
    } catch (_err) {
      return;
    }

    var handle = document.getElementById('user-handle');
    if (handle) handle.textContent = 'Signed in as @' + user.login;
    var who = document.getElementById('nav-who');
    if (who) who.textContent = '@' + user.login;

    initPlan();
    initClaim();
    await loadDashboard();

    var signOutBtn = document.getElementById('sign-out');
    if (signOutBtn) {
      signOutBtn.addEventListener('click', function () {
        fetch('/auth/logout', {
          method: 'POST',
          headers: { 'X-Aired-Request': '1' },
          credentials: 'same-origin',
        }).then(function () {
          window.location.href = '/';
        }).catch(function () {
          window.location.href = '/';
        });
      });
    }
  }
})();
