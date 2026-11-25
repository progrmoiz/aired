/*
 * Dashboard: API keys panel. Self-contained: it fills <section id="api-keys">
 * and uses only /api/me/keys, so dashboard.js and the page layout can change
 * around it. Builds every element with textContent (names are user input).
 * Uses only classes already in style.css, so no Tailwind rebuild is needed.
 */
(function () {
  'use strict';

  var root = document.getElementById('api-keys');
  if (!root) return;

  var PRIMARY = 'plan-btn plan-btn-primary flex-shrink-0 rounded px-3 py-2 text-sm font-medium bg-aired-text-primary text-aired-bg focus-ring';
  var SECONDARY = 'plan-btn flex-shrink-0 rounded px-3 py-2 text-sm border border-aired-border bg-aired-bg text-aired-text-secondary hover:text-aired-text-primary hover:border-aired-border-focus hover:bg-aired-surface-hover active:bg-aired-border focus-ring';
  var SMALL = 'text-xs text-aired-text-secondary hover:text-aired-text-primary transition-colors duration-150 focus-ring rounded-sm px-1.5 py-1';

  var state = { keys: [], max: 5, busy: false };

  function el(tag, className, text) {
    var node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  }

  function when(ms) {
    if (!ms) return 'never';
    var d = new Date(ms);
    return isNaN(d.getTime()) ? '' : d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
  }

  function request(method, path, body) {
    var opts = { method: method, credentials: 'same-origin', headers: {} };
    if (method !== 'GET') opts.headers['X-Aired-Request'] = '1';
    if (body !== undefined) {
      opts.headers['Content-Type'] = 'application/json';
      opts.body = JSON.stringify(body);
    }
    return fetch(path, opts).then(function (res) {
      return res.json().catch(function () { return {}; }).then(function (data) {
        return { ok: res.ok, status: res.status, data: data || {} };
      });
    });
  }

  // --- elements ---------------------------------------------------------------

  var header = el('div', 'min-w-0');
  header.appendChild(el('h2', 'text-sm text-aired-text-primary', 'API keys'));
  var hint = el('p', 'text-xs text-aired-text-tertiary mt-0.5');
  hint.appendChild(document.createTextNode('For CI and agents. Set '));
  hint.appendChild(el('code', 'font-mono text-aired-text-primary', 'AIRED_API_KEY'));
  hint.appendChild(document.createTextNode(' and pages publish to this account.'));
  header.appendChild(hint);

  var form = el('form', 'mt-3 flex flex-wrap items-center gap-3');
  var label = el('label', 'sr-only', 'Key name');
  label.htmlFor = 'api-key-name';
  var input = el('input', 'flex-1 min-w-0 rounded px-3 py-2 text-sm border border-aired-border bg-aired-bg text-aired-text-primary focus-ring');
  input.id = 'api-key-name';
  input.type = 'text';
  input.maxLength = 60;
  input.placeholder = 'Name, e.g. GitHub Actions';
  input.autocomplete = 'off';
  var create = el('button', PRIMARY, 'Create key');
  create.type = 'submit';
  form.appendChild(label);
  form.appendChild(input);
  form.appendChild(create);

  var error = el('p', 'hidden mt-2 text-xs text-red-400');
  error.setAttribute('role', 'alert');

  // Shown once, right after a key is created.
  var reveal = el('div', 'hidden mt-4 rounded-lg border border-aired-border bg-aired-surface px-4 py-3');
  var revealText = el('p', 'text-sm text-aired-text-primary', 'Copy this key now. You won’t be able to see it again.');
  var revealRow = el('div', 'mt-2 flex flex-wrap items-center gap-3');
  var revealKey = el('code', 'flex-1 min-w-0 font-mono text-xs text-aired-text-primary truncate');
  var copy = el('button', SECONDARY, 'Copy');
  copy.type = 'button';
  var done = el('button', SECONDARY, 'Done');
  done.type = 'button';
  revealRow.appendChild(revealKey);
  revealRow.appendChild(copy);
  revealRow.appendChild(done);
  reveal.appendChild(revealText);
  reveal.appendChild(revealRow);

  var list = el('ul', 'mt-3 divide-y divide-aired-border');
  list.setAttribute('aria-label', 'Your API keys');
  var empty = el('p', 'hidden text-sm text-aired-text-secondary py-3', 'No keys yet.');
  var status = el('div', 'sr-only');
  status.setAttribute('role', 'status');
  status.setAttribute('aria-live', 'polite');

  root.appendChild(header);
  root.appendChild(form);
  root.appendChild(error);
  root.appendChild(reveal);
  root.appendChild(list);
  root.appendChild(empty);
  root.appendChild(status);

  // --- behaviour ----------------------------------------------------------------

  function showError(text) {
    error.textContent = text || '';
    error.classList.toggle('hidden', !text);
  }

  function announce(text) {
    status.textContent = text;
  }

  function render() {
    list.textContent = '';
    state.keys.forEach(function (key) {
      var li = el('li', 'flex items-center gap-3 min-h-[44px] py-3');
      var info = el('div', 'flex-1 min-w-0');
      info.appendChild(el('span', 'block text-sm text-aired-text-primary truncate', key.name));
      var meta = el('span', 'flex items-center gap-2 mt-0.5');
      meta.appendChild(el('span', 'font-mono text-xs text-aired-text-tertiary', key.prefix + '…'));
      meta.appendChild(el('span', 'text-xs text-aired-text-tertiary', 'created ' + when(key.createdAt) + ' · last used ' + when(key.lastUsedAt)));
      info.appendChild(meta);
      li.appendChild(info);
      li.appendChild(revokeButton(key));
      list.appendChild(li);
    });
    empty.classList.toggle('hidden', state.keys.length > 0);
    var full = state.keys.length >= state.max;
    create.disabled = state.busy || full;
    input.disabled = full;
    input.placeholder = full ? 'You have ' + state.max + ' keys. Revoke one to add another.' : 'Name, e.g. GitHub Actions';
  }

  // Two clicks: "Revoke" arms it for a few seconds, "Confirm revoke" does it.
  function revokeButton(key) {
    var btn = el('button', SMALL, 'Revoke');
    btn.type = 'button';
    btn.setAttribute('aria-label', 'Revoke key ' + key.name);
    var armed = null;
    btn.addEventListener('click', function () {
      if (!armed) {
        btn.textContent = 'Confirm revoke';
        armed = setTimeout(function () { armed = null; btn.textContent = 'Revoke'; }, 4000);
        return;
      }
      clearTimeout(armed);
      armed = null;
      btn.disabled = true;
      btn.textContent = 'Revoking…';
      request('DELETE', '/api/me/keys/' + encodeURIComponent(key.id)).then(function (res) {
        if (!res.ok && res.status !== 404) throw new Error(res.data.error || 'Could not revoke the key.');
        state.keys = state.keys.filter(function (k) { return k.id !== key.id; });
        showError('');
        render();
        announce('Revoked ' + key.name);
      }).catch(function (err) {
        btn.disabled = false;
        btn.textContent = 'Revoke';
        showError(err.message || 'Could not revoke the key.');
      });
    });
    return btn;
  }

  form.addEventListener('submit', function (e) {
    e.preventDefault();
    var name = input.value.trim();
    if (!name) {
      showError('Give the key a name.');
      input.focus();
      return;
    }
    state.busy = true;
    create.textContent = 'Creating…';
    render();
    request('POST', '/api/me/keys', { name: name }).then(function (res) {
      if (!res.ok) throw new Error(res.data.error || 'Could not create the key.');
      state.keys.unshift({ id: res.data.id, name: res.data.name, prefix: res.data.prefix, createdAt: res.data.createdAt, lastUsedAt: null });
      input.value = '';
      showError('');
      revealKey.textContent = res.data.key;
      reveal.classList.remove('hidden');
      copy.focus();
      announce('Created ' + res.data.name + '. Copy the key now.');
    }).catch(function (err) {
      showError(err.message || 'Could not create the key.');
    }).then(function () {
      state.busy = false;
      create.textContent = 'Create key';
      render();
    });
  });

  copy.addEventListener('click', function () {
    var text = revealKey.textContent;
    var finish = function () { copy.textContent = 'Copied'; announce('Key copied'); };
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(finish, function () { showError('Copy failed. Select the key and copy it by hand.'); });
    } else {
      showError('Copy failed. Select the key and copy it by hand.');
    }
  });

  // Forget the key once it's dismissed: it's never shown again.
  done.addEventListener('click', function () {
    revealKey.textContent = '';
    copy.textContent = 'Copy';
    reveal.classList.add('hidden');
    input.focus();
  });

  // Signed in with a session: show the panel. Anything else keeps it hidden.
  request('GET', '/api/me/keys').then(function (res) {
    if (!res.ok) return;
    state.keys = Array.isArray(res.data.keys) ? res.data.keys : [];
    if (typeof res.data.max === 'number') state.max = res.data.max;
    render();
    root.classList.remove('hidden');
  }).catch(function () { /* the panel stays hidden */ });
})();
