/*
 * Dashboard: API keys panel. Self-contained: it fills <section id="api-keys">,
 * uses only /api/me/keys, and brings its own scoped styles (ak-*), so it looks
 * the same whichever stylesheet the dashboard loads and dashboard.js and the
 * page layout can change around it. Builds every element with textContent
 * (names are user input).
 */
(function () {
  'use strict';

  var root = document.getElementById('api-keys');
  if (!root) return;

  // Scoped styles, injected once. Colours are the DESIGN.md tokens.
  if (!document.getElementById('ak-style')) {
    var css = document.createElement('style');
    css.id = 'ak-style';
    css.textContent = [
      '#api-keys{margin-top:28px}',
      '#api-keys.panel{padding:20px 24px}',
      '@media (max-width:560px){#api-keys.panel{padding:16px}}',
      '#api-keys .ak-hidden{display:none}',
      '#api-keys .ak-sr{position:absolute;width:1px;height:1px;padding:0;margin:-1px;overflow:hidden;clip:rect(0,0,0,0);white-space:nowrap;border:0}',
      '#api-keys .ak-h{font-size:14px;line-height:20px;color:#ededef;font-weight:400}',
      '#api-keys .ak-hint{margin-top:2px;font-size:12px;line-height:16px;color:#84848a}',
      '#api-keys .ak-code,#api-keys .ak-key,#api-keys .ak-prefix{font-family:"JetBrains Mono",ui-monospace,Menlo,monospace}',
      '#api-keys .ak-code{color:#ededef}',
      '#api-keys .ak-form,#api-keys .ak-row{display:flex;flex-wrap:wrap;align-items:center;gap:12px}',
      '#api-keys .ak-form{margin-top:12px}',
      '#api-keys .ak-row{margin-top:8px}',
      '#api-keys .ak-input{flex:1;min-width:0;border-radius:6px;padding:8px 12px;font:inherit;font-size:14px;color:#ededef;background:#0a0a0b;border:1px solid #222225}',
      '#api-keys .ak-input::placeholder{color:#84848a}',
      '#api-keys .ak-btn{flex-shrink:0;border-radius:6px;padding:8px 12px;font:inherit;font-size:14px;cursor:pointer;transition:background-color 120ms,border-color 120ms,color 120ms,opacity 120ms}',
      '#api-keys .ak-btn:disabled,#api-keys .ak-input:disabled{opacity:.5;cursor:not-allowed}',
      '#api-keys .ak-btn-primary{background:#ededef;color:#0a0a0b;border:0;font-weight:500}',
      '#api-keys .ak-btn-primary:hover:not(:disabled){background:#fff}',
      '#api-keys .ak-btn-secondary{background:#0a0a0b;color:#a1a1a6;border:1px solid #222225}',
      '#api-keys .ak-btn-secondary:hover:not(:disabled){color:#ededef;border-color:#34343a;background:#18181b}',
      '#api-keys .ak-link{background:none;border:0;border-radius:4px;padding:4px 6px;font:inherit;font-size:12px;color:#a1a1a6;cursor:pointer}',
      '#api-keys .ak-link:hover:not(:disabled){color:#ededef}',
      '#api-keys .ak-btn:focus-visible,#api-keys .ak-link:focus-visible,#api-keys .ak-input:focus-visible,#api-keys .ak-h:focus-visible{outline:2px solid #7c6aef;outline-offset:2px}',
      '#api-keys .ak-error{margin-top:8px;font-size:12px;color:#f87171}',
      '#api-keys .ak-reveal{margin-top:16px;border-radius:8px;border:1px solid #222225;background:#0a0a0b;padding:12px 16px}',
      '#api-keys .ak-text{font-size:14px;color:#ededef}',
      '#api-keys .ak-key{flex:1;min-width:0;font-size:12px;color:#ededef;word-break:break-all}',
      '#api-keys .ak-list{margin-top:12px;padding:0;list-style:none}',
      '#api-keys .ak-item{display:flex;align-items:center;gap:12px;min-height:44px;padding:12px 0;border-top:1px solid #222225}',
      '#api-keys .ak-item:first-child{border-top:0}',
      '#api-keys .ak-info{flex:1;min-width:0}',
      '#api-keys .ak-name{display:block;font-size:14px;color:#ededef;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
      '#api-keys .ak-meta{display:flex;flex-wrap:wrap;align-items:center;gap:8px;margin-top:2px;font-size:12px;color:#84848a}',
      '#api-keys .ak-empty{padding:12px 0;font-size:14px;color:#a1a1a6}',
      '@media (prefers-reduced-motion:reduce){#api-keys .ak-btn{transition:none}}'
    ].join('\n');
    document.head.appendChild(css);
  }
  var PRIMARY = 'ak-btn ak-btn-primary';
  var SECONDARY = 'ak-btn ak-btn-secondary';
  var SMALL = 'ak-link';

  var state = { keys: [], max: 5, busy: false };

  function el(tag, className, text) {
    var node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    // 44px touch targets for every button.
    if (tag === 'button') node.style.minHeight = '44px';
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

  var header = el('div', '');
  var heading = el('h2', 'ak-h', 'API keys');
  heading.tabIndex = -1; // focus lands here when there's nothing else to focus
  header.appendChild(heading);
  var hint = el('p', 'ak-hint');
  hint.appendChild(document.createTextNode('For CI and agents. Set '));
  hint.appendChild(el('code', 'ak-code', 'AIRED_API_KEY'));
  hint.appendChild(document.createTextNode(' and pages publish to this account.'));
  header.appendChild(hint);

  var form = el('form', 'ak-form');
  var label = el('label', 'ak-sr', 'Key name');
  label.htmlFor = 'api-key-name';
  var input = el('input', 'ak-input');
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

  var error = el('p', 'ak-error ak-hidden');
  error.setAttribute('role', 'alert');

  // Shown once, right after a key is created.
  var reveal = el('div', 'ak-reveal ak-hidden');
  var revealText = el('p', 'ak-text', 'Copy this key now. You won’t be able to see it again.');
  var revealRow = el('div', 'ak-row');
  // The whole key stays visible (wraps), so it can be checked or copied by hand.
  var revealKey = el('code', 'ak-key');
  var copy = el('button', SECONDARY, 'Copy');
  copy.type = 'button';
  var done = el('button', SECONDARY, 'Done');
  done.type = 'button';
  revealRow.appendChild(revealKey);
  revealRow.appendChild(copy);
  revealRow.appendChild(done);
  reveal.appendChild(revealText);
  reveal.appendChild(revealRow);

  var list = el('ul', 'ak-list');
  list.setAttribute('aria-label', 'Your API keys');
  var empty = el('p', 'ak-empty ak-hidden', 'No keys yet.');
  var status = el('div', 'ak-sr');
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
    error.classList.toggle('ak-hidden', !text);
  }

  function announce(text) {
    status.textContent = text;
  }

  function render() {
    list.textContent = '';
    state.keys.forEach(function (key) {
      var li = el('li', 'ak-item');
      var info = el('div', 'ak-info');
      info.appendChild(el('span', 'ak-name', key.name));
      var meta = el('span', 'ak-meta');
      meta.appendChild(el('span', 'ak-prefix', key.prefix + '…'));
      meta.appendChild(el('span', '', 'created ' + when(key.createdAt) + ' · last used ' + when(key.lastUsedAt)));
      info.appendChild(meta);
      li.appendChild(info);
      li.appendChild(revokeButton(key));
      list.appendChild(li);
    });
    empty.classList.toggle('ak-hidden', state.keys.length > 0);
    var full = state.keys.length >= state.max;
    create.disabled = state.busy || full;
    input.disabled = full;
    input.placeholder = full ? 'You have ' + state.max + ' keys. Revoke one to add another.' : 'Name, e.g. GitHub Actions';
  }

  // Two clicks: "Revoke" arms it, "Confirm revoke" does it. It disarms when
  // focus leaves the button or after 10 seconds, and both steps are announced.
  function revokeButton(key) {
    var btn = el('button', SMALL, 'Revoke');
    btn.type = 'button';
    btn.setAttribute('aria-label', 'Revoke key ' + key.name);
    var armed = null;
    function disarm() {
      if (armed) clearTimeout(armed);
      armed = null;
      btn.textContent = 'Revoke';
      btn.setAttribute('aria-label', 'Revoke key ' + key.name);
    }
    btn.addEventListener('blur', function () { if (armed) disarm(); });
    btn.addEventListener('click', function () {
      if (!armed) {
        btn.textContent = 'Confirm revoke';
        btn.setAttribute('aria-label', 'Confirm revoke key ' + key.name);
        announce('Press again to revoke ' + key.name + '. Anything using it stops working.');
        armed = setTimeout(disarm, 10000);
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
        focusSomething();
      }).catch(function (err) {
        btn.disabled = false;
        disarm();
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
      reveal.classList.remove('ak-hidden');
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

  // After a row or the reveal box goes away: the name field, else the first
  // Revoke button, else the heading.
  function focusSomething() {
    if (!input.disabled) return input.focus();
    var first = list.querySelector('button');
    (first || heading).focus();
  }

  // Forget the key once it's dismissed: it's never shown again.
  done.addEventListener('click', function () {
    revealKey.textContent = '';
    copy.textContent = 'Copy';
    reveal.classList.add('ak-hidden');
    focusSomething();
  });

  // Signed in with a session: show the panel. Anything else keeps it hidden.
  // Signed out (401) or signed in with a key (403): stay hidden. A server or
  // network error shows the panel with the error, so a leaked key can't be
  // hidden by an outage without the person knowing.
  request('GET', '/api/me/keys').then(function (res) {
    if (res.status === 401 || res.status === 403) return;
    if (!res.ok) {
      showError(res.data.error || 'Could not load your keys. Reload to try again.');
      form.classList.add('ak-hidden');
      root.classList.remove('hidden');
      return;
    }
    state.keys = Array.isArray(res.data.keys) ? res.data.keys : [];
    if (typeof res.data.max === 'number') state.max = res.data.max;
    render();
    root.classList.remove('hidden');
  }).catch(function () {
    showError('Could not load your keys. Check your connection and reload.');
    form.classList.add('ak-hidden');
    root.classList.remove('hidden');
  });
})();
