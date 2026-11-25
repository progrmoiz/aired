/* aired — client-side form logic (vanilla JS, no framework) */

(function () {
  "use strict";

  // ── Elements ──
  const form = document.getElementById("air-form");
  if (form) initForm();
  initShared();

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

  function readFileAsText(file) {
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
      const body = { html };
      if (pin) body.pin = pin;
      if (permanent) {
        body.permanent = true;
      } else if (ttlSeconds != null) {
        body.ttl = ttlSeconds;
      }

      const res = await fetch("/api/publish", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
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
    } catch (err) {
      showError(err.message || "Network error. Please try again.");
    } finally {
      setLoading(false);
    }
  });

  // ── Result display ──
  function showResult(data) {
    // Populate
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
      var total = rows.reduce(function (n, r) { return n + r[1]; }, 0), top = rows.slice(0, 5);
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
        img.width = 18;
        img.height = 14;
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
    billBtns.forEach(function (b) {
      b.addEventListener("click", function () {
        var mode = b.getAttribute("data-bill");
        billBtns.forEach(function (x) {
          x.classList.toggle("on", x === b);
          x.setAttribute("aria-pressed", String(x === b));
        });
        document.querySelectorAll("[data-y][data-m]").forEach(function (el) {
          el.textContent = el.getAttribute("data-" + mode);
        });
      });
    });

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
})();
