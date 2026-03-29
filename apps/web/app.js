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

  // ── Live stats ──
  (function () {
    fetch("/api/stats")
      .then(function (r) { return r.json(); })
      .then(function (data) {
        if (data.publishes > 0) {
          document.getElementById("stat-count").textContent = data.publishes.toLocaleString();
          document.getElementById("live-stat").classList.remove("hidden");
        }
      })
      .catch(function () {});
  })();

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
