// utils/logger.js
// Centralized runtime logger for Toree. Stores the last MAX_LOGS entries in
// chrome.storage.local so they can be inspected (and exported) from the
// Options -> Debug & Logs tab, even across background service worker restarts.

const LOGS_KEY = "toree_logs";
const SETTINGS_KEY = "toree_settings";
const MAX_LOGS = 100;

function maskKey(key) {
  if (!key) return "(not set)";
  if (key.length <= 8) return "••••";
  return `${key.slice(0, 4)}…${key.slice(-4)}`;
}

async function getLogs() {
  const data = await chrome.storage.local.get(LOGS_KEY);
  return Array.isArray(data[LOGS_KEY]) ? data[LOGS_KEY] : [];
}

async function clearLogs() {
  await chrome.storage.local.set({ [LOGS_KEY]: [] });
}

/**
 * @param {"info"|"warn"|"error"} level
 * @param {string} message
 * @param {object} [meta] extra context (provider, model, stack, status, etc.)
 */
async function log(level, message, meta = {}) {
  const entry = {
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    timestamp: new Date().toISOString(),
    level,
    message,
    meta,
  };

  try {
    const logs = await getLogs();
    logs.push(entry);
    const trimmed = logs.length > MAX_LOGS ? logs.slice(logs.length - MAX_LOGS) : logs;
    await chrome.storage.local.set({ [LOGS_KEY]: trimmed });
  } catch (storageErr) {
    // If storage itself is failing, at least surface it to the console.
    console.error("[Toree] Failed to persist log entry", storageErr);
  }

  const consoleFn = level === "error" ? console.error : level === "warn" ? console.warn : console.log;
  consoleFn(`[Toree:${level}]`, message, meta);

  return entry;
}

const info = (message, meta) => log("info", message, meta);
const warn = (message, meta) => log("warn", message, meta);
const error = (message, meta) => log("error", message, meta);

/**
 * Builds a ready-to-paste Markdown snippet summarizing extension version,
 * sanitized settings (API keys masked), browser metadata and recent logs —
 * designed to be dropped directly into a Claude chat for debugging.
 */
async function exportForClaude() {
  const [logs, settingsData] = await Promise.all([
    getLogs(),
    chrome.storage.sync.get(SETTINGS_KEY),
  ]);

  const manifest = chrome.runtime.getManifest();
  const settings = settingsData[SETTINGS_KEY] || {};
  const recent = logs.slice(-25);

  const safeSettings = {
    defaultModel: settings.defaultModel || "(not set)",
    openaiKey: maskKey(settings.openaiKey),
    geminiKey: maskKey(settings.geminiKey),
    groqKey: maskKey(settings.groqKey),
  };

  let ua = "unknown";
  try {
    ua = navigator.userAgent;
  } catch {
    /* navigator not available in this context */
  }

  const lines = [];
  lines.push("# Toree Debug Export");
  lines.push("");
  lines.push(`- **Extension version:** ${manifest.version}`);
  lines.push(`- **Exported at:** ${new Date().toISOString()}`);
  lines.push(`- **User agent:** ${ua}`);
  lines.push("");
  lines.push("## Active settings (keys masked)");
  lines.push("```json");
  lines.push(JSON.stringify(safeSettings, null, 2));
  lines.push("```");
  lines.push("");
  lines.push(`## Recent logs (showing last ${recent.length} of ${logs.length})`);
  lines.push("");

  if (recent.length === 0) {
    lines.push("_No logs recorded yet._");
  } else {
    // Most recent first, easier to scan when pasted into a chat.
    [...recent].reverse().forEach((entry) => {
      lines.push(`### [${entry.level.toUpperCase()}] ${entry.timestamp}`);
      lines.push(entry.message);
      if (entry.meta && Object.keys(entry.meta).length > 0) {
        lines.push("```");
        lines.push(JSON.stringify(entry.meta, null, 2));
        lines.push("```");
      }
      lines.push("");
    });
  }

  return lines.join("\n");
}

export const Logger = { log, info, warn, error, getLogs, clearLogs, exportForClaude, maskKey, MAX_LOGS };
