"""
SkillManager — 扫描 skills/ 目录，热加载 SKILL.md 技能文件。

SKILL.md 格式：
---
name: skill-name
description: 简要说明技能用途及触发场景
---
# 技能标题
... 正文指令 ...
"""

import asyncio
from pathlib import Path


def _parse_frontmatter(text: str) -> tuple[dict, str]:
    """从 Markdown 文本中解析 YAML frontmatter（--- ... ---）。"""
    if not text.startswith("---"):
        return {}, text
    end = text.find("\n---", 3)
    if end == -1:
        return {}, text
    fm_text = text[3:end].strip()
    body = text[end + 4:].lstrip("\n")
    meta: dict = {}
    for line in fm_text.splitlines():
        if ":" in line:
            k, _, v = line.partition(":")
            meta[k.strip()] = v.strip()
    return meta, body


class _Skill:
    __slots__ = ("name", "description", "path", "mtime", "full_text")

    def __init__(self, name: str, description: str, path: Path, mtime: float, full_text: str):
        self.name        = name
        self.description = description
        self.path        = path
        self.mtime       = mtime
        self.full_text   = full_text   # 完整 SKILL.md 内容，invoke 时返回


class SkillManager:
    def __init__(self, skills_dir: Path):
        self._dir    = skills_dir
        self._skills: dict[str, _Skill] = {}   # name → _Skill

    # ─── Loading ──────────────────────────────────────────────────

    def load_all(self):
        """扫描技能目录，加载所有技能。"""
        self._skills.clear()
        if not self._dir.exists():
            return
        for skill_dir in sorted(self._dir.iterdir()):
            if not skill_dir.is_dir():
                continue
            self._try_load(skill_dir / "SKILL.md")

    def _try_load(self, path: Path) -> bool:
        try:
            if not path.exists():
                return False
            text  = path.read_text(encoding="utf-8")
            mtime = path.stat().st_mtime
            meta, _ = _parse_frontmatter(text)
            name        = meta.get("name", "").strip()
            description = meta.get("description", "").strip()
            if not name or not description:
                print(f"[Skill] 跳过 {path}（缺少 name 或 description）")
                return False
            self._skills[name] = _Skill(
                name=name, description=description,
                path=path, mtime=mtime, full_text=text,
            )
            print(f"[Skill] 已加载: {name}")
            return True
        except Exception as e:
            print(f"[Skill] 加载失败 {path}: {e}")
            return False

    def _reload_changed(self):
        """检测变更并增量更新，由热重载任务周期调用。"""
        if not self._dir.exists():
            return

        current_paths: set[Path] = set()
        for d in self._dir.iterdir():
            if d.is_dir():
                p = d / "SKILL.md"
                if p.exists():
                    current_paths.add(p)

        # 新增 / 修改
        for path in current_paths:
            try:
                mtime = path.stat().st_mtime
            except OSError:
                continue
            existing = next((s for s in self._skills.values() if s.path == path), None)
            if existing is None or existing.mtime < mtime:
                self._try_load(path)

        # 删除
        removed = {n for n, s in self._skills.items() if s.path not in current_paths}
        for name in removed:
            print(f"[Skill] 已移除: {name}")
            del self._skills[name]

    # ─── Background hot-reload ────────────────────────────────────

    async def watch(self, interval: float = 3.0):
        """异步热重载循环，作为后台任务运行。"""
        while True:
            await asyncio.sleep(interval)
            self._reload_changed()

    # ─── Public API ───────────────────────────────────────────────

    def skill_list(self) -> list[dict]:
        return [{"name": s.name, "description": s.description} for s in self._skills.values()]

    def invoke(self, name: str) -> str:
        """返回完整 SKILL.md 文本，供 AI 获取技能指令。"""
        skill = self._skills.get(name)
        if not skill:
            available = "、".join(self._skills) or "（暂无技能）"
            return f"技能 '{name}' 不存在。当前可用技能：{available}"
        return skill.full_text

    def get_system_prompt_section(self) -> str:
        """生成注入 system prompt 的技能摘要段落。"""
        if not self._skills:
            return ""
        lines = [
            "\n\n## 可用技能（Skills）",
            "当任务涉及下列技能时，先调用 `invoke_skill` 工具获取完整操作指引，再执行任务。\n",
        ]
        for s in self._skills.values():
            lines.append(f"- **{s.name}**: {s.description}")
        return "\n".join(lines)
