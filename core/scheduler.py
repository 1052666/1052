"""
TaskScheduler — 定时任务管理器

调度表达式格式：
  daily:09:00          每天 09:00 执行
  interval:30          每 30 分钟执行一次
  cron:0 9 * * 1       标准 5 字段 Cron 表达式（需安装 croniter）
  once:2024-01-01T09:00:00  一次性任务，执行后自动禁用

上下文文件：data/tasks/{task_id}/context.txt  (追加写入)
任务配置：  data/tasks.json
"""

import asyncio
import json
import uuid
from datetime import datetime, timedelta
from pathlib import Path
from typing import Optional

try:
    from croniter import croniter as _croniter
    HAS_CRONITER = True
except ImportError:
    HAS_CRONITER = False


class TaskScheduler:
    def __init__(self, data_dir: Path):
        self._tasks_file = data_dir / "tasks.json"
        self._tasks_dir  = data_dir / "tasks"
        self._tasks: dict[str, dict] = {}
        self._app_state = None  # 用于发送消息

    def set_app_state(self, app_state):
        """设置 app_state，用于发送消息"""
        self._app_state = app_state

    # ─── Persistence ──────────────────────────────────────────────

    def load(self):
        self._tasks_dir.mkdir(parents=True, exist_ok=True)
        if self._tasks_file.exists():
            try:
                self._tasks = json.loads(self._tasks_file.read_text(encoding="utf-8"))
            except Exception as e:
                print(f"[Scheduler] 加载失败: {e}")
                self._tasks = {}
        print(f"[Scheduler] 已加载 {len(self._tasks)} 个定时任务")

    def _save(self):
        self._tasks_file.parent.mkdir(parents=True, exist_ok=True)
        self._tasks_file.write_text(
            json.dumps(self._tasks, ensure_ascii=False, indent=2),
            encoding="utf-8",
        )

    # ─── Schedule calculation ──────────────────────────────────────

    def _next_run(self, schedule: str) -> Optional[str]:
        """根据调度表达式计算下次执行时间（ISO 格式字符串）。"""
        now = datetime.now()
        try:
            if schedule.startswith("interval:"):
                minutes = int(schedule.split(":", 1)[1])
                return (now + timedelta(minutes=minutes)).isoformat()

            elif schedule.startswith("daily:"):
                time_str = schedule.split(":", 1)[1]   # "09:00"
                h, m = map(int, time_str.split(":"))
                target = now.replace(hour=h, minute=m, second=0, microsecond=0)
                if target <= now:
                    target += timedelta(days=1)
                return target.isoformat()

            elif schedule.startswith("cron:"):
                expr = schedule.split(":", 1)[1]
                if HAS_CRONITER:
                    return _croniter(expr, now).get_next(datetime).isoformat()
                print("[Scheduler] cron 表达式需要安装 croniter (pip install croniter)")
                return None

            elif schedule.startswith("once:"):
                return schedule.split(":", 1)[1]   # ISO datetime string

        except Exception as e:
            print(f"[Scheduler] 解析调度表达式失败 '{schedule}': {e}")
        return None

    def _fmt_next(self, iso: Optional[str]) -> str:
        if not iso:
            return "—"
        try:
            dt = datetime.fromisoformat(iso)
            return dt.strftime("%Y-%m-%d %H:%M")
        except Exception:
            return iso

    # ─── CRUD ─────────────────────────────────────────────────────

    def task_list(self) -> list[dict]:
        result = []
        for t in self._tasks.values():
            row = dict(t)
            row["api_key"] = "***" if t.get("api_key") else ""  # mask key
            row["next_run_fmt"] = self._fmt_next(t.get("next_run"))
            row["last_run_fmt"] = self._fmt_next(t.get("last_run"))
            result.append(row)
        return result

    def create_task(self, data: dict) -> dict:
        task_id = str(uuid.uuid4())[:8]
        task = {
            "id":          task_id,
            "name":        data["name"],
            "prompt":      data["prompt"],
            "schedule":    data["schedule"],
            "api_key":     data.get("api_key", ""),
            "base_url":    data.get("base_url", "https://api.openai.com/v1"),
            "model":       data.get("model", "gpt-4o-mini"),
            "temperature": float(data.get("temperature", 0.7)),
            "max_tokens":  int(data.get("max_tokens", 2048)),
            "enabled":     bool(data.get("enabled", True)),
            "created_at":  datetime.now().isoformat(),
            "last_run":    None,
            "next_run":    self._next_run(data["schedule"]),
            "run_count":   0,
            # 目标平台和用户（用于发送结果）
            "platform":    data.get("platform", "telegram"),
            "user_id":     data.get("user_id", ""),
        }
        self._tasks[task_id] = task
        (self._tasks_dir / task_id).mkdir(parents=True, exist_ok=True)
        self._save()
        print(f"[Scheduler] 创建任务: {task['name']} ({task_id}), 平台: {task['platform']}, 用户: {task['user_id']}")
        return task

    def update_task(self, task_id: str, data: dict) -> Optional[dict]:
        task = self._tasks.get(task_id)
        if not task:
            return None
        for field in ["name", "prompt", "schedule", "api_key", "base_url",
                      "model", "temperature", "max_tokens", "enabled"]:
            if field in data and data[field] is not None:
                task[field] = data[field]
        if "schedule" in data:
            task["next_run"] = self._next_run(task["schedule"])
        self._save()
        return task

    def delete_task(self, task_id: str) -> bool:
        if task_id not in self._tasks:
            return False
        del self._tasks[task_id]
        self._save()
        return True

    # ─── Context file ─────────────────────────────────────────────

    def get_context(self, task_id: str) -> str:
        ctx = self._tasks_dir / task_id / "context.txt"
        if ctx.exists():
            return ctx.read_text(encoding="utf-8")
        return "(暂无执行记录)"

    def clear_context(self, task_id: str):
        ctx = self._tasks_dir / task_id / "context.txt"
        if ctx.exists():
            ctx.unlink()

    # ─── Execution ────────────────────────────────────────────────

    async def run_task(self, task_id: str) -> str:
        task = self._tasks.get(task_id)
        if not task:
            return f"任务 {task_id} 不存在"
        return await self._execute(task)

    async def _execute(self, task: dict) -> str:
        from openai import AsyncOpenAI

        now = datetime.now()
        name = task["name"]
        print(f"[Scheduler] ▶ 执行任务: {name}")

        try:
            client = AsyncOpenAI(
                api_key=task["api_key"],
                base_url=task.get("base_url") or "https://api.openai.com/v1",
            )
            resp = await client.chat.completions.create(
                model=task["model"],
                messages=[{"role": "user", "content": task["prompt"]}],
                temperature=float(task.get("temperature", 0.7)),
                max_tokens=int(task.get("max_tokens", 2048)),
            )
            result = resp.choices[0].message.content or "(无回复)"
        except Exception as e:
            result = f"[执行出错] {e}"

        # ── 写入 context.txt ──────────────────────────────────────
        run_no   = task["run_count"] + 1
        divider  = "─" * 48
        entry = (
            f"=== 执行记录 #{run_no} ===\n"
            f"时间: {now.strftime('%Y-%m-%d %H:%M:%S')}\n"
            f"任务: {name}\n\n"
            f"【提示词】\n{task['prompt']}\n\n"
            f"【AI 回复】\n{result}\n\n"
            f"{divider}\n\n"
        )
        ctx_dir  = self._tasks_dir / task["id"]
        ctx_dir.mkdir(parents=True, exist_ok=True)
        with open(ctx_dir / "context.txt", "a", encoding="utf-8") as f:
            f.write(entry)

        # ── 发送消息给用户 ────────────────────────────────────────
        await self._send_to_user(task, result)

        # ── 更新任务元数据 ────────────────────────────────────────
        task["last_run"]  = now.isoformat()
        task["run_count"] = run_no
        task["running"]   = False  # 清除运行中标记
        if task["schedule"].startswith("once:"):
            task["enabled"]  = False
            task["next_run"] = None
        else:
            task["next_run"] = self._next_run(task["schedule"])
        self._save()

        print(f"[Scheduler] ✓ 任务 '{name}' 完成")
        return result

    async def _send_to_user(self, task: dict, message: str):
        """通过 IM 发送消息给用户"""
        if not self._app_state:
            print("[Scheduler] 没有 app_state，无法发送消息")
            return

        platform = task.get("platform", "telegram")
        user_id = task.get("user_id", "")

        if not user_id:
            print(f"[Scheduler] 任务 {task['name']} 没有设置 user_id，跳过发送")
            return

        try:
            if platform == "telegram" and self._app_state.im_manager.telegram:
                bot = self._app_state.im_manager.telegram.app.bot
                await bot.send_message(
                    chat_id=int(user_id),
                    text=f"📅 **{task['name']}**\n\n{message}",
                    parse_mode="Markdown"
                )
                print(f"[Scheduler] 已通过 TG 发送给用户 {user_id}")
            elif platform == "lark" and self._app_state.im_manager.lark:
                # 飞书发送逻辑
                print(f"[Scheduler] 飞书发送暂未实现")
            else:
                print(f"[Scheduler] 未知平台或未连接: {platform}")
        except Exception as e:
            print(f"[Scheduler] 发送消息失败: {e}")

    # ─── Background loop ──────────────────────────────────────────

    async def run_loop(self):
        """后台轮询：每 30 秒检查是否有到期任务。"""
        while True:
            await asyncio.sleep(30)
            now = datetime.now()
            for task in list(self._tasks.values()):
                if not task.get("enabled") or not task.get("next_run"):
                    continue
                # 跳过正在执行的任务，防止重复执行
                if task.get("running"):
                    continue
                try:
                    if now >= datetime.fromisoformat(task["next_run"]):
                        task["running"] = True  # 标记为运行中
                        asyncio.create_task(self._execute(task))
                except Exception as e:
                    print(f"[Scheduler] 检查任务出错 '{task.get('name')}': {e}")
