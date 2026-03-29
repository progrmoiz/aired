/* aired — client-side form logic (vanilla JS, no framework) */

(function () {
  "use strict";

  // ── Elements ──
  const form = document.getElementById("air-form");
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
  function updateCharCount() {
    const len = htmlInput.value.length;
    const kb = (len / 1024).toFixed(1);
    charCount.textContent = len > 0 ? `${kb} KB` : "";
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
      btn.textContent = "Copied!";
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
      btn.textContent = "Copied!";
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
      submitBtn.textContent = "Airing…";
      submitBtn.classList.add("loading");
    } else {
      submitBtn.textContent = "Air it";
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

  // ── Country code to lat/lng ──
  var COUNTRY_COORDS = {
    US:[37.09,-95.71],GB:[55.38,-3.44],DE:[51.17,10.45],FR:[46.23,2.21],CA:[56.13,-106.35],
    AU:[-25.27,133.78],IN:[20.59,78.96],JP:[36.2,138.25],BR:[-14.24,-51.93],PK:[30.38,69.35],
    CN:[35.86,104.2],RU:[61.52,105.32],KR:[35.91,127.77],MX:[23.63,-102.55],ID:[-0.79,113.92],
    TR:[38.96,35.24],IT:[41.87,12.57],ES:[40.46,-3.75],NL:[52.13,5.29],SE:[60.13,18.64],
    NO:[60.47,8.47],PL:[51.92,19.15],CH:[46.82,8.23],AT:[47.52,14.55],BE:[50.5,4.47],
    ZA:[-30.56,22.94],NG:[9.08,8.68],EG:[26.82,30.8],AR:[-38.42,-63.62],CL:[-35.68,-71.54],
    CO:[4.57,-74.3],SA:[23.89,45.08],AE:[23.42,53.85],SG:[1.35,103.82],TH:[15.87,100.99],
    PH:[12.88,121.77],VN:[14.06,108.28],MY:[4.21,101.98],NZ:[-40.9,174.89],IL:[31.05,34.85],
    IE:[53.14,-7.69],PT:[39.4,-8.22],DK:[56.26,9.5],FI:[61.92,25.75],CZ:[49.82,15.47],
    RO:[45.94,24.97],HU:[47.16,19.5],GR:[39.07,21.82],UA:[48.38,31.17],BD:[23.68,90.36],
    KE:[-0.02,37.91],GH:[7.95,-1.02],TZ:[-6.37,34.89],ET:[9.15,40.49],MA:[31.79,-7.09],
    TN:[33.89,9.54],LK:[7.87,80.77],MM:[21.91,95.96],KH:[12.57,104.99],PE:[-9.19,-75.02],
    QA:[25.35,51.18],KW:[29.31,47.48],BH:[26.07,50.56],OM:[21.47,55.98],JO:[30.59,36.24],
    LB:[33.85,35.86],IQ:[33.22,43.68],XX:[0,0]
  };

  // ── Live stats + globe + marquee ──
  (function () {
    fetch("/api/stats")
      .then(function (r) { return r.json(); })
      .then(function (data) {
        // Inline hero stat
        if (data.publishes > 0) {
          var sc = document.getElementById("stat-count");
          if (sc) sc.textContent = data.publishes.toLocaleString();
          var ls = document.getElementById("live-stat");
          if (ls) ls.classList.remove("hidden");
        }

        // Countries inline
        var sci = document.getElementById("stat-countries-inline");
        if (sci && data.geo) {
          var countryCount = Object.keys(data.geo).length;
          if (countryCount > 0) {
            sci.textContent = " across " + countryCount + " countries";
          }
        }

        // Globe behind hero
        var canvas = document.getElementById("globe-canvas");
        function initGlobe() {
          var cg = window.__createGlobe;
          if (!canvas || !cg) return;
          var markers = [];
          var geo = data.geo || {};
          var maxViews = 1;
          for (var cc in geo) {
            if (geo[cc] > maxViews) maxViews = geo[cc];
          }
          for (var cc2 in geo) {
            var coords = COUNTRY_COORDS[cc2];
            if (coords) {
              markers.push({
                location: coords,
                size: Math.max(0.03, Math.min(0.12, (geo[cc2] / maxViews) * 0.12))
              });
            }
          }
          // If no real data yet, show a few default markers for visual appeal
          if (markers.length === 0) {
            markers = [
              { location: [30.38, 69.35], size: 0.06 },
              { location: [37.09, -95.71], size: 0.04 },
              { location: [51.17, 10.45], size: 0.03 },
              { location: [-25.27, 133.78], size: 0.03 },
              { location: [36.2, 138.25], size: 0.03 },
            ];
          }

          var phi = 0;
          cg(canvas, {
            devicePixelRatio: 2,
            width: 1000,
            height: 1000,
            phi: 0,
            theta: 0.2,
            dark: 1,
            diffuse: 1.5,
            mapSamples: 20000,
            mapBrightness: 4,
            baseColor: [0.08, 0.08, 0.12],
            markerColor: [0.49, 0.42, 0.94],
            glowColor: [0.08, 0.06, 0.18],
            markers: markers,
            onRender: function (state) {
              state.phi = phi;
              phi += 0.002;
            }
          });
        }
        // Try init now, or wait for cobe to load
        if (window.__createGlobe) {
          initGlobe();
        } else {
          window.addEventListener('cobe-ready', initGlobe);
        }

        // Marquee feed
        var track = document.getElementById("marquee-track");
        var section = document.getElementById("marquee-section");
        if (track && section && data.recent && data.recent.length > 0) {
          var now = Date.now();
          var items = data.recent.map(function (item) {
            var ago = Math.floor((now - item.ts) / 1000);
            var agoText;
            if (ago < 60) agoText = ago + "s ago";
            else if (ago < 3600) agoText = Math.floor(ago / 60) + "m ago";
            else if (ago < 86400) agoText = Math.floor(ago / 3600) + "h ago";
            else agoText = Math.floor(ago / 86400) + "d ago";
            return '<span class="inline-flex items-center gap-1.5">' +
              '<span>' + flagEmoji(item.country) + '</span>' +
              '<span class="text-aired-text-secondary">' + escapeHtml(item.title) + '</span>' +
              '<span class="text-aired-text-tertiary">' + agoText + '</span>' +
            '</span>';
          });
          // Duplicate for seamless loop
          var html = items.join('') + items.join('');
          track.innerHTML = html;
          section.style.display = "block";
        }
      })
      .catch(function () {
        // Still show globe even if stats fail
        function initFallbackGlobe() {
          var cg = window.__createGlobe;
          var canvas = document.getElementById("globe-canvas");
          if (!canvas || !cg) return;
          var phi = 0;
          cg(canvas, {
            devicePixelRatio: 2, width: 1000, height: 1000,
            phi: 0, theta: 0.15, dark: 1, diffuse: 1.2,
            mapSamples: 16000, mapBrightness: 6,
            baseColor: [0.12, 0.12, 0.14],
            markerColor: [0.49, 0.42, 0.94],
            glowColor: [0.06, 0.06, 0.1],
            markers: [
              { location: [30.38, 69.35], size: 0.06 },
              { location: [37.09, -95.71], size: 0.04 },
              { location: [51.17, 10.45], size: 0.03 },
            ],
            onRender: function (state) { state.phi = phi; phi += 0.002; }
          });
        }
        if (window.__createGlobe) initFallbackGlobe();
        else window.addEventListener('cobe-ready', initFallbackGlobe);
      });
  })();

  function flagEmoji(cc) {
    if (!cc || cc === "XX" || cc.length !== 2) return "🌐";
    var a = cc.charCodeAt(0) - 65 + 0x1F1E6;
    var b = cc.charCodeAt(1) - 65 + 0x1F1E6;
    return String.fromCodePoint(a) + String.fromCodePoint(b);
  }

  function escapeHtml(str) {
    var div = document.createElement("div");
    div.textContent = str;
    return div.innerHTML;
  }

  // ── Install section copy buttons ──
  document.querySelectorAll(".copy-snippet").forEach(function (btn) {
    btn.addEventListener("click", function () {
      var text = btn.getAttribute("data-copy");
      if (!text) return;
      navigator.clipboard.writeText(text).then(function () {
        btn.textContent = "Copied!";
        btn.classList.add("copied");
        setTimeout(function () {
          btn.textContent = "Copy";
          btn.classList.remove("copied");
        }, 2000);
      });
    });
  });

  // ── MCP client tabs ──
  (function () {
    var tabs = document.querySelectorAll(".mcp-tab");
    if (!tabs.length) return;

    tabs.forEach(function (tab) {
      tab.addEventListener("click", function () {
        var target = tab.getAttribute("data-tab");

        // Update tab styles
        tabs.forEach(function (t) {
          t.setAttribute("aria-selected", "false");
          t.className = "mcp-tab px-2.5 py-1 text-2xs font-medium rounded-sm transition-colors duration-150 text-aired-text-tertiary hover:text-aired-text-secondary";
        });
        tab.setAttribute("aria-selected", "true");
        tab.className = "mcp-tab px-2.5 py-1 text-2xs font-medium rounded-sm transition-colors duration-150 bg-aired-accent/10 text-aired-accent";

        // Show target panel, hide others
        document.querySelectorAll(".mcp-panel").forEach(function (panel) {
          panel.classList.add("hidden");
        });
        var panel = document.getElementById("mcp-panel-" + target);
        if (panel) panel.classList.remove("hidden");
      });
    });
  })();
})();
