// background/background.js
import { Logger } from "../utils/logger.js";
import { Storage } from "../utils/storage.js";

const PARENT_ID = "toree-parent";
const MANAGE_ID = "toree-manage";
const EMPTY_ID = "toree-empty";
const PROMPT_PREFIX = "toree-prompt-";

// Maps a model id to the provider that serves it. Anything not listed here
// falls back to a prefix-based guess in providerForModel().
const MODEL_PROVIDERS = {
  "gpt-4o-mini": "openai",
  "gpt-4o": "openai",
  "gpt-4-turbo": "openai",
  "gemini-2.0-flash": "gemini",
  "gemini-1.5-flash": "gemini",
  "gemini-1.5-pro": "gemini",
  "groq-openai/gpt-oss-120b": "groq",
  "groq-openai/gpt-oss-20b": "groq",
  "groq-qwen/qwen3-32b": "groq",
  "groq-allam-2-7b": "groq",
};

// Ordered best-first per provider. Used both for the "Auto" option and as
// the automatic fallback chain when a requested model comes back as
// unavailable — free-tier accounts (Groq especially) can lose access to a
// specific model id at any time, so we never want one hardcoded name to be
// able to break the whole extension.
// NOTE: "meta-llama/llama-prompt-guard-2-*" and "openai/gpt-oss-safeguard-20b"
// are intentionally excluded — those are classifier/moderation models, not
// general chat models, so they're a bad fit for rewriting selected text.
const FALLBACK_MODELS = {
  openai: ["gpt-4o-mini", "gpt-4o", "gpt-4-turbo"],
  gemini: ["gemini-2.0-flash", "gemini-1.5-flash", "gemini-1.5-pro"],
  groq: ["openai/gpt-oss-120b", "openai/gpt-oss-20b", "qwen/qwen3-32b", "allam-2-7b"],
};

function isModelUnavailableError(message = "") {
  const m = message.toLowerCase();
  return (
    m.includes("does not exist") ||
    m.includes("not found") ||
    m.includes("decommissioned") ||
    m.includes("model_not_found") ||
    m.includes("invalid model") ||
    m.includes("unknown model")
  );
}

function providerForModel(model = "") {
  if (MODEL_PROVIDERS[model]) return MODEL_PROVIDERS[model];
  if (model.startsWith("gemini")) return "gemini";
  if (model.startsWith("groq")) return "groq";
  return "openai";
}

// ---------------------------------------------------------------------------
// Context menu construction
// ---------------------------------------------------------------------------

async function buildContextMenus() {
  await new Promise((resolve) => chrome.contextMenus.removeAll(resolve));

  chrome.contextMenus.create({
    id: PARENT_ID,
    title: "Toree Prompter",
    contexts: ["selection"],
  });

  const prompts = await Storage.getPrompts();

  if (prompts.length === 0) {
    chrome.contextMenus.create({
      id: EMPTY_ID,
      parentId: PARENT_ID,
      title: "No prompts yet — click to add one",
      contexts: ["selection"],
    });
  } else {
    prompts.forEach((prompt) => {
      const label = prompt.title && prompt.title.trim() ? prompt.title.trim() : prompt.template.slice(0, 45);
      chrome.contextMenus.create({
        id: `${PROMPT_PREFIX}${prompt.id}`,
        parentId: PARENT_ID,
        title: label,
        contexts: ["selection"],
      });
    });
  }

  chrome.contextMenus.create({ id: "toree-sep", type: "separator", parentId: PARENT_ID, contexts: ["selection"] });
  chrome.contextMenus.create({
    id: MANAGE_ID,
    parentId: PARENT_ID,
    title: "⚙️ Manage Prompts…",
    contexts: ["selection"],
  });
}

chrome.runtime.onInstalled.addListener(async (details) => {
  await Storage.seedStarterPromptsIfEmpty();
  await buildContextMenus();
  await Logger.info(`Toree ${details.reason}`, { version: chrome.runtime.getManifest().version });
});

chrome.runtime.onStartup.addListener(() => {
  buildContextMenus();
});

// Requirement: dynamically rebuild context menus whenever prompts are added,
// edited, or deleted — options.js only ever touches storage, this listener
// is what keeps the native menu in sync automatically.
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === "local" && changes[Storage.PROMPTS_KEY]) {
    buildContextMenus();
  }
});

// ---------------------------------------------------------------------------
// Messaging helper: deliver a message to a tab's content script, injecting
// it on demand if it hasn't loaded yet (e.g. the tab was open before the
// extension was installed/updated).
// ---------------------------------------------------------------------------

async function sendToTab(tabId, message) {
  try {
    await chrome.tabs.sendMessage(tabId, message);
  } catch (firstErr) {
    try {
      await chrome.scripting.executeScript({ target: { tabId }, files: ["content/content.js"] });
      await chrome.tabs.sendMessage(tabId, message);
    } catch (secondErr) {
      await Logger.error("Could not deliver message to content script", {
        tabId,
        messageType: message.type,
        stack: secondErr.stack,
      });
    }
  }
}

// ---------------------------------------------------------------------------
// Context menu click handling
// ---------------------------------------------------------------------------

chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  if (!tab || typeof tab.id !== "number") return;

  if (info.menuItemId === MANAGE_ID || info.menuItemId === EMPTY_ID) {
    chrome.runtime.openOptionsPage();
    return;
  }

  if (typeof info.menuItemId !== "string" || !info.menuItemId.startsWith(PROMPT_PREFIX)) {
    return;
  }

  const promptId = info.menuItemId.slice(PROMPT_PREFIX.length);
  const prompts = await Storage.getPrompts();
  const prompt = prompts.find((p) => p.id === promptId);

  if (!prompt) {
    await Logger.error("Clicked prompt no longer exists", { promptId });
    await sendToTab(tab.id, { type: "SHOW_TOAST", level: "error", message: "Toree: That prompt no longer exists." });
    return;
  }

  const provider = providerForModel(prompt.model);
  const settings = await Storage.getSettings();
  const apiKey = settings[`${provider}Key`];

  // Fallback mechanism: missing API key -> warn the user and open settings.
  if (!apiKey) {
    await sendToTab(tab.id, {
      type: "SHOW_TOAST",
      level: "error",
      message: `Toree: No ${provider} API key set. Opening settings…`,
    });
    chrome.runtime.openOptionsPage();
    await Logger.warn(`Missing API key for provider "${provider}"`, { promptId: prompt.id });
    return;
  }

  const selectionText = info.selectionText || "";
  const finalPrompt = prompt.template.split("#TEXT#").join(selectionText);

  await sendToTab(tab.id, { type: "SHOW_LOADER", message: "Toree is thinking…" });

  try {
    const resultText = await callModel(provider, prompt.model, finalPrompt, apiKey);

    await sendToTab(tab.id, { type: "HIDE_LOADER" });

    if (info.editable) {
      await sendToTab(tab.id, { type: "REPLACE_SELECTION", text: resultText });
    } else {
      await sendToTab(tab.id, { type: "SHOW_RESULT_MODAL", text: resultText, title: prompt.title || "Toree result" });
    }

    await Logger.info(`Prompt "${prompt.title || prompt.id}" executed successfully`, {
      provider,
      model: prompt.model,
      editable: !!info.editable,
    });
  } catch (err) {
    await sendToTab(tab.id, { type: "HIDE_LOADER" });
    await sendToTab(tab.id, {
      type: "SHOW_TOAST",
      level: "error",
      message: `Toree: ${err.message || "Request failed."}`,
    });
    await Logger.error(`API call failed: ${err.message}`, {
      provider,
      model: prompt.model,
      stack: err.stack,
    });
  }
});

// Clicking the toolbar icon opens settings directly (no popup UI needed).
chrome.action.onClicked.addListener(() => {
  chrome.runtime.openOptionsPage();
});

// ---------------------------------------------------------------------------
// Messages from the options page (e.g. "test this API key")
// ---------------------------------------------------------------------------

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.type === "TEST_API_KEY") {
    (async () => {
      try {
        const result = await callModel(message.provider, message.model, "Reply with the single word: OK", message.apiKey);
        sendResponse({ ok: true, result });
      } catch (err) {
        await Logger.error(`API key test failed for ${message.provider}`, { stack: err.stack });
        sendResponse({ ok: false, error: err.message });
      }
    })();
    return true; // keep the message channel open for the async response
  }
  return false;
});

// ---------------------------------------------------------------------------
// LLM provider calls
// ---------------------------------------------------------------------------

async function callProviderOnce(provider, model, prompt, apiKey) {
  if (provider === "openai") return callOpenAI(model, prompt, apiKey);
  if (provider === "gemini") return callGemini(model, prompt, apiKey);
  if (provider === "groq") return callGroq(model, prompt, apiKey);
  throw new Error(`Unknown provider: ${provider}`);
}

// Tries the requested model first (unless it's the special "<provider>-auto"
// id, e.g. "groq-auto"), then walks down FALLBACK_MODELS[provider] any time
// the failure looks like "this model doesn't exist / isn't available to me"
// rather than a real error. Real errors (bad key, rate limit, network) are
// thrown immediately instead of silently burning through every fallback.
async function callModel(provider, requestedModel, prompt, apiKey) {
  const isAuto = requestedModel === `${provider}-auto`;
  const bareRequested =
    provider === "groq" && requestedModel?.startsWith("groq-") ? requestedModel.slice("groq-".length) : requestedModel;

  const candidates = [];
  if (!isAuto && bareRequested) candidates.push(bareRequested);
  (FALLBACK_MODELS[provider] || []).forEach((m) => {
    if (!candidates.includes(m)) candidates.push(m);
  });

  let lastErr;
  for (const model of candidates) {
    try {
      const text = await callProviderOnce(provider, model, prompt, apiKey);
      if (model !== bareRequested) {
        await Logger.warn(`"${bareRequested || "auto"}" unavailable for ${provider} — auto-picked "${model}" instead`, {
          provider,
        });
      }
      return text;
    } catch (err) {
      lastErr = err;
      if (!isModelUnavailableError(err.message)) throw err;
      await Logger.warn(`Model "${model}" unavailable for ${provider}, trying next fallback…`, { error: err.message });
    }
  }
  throw lastErr || new Error(`No working model found for ${provider}.`);
}

async function safeJson(res) {
  try {
    return await res.json();
  } catch {
    return null;
  }
}

async function callOpenAI(model, prompt, apiKey) {
  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: model || "gpt-4o-mini",
      messages: [{ role: "user", content: prompt }],
      temperature: 0.3,
    }),
  });
  if (!res.ok) {
    const body = await safeJson(res);
    throw new Error(body?.error?.message || `OpenAI error (${res.status})`);
  }
  const data = await res.json();
  return (data.choices?.[0]?.message?.content || "").trim();
}

async function callGroq(model, prompt, apiKey) {
  const res = await fetch("https://api.groq.com/openai/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: model || "openai/gpt-oss-20b",
      messages: [{ role: "user", content: prompt }],
      temperature: 0.3,
    }),
  });
  if (!res.ok) {
    const body = await safeJson(res);
    throw new Error(body?.error?.message || `Groq error (${res.status})`);
  }
  const data = await res.json();
  return (data.choices?.[0]?.message?.content || "").trim();
}

async function callGemini(model, prompt, apiKey) {
  const modelName = model || "gemini-2.0-flash";
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${modelName}:generateContent?key=${apiKey}`;
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }] }),
  });
  if (!res.ok) {
    const body = await safeJson(res);
    throw new Error(body?.error?.message || `Gemini error (${res.status})`);
  }
  const data = await res.json();
  return (data.candidates?.[0]?.content?.parts?.[0]?.text || "").trim();
}

// Catch anything that slips past try/catch blocks above so it still lands in
// the Debug & Logs tab instead of silently dying with the service worker.
self.addEventListener("unhandledrejection", (event) => {
  Logger.error("Unhandled rejection in background service worker", {
    stack: event.reason?.stack || String(event.reason),
  });
});
