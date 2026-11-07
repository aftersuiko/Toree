// utils/storage.js
// Centralized access to chrome.storage for Toree.
// Prompts (potentially many / long) live in storage.local.
// Settings (API keys, default model) live in storage.sync so they follow the
// user across signed-in Chrome instances.

const PROMPTS_KEY = "toree_prompts";
const SETTINGS_KEY = "toree_settings";

const DEFAULT_SETTINGS = {
  openaiKey: "",
  geminiKey: "",
  groqKey: "",
  defaultModel: "gpt-4o-mini",
};

// A set of starter prompts created on first install so the context menu
// isn't empty the first time a user right-clicks selected text.
const STARTER_PROMPTS = [
  {
    title: "Rephrase professionally",
    template: "Rephrase the following text in a clear, professional tone. Return only the rewritten text, nothing else:\n\n#TEXT#",
    model: "gpt-4o-mini",
  },
  {
    title: "Summarize",
    template: "Summarize the following text in 2-3 concise sentences:\n\n#TEXT#",
    model: "gpt-4o-mini",
  },
  {
    title: "Fix grammar & spelling",
    template: "Correct any grammar and spelling mistakes in the following text. Return only the corrected text:\n\n#TEXT#",
    model: "gpt-4o-mini",
  },
];

function generateId() {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

async function getPrompts() {
  const data = await chrome.storage.local.get(PROMPTS_KEY);
  return Array.isArray(data[PROMPTS_KEY]) ? data[PROMPTS_KEY] : [];
}

async function savePrompts(prompts) {
  await chrome.storage.local.set({ [PROMPTS_KEY]: prompts });
}

async function seedStarterPromptsIfEmpty() {
  const existing = await getPrompts();
  if (existing.length > 0) return existing;
  const seeded = STARTER_PROMPTS.map((p) => ({
    id: generateId(),
    createdAt: Date.now(),
    ...p,
  }));
  await savePrompts(seeded);
  return seeded;
}

async function addPrompt({ title, template, model }) {
  if (!template || !template.includes("#TEXT#")) {
    throw new Error('Prompt template must contain the "#TEXT#" placeholder.');
  }
  const prompts = await getPrompts();
  const prompt = {
    id: generateId(),
    title: (title || "").trim(),
    template,
    model: model || DEFAULT_SETTINGS.defaultModel,
    createdAt: Date.now(),
  };
  prompts.push(prompt);
  await savePrompts(prompts);
  return prompt;
}

async function updatePrompt(id, updates) {
  const prompts = await getPrompts();
  const idx = prompts.findIndex((p) => p.id === id);
  if (idx === -1) throw new Error("Prompt not found.");
  prompts[idx] = { ...prompts[idx], ...updates };
  await savePrompts(prompts);
  return prompts[idx];
}

async function deletePrompt(id) {
  const prompts = await getPrompts();
  const next = prompts.filter((p) => p.id !== id);
  await savePrompts(next);
  return next;
}

async function getSettings() {
  const data = await chrome.storage.sync.get(SETTINGS_KEY);
  return { ...DEFAULT_SETTINGS, ...(data[SETTINGS_KEY] || {}) };
}

async function saveSettings(partialSettings) {
  const current = await getSettings();
  const merged = { ...current, ...partialSettings };
  await chrome.storage.sync.set({ [SETTINGS_KEY]: merged });
  return merged;
}

export const Storage = {
  PROMPTS_KEY,
  SETTINGS_KEY,
  DEFAULT_SETTINGS,
  generateId,
  getPrompts,
  savePrompts,
  seedStarterPromptsIfEmpty,
  addPrompt,
  updatePrompt,
  deletePrompt,
  getSettings,
  saveSettings,
};
