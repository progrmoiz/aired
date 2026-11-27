/* aired — client-side form logic (vanilla JS, no framework) */

(function () {
  "use strict";

  // ── Elements ──
  const form = document.getElementById("air-form");
  if (form) initForm();
  initShared();
  initAgentMenu();
  initMotion();

  function initForm() {
  const htmlInput = document.getElementById("html-input");
  const fileInput = document.getElementById("file-input");
  const uploadBtn = document.getElementById("upload-btn");
  const ttlSelect = document.getElementById("ttl-select");
  const pinInput = document.getElementById("pin-input");
  const submitBtn = document.getElementById("submit-btn");
  const charCount = document.getElementById("char-count");
  const errorMsg = document.getElementById("error-msg");
  const resultCard = document.getElementById("result-card");
  const resultUrl = document.getElementById("result-url");
  const copyUrlBtn = document.getElementById("copy-url-btn");
  const resultToken = document.getElementById("result-token");
  const copyTokenBtn = document.getElementById("copy-token-btn");
  const resultExpiry = document.getElementById("result-expiry");
  const savedRow = document.getElementById("result-saved");
  const newBtn = document.getElementById("new-btn");
  const pasteArea = document.querySelector(".paste-area");
  const dragHint = document.querySelector(".drag-hint");

  // ── State ──
  let currentUrl = "";
  let currentToken = "";

  // ── Char count ──
  const emptyHint = document.getElementById("empty-hint");

  function updateCharCount() {
    const len = htmlInput.value.length;
    if (emptyHint) emptyHint.style.opacity = len === 0 ? "1" : "0";
    const kb = (len / 1024).toFixed(1);
    charCount.textContent = len === 0 ? "" : len < 1024 ? `${len} B` : `${kb} KB`;
    submitBtn.disabled = len === 0;
  }

  htmlInput.addEventListener("input", updateCharCount);
  updateCharCount();

  // ── File upload ──
  uploadBtn.addEventListener("click", () => fileInput.click());

  fileInput.addEventListener("change", (e) => {
    const file = e.target.files[0];
    if (!file) return;
    readFileAsText(file);
    fileInput.value = ""; // reset so same file can be re-uploaded
  });

  // A dropped .md file publishes as Markdown (a readable page, or slides with
  // `type: deck`); so does pasted text with no HTML tags that reads as Markdown.
  let fromMarkdownFile = false;
  function looksLikeMarkdown(text) {
    if (fromMarkdownFile) return true;
    if (/<[a-zA-Z!/][^>]*>/.test(text)) return false;
    return /^(---\s*\n|#{1,6}\s|[-*+]\s|\d+\.\s|>\s|```)/m.test(text);
  }

  function readFileAsText(file) {
    fromMarkdownFile = /\.(md|markdown|mdown|mkd)$/i.test(file.name || "");
    if (file.size > 2 * 1024 * 1024) {
      showError("File too large. Maximum size is 2 MB.");
      return;
    }
    const reader = new FileReader();
    reader.onload = (e) => {
      htmlInput.value = e.target.result;
      updateCharCount();
      htmlInput.focus();
    };
    reader.onerror = () => showError("Failed to read file.");
    reader.readAsText(file);
  }

  // ── Drag and drop onto paste area ──
  pasteArea.addEventListener("dragenter", (e) => {
    e.preventDefault();
    pasteArea.classList.add("drag-over");
  });

  pasteArea.addEventListener("dragover", (e) => {
    e.preventDefault();
  });

  pasteArea.addEventListener("dragleave", (e) => {
    if (!pasteArea.contains(e.relatedTarget)) {
      pasteArea.classList.remove("drag-over");
    }
  });

  pasteArea.addEventListener("drop", (e) => {
    e.preventDefault();
    pasteArea.classList.remove("drag-over");
    const file = e.dataTransfer.files[0];
    if (file) {
      readFileAsText(file);
    } else {
      // Maybe they dropped text
      const text = e.dataTransfer.getData("text");
      if (text) {
        fromMarkdownFile = false;
        htmlInput.value = text;
        updateCharCount();
      }
    }
  });

  // ── TTL mapping ──
  const TTL_MAP = {
    "3600": 3600,
    "86400": 86400,
    "604800": 604800,
    "2592000": 2592000,
    "permanent": null,
  };

  // ── Submit ──
  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    hideError();

    const html = htmlInput.value.trim();
    if (!html) return;

    const ttlValue = ttlSelect.value;
    const pin = pinInput.value.trim() || undefined;
    const ttlSeconds = TTL_MAP[ttlValue];
    const permanent = ttlValue === "permanent";

    setLoading(true);

    try {
      const body = looksLikeMarkdown(html) ? { markdown: html } : { html };
      if (pin) body.pin = pin;
      if (permanent) {
        body.permanent = true;
      } else if (ttlSeconds != null) {
        body.ttl = ttlSeconds;
      }

      const res = await fetch("/api/publish", {
        method: "POST",
        // Signed-in browsers must send it (the API's CSRF check).
        headers: { "Content-Type": "application/json", "X-Aired-Request": "1" },
        body: JSON.stringify(body),
      });

      const data = await res.json();

      if (!res.ok) {
        showError(data.error || `Error ${res.status}`);
        return;
      }

      currentUrl = data.url;
      currentToken = data.update_token || "";
      showResult(data);
      rememberPublish(data, html);
    } catch (err) {
      showError(err.message || "Network error. Please try again.");
    } finally {
      setLoading(false);
    }
  });

  // ── Result display ──
  function showResult(data) {
    // Populate
    if (savedRow) savedRow.classList.add("hidden");
    resultUrl.href = data.url;
    resultUrl.textContent = data.url;
    resultToken.textContent = data.update_token || "";

    if (data.expiresAt && data.expiresAt !== null) {
      const d = new Date(data.expiresAt);
      resultExpiry.textContent = `Expires ${formatDate(d)}`;
    } else {
      resultExpiry.textContent = "No expiry";
    }

    // Show with animation
    resultCard.style.display = "flex";
    // Trigger transition on next frame
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        resultCard.style.opacity = "1";
        resultCard.style.transform = "translateY(0)";
      });
    });

    // Scroll to result
    resultCard.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }

  // ── Keep the update token in this browser for signed-out publishers ──
  var PAGES_KEY = "aired.pages";
  var PAGES_CAP = 200;

  function pageIdFrom(data) {
    if (data && typeof data.id === "string" && data.id) return data.id;
    try {
      var m = new URL(data.url, location.href).pathname.match(/^\/p\/([^/]+)\/?$/);
      return m ? decodeURIComponent(m[1]) : "";
    } catch (e) { return ""; }
  }

  function pageTitleFrom(html) {
    var m = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(html || "");
    return m ? m[1].replace(/\s+/g, " ").trim().slice(0, 120) : "";
  }

  function isSignedIn() {
    return fetch("/api/me", { credentials: "same-origin" })
      .then(function (res) { return res.status === 200; })
      .catch(function () { return false; });
  }

  function rememberPublish(data, html) {
    var id = pageIdFrom(data);
    var token = data.update_token || "";
    isSignedIn().then(function (signedIn) {
      // Signed-in publishers' pages are already owned; nothing to keep.
      if (signedIn || !savedRow) return;
      if (!id || !token) return;
      try {
        var list = [];
        try {
          var parsed = JSON.parse(localStorage.getItem(PAGES_KEY) || "[]");
          if (Array.isArray(parsed)) list = parsed;
        } catch (e) { list = []; }
        list = list.filter(function (p) { return p && p.id !== id; });
        list.unshift({
          id: id,
          token: token,
          title: pageTitleFrom(html),
          url: data.url,
          createdAt: new Date().toISOString(),
        });
        localStorage.setItem(PAGES_KEY, JSON.stringify(list.slice(0, PAGES_CAP)));
        savedRow.classList.remove("hidden");
      } catch (e) { /* private mode or quota: publishing already succeeded */ }
    });
  }

  function hideResult() {
    resultCard.style.opacity = "0";
    resultCard.style.transform = "translateY(8px)";
    setTimeout(() => {
      resultCard.style.display = "none";
    }, 250);
  }

  // ── Copy buttons ──
  copyUrlBtn.addEventListener("click", () => {
    copyToClipboard(resultUrl.href || currentUrl, copyUrlBtn);
  });

  copyTokenBtn.addEventListener("click", () => {
    copyToClipboard(resultToken.textContent, copyTokenBtn);
  });

  function copyToClipboard(text, btn) {
    if (!text) return;
    navigator.clipboard.writeText(text).then(() => {
      btn.textContent = "Copied";
      btn.classList.add("copied");
      setTimeout(() => {
        btn.textContent = "Copy";
        btn.classList.remove("copied");
      }, 2000);
    }).catch(() => {
      // Fallback for older browsers
      const ta = document.createElement("textarea");
      ta.value = text;
      ta.style.position = "fixed";
      ta.style.left = "-9999px";
      document.body.appendChild(ta);
      ta.select();
      document.execCommand("copy");
      document.body.removeChild(ta);
      btn.textContent = "Copied";
      btn.classList.add("copied");
      setTimeout(() => {
        btn.textContent = "Copy";
        btn.classList.remove("copied");
      }, 2000);
    });
  }

  // ── New / reset ──
  newBtn.addEventListener("click", () => {
    hideResult();
    htmlInput.value = "";
    fromMarkdownFile = false;
    pinInput.value = "";
    ttlSelect.value = "604800";
    updateCharCount();
    currentUrl = "";
    currentToken = "";
    htmlInput.focus();
  });

  // ── Error helpers ──
  function showError(msg) {
    errorMsg.textContent = msg;
    errorMsg.classList.remove("hidden");
  }

  function hideError() {
    errorMsg.classList.add("hidden");
    errorMsg.textContent = "";
  }

  // ── Loading state ──
  function setLoading(on) {
    submitBtn.disabled = on;
    if (on) {
      submitBtn.textContent = "Publishing…";
      submitBtn.classList.add("loading");
    } else {
      submitBtn.textContent = "Publish";
      submitBtn.classList.remove("loading");
      submitBtn.disabled = htmlInput.value.trim().length === 0;
    }
  }

  // ── Date formatting ──
  function formatDate(d) {
    return d.toLocaleDateString("en-US", {
      month: "long",
      day: "numeric",
      year: "numeric",
    });
  }

  // ── Initial state: hide result card ──
  resultCard.style.display = "none";
  resultCard.style.opacity = "0";
  resultCard.style.transform = "translateY(8px)";
  resultCard.style.transition = "opacity 0.25s ease, transform 0.25s ease";
  }

  function initShared() {
    // ── Nav: "Log in" becomes the signed-in handle ──
    var navAuth = document.getElementById("nav-auth");
    if (navAuth) {
      fetch("/api/me", { credentials: "same-origin" })
        .then(function (res) { return res.status === 200 ? res.json() : null; })
        .then(function (user) {
          navAuth.classList.remove("hidden"); // guide pages start it hidden
          if (user && user.login) {
            navAuth.href = "/dashboard";
            navAuth.textContent = "@" + user.login;
          }
        })
        .catch(function () { navAuth.classList.remove("hidden"); });
    }

    // ── "On this page" contents: mark the section being read ──
    var tocLinks = Array.prototype.slice.call(document.querySelectorAll(".toc a[href^='#']"));
    if (tocLinks.length) {
      var tocTargets = tocLinks.map(function (a) {
        return { link: a, el: document.getElementById(a.getAttribute("href").slice(1)) };
      }).filter(function (t) { return t.el; });
      var tocUpdate = function () {
        var line = window.scrollY + 120;
        var current = null;
        tocTargets.forEach(function (t) {
          if (t.el.getBoundingClientRect().top + window.scrollY <= line) current = t;
        });
        tocTargets.forEach(function (t) { t.link.classList.toggle("on", t === current); });
      };
      window.addEventListener("scroll", tocUpdate, { passive: true });
      tocUpdate();
    }

    // ── "Start free" / "Publish a page" links jump to the form and focus it ──
    document.querySelectorAll("[data-publish]").forEach(function (a) {
      a.addEventListener("click", function (e) {
        var input = document.getElementById("html-input");
        if (!input) return; // no form on this page: follow the link to the homepage
        e.preventDefault();
        document.getElementById("publish").scrollIntoView({ behavior: "smooth", block: "start" });
        setTimeout(function () { input.focus({ preventScroll: true }); }, 350);
      });
    });

    // ── Live numbers ──
    if (document.querySelector("[data-stat]")) loadStats();

    function loadStats() {
      fetch("/api/stats")
        .then(function (r) { return r.json(); })
        .then(function (data) {
          var values = {
            publishes: data.publishes,
            views: data.views,
            countries: data.geo ? Object.keys(data.geo).length : 0,
          };
          document.querySelectorAll("[data-stat]").forEach(function (el) {
            var v = values[el.getAttribute("data-stat")];
            if (typeof v === "number" && v > 0) el.setAttribute("data-value", v);
            if (!el.hasAttribute("data-count") && el.getAttribute("data-value")) el.textContent = v.toLocaleString("en-US");
          });
          renderGeo(data.geo || {});
          countUpWhenSeen();
        })
        .catch(function () {}); // keep the numbers already in the markup
    }

    // Count the big numbers up from zero the first time the section is on screen.
    function countUpWhenSeen() {
      var els = document.querySelectorAll("[data-count][data-value]");
      var box = document.getElementById("nums");
      if (!els.length || !box) return;
      var reduce = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
      function finish() { els.forEach(function (el) { el.textContent = Number(el.getAttribute("data-value")).toLocaleString("en-US"); }); }
      if (reduce || !("IntersectionObserver" in window)) return finish();
      var io = new IntersectionObserver(function (entries) {
        if (!entries[0].isIntersecting) return;
        io.disconnect();
        var start = performance.now(), dur = 1200;
        (function step(now) {
          var t = Math.min(1, (now - start) / dur), e = 1 - Math.pow(1 - t, 3);
          els.forEach(function (el) { el.textContent = Math.round(Number(el.getAttribute("data-value")) * e).toLocaleString("en-US"); });
          if (t < 1) requestAnimationFrame(step);
        })(start);
      }, { threshold: 0.4 });
      io.observe(box);
    }

    var regionName = (function () {
      try { var dn = new Intl.DisplayNames(["en"], { type: "region" }); return function (cc) { try { return dn.of(cc) || cc; } catch (e) { return cc; } }; }
      catch (e) { return function (cc) { return cc; }; }
    })();

    // Top countries by opens, with a bar for each one's share.
    function renderGeo(geo) {
      var list = document.getElementById("geo");
      if (!list) return;
      var rows = Object.keys(geo).filter(function (cc) { return cc !== "XX"; })
        .map(function (cc) { return [cc, geo[cc]]; })
        .sort(function (a, b) { return b[1] - a[1]; });
      if (!rows.length) return;
      var total = rows.reduce(function (n, r) { return n + r[1]; }, 0), top = rows.slice(0, 3);
      list.innerHTML = "";
      top.forEach(function (r) {
        var li = document.createElement("li");
        li.tabIndex = 0;
        var share = r[1] / total;
        li.style.setProperty("--w", Math.max(4, Math.round(100 * r[1] / top[0][1])) + "%");
        li.title = r[1].toLocaleString("en-US") + " opens";
        var name = document.createElement("span");
        name.className = "flag";
        var img = document.createElement("img");
        img.src = "https://cdn.jsdelivr.net/gh/lipis/flag-icons@7.2.3/flags/4x3/" + r[0].toLowerCase() + ".svg";
        img.alt = "";
        img.width = 16;
        img.height = 12;
        img.loading = "lazy";
        img.onerror = function () { img.remove(); };
        name.appendChild(img);
        name.appendChild(document.createTextNode(regionName(r[0])));
        var pct = document.createElement("b");
        pct.textContent = (share < 0.01 ? "<1" : Math.round(share * 100)) + "%";
        li.addEventListener("mouseenter", function () { pct.textContent = r[1].toLocaleString("en-US"); });
        li.addEventListener("focus", function () { pct.textContent = r[1].toLocaleString("en-US"); });
        li.addEventListener("mouseleave", function () { pct.textContent = (share < 0.01 ? "<1" : Math.round(share * 100)) + "%"; });
        li.addEventListener("blur", function () { pct.textContent = (share < 0.01 ? "<1" : Math.round(share * 100)) + "%"; });
        li.appendChild(name);
        li.appendChild(pct);
        list.appendChild(li);
      });
      if (rows.length > top.length) {
        var more = document.createElement("li");
        more.className = "more";
        more.textContent = "+ " + (rows.length - top.length) + " more countries";
        list.appendChild(more);
      }
    }

    // ── Copy setup for my agent ──
    var SETUP_PROMPT = [
      "I'd like you to set up aired: HTML hosting for agents. Paste HTML, get a live URL, no signup.",
      "",
      "Install as a skill if I have npm: npx skills add progrmoiz/aired -g",
      "",
      "If not, do this instead: read https://aired.sh/llms.txt and use the HTTP API at https://aired.sh/api/publish."
    ].join("\n");
    function copyText(text, btn, done) {
      var label = btn.querySelector("span") || btn;
      var orig = label.textContent;
      function ok() {
        label.textContent = done;
        btn.classList.add("copied");
        setTimeout(function () { label.textContent = orig; btn.classList.remove("copied"); }, 2000);
      }
      if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(text).then(ok, function () { fallback(); ok(); });
      else { fallback(); ok(); }
      function fallback() {
        var ta = document.createElement("textarea");
        ta.value = text; ta.style.position = "fixed"; ta.style.left = "-9999px";
        document.body.appendChild(ta); ta.select();
        try { document.execCommand("copy"); } catch (e) {}
        document.body.removeChild(ta);
      }
    }
    document.querySelectorAll("[data-setup]").forEach(function (btn) {
      btn.addEventListener("click", function () { copyText(SETUP_PROMPT, btn, "Copied, paste it into your agent"); });
    });
    document.querySelectorAll("[data-code-copy]").forEach(function (btn) {
      btn.addEventListener("click", function () {
        var panel = document.querySelector("[data-code-panel]:not([hidden])");
        if (panel) copyText(panel.getAttribute("data-copy") || panel.textContent, btn, "Copied");
      });
    });

    // ── Code card tabs (CLI / MCP / API) ──
    var codeTabs = document.querySelectorAll("[data-code]");
    codeTabs.forEach(function (tab) {
      tab.addEventListener("click", function () {
        var target = tab.getAttribute("data-code");
        codeTabs.forEach(function (t) { t.setAttribute("aria-selected", String(t === tab)); });
        document.querySelectorAll("[data-code-panel]").forEach(function (p) {
          p.hidden = p.getAttribute("data-code-panel") !== target;
        });
      });
    });

    // ── Spotlight on feature cells ──
    document.querySelectorAll(".feat").forEach(function (f) {
      f.addEventListener("pointermove", function (e) {
        var r = f.getBoundingClientRect();
        f.style.setProperty("--x", (e.clientX - r.left) + "px");
        f.style.setProperty("--y", (e.clientY - r.top) + "px");
      });
    });

    // ── Yearly / monthly price toggle (homepage plans and /pricing) ──
    var billBtns = document.querySelectorAll("[data-bill]");
    var billMode = "y";
    billBtns.forEach(function (b) {
      b.addEventListener("click", function () {
        var mode = b.getAttribute("data-bill");
        billMode = mode;
        syncProLink();
        billBtns.forEach(function (x) {
          x.classList.toggle("on", x === b);
          x.setAttribute("aria-pressed", String(x === b));
        });
        document.querySelectorAll("[data-y][data-m]").forEach(function (el) {
          el.textContent = el.getAttribute("data-" + mode);
        });
      });
    });

    // ── Pro button: "Coming soon" until billing is on ──
    // The static HTML says "Coming soon"; this only upgrades it when the server says billing is live.
    var proGo = document.querySelector("[data-pro-go]");
    var proPlan = null; // "pro" once we know the visitor already has Pro
    function syncProLink() {
      if (!proGo || proGo.tagName !== "A" || proPlan === "pro") return;
      proGo.href = "/upgrade?interval=" + (billMode === "m" ? "month" : "year");
    }
    if (proGo) {
      fetch("/api/billing/status", { credentials: "same-origin" })
        .then(function (res) { return res.ok ? res.json() : null; })
        .then(function (status) {
          if (!status || status.enabled !== true) return;
          var a = document.createElement("a");
          a.className = proGo.className.replace(/\bsoon\b/, "").trim();
          a.setAttribute("data-pro-go", "");
          if (status.plan === "pro") {
            proPlan = "pro";
            a.href = "/dashboard";
            a.textContent = "Manage in dashboard";
          } else {
            a.textContent = "Get Pro";
          }
          proGo.replaceWith(a);
          proGo = a;
          syncProLink();
        })
        .catch(function () {}); // keep "Coming soon"
    }

    // ── Animated beam: curved path from each node to the hub ──
    var box = document.getElementById("beam");
    if (box) {
      var svg = box.querySelector("svg.lines"), hub = box.querySelector("[data-hub]"), NS = "http://www.w3.org/2000/svg";
      var draw = function () {
        svg.querySelectorAll("path").forEach(function (p) { p.remove(); });
        var b = box.getBoundingClientRect(), h = hub.getBoundingClientRect();
        var hy = h.top + h.height / 2 - b.top;
        box.querySelectorAll("[data-beam]").forEach(function (n, i) {
          var r = n.getBoundingClientRect(), left = r.left + r.width / 2 < h.left;
          var x = (left ? r.right : r.left) - b.left, y = r.top + r.height / 2 - b.top;
          var x2 = left ? h.left - b.left : h.right - b.left, mx = (x + x2) / 2;
          var d = left
            ? "M" + x + " " + y + " C" + mx + " " + y + " " + mx + " " + hy + " " + x2 + " " + hy
            : "M" + x2 + " " + hy + " C" + mx + " " + hy + " " + mx + " " + y + " " + x + " " + y;
          ["base", "pulse"].forEach(function (c) {
            var p = document.createElementNS(NS, "path");
            p.setAttribute("d", d);
            p.setAttribute("class", c);
            if (c === "pulse") p.style.animationDelay = (i * 0.4) + "s";
            svg.appendChild(p);
          });
        });
      };
      draw();
      addEventListener("resize", draw);
    }
  }

  // ── Agent menu: "Copy page" at the top of each guide and the docs ──
  // The markup is one split button (.agent[data-agent][data-task]); the menu
  // is built here. Clicks are counted by item at POST /api/site-event: page,
  // item and day only (apps/worker/src/lib/site-event.ts).
  function initAgentMenu() {
    var roots = document.querySelectorAll(".aimenu[data-agent]");
    if (!roots.length) return;
    var canonical = document.querySelector('link[rel="canonical"]');
    var pageUrl = canonical ? canonical.href : location.origin + location.pathname;
    var origin = new URL(pageUrl).origin;
    var mcpUrl = origin + "/mcp";
    var accountUrl = origin + "/mcp/account";
    var cursorConfig = btoa(JSON.stringify({ url: mcpUrl }));
    var ICON = {
      chat: '<path d="M21 12a8 8 0 0 1-11.6 7.1L4 20l1-4.6A8 8 0 1 1 21 12z"/>',
      doc: '<path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"/><path d="M14 3v5h5M9 13h6M9 17h4"/>',
      markdown: '<rect x="2" y="5" width="20" height="14" rx="2.5"/><path d="M6 15V9l2.5 3L11 9v6M16.5 9v6M14 12.5l2.5 2.5 2.5-2.5"/>',
      term: '<path d="m4 17 6-5-6-5M12 19h8"/>',
      plug: '<path d="M9 2v6M15 2v6M6 8h12v4a6 6 0 0 1-12 0zM12 18v4"/>',
      book: '<path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20V3H6.5A2.5 2.5 0 0 0 4 5.5z"/><path d="M4 19.5A2.5 2.5 0 0 0 6.5 22H20v-5"/>'
    };
    // Brand marks: the same Claude, ChatGPT (OpenAI) and Cursor logos as the
    // homepage's "Works with" row, filled with the text colour.
    var BRAND = {
      claude: "m4.7144 15.9555 4.7174-2.6471.079-.2307-.079-.1275h-.2307l-.7893-.0486-2.6956-.0729-2.3375-.0971-2.2646-.1214-.5707-.1215-.5343-.7042.0546-.3522.4797-.3218.686.0608 1.5179.1032 2.2767.1578 1.6514.0972 2.4468.255h.3886l.0546-.1579-.1336-.0971-.1032-.0972L6.973 9.8356l-2.55-1.6879-1.3356-.9714-.7225-.4918-.3643-.4614-.1578-1.0078.6557-.7225.8803.0607.2246.0607.8925.686 1.9064 1.4754 2.4893 1.8336.3643.3035.1457-.1032.0182-.0728-.164-.2733-1.3539-2.4467-1.445-2.4893-.6435-1.032-.17-.6194c-.0607-.255-.1032-.4674-.1032-.7285L6.287.1335 6.6997 0l.9957.1336.419.3642.6192 1.4147 1.0018 2.2282 1.5543 3.0296.4553.8985.2429.8318.091.255h.1579v-.1457l.1275-1.706.2368-2.0947.2307-2.6957.0789-.7589.3764-.9107.7468-.4918.5828.2793.4797.686-.0668.4433-.2853 1.8517-.5586 2.9021-.3643 1.9429h.2125l.2429-.2429.9835-1.3053 1.6514-2.0643.7286-.8196.85-.9046.5464-.4311h1.0321l.759 1.1293-.34 1.1657-1.0625 1.3478-.8804 1.1414-1.2628 1.7-.7893 1.36.0729.1093.1882-.0183 2.8535-.607 1.5421-.2794 1.8396-.3157.8318.3886.091.3946-.3278.8075-1.967.4857-2.3072.4614-3.4364.8136-.0425.0304.0486.0607 1.5482.1457.6618.0364h1.621l3.0175.2247.7892.522.4736.6376-.079.4857-1.2142.6193-1.6393-.3886-3.825-.9107-1.3113-.3279h-.1822v.1093l1.0929 1.0686 2.0035 1.8092 2.5075 2.3314.1275.5768-.3218.4554-.34-.0486-2.2039-1.6575-.85-.7468-1.9246-1.621h-.1275v.17l.4432.6496 2.3436 3.5214.1214 1.0807-.17.3521-.6071.2125-.6679-.1214-1.3721-1.9246L14.38 17.959l-1.1414-1.9428-.1397.079-.674 7.2552-.3156.3703-.7286.2793-.6071-.4614-.3218-.7468.3218-1.4753.3886-1.9246.3157-1.53.2853-1.9004.17-.6314-.0121-.0425-.1397.0182-1.4328 1.9672-2.1796 2.9446-1.7243 1.8456-.4128.164-.7164-.3704.0667-.6618.4008-.5889 2.386-3.0357 1.4389-1.882.929-1.0868-.0062-.1579h-.0546l-6.3385 4.1164-1.1293.1457-.4857-.4554.0608-.7467.2307-.2429 1.9064-1.3114Z",
      openai: "M22.2819 9.8211a5.9847 5.9847 0 0 0-.5157-4.9108 6.0462 6.0462 0 0 0-6.5098-2.9A6.0651 6.0651 0 0 0 4.9807 4.1818a5.9847 5.9847 0 0 0-3.9977 2.9 6.0462 6.0462 0 0 0 .7427 7.0966 5.98 5.98 0 0 0 .511 4.9107 6.051 6.051 0 0 0 6.5146 2.9001A5.9847 5.9847 0 0 0 13.2599 24a6.0557 6.0557 0 0 0 5.7718-4.2058 5.9894 5.9894 0 0 0 3.9977-2.9001 6.0557 6.0557 0 0 0-.7475-7.0729zm-9.022 12.6081a4.4755 4.4755 0 0 1-2.8764-1.0408l.1419-.0804 4.7783-2.7582a.7948.7948 0 0 0 .3927-.6813v-6.7369l2.02 1.1686a.0719.0719 0 0 1 .038.052v5.5826a4.504 4.504 0 0 1-4.4945 4.4944zm-9.6607-4.1254a4.4708 4.4708 0 0 1-.5346-3.0137l.142.0852 4.783 2.7582a.7712.7712 0 0 0 .7806 0l5.8428-3.3685v2.3324a.0804.0804 0 0 1-.0332.0615L9.74 19.9502a4.4992 4.4992 0 0 1-6.1408-1.6464zM2.3408 7.8956a4.485 4.485 0 0 1 2.3655-1.9728V11.6a.7664.7664 0 0 0 .3879.6765l5.8144 3.3543-2.0201 1.1685a.0757.0757 0 0 1-.071 0l-4.8303-2.7865A4.504 4.504 0 0 1 2.3408 7.872zm16.5963 3.8558L13.1038 8.364 15.1192 7.2a.0757.0757 0 0 1 .071 0l4.8303 2.7913a4.4944 4.4944 0 0 1-.6765 8.1042v-5.6772a.79.79 0 0 0-.4069-.667zm2.0107-3.0231l-.142-.0852-4.7735-2.7818a.7759.7759 0 0 0-.7854 0L9.409 9.2297V6.8974a.0662.0662 0 0 1 .0284-.0615l4.8303-2.7866a4.4992 4.4992 0 0 1 6.6802 4.66zM8.3065 12.863l-2.02-1.1638a.0804.0804 0 0 1-.038-.0567V6.0742a4.4992 4.4992 0 0 1 7.3757-3.4537l-.142.0805L8.704 5.459a.7948.7948 0 0 0-.3927.6813zm1.0976-2.3654l2.602-1.4998 2.6069 1.4998v2.9994l-2.5974 1.4997-2.6067-1.4997Z",
      cursor: "M11.503.131 1.891 5.678a.84.84 0 0 0-.42.726v11.188c0 .3.162.575.42.724l9.609 5.55a1 1 0 0 0 .998 0l9.61-5.55a.84.84 0 0 0 .42-.724V6.404a.84.84 0 0 0-.42-.726L12.497.131a1.01 1.01 0 0 0-.996 0M2.657 6.338h18.55c.263 0 .43.287.297.515L12.23 22.918c-.062.107-.229.064-.229-.06V12.335a.59.59 0 0 0-.295-.51l-9.11-5.257c-.109-.063-.064-.23.061-.23",
      windsurf: "M23.55 5.067c-1.2038-.002-2.1806.973-2.1806 2.1765v4.8676c0 .972-.8035 1.7594-1.7597 1.7594-.568 0-1.1352-.286-1.4718-.7659l-4.9713-7.1003c-.4125-.5896-1.0837-.941-1.8103-.941-1.1334 0-2.1533.9635-2.1533 2.153v4.8957c0 .972-.7969 1.7594-1.7596 1.7594-.57 0-1.1363-.286-1.4728-.7658L.4076 5.1598C.2822 4.9798 0 5.0688 0 5.2882v4.2452c0 .2147.0656.4228.1884.599l5.4748 7.8183c.3234.462.8006.8052 1.3509.9298 1.3771.313 2.6446-.747 2.6446-2.0977v-4.893c0-.972.7875-1.7593 1.7596-1.7593h.003a1.798 1.798 0 0 1 1.4718.7658l4.9723 7.0994c.4135.5905 1.05.941 1.8093.941 1.1587 0 2.1515-.9645 2.1515-2.153v-4.8948c0-.972.7875-1.7594 1.7596-1.7594h.194a.22.22 0 0 0 .2204-.2202v-4.622a.22.22 0 0 0-.2203-.2203Z",
      copilot: "M23.922 16.997C23.061 18.492 18.063 22.02 12 22.02 5.937 22.02.939 18.492.078 16.997A.641.641 0 0 1 0 16.741v-2.869a.883.883 0 0 1 .053-.22c.372-.935 1.347-2.292 2.605-2.656.167-.429.414-1.055.644-1.517a10.098 10.098 0 0 1-.052-1.086c0-1.331.282-2.499 1.132-3.368.397-.406.89-.717 1.474-.952C7.255 2.937 9.248 1.98 11.978 1.98c2.731 0 4.767.957 6.166 2.093.584.235 1.077.546 1.474.952.85.869 1.132 2.037 1.132 3.368 0 .368-.014.733-.052 1.086.23.462.477 1.088.644 1.517 1.258.364 2.233 1.721 2.605 2.656a.841.841 0 0 1 .053.22v2.869a.641.641 0 0 1-.078.256Zm-11.75-5.992h-.344a4.359 4.359 0 0 1-.355.508c-.77.947-1.918 1.492-3.508 1.492-1.725 0-2.989-.359-3.782-1.259a2.137 2.137 0 0 1-.085-.104L4 11.746v6.585c1.435.779 4.514 2.179 8 2.179 3.486 0 6.565-1.4 8-2.179v-6.585l-.098-.104s-.033.045-.085.104c-.793.9-2.057 1.259-3.782 1.259-1.59 0-2.738-.545-3.508-1.492a4.359 4.359 0 0 1-.355-.508Zm2.328 3.25c.549 0 1 .451 1 1v2c0 .549-.451 1-1 1-.549 0-1-.451-1-1v-2c0-.549.451-1 1-1Zm-5 0c.549 0 1 .451 1 1v2c0 .549-.451 1-1 1-.549 0-1-.451-1-1v-2c0-.549.451-1 1-1Zm3.313-6.185c.136 1.057.403 1.913.878 2.497.442.544 1.134.938 2.344.938 1.573 0 2.292-.337 2.657-.751.384-.435.558-1.15.558-2.361 0-1.14-.243-1.847-.705-2.319-.477-.488-1.319-.862-2.824-1.025-1.487-.161-2.192.138-2.533.529-.269.307-.437.808-.438 1.578v.021c0 .265.021.562.063.893Zm-1.626 0c.042-.331.063-.628.063-.894v-.02c-.001-.77-.169-1.271-.438-1.578-.341-.391-1.046-.69-2.533-.529-1.505.163-2.347.537-2.824 1.025-.462.472-.705 1.179-.705 2.319 0 1.211.175 1.926.558 2.361.365.414 1.084.751 2.657.751 1.21 0 1.902-.394 2.344-.938.475-.584.742-1.44.878-2.497Z"
    };
    function icon(name) {
      if (BRAND[name]) return '<svg class="brand ' + name + '" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="' + BRAND[name] + '"/></svg>';
      return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + ICON[name] + "</svg>";
    }
    function esc(s) { return String(s).replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;"); }

    function track(page, item) {
      try {
        fetch("/api/site-event", {
          method: "POST",
          keepalive: true,
          credentials: "same-origin",
          headers: { "Content-Type": "application/json", "X-Aired-Request": "1" },
          body: JSON.stringify({ page: page, item: item })
        }).catch(function () {});
      } catch (e) {}
    }

    function fallbackCopy(text) {
      var ta = document.createElement("textarea");
      ta.value = text; ta.style.position = "fixed"; ta.style.left = "-9999px";
      document.body.appendChild(ta); ta.select();
      var ok = false;
      try { ok = document.execCommand("copy"); } catch (e) {}
      document.body.removeChild(ta);
      return ok ? Promise.resolve() : Promise.reject(new Error("copy failed"));
    }
    function copyText(text) {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        return navigator.clipboard.writeText(text).catch(function () { return fallbackCopy(text); });
      }
      return fallbackCopy(text);
    }
    // Safari only lets a click copy text it fetches through ClipboardItem.
    function copyFromUrl(url) {
      var load = function () {
        return fetch(url).then(function (r) { if (!r.ok) throw new Error("load failed"); return r.text(); });
      };
      if (window.ClipboardItem && navigator.clipboard && navigator.clipboard.write) {
        var blob = load().then(function (t) { return new Blob([t], { type: "text/plain" }); });
        return navigator.clipboard.write([new ClipboardItem({ "text/plain": blob })])
          .catch(function () { return load().then(copyText); });
      }
      return load().then(copyText);
    }
    function flash(el, text, ok) {
      var label = el.querySelector("[data-say]");
      if (!label) return;
      var orig = label.getAttribute("data-say");
      label.textContent = text;
      el.classList.toggle("copied", ok);
      el.classList.toggle("failed", !ok);
      clearTimeout(el._flash);
      el._flash = setTimeout(function () { label.textContent = orig; el.classList.remove("copied", "failed"); }, 1800);
    }

    Array.prototype.forEach.call(roots, function (root, n) {
      var page = root.getAttribute("data-agent");
      var task = root.getAttribute("data-task") || "use aired";
      var md = root.getAttribute("data-md") || "/" + page + ".md";
      var setupHref = page === "docs" ? "#mcp" : "/docs#mcp";
      var prompt = encodeURIComponent("Read " + pageUrl + " and help me " + task + ".");
      var copyBtn = root.querySelector(".aimenu-copy");
      var moreBtn = root.querySelector(".aimenu-more");
      var menuId = "aimenu-menu-" + n;

      var tile = function (o) {
        var tag = o.href ? "a" : "button";
        var attrs = o.href ? ' href="' + esc(o.href) + '"' : ' type="button"';
        return "<" + tag + ' class="aimenu-app aimenu-item" role="menuitem"' + attrs + ' data-item="' + o.item + '"' +
          (o.copy ? ' data-copy="' + esc(o.copy) + '" data-done="' + esc(o.done) + '"' : "") + ">" + icon(o.icon) + "<span>" + o.label + "</span></" + tag + ">";
      };
      var row = function (o) {
        var tag = o.href ? "a" : "button";
        var attrs = o.href
          ? ' href="' + esc(o.href) + '"' + (o.newTab ? ' target="_blank" rel="noopener"' : "")
          : ' type="button"';
        return "<" + tag + ' class="aimenu-item" role="menuitem"' + attrs + ' data-item="' + o.item + '"' +
          (o.copy ? ' data-copy="' + esc(o.copy) + '"' : "") + ">" + icon(o.icon) +
          '<span><b>' + o.label + '</b><small data-say="' + esc(o.say) + '">' + o.say + "</small></span></" + tag + ">";
      };
      var menu = document.createElement("div");
      menu.className = "aimenu-menu";
      menu.id = menuId;
      menu.setAttribute("role", "menu");
      menu.setAttribute("aria-label", "Use this page with AI");
      menu.hidden = true;
      menu.innerHTML =
        '<p class="aimenu-grp">Use with AI</p>' +
        row({ item: "chatgpt", icon: "openai", label: "Open in ChatGPT", say: "Opens with this page and the task", href: "https://chatgpt.com/?q=" + prompt, newTab: true }) +
        row({ item: "claude", icon: "claude", label: "Open in Claude", say: "Opens with this page and the task", href: "https://claude.ai/new?q=" + prompt, newTab: true }) +
        row({ item: "open_markdown", icon: "markdown", label: "View as Markdown", say: "Plain text for any AI tool", href: md, newTab: true }) +
        '<p class="aimenu-grp">Add aired to your agent</p><div class="aimenu-apps">' +
        tile({ item: "claude_code", icon: "claude", label: "Claude Code", done: "Copied. Run it in your terminal.", copy: "claude mcp add aired --transport http " + mcpUrl }) +
        tile({ item: "codex", icon: "openai", label: "Codex", done: "Copied. Run it in your terminal.", copy: "codex mcp add aired --url " + mcpUrl }) +
        tile({ item: "cursor", icon: "cursor", label: "Cursor", href: "cursor://anysphere.cursor-deeplink/mcp/install?name=aired&config=" + encodeURIComponent(cursorConfig) }) +
        tile({ item: "vscode", icon: "copilot", label: "VS Code", done: "Copied. Paste it into .vscode/mcp.json.", copy: JSON.stringify({ servers: { aired: { type: "http", url: mcpUrl } } }, null, 2) }) +
        tile({ item: "windsurf", icon: "windsurf", label: "Windsurf", done: "Copied. Paste it into Windsurf's mcp_config.json.", copy: JSON.stringify({ mcpServers: { aired: { serverUrl: mcpUrl } } }, null, 2) }) +
        tile({ item: "claude_app", icon: "claude", label: "Claude app", done: "Copied. In Claude, add it as a custom connector.", copy: accountUrl }) +
        tile({ item: "chatgpt_app", icon: "openai", label: "ChatGPT app", done: "Copied. In ChatGPT, add it as a connector.", copy: accountUrl }) +
        '<a class="aimenu-app" role="menuitem" href="' + setupHref + '">' + icon("book") + '<span>All setups</span></a>' +
        '</div><p class="aimenu-say" aria-live="polite" data-say-apps>Pick your app to copy its setup.</p>' +
        '';
      root.appendChild(menu);
      moreBtn.setAttribute("aria-controls", menuId);

      var items = function () { return Array.prototype.slice.call(menu.querySelectorAll(".aimenu-item, .aimenu-app")); };
      function place() {
        menu.style.left = ""; menu.style.right = "";
        var r = root.getBoundingClientRect();
        var w = Math.min(340, document.documentElement.clientWidth - 32);
        if (r.right - w < 16) menu.style.left = "0"; else menu.style.right = "0";
      }
      function open(focusFirst) {
        menu.hidden = false;
        moreBtn.setAttribute("aria-expanded", "true");
        place();
        if (focusFirst) items()[0].focus();
      }
      function close(refocus) {
        if (menu.hidden) return;
        menu.hidden = true;
        moreBtn.setAttribute("aria-expanded", "false");
        if (refocus) moreBtn.focus();
      }
      moreBtn.addEventListener("click", function () {
        if (menu.hidden) open(false); else close(false);
      });
      moreBtn.addEventListener("keydown", function (e) {
        if (e.key === "ArrowDown") { e.preventDefault(); open(true); }
      });
      menu.addEventListener("keydown", function (e) {
        var list = items(), i = list.indexOf(document.activeElement);
        if (e.key === "ArrowDown") { e.preventDefault(); list[(i + 1) % list.length].focus(); }
        else if (e.key === "ArrowUp") { e.preventDefault(); list[(i - 1 + list.length) % list.length].focus(); }
        else if (e.key === "Tab") close(false);
      });
      document.addEventListener("click", function (e) { if (!root.contains(e.target)) close(false); });
      document.addEventListener("keydown", function (e) {
        if (e.key === "Escape" && !menu.hidden) { e.preventDefault(); close(root.contains(document.activeElement)); }
      });

      menu.addEventListener("click", function (e) {
        var el = e.target.closest(".aimenu-item");
        if (!el) return;
        track(page, el.getAttribute("data-item"));
        var text = el.getAttribute("data-copy");
        if (text) {
          var say = el.classList.contains("aimenu-app") ? menu.querySelector("[data-say-apps]") : null;
          copyText(text).then(function () {
            if (say) { say.textContent = el.getAttribute("data-done"); say.classList.add("ok"); el.classList.add("copied"); setTimeout(function () { el.classList.remove("copied"); }, 1800); }
            else flash(el, "Copied. Paste it in your terminal or app", true);
          }, function () {
            if (say) { say.textContent = "Couldn't copy. Use All setups instead."; say.classList.remove("ok"); }
            else flash(el, text, false);
          });
        }
      });

      copyBtn.addEventListener("click", function () {
        track(page, "copy_page");
        var label = copyBtn.querySelector("span");
        var orig = label.textContent;
        copyFromUrl(md).then(function () {
          label.textContent = "Copied";
          copyBtn.classList.add("copied");
        }, function () {
          label.textContent = "Couldn't copy";
        }).then(function () {
          setTimeout(function () { label.textContent = orig; copyBtn.classList.remove("copied"); }, 1800);
        });
      });
    });
  }

  // ── Motion: the moving hero pictures and the explainers in guide articles ──
  // DESIGN.md §9.3 Motion: slow loops that pause off screen (and, for
  // explainers, on hover or focus). With reduced motion, nothing moves and
  // explainers show their last step.
  function initMotion() {
    var reduce = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    // Runs tick() every ms while el is on screen and not paused.
    function loop(el, ms, tick, pauseOnHover) {
      var visible = false, hovered = false, timer = null;
      function run() {
        clearTimeout(timer);
        if (!visible || hovered) return;
        timer = setTimeout(function () { tick(); run(); }, ms);
      }
      if ("IntersectionObserver" in window) {
        new IntersectionObserver(function (entries) {
          visible = entries[0].isIntersecting;
          run();
        }).observe(el);
      } else { visible = true; run(); }
      if (pauseOnHover) {
        var on = function () { hovered = true; clearTimeout(timer); };
        var off = function () { hovered = false; run(); };
        el.addEventListener("mouseenter", on);
        el.addEventListener("mouseleave", off);
        el.addEventListener("focusin", on);
        el.addEventListener("focusout", off);
      }
    }

    // Slides hero: flip through the slides, keep the counter and address in step.
    document.querySelectorAll("[data-deck]").forEach(function (deck) {
      if (reduce) return;
      var slides = deck.querySelectorAll("section");
      var i = 0;
      loop(deck, 2800, function () {
        slides[i].classList.remove("on");
        slides[i].classList.add("was");
        i = (i + 1) % slides.length;
        slides.forEach(function (sl, k) { if (k !== i && k !== (i + slides.length - 1) % slides.length) sl.classList.remove("was"); });
        slides[i].classList.remove("was");
        slides[i].classList.add("on");
        var n = slides[i].getAttribute("data-n");
        document.querySelectorAll("[data-deck-n], [data-deck-count], [data-deck-url]").forEach(function (t) { t.textContent = n; });
      });
    });

    // Snake hero: the snake goes round the board and eats.
    document.querySelectorAll(".report.game .board").forEach(function (board) {
      if (reduce) return;
      var cells = board.querySelectorAll("i");
      var cols = 10;
      var path = [];
      var r, c;
      for (c = 1; c <= 8; c++) path.push([2, c]);
      for (r = 3; r <= 7; r++) path.push([r, 8]);
      for (c = 7; c >= 1; c--) path.push([7, c]);
      for (r = 6; r >= 3; r--) path.push([r, 1]);
      var score = board.parentNode.querySelector(".game-top span");
      var points = 14, head = 4, len = 4, food = 11;
      function draw() {
        cells.forEach(function (cell) { cell.className = ""; });
        for (var k = 0; k < len; k++) {
          var p = path[(head - k + path.length) % path.length];
          cells[p[0] * cols + p[1]].className = k === 0 ? "h" : "s";
        }
        var f = path[food];
        cells[f[0] * cols + f[1]].className = "f";
      }
      draw();
      loop(board, 260, function () {
        head = (head + 1) % path.length;
        if (head === food) {
          points += 1;
          if (score) score.textContent = "Score " + points;
          len = len >= 9 ? 4 : len + 1;
          food = (head + 7 + (points % 5)) % path.length;
        }
        draw();
      });
    });

    // Explainers: <figure class="explain" data-steps="3"> steps through
    // data-step 1..n; buttons with data-mode switch what it shows.
    document.querySelectorAll("figure.explain[data-steps]").forEach(function (fig) {
      var n = Number(fig.getAttribute("data-steps"));
      var set = function (k) { fig.setAttribute("data-step", String(k)); };
      fig.querySelectorAll("[data-mode]").forEach(function (b) {
        b.addEventListener("click", function () {
          fig.setAttribute("data-show", b.getAttribute("data-mode"));
          fig.querySelectorAll("[data-mode]").forEach(function (o) { o.setAttribute("aria-pressed", String(o === b)); });
          set(reduce ? n : 1);
        });
      });
      if (reduce) { set(n); return; }
      loop(fig, 2600, function () { set(Number(fig.getAttribute("data-step")) % n + 1); }, true);
    });
  }
})();
