// ─── Marked / highlight.js setup ──────────────────────────────────
(function setupMarked() {
  const renderer = new marked.Renderer();
  renderer.code = function (code, lang) {
    const language = lang && hljs.getLanguage(lang) ? lang : "plaintext";
    const highlighted = hljs.highlight(
      typeof code === "object" ? code.text : code,
      { language }
    ).value;
    return `<pre><code class="hljs language-${language}">${highlighted}</code></pre>`;
  };
  marked.setOptions({ renderer, breaks: true, gfm: true });
})();

// ─── Auto-resize textarea ─────────────────────────────────────────
function autoResizeTextarea() {
  userInput.style.height = "auto";
  userInput.style.height = Math.min(userInput.scrollHeight, 160) + "px";
}

// ─── Init: load data on page ready ───────────────────────────────
(function init() {
  loadSettings();
  loadSystemPrompt();
  loadMCPServers();
  loadSkills();
  loadScheduler();
  loadIMConfig();
  loadConversationHistory();
  loadEvolutionStatus();
  autoResizeTextarea();
})();

// ─── Chat event listeners ─────────────────────────────────────────
sendBtn.addEventListener("click", sendMessage);
stopBtn.addEventListener("click", stopStreaming);
$("clear-btn").addEventListener("click", clearChat);

userInput.addEventListener("keydown", e => {
  if (e.key === "Enter" && !e.shiftKey) {
    e.preventDefault();
    const text = userInput.value.trim();
    if (text === "/new") {
      userInput.value = "";
      autoResizeTextarea();
      clearChat();
      return;
    }
    if (text === "/1052" || text === "/1052菜单") {
      userInput.value = "";
      autoResizeTextarea();
      showCommandMenu();
      return;
    }
    if (text === "/1052进化") {
      userInput.value = "";
      autoResizeTextarea();
      toggleEvolution();
      return;
    }
    sendMessage();
  }
});

userInput.addEventListener("input", autoResizeTextarea);

// ─── Slash command clicks ─────────────────────────────────────────
document.querySelectorAll(".cmd-item[data-cmd]").forEach(el => {
  el.addEventListener("click", () => {
    if (el.dataset.cmd === "/new") {
      clearChat();
    } else if (el.dataset.cmd === "/1052" || el.dataset.cmd === "/1052菜单") {
      showCommandMenu();
    } else if (el.dataset.cmd === "/1052进化") {
      toggleEvolution();
    }
  });
});

// ─── Command menu ────────────────────────────────────────────────
function showCommandMenu() {
  const menuText = `📋 <b>1052 可用命令</b>

<code>/new</code> - 新建对话，清空上下文
<code>/1052</code> - 显示命令菜单
<code>/1052进化</code> - 开启进化模式（自主思考）
<code>/help</code> - 查看帮助

直接发送消息与我对话`;

  appendMessage("ai", menuText);
}

// ─── Evolution mode ────────────────────────────────────────────────
let evolutionActive = false;

async function loadEvolutionStatus() {
  try {
    const res = await fetch("/im/evolution/status");
    const data = await res.json();
    updateEvolutionUI(data);
  } catch (e) {
    console.error("Failed to load evolution status:", e);
  }
}

function updateEvolutionUI(data) {
  const panel = $("evolution-panel");
  const badge = $("evolution-status-badge");
  const info = $("evolution-info");
  const stopBtn = $("evolution-stop-btn");

  if (!panel) return;

  if (data.active) {
    panel.style.display = "block";
    badge.textContent = "运行中";
    badge.style.background = "#16a34a";
    badge.style.color = "#fff";
    info.innerHTML = `平台: ${data.platform}<br>开始: ${data.start_time || "-"}<br>结果数: ${data.result_count}`;
    stopBtn.style.display = "block";
    evolutionActive = true;
  } else {
    panel.style.display = "none";
    evolutionActive = false;
  }
}

async function toggleEvolution() {
  if (evolutionActive) {
    // 停止进化模式
    try {
      const res = await fetch("/im/evolution/stop", { method: "POST" });
      const data = await res.json();
      if (data.ok) {
        appendMessage("ai", "✅ " + data.message);
        loadEvolutionStatus();
      } else {
        appendMessage("ai", "❌ " + data.message);
      }
    } catch (e) {
      appendMessage("ai", "❌ 停止进化模式失败");
    }
  } else {
    // 开始进化模式
    try {
      const res = await fetch("/im/evolution/start", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ platform: "web", user_id: "web_user" })
      });
      const data = await res.json();
      if (data.ok) {
        appendMessage("ai", "🔄 " + data.message);
        loadEvolutionStatus();
      } else {
        appendMessage("ai", "❌ " + data.message);
      }
    } catch (e) {
      appendMessage("ai", "❌ 启动进化模式失败");
    }
  }
}

$("evolution-stop-btn")?.addEventListener("click", toggleEvolution);

// ─── Tab switching ────────────────────────────────────────────────
document.querySelectorAll(".tab-btn").forEach(btn => {
  btn.addEventListener("click", () => {
    document.querySelectorAll(".tab-btn").forEach(b => b.classList.remove("active"));
    btn.classList.add("active");
    const tab = btn.dataset.tab;
    $("tab-chat").style.display     = tab === "chat"     ? "flex" : "none";
    $("tab-settings").style.display = tab === "settings" ? "block" : "none";
    if (tab === "chat") $("tab-chat").style.flexDirection = "column";
  });
});

// ─── Mobile sidebar ───────────────────────────────────────────────
$("toggle-sidebar").addEventListener("click", () => {
  $("sidebar").classList.toggle("open");
  $("overlay").classList.toggle("visible");
});
$("overlay").addEventListener("click", () => {
  $("sidebar").classList.remove("open");
  $("overlay").classList.remove("visible");
});
