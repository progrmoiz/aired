/* aired — dashboard page logic (vanilla JS, no framework) */

(function () {
  'use strict';

  var UNSORTED_KEY = '__unsorted__';
  var UNSORTED_LABEL = 'Unsorted';

  function relativeAge(isoString) {
    if (!isoString) return '';
    var now = Date.now();
    var then = new Date(isoString).getTime();
    var diff = Math.floor((now - then) / 1000);
    if (diff < 60) return diff + 's ago';
    if (diff < 3600) return Math.floor(diff / 60) + 'm ago';
    if (diff < 86400) return Math.floor(diff / 3600) + 'h ago';
    if (diff < 86400 * 30) return Math.floor(diff / 86400) + 'd ago';
    return Math.floor(diff / (86400 * 30)) + 'mo ago';
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
    li.className = 'flex items-center gap-3 min-h-[44px] py-3';
    li.setAttribute('data-page-id', page.id);

    var info = document.createElement('div');
    info.className = 'flex-1 min-w-0';

    var titleLink = document.createElement('a');
    titleLink.className = 'row-link block text-sm text-aired-text-primary truncate focus-ring rounded-sm';
    titleLink.href = '/p/' + page.id;
    titleLink.target = '_blank';
    titleLink.rel = 'noopener noreferrer';
    titleLink.textContent = page.title || page.id;

    var metaEl = document.createElement('div');
    metaEl.className = 'flex items-center gap-2 mt-0.5';

    var idSpan = document.createElement('span');
    idSpan.className = 'font-mono text-xs text-aired-text-tertiary';
    idSpan.textContent = page.id;
    metaEl.appendChild(idSpan);

    if (page.createdAt) {
      var dot = document.createElement('span');
      dot.className = 'text-aired-text-tertiary';
      dot.textContent = '·';
      dot.setAttribute('aria-hidden', 'true');
      metaEl.appendChild(dot);

      var ageSpan = document.createElement('span');
      ageSpan.className = 'text-xs text-aired-text-tertiary';
      ageSpan.textContent = relativeAge(page.createdAt);
      metaEl.appendChild(ageSpan);
    }

    info.appendChild(titleLink);
    info.appendChild(metaEl);

    var viewsEl = document.createElement('span');
    viewsEl.className = 'text-xs text-aired-text-tertiary tabular-nums flex-shrink-0';
    var viewCount = typeof page.readCount === 'number' ? page.readCount : 0;
    viewsEl.textContent = viewCount + (viewCount === 1 ? ' view' : ' views');

    var copyBtn = document.createElement('button');
    copyBtn.type = 'button';
    var copyBaseClass = 'row-action-btn flex-shrink-0 text-xs text-aired-text-tertiary hover:text-aired-text-primary focus-ring rounded-sm border border-transparent px-1.5 py-1';
    copyBtn.className = copyBaseClass;
    copyBtn.setAttribute('aria-label', 'Copy page URL');
    copyBtn.textContent = 'Copy';

    var copyTimer = null;
    function setCopied() {
      copyBtn.className = copyBaseClass + ' row-action-copied';
      copyBtn.textContent = 'Copied';
      announce('Copied');
      if (copyTimer) clearTimeout(copyTimer);
      copyTimer = setTimeout(function () {
        copyBtn.className = copyBaseClass;
        copyBtn.textContent = 'Copy';
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
    var deleteBaseClass = 'row-action-btn flex-shrink-0 text-xs text-aired-text-tertiary hover:text-aired-text-primary focus-ring rounded-sm border border-transparent px-1.5 py-1';
    deleteBtn.className = deleteBaseClass;
    deleteBtn.setAttribute('aria-label', 'Delete page');
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
        deleteBtn.textContent = 'Confirm delete';
        deleteBtn.className = deleteBaseClass + ' row-action-confirm';
        deleteTimer = setTimeout(revertDelete, 3000);
      } else if (deleteState === 'confirm') {
        if (deleteTimer) { clearTimeout(deleteTimer); deleteTimer = null; }
        deleteState = 'deleting';
        deleteBtn.disabled = true;
        deleteBtn.textContent = 'Deleting…';
        deleteBtn.className = deleteBaseClass + ' opacity-50 cursor-not-allowed';

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

    li.appendChild(info);
    li.appendChild(viewsEl);
    li.appendChild(copyBtn);
    li.appendChild(deleteBtn);

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
        countEl.innerHTML = '&nbsp;';
      } else {
        var pageLabel = currentPageCount + ' page' + (currentPageCount === 1 ? '' : 's');
        if (projectCount > 0) {
          pageLabel += ' · ' + projectCount + ' project' + (projectCount === 1 ? '' : 's');
        }
        countEl.textContent = pageLabel;
      }
    }

    var heroPublish = document.getElementById('hero-publish');
    if (heroPublish && currentPageCount !== null) {
      heroPublish.textContent = currentPageCount === 0 ? 'Publish your first →' : 'Publish another →';
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

    var section = document.createElement('section');
    section.className = 'project-group border-b border-aired-border';
    section.setAttribute('data-project', group.key);

    var header = document.createElement('button');
    header.type = 'button';
    header.className = 'group-header w-full flex items-center gap-2 min-h-[44px] py-3 text-left focus-ring rounded-sm text-sm text-aired-text-primary';
    header.setAttribute('aria-expanded', 'false');
    header.setAttribute('aria-controls', ulId);

    var chevron = document.createElement('span');
    chevron.className = 'group-chevron text-aired-text-tertiary flex-shrink-0';
    chevron.setAttribute('aria-hidden', 'true');
    chevron.textContent = '›';

    var nameEl = document.createElement('span');
    nameEl.className = 'font-medium truncate';
    nameEl.textContent = group.label;

    var countEl = document.createElement('span');
    countEl.className = 'group-count ml-auto flex-shrink-0 text-xs text-aired-text-tertiary tabular-nums';
    countEl.textContent = String(group.count);

    header.appendChild(chevron);
    header.appendChild(nameEl);
    header.appendChild(countEl);

    var ul = document.createElement('ul');
    ul.id = ulId;
    ul.className = 'divide-y divide-aired-border pb-1';
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
      // Prune an emptied group entirely.
      if (state.count === 0 && ul.children.length === 0) {
        section.remove();
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
      btn.className = 'mb-3 w-full text-xs text-aired-text-secondary hover:text-aired-text-primary transition-colors duration-150 focus-ring rounded-sm py-2';
      btn.textContent = 'Load more';
      btn.addEventListener('click', function () {
        btn.textContent = 'Loading…';
        btn.disabled = true;
        loadPage(true).then(function () {
          btn.remove();
          renderLoadMore();
        }).catch(function () {
          btn.textContent = 'Load more';
          btn.disabled = false;
        });
      });
      ul.parentNode.insertBefore(btn, ul.nextSibling);
    }

    // Fetch one page of rows. `append` distinguishes load-more from first load.
    function loadPage(append) {
      if (state.loading) return Promise.resolve();
      state.loading = true;

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
        }
        state.loading = false;
        renderLoadMore();
      }).catch(function (err) {
        state.loading = false;
        throw err;
      });
    }

    function ensureLoaded() {
      if (state.loaded) return Promise.resolve();
      state.loaded = true;

      // Unsorted may carry prefetched first-page rows from the dashboard probe.
      if (group.prefetched) {
        appendRows(group.prefetched);
        renderLoadMore();
        return Promise.resolve();
      }
      return loadPage(false).catch(function () {
        // Surface a minimal inline failure inside the group.
        var p = document.createElement('p');
        p.className = 'text-sm text-aired-text-secondary py-2';
        p.textContent = 'Could not load.';
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
    wrap.className = 'flex items-center justify-between py-3';

    var msg = document.createElement('p');
    msg.className = 'text-sm text-aired-text-secondary';
    msg.textContent = 'Could not load.';

    var retry = document.createElement('button');
    retry.type = 'button';
    retry.className = 'text-xs text-aired-text-secondary hover:text-aired-text-primary transition-colors duration-150 focus-ring rounded-sm px-1.5 py-1';
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
      if (projects.length === 0 && unsortedRows.length === 0) {
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

      if (unsortedRows.length > 0) {
        renderGroup(container, {
          key: UNSORTED_KEY,
          label: UNSORTED_LABEL,
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

    var h1 = document.getElementById('user-handle');
    if (h1) h1.textContent = '@' + user.login;

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
