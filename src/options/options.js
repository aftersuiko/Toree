// options/options.js
import { Storage } from "../utils/storage.js";
import { Logger } from "../utils/logger.js";

const MODEL_GROUPS = [
  {
    label: "OpenAI",
    provider: "openai",
    models: [
      { id: "gpt-4o-mini", label: "gpt-4o-mini" },
      { id: "gpt-4o", label: "gpt-4o" },
      { id: "gpt-4-turbo", label: "gpt-4-turbo" },
    ],
  },
  {
    label: "Google Gemini",
    provider: "gemini",
    models: [
      { id: "gemini-2.0-flash", label: "gemini-2.0-flash" },
      { id: "gemini-1.5-flash", label: "gemini-1.5-flash" },
      { id: "gemini-1.5-pro", label: "gemini-1.5-pro" },
    ],
  },
  {
    label: "Groq",
    provider: "groq",
    models: [
      { id: "groq-auto", label: "Auto (recommended — picks a working model)" },
      { id: "groq-openai/gpt-oss-120b", label: "groq · openai/gpt-oss-120b (best quality)" },
      { id: "groq-openai/gpt-oss-20b", label: "groq · openai/gpt-oss-20b (fastest)" },
      { id: "groq-qwen/qwen3-32b", label: "groq · qwen/qwen3-32b" },
      { id: "groq-allam-2-7b", label: "groq · allam-2-7b (small, EN/AR)" },
    ],
  },
];

function populateModelSelect(selectEl) {
  selectEl.innerHTML = "";
  MODEL_GROUPS.forEach((group) => {
    const optgroup = document.createElement("optgroup");
    optgroup.label = group.label;
    group.models.forEach((m) => {
      const opt = document.createElement("option");
      opt.value = m.id;
      opt.textContent = m.label;
      optgroup.appendChild(opt);
    });
    selectEl.appendChild(optgroup);
  });
}

function providerForModel(modelId) {
  for (const group of MODEL_GROUPS) {
    if (group.models.some((m) => m.id === modelId)) return group.provider;
  }
  return "openai";
}

// ---------------------------------------------------------------------------
// Tabs
// ---------------------------------------------------------------------------

document.querySelectorAll(".tab-btn").forEach((btn) => {
  btn.addEventListener("click", () => {
    document.querySelectorAll(".tab-btn").forEach((b) => b.classList.remove("active"));
    document.querySelectorAll(".panel").forEach((p) => p.classList.remove("active"));
    btn.classList.add("active");
    document.getElementById(`panel-${btn.dataset.tab}`).classList.add("active");
    if (btn.dataset.tab === "debug") renderLogs();
  });
});

// ---------------------------------------------------------------------------
// Toasts
// ---------------------------------------------------------------------------

function toast(message, level = "info") {
  const area = document.getElementById("toast-area");
  const el = document.createElement("div");
  el.className = `toast ${level}`;
  el.textContent = message;
  area.appendChild(el);
  setTimeout(() => el.remove(), 4000);
}

// ---------------------------------------------------------------------------
// Prompts tab
// ---------------------------------------------------------------------------

const promptTitleEl = document.getElementById("prompt-title");
const promptTemplateEl = document.getElementById("prompt-template");
const promptModelEl = document.getElementById("prompt-model");
const promptSaveBtn = document.getElementById("prompt-save");
const promptCancelBtn = document.getElementById("prompt-cancel-edit");
const promptFormTitle = document.getElementById("prompt-form-title");
const promptListEl = document.getElementById("prompt-list");

populateModelSelect(promptModelEl);

let editingPromptId = null;

function resetPromptForm() {
  editingPromptId = null;
  promptTitleEl.value = "";
  promptTemplateEl.value = "";
  promptModelEl.value = MODEL_GROUPS[0].models[0].id;
  promptFormTitle.textContent = "Add a prompt";
  promptSaveBtn.textContent = "Save prompt";
  promptCancelBtn.style.display = "none";
}

async function renderPrompts() {
  const prompts = await Storage.getPrompts();
  promptListEl.innerHTML = "";

  if (prompts.length === 0) {
    promptListEl.innerHTML = '<p class="empty-state">No prompts yet. Add one above — it will appear instantly in the right-click menu.</p>';
    return;
  }

  prompts.forEach((prompt) => {
    const item = document.createElement("div");
    item.className = "prompt-item";

    const head = document.createElement("div");
    head.className = "prompt-item-head";

    const titleWrap = document.createElement("div");
    const strong = document.createElement("strong");
    strong.textContent = prompt.title || "(untitled)";
    const tag = document.createElement("span");
    tag.className = "model-tag";
    tag.textContent = prompt.model;
    titleWrap.appendChild(strong);
    titleWrap.appendChild(tag);

    const btnWrap = document.createElement("div");
    const editBtn = document.createElement("button");
    editBtn.className = "btn small";
    editBtn.textContent = "Edit";
    editBtn.addEventListener("click", () => startEditPrompt(prompt));
    const delBtn = document.createElement("button");
    delBtn.className = "btn small danger";
    delBtn.textContent = "Delete";
    delBtn.addEventListener("click", () => deletePromptConfirm(prompt));
    btnWrap.appendChild(editBtn);
    btnWrap.appendChild(delBtn);

    head.appendChild(titleWrap);
    head.appendChild(btnWrap);

    const template = document.createElement("div");
    template.className = "prompt-template";
    template.textContent = prompt.template;

    item.appendChild(head);
    item.appendChild(template);
    promptListEl.appendChild(item);
  });
}

function startEditPrompt(prompt) {
  editingPromptId = prompt.id;
  promptTitleEl.value = prompt.title || "";
  promptTemplateEl.value = prompt.template;
  promptModelEl.value = prompt.model;
  promptFormTitle.textContent = "Edit prompt";
  promptSaveBtn.textContent = "Update prompt";
  promptCancelBtn.style.display = "inline-block";
  document.querySelector('.tab-btn[data-tab="prompts"]').scrollIntoView({ behavior: "smooth" });
}

async function deletePromptConfirm(prompt) {
  const ok = window.confirm(`Delete the prompt "${prompt.title || prompt.template.slice(0, 30)}"?`);
  if (!ok) return;
  await Storage.deletePrompt(prompt.id);
  await Logger.info(`Prompt deleted: ${prompt.title || prompt.id}`);
  toast("Prompt deleted.", "success");
  renderPrompts();
}

promptCancelBtn.addEventListener("click", resetPromptForm);

promptSaveBtn.addEventListener("click", async () => {
  const title = promptTitleEl.value.trim();
  const template = promptTemplateEl.value.trim();
  const model = promptModelEl.value;

  if (!template) {
    toast("Please enter a prompt template.", "error");
    return;
  }
  if (!template.includes("#TEXT#")) {
    toast('The template must include the "#TEXT#" placeholder.', "error");
    return;
  }

  try {
    if (editingPromptId) {
      await Storage.updatePrompt(editingPromptId, { title, template, model });
      await Logger.info(`Prompt updated: ${title || editingPromptId}`);
      toast("Prompt updated.", "success");
    } else {
      await Storage.addPrompt({ title, template, model });
      await Logger.info(`Prompt created: ${title || "(untitled)"}`);
      toast("Prompt saved — check your right-click menu!", "success");
    }
    resetPromptForm();
    renderPrompts();
  } catch (err) {
    toast(err.message, "error");
    await Logger.error("Failed to save prompt", { stack: err.stack });
  }
});

// ---------------------------------------------------------------------------
// Settings tab
// ---------------------------------------------------------------------------

const defaultModelEl = document.getElementById("default-model");
populateModelSelect(defaultModelEl);

const openaiKeyEl = document.getElementById("openai-key");
const geminiKeyEl = document.getElementById("gemini-key");
const groqKeyEl = document.getElementById("groq-key");

async function renderSettings() {
  const settings = await Storage.getSettings();
  openaiKeyEl.value = settings.openaiKey || "";
  geminiKeyEl.value = settings.geminiKey || "";
  groqKeyEl.value = settings.groqKey || "";
  defaultModelEl.value = settings.defaultModel || MODEL_GROUPS[0].models[0].id;
}

document.getElementById("settings-save").addEventListener("click", async () => {
  await Storage.saveSettings({
    openaiKey: openaiKeyEl.value.trim(),
    geminiKey: geminiKeyEl.value.trim(),
    groqKey: groqKeyEl.value.trim(),
    defaultModel: defaultModelEl.value,
  });
  await Logger.info("Settings saved");
  toast("Settings saved.", "success");
});

document.querySelectorAll("[data-test]").forEach((btn) => {
  btn.addEventListener("click", async () => {
    const provider = btn.dataset.test;
    const keyEl = { openai: openaiKeyEl, gemini: geminiKeyEl, groq: groqKeyEl }[provider];
    const statusEl = document.getElementById(`${provider}-status`);
    const apiKey = keyEl.value.trim();

    if (!apiKey) {
      toast(`Enter a ${provider} API key first.`, "error");
      return;
    }

    const model = MODEL_GROUPS.find((g) => g.provider === provider).models[0].id;
    statusEl.textContent = "";
    btn.disabled = true;
    btn.textContent = "Testing…";

    chrome.runtime.sendMessage({ type: "TEST_API_KEY", provider, model, apiKey }, (response) => {
      btn.disabled = false;
      btn.textContent = "Test";
      if (chrome.runtime.lastError) {
        statusEl.innerHTML = `<span class="status-pill fail">error</span>`;
        toast(chrome.runtime.lastError.message, "error");
        return;
      }
      if (response?.ok) {
        statusEl.innerHTML = `<span class="status-pill ok">working</span>`;
      } else {
        statusEl.innerHTML = `<span class="status-pill fail">failed</span>`;
        toast(response?.error || "Key test failed.", "error");
      }
    });
  });
});

// ---------------------------------------------------------------------------
// Debug & Logs tab
// ---------------------------------------------------------------------------

async function renderLogs() {
  const logs = await Logger.getLogs();
  const tbody = document.getElementById("log-tbody");
  const countEl = document.getElementById("log-count");
  countEl.textContent = `(${logs.length} of last ${Logger.MAX_LOGS})`;
  tbody.innerHTML = "";

  if (logs.length === 0) {
    tbody.innerHTML = '<tr><td colspan="3" class="empty-state">No logs yet.</td></tr>';
    return;
  }

  [...logs].reverse().forEach((entry) => {
    const tr = document.createElement("tr");
    const time = new Date(entry.timestamp).toLocaleString();
    tr.innerHTML = `
      <td>${time}</td>
      <td><span class="level-badge ${entry.level}">${entry.level}</span></td>
      <td>${escapeHtml(entry.message)}</td>
    `;
    tbody.appendChild(tr);
  });
}

function escapeHtml(str) {
  const div = document.createElement("div");
  div.textContent = str;
  return div.innerHTML;
}

document.getElementById("refresh-logs").addEventListener("click", renderLogs);

document.getElementById("clear-logs").addEventListener("click", async () => {
  await Logger.clearLogs();
  toast("Logs cleared.", "success");
  renderLogs();
});

document.getElementById("export-logs").addEventListener("click", async () => {
  const markdown = await Logger.exportForClaude();
  const card = document.getElementById("export-card");
  const output = document.getElementById("export-output");
  card.style.display = "block";
  output.value = markdown;
  card.scrollIntoView({ behavior: "smooth" });

  try {
    await navigator.clipboard.writeText(markdown);
    toast("Debug export copied to clipboard.", "success");
  } catch {
    toast("Export ready below — clipboard copy failed, select & copy manually.", "info");
  }
});

// Live-refresh the log table if a background call logs something while the
// Debug tab is open.
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === "local" && changes.toree_logs && document.getElementById("panel-debug").classList.contains("active")) {
    renderLogs();
  }
});

// ---------------------------------------------------------------------------
// Init
// ---------------------------------------------------------------------------

resetPromptForm();
renderPrompts();
renderSettings();
