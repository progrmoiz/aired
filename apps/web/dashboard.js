/* aired — dashboard page logic (vanilla JS, no framework) */

(function () {
  'use strict';

  // ── Relative time helper ──
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

  // ── Row renderer ──
  function renderRow(page) {
    var li = document.createElement('li');
    li.className = 'flex items-center gap-3 min-h-[44px] py-3';
    li.setAttribute('data-page-id', page.id);

    // Left: title + id
    var info = document.createElement('div');
    info.className = 'flex-1 min-w-0';

    var titleEl = document.createElement('div');
    titleEl.className = 'text-sm text-aired-text-primary truncate';
    titleEl.textContent = page.title || page.id;

    var metaEl = document.createElement('div');
    metaEl.className = 'flex items-center gap-2 mt-0.5';

    var idSpan = document.createElement('span');
    idSpan.className = 'font-mono text-xs text-aired-text-tertiary';
    idSpan.textContent = page.id;

    var ageSpan = document.createElement('span');
    ageSpan.className = 'text-xs text-aired-text-tertiary';
    ageSpan.textContent = relativeAge(page.createdAt);

    metaEl.appendChild(idSpan);
    if (page.createdAt) {
      var dot = document.createElement('span');
      dot.className = 'text-aired-text-tertiary';
      dot.textContent = '·';
      dot.setAttribute('aria-hidden', 'true');
      metaEl.appendChild(dot);
      metaEl.appendChild(ageSpan);
    }

    info.appendChild(titleEl);
    info.appendChild(metaEl);

    // Views count (from PageMetadata.readCount)
    var viewsEl = document.createElement('span');
    viewsEl.className = 'text-xs text-aired-text-tertiary tabular-nums flex-shrink-0';
    var viewCount = typeof page.readCount === 'number' ? page.readCount : 0;
    viewsEl.textContent = viewCount + (viewCount === 1 ? ' view' : ' views');

    // Copy button
    var copyBtn = document.createElement('button');
    copyBtn.type = 'button';
    copyBtn.className = 'row-action-btn flex-shrink-0 text-xs text-aired-text-tertiary hover:text-aired-text-primary focus-ring rounded-sm px-1.5 py-1';
    copyBtn.setAttribute('aria-label', 'Copy page URL');
    copyBtn.textContent = 'Copy';

    copyBtn.addEventListener('click', function () {
      var url = 'https://aired.sh/p/' + page.id;
      navigator.clipboard.writeText(url).then(function () {
        copyBtn.textContent = 'Copied';
        setTimeout(function () {
          copyBtn.textContent = 'Copy';
        }, 1800);
      }).catch(function () {
        // Fallback for browsers without clipboard API
        var ta = document.createElement('textarea');
        ta.value = url;
        ta.style.position = 'fixed';
        ta.style.left = '-9999px';
        document.body.appendChild(ta);
        ta.select();
        document.execCommand('copy');
        document.body.removeChild(ta);
        copyBtn.textContent = 'Copied';
        setTimeout(function () {
          copyBtn.textContent = 'Copy';
        }, 1800);
      });
    });

    // Delete button (inline confirm pattern)
    var deleteBtn = document.createElement('button');
    deleteBtn.type = 'button';
    deleteBtn.className = 'row-action-btn flex-shrink-0 text-xs text-aired-text-tertiary hover:text-aired-text-primary focus-ring rounded-sm px-1.5 py-1';
    deleteBtn.setAttribute('aria-label', 'Delete page');
    deleteBtn.textContent = 'Delete';

    var deleteTimer = null;
    var deleteState = 'idle'; // idle | confirm | deleting

    function revertDelete() {
      deleteState = 'idle';
      if (deleteTimer) { clearTimeout(deleteTimer); deleteTimer = null; }
      deleteBtn.textContent = 'Delete';
      deleteBtn.className = 'row-action-btn flex-shrink-0 text-xs text-aired-text-tertiary hover:text-aired-text-primary focus-ring rounded-sm px-1.5 py-1';
      deleteBtn.disabled = false;
    }

    deleteBtn.addEventListener('click', function () {
      if (deleteState === 'idle') {
        deleteState = 'confirm';
        deleteBtn.textContent = 'Confirm delete';
        deleteBtn.className = 'row-action-btn flex-shrink-0 text-xs text-aired-text-secondary focus-ring rounded-sm px-1.5 py-1';
        deleteTimer = setTimeout(revertDelete, 3000);
      } else if (deleteState === 'confirm') {
        if (deleteTimer) { clearTimeout(deleteTimer); deleteTimer = null; }
        deleteState = 'deleting';
        deleteBtn.disabled = true;
        deleteBtn.textContent = 'Deleting…';
        deleteBtn.className = 'row-action-btn flex-shrink-0 text-xs text-aired-text-tertiary focus-ring rounded-sm px-1.5 py-1 opacity-50 cursor-not-allowed';

        fetch('/api/pages/' + page.id, {
          method: 'DELETE',
          headers: { 'X-Aired-Request': '1' },
          credentials: 'same-origin',
        }).then(function (res) {
          if (res.ok) {
            li.remove();
            // Update count
            updatePageCount(-1);
          } else {
            revertDelete();
          }
        }).catch(function () {
          revertDelete();
        });
      }
    });

    li.appendChild(info);
    li.appendChild(viewsEl);
    li.appendChild(copyBtn);
    li.appendChild(deleteBtn);

    return li;
  }

  // ── Page count tracker ──
  var currentPageCount = 0;

  function setPageCount(n) {
    currentPageCount = n;
    renderPageCount();
  }

  function updatePageCount(delta) {
    currentPageCount = Math.max(0, currentPageCount + delta);
    renderPageCount();
  }

  function renderPageCount() {
    var countEl = document.querySelector('header p');
    if (countEl) {
      countEl.textContent = currentPageCount + ' page' + (currentPageCount === 1 ? '' : 's');
    }
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
          var row = renderRow(list[i]);
          ul.appendChild(row);
        }
        // Replace cursor button
        btn.remove();
        renderLoadMore(data.cursor, ul);
      }).catch(function () {
        btn.textContent = 'Load more';
        btn.disabled = false;
      });
    });

    ul.parentNode.insertBefore(btn, ul.nextSibling);
  }

  // ── Main init ──
  document.addEventListener('DOMContentLoaded', function () {
    init();
  });

  async function init() {
    // 1. Fetch current user
    var meRes;
    try {
      meRes = await fetch('/api/me', { credentials: 'same-origin' });
    } catch (err) {
      console.error('Failed to reach /api/me:', err);
      return;
    }

    if (meRes.status === 401) {
      window.location.href = '/auth/github?return=/dashboard';
      return;
    }

    var user;
    try {
      user = await meRes.json();
    } catch (err) {
      console.error('Failed to parse /api/me response:', err);
      return;
    }

    // Update handle
    var h1 = document.querySelector('h1');
    if (h1) h1.textContent = '@' + user.login;

    // 2. Fetch pages
    var pagesRes;
    try {
      pagesRes = await fetch('/api/me/pages', { credentials: 'same-origin' });
    } catch (err) {
      console.error('Failed to reach /api/me/pages:', err);
      var ul = document.getElementById('page-list');
      if (ul) ul.innerHTML = '';
      setPageCount(0);
      return;
    }

    var ul = document.getElementById('page-list');

    if (!pagesRes.ok) {
      if (ul) {
        ul.innerHTML = '';
        var errP = document.createElement('p');
        errP.className = 'text-sm text-aired-text-secondary';
        errP.textContent = 'Could not load. Try again.';
        ul.parentNode.insertBefore(errP, ul.nextSibling);
      }
      setPageCount(0);
      return;
    }

    var pagesData;
    try {
      pagesData = await pagesRes.json();
    } catch (err) {
      console.error('Failed to parse /api/me/pages response:', err);
      if (ul) ul.innerHTML = '';
      setPageCount(0);
      return;
    }

    var list = pagesData.pages || [];

    // Update count
    setPageCount(list.length);

    // Clear skeleton, render rows
    if (ul) {
      ul.innerHTML = '';
      for (var i = 0; i < list.length; i++) {
        var row = renderRow(list[i]);
        ul.appendChild(row);
      }
      // Pagination
      renderLoadMore(pagesData.cursor, ul);
    }

    // 3. Sign-out handler
    var signOutLink = document.getElementById('sign-out');
    if (signOutLink) {
      signOutLink.addEventListener('click', function (e) {
        e.preventDefault();
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
