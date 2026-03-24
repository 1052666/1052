// ─── Global state ─────────────────────────────────────────────────
const state = {
  messages:        [],   // {role, content}
  isStreaming:     false,
  abortController: null,
  settings:        {},
};

// ─── Model → default base URL mapping ─────────────────────────────
const MODEL_URLS = {
  "deepseek-chat":     "https://api.deepseek.com/v1",
  "deepseek-reasoner": "https://api.deepseek.com/v1",
  "moonshot-v1-8k":    "https://api.moonshot.cn/v1",
  "glm-4-flash":       "https://open.bigmodel.cn/api/paas/v4",
};

// ─── Cached DOM references ─────────────────────────────────────────
const msgs       = $("chat-messages");
const welcome    = $("welcome");
const userInput  = $("user-input");
const sendBtn    = $("send-btn");
const stopBtn    = $("stop-btn");
const statusDot  = $("status-dot");
const statusText = $("status-text");
const modelLabel = $("model-label");
