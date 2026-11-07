// content/content.js
// Injected on every page. Builds a small shadow-DOM UI (loader toast, status
// toasts, and a result modal) and listens for messages from the background
// service worker. Also captures the selection at the moment the context menu
// is opened so editable text can be replaced in place after the async API
// call resolves.

(function toreeContentScript() {
  if (window.__toreeContentLoaded) return;
  window.__toreeContentLoaded = true;

  const HOST_ID = "toree-ui-host";

  let host = document.getElementById(HOST_ID);
  let shadow;

  if (host && host.shadowRoot) {
    shadow = host.shadowRoot;
  } else {
    host = document.createElement("div");
    host.id = HOST_ID;
    document.documentElement.appendChild(host);
    shadow = host.attachShadow({ mode: "open" });

    const style = document.createElement("style");
    style.textContent = `
      :host { all: initial; }
      .toree-toast-stack {
        position: fixed;
        bottom: 20px;
        right: 20px;
        z-index: 2147483647;
        display: flex;
        flex-direction: column;
        gap: 8px;
        align-items: flex-end;
        font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
      }
      .toree-toast {
        display: flex;
        align-items: center;
        gap: 8px;
        background: #1f2430;
        color: #f4f5f7;
        padding: 10px 14px;
        border-radius: 8px;
        font-size: 13px;
        line-height: 1.4;
        box-shadow: 0 4px 16px rgba(0,0,0,0.25);
        max-width: 320px;
        animation: toree-fade-in 0.15s ease-out;
      }
      .toree-toast.error { background: #4a1d24; border: 1px solid #c0394a; }
      .toree-toast.success { background: #163a2b; border: 1px solid #2ea864; }
      .toree-toast.info { background: #1f2430; border: 1px solid #3a4150; }
      .toree-spinner {
        width: 14px;
        height: 14px;
        border-radius: 50%;
        border: 2px solid rgba(255,255,255,0.3);
        border-top-color: #fff;
        animation: toree-spin 0.7s linear infinite;
        flex-shrink: 0;
      }
      @keyframes toree-spin { to { transform: rotate(360deg); } }
      @keyframes toree-fade-in { from { opacity: 0; transform: translateY(6px); } to { opacity: 1; transform: translateY(0); } }

      .toree-modal {
        position: fixed;
        z-index: 2147483647;
        width: 360px;
        max-width: calc(100vw - 32px);
        max-height: 70vh;
        display: flex;
        flex-direction: column;
        background: #fff;
        color: #1f2430;
        border-radius: 10px;
        box-shadow: 0 8px 30px rgba(0,0,0,0.3);
        font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
        overflow: hidden;
        animation: toree-fade-in 0.15s ease-out;
      }
      .toree-modal-header {
        display: flex;
        align-items: center;
        justify-content: space-between;
        padding: 10px 14px;
        background: #1f2430;
        color: #fff;
        font-size: 13px;
        font-weight: 600;
      }
      .toree-modal-header button {
        background: transparent;
        border: none;
        color: #fff;
        font-size: 16px;
        cursor: pointer;
        line-height: 1;
        padding: 0 4px;
      }
      .toree-modal-body {
        padding: 14px;
        font-size: 14px;
        line-height: 1.5;
        overflow-y: auto;
        white-space: pre-wrap;
        word-break: break-word;
      }
      .toree-modal-footer {
        display: flex;
        justify-content: flex-end;
        gap: 8px;
        padding: 10px 14px;
        border-top: 1px solid #eee;
      }
      .toree-btn {
        font-size: 13px;
        padding: 6px 12px;
        border-radius: 6px;
        border: 1px solid #ccc;
        background: #f6f6f7;
        cursor: pointer;
      }
      .toree-btn.primary {
        background: #2563eb;
        border-color: #2563eb;
        color: #fff;
      }
    `;
    shadow.appendChild(style);

    const toastStack = document.createElement("div");
    toastStack.className = "toree-toast-stack";
    shadow.appendChild(toastStack);
  }

  const toastStack = shadow.querySelector(".toree-toast-stack");

  // -------------------------------------------------------------------------
  // Track where/what was selected at the moment the context menu opened, so
  // we can replace it in place once the API call resolves.
  // -------------------------------------------------------------------------

  let lastMouse = { x: window.innerWidth - 380, y: 80 };
  let savedSelection = null; // { type: 'field', el, start, end } | { type: 'editable', range }

  document.addEventListener(
    "contextmenu",
    (e) => {
      lastMouse = { x: e.clientX, y: e.clientY };
      const el = e.target;

      if (el && (el.tagName === "TEXTAREA" || el.tagName === "INPUT")) {
        savedSelection = {
          type: "field",
          el,
          start: el.selectionStart,
          end: el.selectionEnd,
        };
      } else if (el && el.isContentEditable) {
        const sel = window.getSelection();
        if (sel && sel.rangeCount > 0) {
          savedSelection = { type: "editable", range: sel.getRangeAt(0).cloneRange() };
        } else {
          savedSelection = null;
        }
      } else {
        savedSelection = null;
      }
    },
    true
  );

  // -------------------------------------------------------------------------
  // Toasts (loader + status messages)
  // -------------------------------------------------------------------------

  let loaderToastEl = null;

  function showLoader(message) {
    hideLoader();
    loaderToastEl = document.createElement("div");
    loaderToastEl.className = "toree-toast info";
    loaderToastEl.innerHTML = `<span class="toree-spinner"></span><span></span>`;
    loaderToastEl.querySelector("span:last-child").textContent = message || "Toree is thinking…";
    toastStack.appendChild(loaderToastEl);
  }

  function hideLoader() {
    if (loaderToastEl) {
      loaderToastEl.remove();
      loaderToastEl = null;
    }
  }

  function showToast(level, message, autoHideMs = 5000) {
    const el = document.createElement("div");
    el.className = `toree-toast ${level || "info"}`;
    const text = document.createElement("span");
    text.textContent = message;
    el.appendChild(text);
    toastStack.appendChild(el);
    if (autoHideMs) {
      setTimeout(() => el.remove(), autoHideMs);
    }
    return el;
  }

  // -------------------------------------------------------------------------
  // Result modal (non-editable selections)
  // -------------------------------------------------------------------------

  function showResultModal(text, title) {
    const existing = shadow.querySelector(".toree-modal");
    if (existing) existing.remove();

    const modal = document.createElement("div");
    modal.className = "toree-modal";

    const maxLeft = window.innerWidth - 360 - 16;
    const maxTop = window.innerHeight - 200;
    const left = Math.max(16, Math.min(lastMouse.x, maxLeft));
    const top = Math.max(16, Math.min(lastMouse.y, maxTop));
    modal.style.left = `${left}px`;
    modal.style.top = `${top}px`;

    const header = document.createElement("div");
    header.className = "toree-modal-header";
    const headerTitle = document.createElement("span");
    headerTitle.textContent = title || "Toree";
    const closeBtn = document.createElement("button");
    closeBtn.textContent = "✕";
    closeBtn.setAttribute("aria-label", "Close");
    closeBtn.addEventListener("click", () => modal.remove());
    header.appendChild(headerTitle);
    header.appendChild(closeBtn);

    const body = document.createElement("div");
    body.className = "toree-modal-body";
    body.textContent = text;

    const footer = document.createElement("div");
    footer.className = "toree-modal-footer";
    const copyBtn = document.createElement("button");
    copyBtn.className = "toree-btn primary";
    copyBtn.textContent = "Copy to Clipboard";
    copyBtn.addEventListener("click", async () => {
      try {
        await navigator.clipboard.writeText(text);
        copyBtn.textContent = "Copied!";
        setTimeout(() => (copyBtn.textContent = "Copy to Clipboard"), 1500);
      } catch {
        showToast("error", "Toree: Could not copy to clipboard.");
      }
    });
    const closeFooterBtn = document.createElement("button");
    closeFooterBtn.className = "toree-btn";
    closeFooterBtn.textContent = "Close";
    closeFooterBtn.addEventListener("click", () => modal.remove());
    footer.appendChild(closeFooterBtn);
    footer.appendChild(copyBtn);

    modal.appendChild(header);
    modal.appendChild(body);
    modal.appendChild(footer);
    shadow.appendChild(modal);
  }

  // -------------------------------------------------------------------------
  // In-place text replacement for editable elements
  // -------------------------------------------------------------------------

  function fallbackToClipboard(text) {
    navigator.clipboard
      .writeText(text)
      .then(() => showToast("info", "Toree: Couldn't edit the field directly — result copied to clipboard instead."))
      .catch(() => showToast("error", "Toree: Couldn't edit the field or copy to clipboard."));
  }

  function replaceSelection(text) {
    if (!savedSelection) {
      fallbackToClipboard(text);
      return;
    }

    if (savedSelection.type === "field") {
      const { el, start, end } = savedSelection;
      if (!document.contains(el)) {
        fallbackToClipboard(text);
        return;
      }
      const original = el.value;
      const safeStart = Math.min(start ?? 0, original.length);
      const safeEnd = Math.min(end ?? safeStart, original.length);
      el.focus();
      el.value = original.slice(0, safeStart) + text + original.slice(safeEnd);
      const newCursor = safeStart + text.length;
      try {
        el.setSelectionRange(newCursor, newCursor);
      } catch {
        /* some input types don't support setSelectionRange */
      }
      el.dispatchEvent(new Event("input", { bubbles: true }));
      el.dispatchEvent(new Event("change", { bubbles: true }));
      showToast("success", "Toree: Text replaced.", 2500);
      return;
    }

    if (savedSelection.type === "editable") {
      try {
        const { range } = savedSelection;
        range.deleteContents();
        range.insertNode(document.createTextNode(text));
        range.collapse(false);
        const sel = window.getSelection();
        sel.removeAllRanges();
        sel.addRange(range);
        const root = range.commonAncestorContainer;
        const el = root.nodeType === Node.ELEMENT_NODE ? root : root.parentElement;
        el?.dispatchEvent(new Event("input", { bubbles: true }));
        showToast("success", "Toree: Text replaced.", 2500);
      } catch {
        fallbackToClipboard(text);
      }
      return;
    }

    fallbackToClipboard(text);
  }

  // -------------------------------------------------------------------------
  // Message handling
  // -------------------------------------------------------------------------

  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    switch (message?.type) {
      case "PING":
        sendResponse({ alive: true });
        break;
      case "SHOW_LOADER":
        showLoader(message.message);
        break;
      case "HIDE_LOADER":
        hideLoader();
        break;
      case "SHOW_TOAST":
        showToast(message.level, message.message);
        break;
      case "SHOW_RESULT_MODAL":
        showResultModal(message.text, message.title);
        break;
      case "REPLACE_SELECTION":
        replaceSelection(message.text);
        break;
      default:
        break;
    }
    return false;
  });
})();
