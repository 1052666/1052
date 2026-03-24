"""
进化模式管理器 - 支持所有平台(Telegram/Web)的统一进化模式
"""
import asyncio
import json
from datetime import datetime
from pathlib import Path
from typing import Optional, Callable, AsyncGenerator
from dataclasses import dataclass, asdict

EVOLUTION_LOG_DIR = Path("data/evolution_logs")
EVOLUTION_INTERVAL = 1800  # 30分钟


@dataclass
class EvolutionStatus:
    active: bool = False
    platform: str = ""
    user_id: str = ""
    start_time: str = ""
    log_file: str = ""
    last_run: str = ""
    result_count: int = 0


class EvolutionManager:
    """进化模式管理器（全局单例）"""

    _instance: Optional["EvolutionManager"] = None

    def __new__(cls):
        if cls._instance is None:
            cls._instance = super().__new__(cls)
            cls._instance._init()
        return cls._instance

    def _init(self):
        self._active = False
        self._platform = ""
        self._user_id = ""
        self._start_time = ""
        self._log_file: Optional[Path] = None
        self._task: Optional[asyncio.Task] = None
        self._chat_handler: Optional[Callable] = None
        self._app_state = None  # 用于发送消息

    def set_app_state(self, app_state):
        """设置 app_state 用于发送消息"""
        self._app_state = app_state

    def set_chat_handler(self, handler: Callable):
        """设置聊天处理器"""
        self._chat_handler = handler

    @property
    def active(self) -> bool:
        return self._active

    def get_status(self) -> EvolutionStatus:
        """获取进化模式状态"""
        return EvolutionStatus(
            active=self._active,
            platform=self._platform,
            user_id=self._user_id,
            start_time=self._start_time,
            log_file=str(self._log_file) if self._log_file else "",
            last_run=self._get_last_run(),
            result_count=self._count_results()
        )

    def _get_last_run(self) -> str:
        """获取最近一次运行时间"""
        if not self._log_file or not self._log_file.exists():
            return ""
        try:
            content = self._log_file.read_text(encoding="utf-8")
            lines = content.split("\n")
            for line in reversed(lines):
                if line.startswith("[") and "]" in line:
                    return line.split("]")[0].replace("[", "")
            return ""
        except:
            return ""

    def _count_results(self) -> int:
        """统计进化结果数量"""
        if not self._log_file or not self._log_file.exists():
            return 0
        try:
            content = self._log_file.read_text(encoding="utf-8")
            return content.count("[AI回复]")
        except:
            return 0

    def get_logs(self) -> str:
        """获取进化日志内容"""
        if not self._log_file or not self._log_file.exists():
            return ""
        try:
            return self._log_file.read_text(encoding="utf-8")
        except:
            return ""

    async def start(self, platform: str, user_id: str) -> str:
        """启动进化模式"""
        if self._active:
            return "⚠️ 已经在进化模式中"

        # 创建日志目录和文件
        EVOLUTION_LOG_DIR.mkdir(parents=True, exist_ok=True)
        timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
        self._log_file = EVOLUTION_LOG_DIR / f"evolution_{timestamp}.log"
        self._log_file.write_text(f"=== 进化模式开始 {datetime.now()} ===\n", encoding="utf-8")

        # 设置状态
        self._active = True
        self._platform = platform
        self._user_id = user_id
        self._start_time = datetime.now().strftime("%Y-%m-%d %H:%M:%S")

        # 启动进化循环
        self._task = asyncio.create_task(self._run_loop())

        return f"🔄 开始进化模式，发送任意消息打断\n\n进化ID: {user_id}\n平台: {platform}"

    async def stop(self) -> str:
        """停止进化模式"""
        if not self._active:
            return "进化模式未启动"

        self._active = False

        if self._task:
            self._task.cancel()
            try:
                await self._task
            except asyncio.CancelledError:
                pass
            self._task = None

        self._log("[系统]", "进化模式已停止")

        result_count = self._count_results()
        self._active = False
        self._platform = ""
        self._user_id = ""
        self._start_time = ""
        self._log_file = None

        return f"✅ 进化模式已停止。共运行 {result_count} 次"

    def _log(self, tag: str, text: str):
        """写入日志"""
        if self._log_file:
            try:
                timestamp = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
                self._log_file.write_text(
                    f"[{timestamp}] {tag} {text}\n",
                    encoding="utf-8",
                    mode="a"
                )
            except:
                pass

    async def _run_loop(self):
        """进化模式后台循环"""
        evolution_prompt = """你是1052，正在进化模式中。请自主思考并执行你认为有意义的任务，可以是搜索信息、生成内容、编写代码、分析数据等任何你能做的事情。每次回复后请简短说明你在做什么。记住：你现在是完全自主的，不需要等待用户指令。"""

        while self._active:
            try:
                # 等待30分钟
                await asyncio.sleep(EVOLUTION_INTERVAL)

                if not self._active:
                    break

                self._log("[系统]", "发送进化指令")

                # 通过 chat_handler 发送自主任务
                if self._chat_handler:
                    full_response = ""
                    try:
                        messages = [{"role": "user", "content": evolution_prompt}]
                        async for chunk in self._chat_handler(messages):
                            if not self._active:
                                break
                            if chunk.get("type") == "delta":
                                full_response += chunk.get("content", "")
                            elif chunk.get("type") == "done":
                                break
                    except Exception as e:
                        self._log("[错误]", str(e))
                        continue

                    if self._active and full_response:
                        self._log("[AI回复]", full_response[:500])

                        # 发送结果给用户
                        await self._send_to_user(full_response)

            except asyncio.CancelledError:
                break
            except Exception as e:
                self._log("[循环错误]", str(e))

    async def _send_to_user(self, message: str):
        """发送消息给用户"""
        if not self._platform or not self._user_id:
            return

        message = message[:2000]

        if self._platform == "telegram" and self._app_state:
            try:
                im = self._app_state.im_manager
                if im and im.telegram and im.telegram.app:
                    bot = im.telegram.app.bot
                    await bot.send_message(
                        chat_id=int(self._user_id),
                        text=f"🔄 [进化结果]\n\n{message}",
                        parse_mode="HTML"
                    )
            except Exception as e:
                self._log("[发送错误]", str(e))

        elif self._platform == "web" and self._app_state:
            # Web 平台：将结果存储到临时文件，前端通过轮询获取
            self._log("[Web通知]", f"结果已生成: {len(message)} 字符")


# 全局单例
evolution_manager = EvolutionManager()
