// ─── Settings persistence (存服务端，API Key 不落浏览器) ───────────

async function loadSettings() {
  try {
    const res = await fetch("/config");
    const cfg = await res.json();

    // API Key：只显示脱敏提示，input 留空（placeholder 显示提示）
    const keyInput = $("api-key");
    keyInput.value = "";
    keyInput.placeholder = cfg.api_key_set
      ? `已配置 (${cfg.api_key_hint})，留空不修改`
      : "sk-...";

    if (cfg.base_url)    $("base-url").value = cfg.base_url;
    if (cfg.model)       setModelSelect(cfg.model);
    if (cfg.temperature != null) {
      $("temperature").value    = cfg.temperature;
      $("temp-val").textContent = cfg.temperature;
    }
    if (cfg.max_tokens != null) $("max-tokens").value = cfg.max_tokens;
  } catch {
    // 服务未就绪，忽略
  }
  // 清理旧版 localStorage 里可能存的 key
  localStorage.removeItem("ai_chat_settings");
  applySettings();
}

async function saveSettings() {
  const model  = getModel();
  const apiKey = $("api-key").value.trim();

  const body = {
    base_url:    $("base-url").value.trim(),
    model,
    temperature: parseFloat($("temperature").value),
    max_tokens:  parseInt($("max-tokens").value),
  };
  // 只有用户填了新 key 才上传
  if (apiKey) body.api_key = apiKey;

  try {
    await fetch("/config", {
      method:  "PUT",
      headers: { "Content-Type": "application/json" },
      body:    JSON.stringify(body),
    });
    // 保存成功后刷新 placeholder
    if (apiKey) {
      $("api-key").value = "";
      $("api-key").placeholder = `已配置 (${apiKey.slice(0,5)}...${apiKey.slice(-4)})，留空不修改`;
    }
    applySettings();
    flashBtn($("save-settings-btn"), "✓ 已保存");
  } catch (e) {
    alert("保存失败: " + e.message);
  }
}

function applySettings() {
  const model   = getModel();
  const keySet  = $("api-key").placeholder.startsWith("已配置") || $("api-key").value.trim();
  modelLabel.textContent = `模型: ${model || "未配置"}`;
  if (keySet) {
    setStatus("ok", `已配置 · ${model}`);
  } else {
    setStatus("", "未配置 API 密钥");
  }
  // 前端 state 不再持有 apiKey
  state.settings = {
    baseUrl:     $("base-url").value.trim(),
    model,
    temperature: parseFloat($("temperature").value),
    maxTokens:   parseInt($("max-tokens").value),
  };
}

function getModel() {
  const sel = $("model").value;
  return sel === "custom" ? $("custom-model").value.trim() : sel;
}

function setModelSelect(model) {
  const sel = $("model");
  const opt = [...sel.options].find(o => o.value === model);
  if (opt) {
    sel.value = model;
  } else {
    sel.value = "custom";
    $("custom-model").style.display = "block";
    $("custom-model").value = model;
  }
}

function setStatus(type, text) {
  statusDot.className = "status-dot" + (type ? " " + type : "");
  statusText.textContent = text;
}

// ─── System Prompt ────────────────────────────────────────────────

async function loadSystemPrompt() {
  try {
    const res = await fetch("/system-prompt");
    const { content } = await res.json();
    $("system-prompt").value = content;
    $("sp-preview").textContent = content;
  } catch {
    $("sp-preview").textContent = "(无法加载 system_prompt.md)";
  }
}

// ─── Settings event listeners ─────────────────────────────────────

$("save-settings-btn").addEventListener("click", saveSettings);

$("toggle-key").addEventListener("click", () => {
  const inp = $("api-key");
  inp.type = inp.type === "password" ? "text" : "password";
});

$("temperature").addEventListener("input", e => {
  $("temp-val").textContent = parseFloat(e.target.value).toFixed(1);
});

$("model").addEventListener("change", function () {
  const custom = $("custom-model");
  custom.style.display = this.value === "custom" ? "block" : "none";
  if (MODEL_URLS[this.value]) {
    $("base-url").value = MODEL_URLS[this.value];
  } else if (this.value.startsWith("gpt")) {
    $("base-url").value = "https://api.openai.com/v1";
  }
});

// ─── System prompt edit/save/cancel ──────────────────────────────

$("sp-edit-btn").addEventListener("click", () => {
  $("sp-preview").style.display    = "none";
  $("system-prompt").style.display = "block";
  $("sp-edit-btn").style.display   = "none";
  $("sp-save-btn").style.display   = "inline-block";
  $("sp-cancel-btn").style.display = "inline-block";
  $("system-prompt").focus();
});

$("sp-cancel-btn").addEventListener("click", () => {
  $("sp-preview").style.display    = "block";
  $("system-prompt").style.display = "none";
  $("sp-edit-btn").style.display   = "inline-block";
  $("sp-save-btn").style.display   = "none";
  $("sp-cancel-btn").style.display = "none";
  $("system-prompt").value = $("sp-preview").textContent;
});

$("sp-save-btn").addEventListener("click", async () => {
  const content = $("system-prompt").value;
  try {
    const res = await fetch("/system-prompt", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ content }),
    });
    if (!res.ok) throw new Error("保存失败");
    $("sp-preview").textContent = content;
    $("sp-preview").style.display    = "block";
    $("system-prompt").style.display = "none";
    $("sp-edit-btn").style.display   = "inline-block";
    $("sp-save-btn").style.display   = "none";
    $("sp-cancel-btn").style.display = "none";
    flashBtn($("sp-save-btn"), "✓ 已保存");
  } catch (e) {
    alert("保存失败: " + e.message);
  }
});
