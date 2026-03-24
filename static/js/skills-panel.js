// ─── Skills panel ─────────────────────────────────────────────────

async function loadSkills() {
  try {
    const res = await fetch("/skills");
    const { skills } = await res.json();
    renderSkills(skills);
  } catch {
    $("skill-list").innerHTML =
      '<div style="font-size:12px;color:#ef4444">无法获取技能状态</div>';
  }
}

function renderSkills(skills) {
  const list = $("skill-list");
  if (!skills || skills.length === 0) {
    list.innerHTML =
      '<div style="font-size:12px;color:#6b7280;text-align:center;padding:6px 0">暂无技能<br>' +
      '<span style="font-size:10px">在 skills/ 目录下创建技能文件夹</span></div>';
    return;
  }
  list.innerHTML = skills.map(s => `
    <div class="skill-card" data-name="${escHtml(s.name)}" title="点击查看详情">
      <div class="skill-card-header">
        <span class="skill-icon">🎯</span>
        <span class="skill-name">${escHtml(s.name)}</span>
        <span class="skill-badge">已加载</span>
      </div>
      <div class="skill-desc">${escHtml(s.description)}</div>
    </div>`
  ).join("");

  // Click to preview full content
  list.querySelectorAll(".skill-card").forEach(card => {
    card.addEventListener("click", async () => {
      const name = card.dataset.name;
      try {
        const res = await fetch(`/skills/${encodeURIComponent(name)}`);
        const { content } = await res.json();
        showSkillPreview(name, content);
      } catch (e) {
        alert("获取技能详情失败: " + e.message);
      }
    });
  });
}

function showSkillPreview(name, content) {
  const overlay = document.createElement("div");
  overlay.style.cssText =
    "position:fixed;inset:0;background:rgba(0,0,0,.55);z-index:200;display:flex;align-items:center;justify-content:center;padding:24px";

  const box = document.createElement("div");
  box.style.cssText =
    "background:#1a1d23;border:1px solid #3d4452;border-radius:10px;width:100%;max-width:620px;" +
    "max-height:80vh;display:flex;flex-direction:column;overflow:hidden";

  box.innerHTML = `
    <div style="display:flex;align-items:center;justify-content:space-between;padding:14px 18px;border-bottom:1px solid #2d3340">
      <span style="font-size:14px;font-weight:600;color:#f9fafb">🎯 ${escHtml(name)}</span>
      <button id="skill-preview-close" style="background:none;border:none;color:#9ca3af;font-size:18px;cursor:pointer;line-height:1">×</button>
    </div>
    <pre style="margin:0;padding:16px;overflow:auto;font-size:12px;font-family:'Fira Code',monospace;color:#e5e7eb;white-space:pre-wrap;word-break:break-all;line-height:1.6">${escHtml(content)}</pre>`;

  overlay.appendChild(box);
  document.body.appendChild(overlay);

  const close = () => document.body.removeChild(overlay);
  box.querySelector("#skill-preview-close").addEventListener("click", close);
  overlay.addEventListener("click", e => { if (e.target === overlay) close(); });
}

// ─── Skills event listeners ───────────────────────────────────────

$("skill-reload-btn").addEventListener("click", async () => {
  const btn = $("skill-reload-btn");
  btn.textContent = "↺ 重载中...";
  btn.disabled = true;
  try {
    const res = await fetch("/skills/reload", { method: "POST" });
    const { skills } = await res.json();
    renderSkills(skills);
  } finally {
    btn.textContent = "↺ 重载";
    btn.disabled = false;
  }
});
