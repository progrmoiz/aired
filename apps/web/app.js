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
    var cursorConfig = btoa(JSON.stringify({ url: mcpUrl }));
    var ICON = {
      chat: '<path d="M21 12a8 8 0 0 1-11.6 7.1L4 20l1-4.6A8 8 0 1 1 21 12z"/>',
      doc: '<path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"/><path d="M14 3v5h5M9 13h6M9 17h4"/>',
      term: '<path d="m4 17 6-5-6-5M12 19h8"/>',
      plug: '<path d="M9 2v6M15 2v6M6 8h12v4a6 6 0 0 1-12 0zM12 18v4"/>',
      book: '<path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20V3H6.5A2.5 2.5 0 0 0 4 5.5z"/><path d="M4 19.5A2.5 2.5 0 0 0 6.5 22H20v-5"/>'
    };
    function icon(name) {
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
        row({ item: "chatgpt", icon: "chat", label: "Open in ChatGPT", say: "Opens with this page and the task", href: "https://chatgpt.com/?q=" + prompt, newTab: true }) +
        row({ item: "claude", icon: "chat", label: "Open in Claude", say: "Opens with this page and the task", href: "https://claude.ai/new?q=" + prompt, newTab: true }) +
        row({ item: "open_markdown", icon: "doc", label: "View as Markdown", say: "Plain text for any AI tool", href: md, newTab: true }) +
        '<p class="aimenu-grp">Add aired to your agent</p>' +
        row({ item: "claude_code", icon: "term", label: "Claude Code", say: "Copy the install command", copy: "claude mcp add aired --transport http " + mcpUrl }) +
        row({ item: "codex", icon: "term", label: "Codex", say: "Copy the install command", copy: "codex mcp add aired --url " + mcpUrl }) +
        row({ item: "cursor", icon: "plug", label: "Cursor", say: "Install in one click", href: "cursor://anysphere.cursor-deeplink/mcp/install?name=aired&config=" + encodeURIComponent(cursorConfig) }) +
        row({ item: "mcp_url", icon: "plug", label: "ChatGPT, Claude Desktop, VS Code", say: "Copy the server address", copy: mcpUrl }) +
        '<a class="aimenu-all" href="' + setupHref + '">All setup options <span aria-hidden="true">→</span></a>';
      root.appendChild(menu);
      moreBtn.setAttribute("aria-controls", menuId);

      var items = function () { return Array.prototype.slice.call(menu.querySelectorAll(".aimenu-item, .aimenu-all")); };
      function place() {
        menu.style.left = ""; menu.style.right = "";
        var r = root.getBoundingClientRect();
        var w = Math.min(320, document.documentElement.clientWidth - 32);
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
          copyText(text).then(function () { flash(el, "Copied. Paste it in your terminal or app", true); },
            function () { flash(el, text, false); });
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
