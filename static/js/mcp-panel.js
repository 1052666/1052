// ─── MCP server management ────────────────────────────────────────

async function loadMCPServers() {
  try {
    const res = await fetch("/mcp/servers");
    const { servers } = await res.json();
    renderMCPServers(servers);
  } catch {
    $("mcp-server-list").innerHTML =
      '<div style="font-size:12px;color:#ef4444">无法获取 MCP 状态</div>';
  }
}

function renderMCPServers(servers) {
  const list = $("mcp-server-list");
  if (!servers || servers.length === 0) {
    list.innerHTML =
      '<div style="font-size:12px;color:#6b7280;text-align:center;padding:6px 0">暂无 MCP 服务器<br><span style="font-size:10px">点击「配置」添加</span></div>';
    return;
  }
  list.innerHTML = servers.map(s => {
    const dotClass = s.status === "connected" ? "connected" : "error";
    const toolTags = s.tools.length
      ? s.tools.map(t => `<span class="mcp-tool-tag">${t.name}</span>`).join("")
      : '<span style="color:#6b7280;font-size:10px">无工具</span>';
    const errLine = s.error
      ? `<div class="mcp-error">⚠ ${escHtml(s.error)}</div>` : "";
    return `
      <div class="mcp-card">
        <div class="mcp-card-header">
          <span class="mcp-dot ${dotClass}"></span>
          <span class="mcp-name">${escHtml(s.name)}</span>
          <span style="font-size:10px;color:${s.status === 'connected' ? '#22c55e' : '#ef4444'}">${s.status === 'connected' ? '已连接' : '失败'}</span>
        </div>
        ${errLine}
        ${s.tools.length ? `<div class="mcp-tools">${toolTags}</div>` : ""}
      </div>`;
  }).join("");
}

// ─── MCP event listeners ──────────────────────────────────────────

$("mcp-edit-btn").addEventListener("click", async () => {
  const res = await fetch("/mcp/config");
  const { content } = await res.json();
  try { $("mcp-config-editor").value = JSON.stringify(JSON.parse(content), null, 2); }
  catch { $("mcp-config-editor").value = content; }
  $("mcp-editor-wrap").style.display = "block";
  $("mcp-edit-btn").style.display    = "none";
});

$("mcp-cancel-btn").addEventListener("click", () => {
  $("mcp-editor-wrap").style.display = "none";
  $("mcp-edit-btn").style.display    = "inline-block";
});

$("mcp-save-btn").addEventListener("click", async () => {
  const content = $("mcp-config-editor").value;
  try { JSON.parse(content); } catch {
    alert("JSON 格式有误，请检查后保存。");
    return;
  }
  try {
    await fetch("/mcp/config", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ content }),
    });
    $("mcp-editor-wrap").style.display = "none";
    $("mcp-edit-btn").style.display    = "inline-block";
    flashBtn($("mcp-save-btn"), "连接中...");
    const res = await fetch("/mcp/reload", { method: "POST" });
    const { servers } = await res.json();
    renderMCPServers(servers);
  } catch (e) {
    alert("保存失败: " + e.message);
  }
});

$("mcp-reload-btn").addEventListener("click", async () => {
  $("mcp-reload-btn").textContent = "↺ 重连中...";
  $("mcp-reload-btn").disabled = true;
  try {
    const res = await fetch("/mcp/reload", { method: "POST" });
    const { servers } = await res.json();
    renderMCPServers(servers);
  } finally {
    $("mcp-reload-btn").textContent = "↺ 重连";
    $("mcp-reload-btn").disabled = false;
  }
});
