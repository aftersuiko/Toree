# Toree

A lightweight, no-nonsense Chrome extension (Manifest V3) that lets you run custom AI prompts on any highlighted text directly from your right-click context menu. 

Select text -> right-click -> run your custom prompt (grammar fix, rephrasing, summarization, code explanation, etc.).

---

## ✨ Features

- **Right-Click Context Menu Integration:** Add custom prompt templates using a `#TEXT#` placeholder.
- **Smart Text Handling:** 
  - Automatically replaces text **inline** if you're inside an editable field (inputs, textareas, contenteditable elements).
  - Shows a non-intrusive **floating modal / toast** if you highlight standard, non-editable web text.
- **Custom API Key & Endpoint Support:** Connect your own keys (Google Gemini, OpenAI, or compatible custom endpoints). Perfect for taking advantage of free API tiers.
- **Built-in Debug Logger:** Automatically catches and formats runtime errors into clean Markdown code blocks so you can easily copy-paste them to Claude/ChatGPT for quick troubleshooting.

---

## 🚀 Installation & Setup

### 1. Load into Browser
1. Download Toree from release.
2. Open Chrome/Brave and navigate to `chrome://extensions/`.
3. Enable **Developer mode** (toggle in the top-right corner).
4. Click **Load unpacked** and select the folder containing this extension's code.

### 2. Configure Your API Key & Prompts
1. Click on the extension icon in your toolbar to open the **Options / Settings** page.
2. Select your provider (e.g., Gemini, OpenAI) and enter your API key.
3. Add your custom context menu options using `#TEXT#` where the highlighted text should be injected.
4. Save settings and test it out!

---

## 🛠️ Usage Example

1. Highlight any text on a webpage.
2. Right-click and hover over your extension's context menu.
3. Pick a custom prompt (e.g., *Fix Grammar* or *Rephrase*).
4. Watch it output in a modal or replace your text inline!

---

## 🐛 Debugging & Troubleshooting

If something breaks or an API call fails:
1. Open the extension popup / settings page.
2. Check the **Debug Log** section.
3. Click **Copy Markdown Logs** to instantly copy clean runtime exception details formatted specifically for AI debugging.

---

## 📝 License

[MIT](LICENSE) - Free to tweak, break, and modify as you like!
