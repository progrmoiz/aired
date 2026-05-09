/* aired — dashboard page logic (vanilla JS, no framework) */

(function () {
  'use strict';

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

  function renderRow(page) {
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

  // ── Page count tracker ──
  var currentPageCount = null;

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
    if (!countEl) return;
    if (currentPageCount === null) {
      countEl.innerHTML = '&nbsp;';
      return;
    }
    countEl.textContent = currentPageCount + ' page' + (currentPageCount === 1 ? '' : 's');
  }

  // ── Load more ──
  function renderLoadMore(cursor, ul) {
    var existing = document.getElementById('load-more-btn');
    if (existing) existing.remove();
    if (!cursor) return;

    var btn = document.createElement('button');
    btn.id = 'load-more-btn';
    btn.type = 'button';
    btn.className = 'mt-6 w-full text-xs text-aired-text-secondary hover:text-aired-text-primary transition-colors duration-150 focus-ring rounded-sm py-2';
    btn.textContent = 'Load more';

    btn.addEventListener('click', function () {
      btn.textContent = 'Loading…';
      btn.disabled = true;

      fetch('/api/me/pages?cursor=' + encodeURIComponent(cursor) + '&limit=20', {
        credentials: 'same-origin',
      }).then(function (res) {
        return res.json();
      }).then(function (data) {
        var list = data.pages || [];
        for (var i = 0; i < list.length; i++) {
          ul.appendChild(renderRow(list[i]));
        }
        if (currentPageCount !== null) {
          currentPageCount += list.length;
          renderPageCount();
        }
        btn.remove();
        renderLoadMore(data.cursor, ul);
      }).catch(function () {
        btn.textContent = 'Load more';
        btn.disabled = false;
      });
    });

    ul.parentNode.insertBefore(btn, ul.nextSibling);
  }

  // ── Error state with retry ──
  function showLoadError(ul) {
    if (!ul) return;
    ul.innerHTML = '';

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
      loadPages();
    });

    wrap.appendChild(msg);
    wrap.appendChild(retry);
    ul.parentNode.insertBefore(wrap, ul.nextSibling);
  }

  function clearLoadError() {
    var existing = document.getElementById('load-error');
    if (existing) existing.remove();
  }

  // ── Pages loader ──
  async function loadPages() {
    var ul = document.getElementById('page-list');
    clearLoadError();

    var pagesRes;
    try {
      pagesRes = await fetch('/api/me/pages', { credentials: 'same-origin' });
    } catch (_err) {
      if (ul) ul.innerHTML = '';
      setPageCount(0);
      showLoadError(ul);
      return;
    }

    if (!pagesRes.ok) {
      if (ul) ul.innerHTML = '';
      setPageCount(0);
      showLoadError(ul);
      return;
    }

    var pagesData;
    try {
      pagesData = await pagesRes.json();
    } catch (_err) {
      if (ul) ul.innerHTML = '';
      setPageCount(0);
      showLoadError(ul);
      return;
    }

    var list = pagesData.pages || [];
    setPageCount(list.length);

    if (ul) {
      ul.innerHTML = '';
      for (var i = 0; i < list.length; i++) {
        ul.appendChild(renderRow(list[i]));
      }
      renderLoadMore(pagesData.cursor, ul);
    }
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
      var ul0 = document.getElementById('page-list');
      if (ul0) ul0.innerHTML = '';
      setPageCount(0);
      showLoadError(ul0);
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

    await loadPages();

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
