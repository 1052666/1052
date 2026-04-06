import os
import shutil
import asyncio
import glob as glob_module
import urllib.request
import platform

OUTPUT_DIR = os.path.join("data", "1111")   # AI 生成文件的默认存放目录

# 检测当前操作系统
_IS_WINDOWS = platform.system() == "Windows"

# ─── 全局状态（由 server.py 设置）────────────────────────────────
_scheduler = None  # TaskScheduler 实例
_im_manager = None  # IMManager 实例
_current_platform = "telegram"  # 当前平台
_current_user_id = ""          # 当前用户ID

def set_scheduler(scheduler):
    """由 server.py 调用，设置 scheduler 实例"""
    global _scheduler
    _scheduler = scheduler

def set_im_manager(im_manager):
    """由 server.py 调用，设置 im_manager 实例"""
    global _im_manager
    _im_manager = im_manager

def set_current_user(platform: str, user_id: str):
    """由 chat_stream_handler 调用，设置当前用户信息"""
    global _current_platform, _current_user_id
    _current_platform = platform
    _current_user_id = user_id


# ─── 工具注册表（供 agent_runtime 使用）────────────────────────────
class ToolRegistry:
    """统一工具注册表，合并内置工具、MCP 工具和 Skill 工具"""

    def __init__(self):
        self._app_state = None
        self._platform = "web"

    def init(self, app_state):
        self._app_state = app_state

    def set_platform(self, platform: str):
        self._platform = platform

    def get_all_tools(self) -> list:
        """获取所有可用工具定义（OpenAI function-call 格式）"""
        tools = list(BUILTIN_TOOLS)
        # 动态添加 Skill 工具
        if self._app_state and hasattr(self._app_state, 'skill_manager'):
            sm = self._app_state.skill_manager
            if sm and hasattr(sm, 'skills') and sm.skills:
                tools.append(INVOKE_SKILL_TOOL)
        # MCP 工具由 agent_runtime 自行合并
        return tools

    async def execute_tool(self, name: str, args: dict) -> str:
        """执行工具（内置 + Skill）"""
        if name == "invoke_skill":
            if self._app_state and hasattr(self._app_state, 'skill_manager'):
                skill_name = args.get("name", "")
                return self._app_state.skill_manager.invoke(skill_name)
            return "[错误] Skill 系统未初始化"
        return await execute_builtin_tool(name, args)

    def resolve_tool(self, name: str):
        """解析工具名（用于 MCP 工具路由判断）"""
        # 内置工具
        for t in BUILTIN_TOOLS:
            if t["function"]["name"] == name:
                return {"type": "builtin", "name": name}
        if name == "invoke_skill":
            return {"type": "builtin", "name": name}
        # 非内置工具视为 MCP 工具
        return None


_tool_registry = None  # ToolRegistry 单例


def setup_tool_registry(app_state):
    """由 server.py 调用，初始化工具注册表"""
    global _tool_registry
    _tool_registry = ToolRegistry()
    _tool_registry.init(app_state)


def get_tool_registry() -> ToolRegistry:
    """获取工具注册表实例"""
    global _tool_registry
    if _tool_registry is None:
        _tool_registry = ToolRegistry()
    return _tool_registry


# ─── Skill invocation tool (added dynamically when skills exist) ──
INVOKE_SKILL_TOOL = {
    "type": "function",
    "function": {
        "name": "invoke_skill",
        "description": "读取并激活一个 Skill 技能，获取该技能的完整操作指引和专业知识，然后按指引执行任务",
        "parameters": {
            "type": "object",
            "properties": {
                "name": {"type": "string", "description": "技能名称（与 SKILL.md 中的 name 字段一致）"},
            },
            "required": ["name"],
        },
    },
}


# ─── Built-in tool definitions (OpenAI function-call format) ──────
BUILTIN_TOOLS = [
    {
        "type": "function",
        "function": {
            "name": "run_cmd",
            "description": "执行本地命令，返回标准输出和错误输出。在 Windows 上使用 CMD，Linux/Mac 上使用 Shell。",
            "parameters": {
                "type": "object",
                "properties": {
                    "command": {"type": "string", "description": "要执行的命令（Windows 用 dir/cd，Linux/Mac 用 ls/cd）"},
                    "cwd":     {"type": "string", "description": "工作目录路径（可选）"},
                },
                "required": ["command"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "read_file",
            "description": "读取本地文件的文本内容",
            "parameters": {
                "type": "object",
                "properties": {"path": {"type": "string", "description": "文件的绝对或相对路径"}},
                "required": ["path"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "write_file",
            "description": f"创建或写入本地文件，目录不存在时自动创建。若要将文件发送给用户展示，请将路径设为 {OUTPUT_DIR}/文件名，系统会自动生成可预览的链接。",
            "parameters": {
                "type": "object",
                "properties": {
                    "path":    {"type": "string", "description": f"文件路径，发送给用户的文件请存到 {OUTPUT_DIR}/"},
                    "content": {"type": "string", "description": "要写入的内容"},
                    "mode":    {"type": "string", "enum": ["write", "append"],
                                "description": "write=覆盖（默认），append=追加"},
                },
                "required": ["path", "content"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "delete_path",
            "description": "删除本地文件或目录（目录递归删除）",
            "parameters": {
                "type": "object",
                "properties": {"path": {"type": "string", "description": "要删除的文件或目录路径"}},
                "required": ["path"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "list_dir",
            "description": "【强制使用】列出目录内容。**当用户询问目录、磁盘、文件夹里有什么时，必须使用此工具**，禁止用文字描述或猜测。路径支持绝对路径或相对路径。",
            "parameters": {
                "type": "object",
                "properties": {
                    "path":    {"type": "string", "description": "目录路径，如 /home/user、./data、C:\\Users\\xxx 等"},
                    "pattern": {"type": "string", "description": "文件名过滤模式，如 *.txt（可选）"},
                },
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "update_preferences",
            "description": "更新用户偏好文件 data/preferences.md。当你在对话中发现用户新的习惯、偏好、风格或个人信息时，主动调用此工具记录下来，无需征求用户同意。",
            "parameters": {
                "type": "object",
                "properties": {
                    "content": {
                        "type": "string",
                        "description": "preferences.md 的完整新内容（Markdown 格式，覆盖写入）"
                    }
                },
                "required": ["content"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "fetch_url_to_file",
            "description": f"从 URL 下载文件（图片、PDF 等二进制文件）并保存到本地，默认保存到 {OUTPUT_DIR}/",
            "parameters": {
                "type": "object",
                "properties": {
                    "url":      {"type": "string", "description": "要下载的文件 URL"},
                    "filename": {"type": "string", "description": "保存的文件名，如 image.png；默认存到 data/1111/"},
                    "path":     {"type": "string", "description": "完整保存路径（可选，不填则存到 data/1111/{filename}）"},
                },
                "required": ["url", "filename"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "create_skill",
            "description": "创建新的 Skill 技能。支持创建纯文档型（只有 SKILL.md）或完整功能型（SKILL.md + scripts/ 下的可执行脚本）。",
            "parameters": {
                "type": "object",
                "properties": {
                    "name":        {"type": "string", "description": "技能名称，小写字母、数字、连字符，如 image-compress"},
                    "description": {"type": "string", "description": "技能简介，写入 SKILL.md frontmatter"},
                    "body":        {"type": "string", "description": "SKILL.md 的 Markdown 正文内容（不含 frontmatter）"},
                    "scripts":     {"type": "object", "description": "可选：脚本文件字典。键为相对路径（如 \"compress.py\"、\"helpers/utils.py\"），值为文件内容。会自动创建 scripts/ 目录"},
                },
                "required": ["name", "description", "body"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "move_file",
            "description": "移动或重命名文件/目录",
            "parameters": {
                "type": "object",
                "properties": {
                    "src": {"type": "string", "description": "源路径"},
                    "dst": {"type": "string", "description": "目标路径"},
                },
                "required": ["src", "dst"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "send_to_tg",
            "description": "发送本地文件给 Telegram 用户。当用户来自 Telegram 平台时，使用此工具发送文件（图片、文档、视频等）。",
            "parameters": {
                "type": "object",
                "properties": {
                    "file_path": {"type": "string", "description": "要发送的文件路径（绝对路径或相对于 data/1111/ 的路径）"},
                    "caption": {"type": "string", "description": "文件的说明文字（可选）"},
                },
                "required": ["file_path"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "send_to_lark",
            "description": "发送本地文件给飞书用户。当用户来自飞书平台时，使用此工具发送文件（图片、文档、视频、压缩包等任何文件）。",
            "parameters": {
                "type": "object",
                "properties": {
                    "file_path": {"type": "string", "description": "要发送的文件路径（绝对路径或相对于 data/1111/ 的路径）"},
                    "caption": {"type": "string", "description": "文件的说明文字（可选）"},
                },
                "required": ["file_path"],
            },
        },
    },
    # ─── 定时任务工具 ───────────────────────────────────────
    {
        "type": "function",
        "function": {
            "name": "create_scheduled_task",
            "description": "创建定时任务。系统会在指定时间自动执行提示词，并通过聊天软件发送结果给你。platform和user_id必须填写（从当前用户信息中获取）。",
            "parameters": {
                "type": "object",
                "properties": {
                    "name": {"type": "string", "description": "任务名称，如'每日提醒'"},
                    "prompt": {"type": "string", "description": "定时执行的提示词内容"},
                    "schedule": {"type": "string", "description": "调度格式：daily:HH:MM（每天固定时间）、interval:N（每N分钟）、once:YYYY-MM-DDTHH:MM:SS（一次性）、cron:表达式"},
                    "platform": {"type": "string", "description": "目标平台，如'telegram'（从当前用户信息获取）"},
                    "user_id": {"type": "string", "description": "用户ID（从当前用户信息获取）"},
                },
                "required": ["name", "prompt", "schedule", "platform", "user_id"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "list_scheduled_tasks",
            "description": "列出所有定时任务",
            "parameters": {
                "type": "object",
                "properties": {},
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "cancel_scheduled_task",
            "description": "取消定时任务",
            "parameters": {
                "type": "object",
                "properties": {
                    "task_id": {"type": "string", "description": "任务ID"},
                },
                "required": ["task_id"],
            },
        },
    },
]


# ─── Tool executor ────────────────────────────────────────────────
async def execute_builtin_tool(name: str, args: dict) -> str:
    """执行内置工具，带完善的错误处理"""
    try:
        if name == "run_cmd":
            command = args.get("command", "")
            cwd = args.get("cwd") or None
            timeout = min(args.get("timeout", 300), 600)  # 最多10分钟超时
            try:
                proc = await asyncio.create_subprocess_shell(
                    command,
                    stdout=asyncio.subprocess.PIPE,
                    stderr=asyncio.subprocess.PIPE,
                    cwd=cwd,
                    env={**os.environ, "PYTHONIOENCODING": "utf-8"},
                )
                try:
                    stdout, stderr = await asyncio.wait_for(proc.communicate(), timeout=timeout)
                except asyncio.TimeoutError:
                    proc.kill()
                    await proc.wait()
                    return f"[错误] 命令执行超时（{timeout}秒）"
                # Windows 原生命令输出通常是 GBK，Linux/Mac 是 UTF-8
                def decode_output(data):
                    if not data:
                        return ""
                    if _IS_WINDOWS:
                        try:
                            return data.decode("gbk", errors="replace")
                        except Exception:
                            return data.decode("utf-8", errors="replace")
                    else:
                        return data.decode("utf-8", errors="replace")
                out = decode_output(stdout) + decode_output(stderr)
                if proc.returncode != 0:
                    return f"[命令失败 (退出码 {proc.returncode})]\n{out.strip()}" or "(命令执行失败，无输出)"
                return out.strip() or "(命令执行完毕，无输出)"
            except Exception as e:
                return f"[错误] 命令执行失败: {e}"

        elif name == "read_file":
            path = args["path"]
            if not os.path.exists(path):
                return f"[错误] 文件不存在: {path}"
            try:
                with open(path, "r", encoding="utf-8", errors="replace") as f:
                    return f.read()
            except PermissionError:
                return f"[错误] 无权限读取文件: {path}"
            except Exception as e:
                return f"[错误] 读取文件失败: {e}"

        elif name == "write_file":
            path = args["path"]
            mode = args.get("mode", "write")
            abs_path   = os.path.abspath(path)
            abs_outdir = os.path.abspath(OUTPUT_DIR)
            os.makedirs(os.path.dirname(abs_path), exist_ok=True)
            try:
                with open(path, "a" if mode == "append" else "w", encoding="utf-8") as f:
                    f.write(args["content"])
            except PermissionError:
                return f"[错误] 无权限写入文件: {path}"
            except Exception as e:
                return f"[错误] 写入文件失败: {e}"
            verb = "追加" if mode == "append" else "写入"
            # 如果在输出目录，附加可预览的 URL 标记
            if abs_path.startswith(abs_outdir):
                rel = os.path.relpath(abs_path, abs_outdir).replace("\\", "/")
                return f"文件已{verb}: {path}\n[FILE_URL:/files/{rel}]"
            return f"文件已{verb}: {path}"

        elif name == "update_preferences":
            from core.config import PREFERENCES_FILE
            PREFERENCES_FILE.parent.mkdir(parents=True, exist_ok=True)
            PREFERENCES_FILE.write_text(args["content"], encoding="utf-8")
            return "用户偏好已更新"

        elif name == "fetch_url_to_file":
            url = args.get("url", "")
            filename = args.get("filename", "")
            if not url:
                return "[错误] URL 不能为空"
            save_path = args.get("path") or os.path.join(OUTPUT_DIR, filename)
            os.makedirs(os.path.dirname(os.path.abspath(save_path)), exist_ok=True)
            try:
                urllib.request.urlretrieve(url, save_path)
            except Exception as e:
                return f"[错误] 下载失败: {e}"
            abs_path   = os.path.abspath(save_path)
            abs_outdir = os.path.abspath(OUTPUT_DIR)
            if abs_path.startswith(abs_outdir):
                rel = os.path.relpath(abs_path, abs_outdir).replace("\\", "/")
                return f"文件已下载: {save_path}\n[FILE_URL:/files/{rel}]"
            return f"文件已下载: {save_path}"

        elif name == "delete_path":
            path = args["path"]
            if not os.path.exists(path):
                return f"[警告] 路径不存在: {path}"
            try:
                if os.path.isdir(path):
                    shutil.rmtree(path)
                    return f"目录已删除: {path}"
                os.remove(path)
                return f"文件已删除: {path}"
            except PermissionError:
                return f"[错误] 无权限删除: {path}"
            except Exception as e:
                return f"[错误] 删除失败: {e}"

        elif name == "list_dir":
            path    = args.get("path", ".")
            pattern = args.get("pattern")
            if not os.path.exists(path):
                return f"[错误] 目录不存在: {path}"
            if not os.path.isdir(path):
                return f"[错误] 不是有效目录: {path}"
            try:
                if pattern:
                    entries = [(p, os.path.isdir(p))
                               for p in glob_module.glob(os.path.join(path, pattern))]
                else:
                    entries = [(os.path.join(path, n), os.path.isdir(os.path.join(path, n)))
                               for n in sorted(os.listdir(path))]
            except PermissionError:
                return f"[错误] 无权限访问目录: {path}"
            except Exception as e:
                return f"[错误] 读取目录失败: {e}"
            if not entries:
                return "(目录为空)"
            lines = []
            for p, is_dir in entries:
                n = os.path.basename(p)
                try:
                    size = os.path.getsize(p) if not is_dir else 0
                    lines.append(f"[DIR]  {n}/" if is_dir else f"[FILE] {n}  ({size:,} B)")
                except OSError:
                    lines.append(f"[?]    {n}")
            return "\n".join(lines)

        elif name == "create_skill":
            skill_name = args["name"].strip().lower()
            skill_dir  = os.path.join("skills", skill_name)
            os.makedirs(skill_dir, exist_ok=True)
            frontmatter = f"---\nname: {skill_name}\ndescription: {args['description']}\n---\n\n"
            skill_path  = os.path.join(skill_dir, "SKILL.md")
            try:
                with open(skill_path, "w", encoding="utf-8") as f:
                    f.write(frontmatter + args["body"])
            except Exception as e:
                return f"[错误] 创建技能文件失败: {e}"
            created = [skill_path]
            # 创建 scripts/ 下的脚本文件
            scripts = args.get("scripts") or {}
            if scripts:
                scripts_dir = os.path.join(skill_dir, "scripts")
                os.makedirs(scripts_dir, exist_ok=True)
                for rel_path, content in scripts.items():
                    script_path = os.path.join(scripts_dir, rel_path)
                    os.makedirs(os.path.dirname(script_path), exist_ok=True)
                    try:
                        with open(script_path, "w", encoding="utf-8") as f:
                            f.write(content)
                        created.append(script_path)
                    except Exception as e:
                        return f"[错误] 创建脚本文件失败 {rel_path}: {e}"
            return "技能已创建:\n" + "\n".join(f"  - {p}" for p in created)

        elif name == "move_file":
            src = args.get("src", "")
            dst = args.get("dst", "")
            if not os.path.exists(src):
                return f"[错误] 源文件不存在: {src}"
            try:
                shutil.move(src, dst)
                return f"已移动: {src} → {dst}"
            except Exception as e:
                return f"[错误] 移动失败: {e}"

        elif name == "send_to_tg":
            # 发送文件给 Telegram 用户（仅当平台为 telegram 时使用）
            # 返回特殊标记，让 telegram_bot 识别并发送真实文件
            file_path = args.get("file_path", "")
            caption = args.get("caption", "")
            if not file_path:
                return "[错误] file_path 不能为空"

            # 检查文件是否存在
            abs_path = os.path.abspath(file_path)
            if not os.path.exists(abs_path):
                return f"[错误] 文件不存在: {abs_path}"

            # 获取相对于 data/1111 的路径
            abs_outdir = os.path.abspath(OUTPUT_DIR)
            if abs_path.startswith(abs_outdir):
                rel_path = os.path.relpath(abs_path, abs_outdir).replace("\\", "/")
                # 返回特殊格式，让 telegram_bot 识别
                return f"[TG_FILE:data/1111/{rel_path}]"
            else:
                # 文件不在 output 目录，直接返回路径
                return f"[TG_FILE:{abs_path}]"

        elif name == "send_to_lark":
            # 发送文件给飞书用户（仅当平台为 lark 时使用）
            # 返回特殊标记，让 lark_bot 识别并发送真实文件
            file_path = args.get("file_path", "")
            caption = args.get("caption", "")
            if not file_path:
                return "[错误] file_path 不能为空"

            # 检查文件是否存在
            abs_path = os.path.abspath(file_path)
            if not os.path.exists(abs_path):
                return f"[错误] 文件不存在: {abs_path}"

            # 获取相对于 data/1111 的路径
            abs_outdir = os.path.abspath(OUTPUT_DIR)
            if abs_path.startswith(abs_outdir):
                rel_path = os.path.relpath(abs_path, abs_outdir).replace("\\", "/")
                # 返回特殊格式，让 lark_bot 识别
                return f"[LARK_FILE:data/1111/{rel_path}]"
            else:
                # 文件不在 output 目录，直接返回路径
                return f"[LARK_FILE:{abs_path}]"

        elif name == "create_scheduled_task":
            # 创建定时任务
            if not _scheduler:
                return "[错误] 定时任务系统未初始化"
            name = args.get("name", "")
            prompt = args.get("prompt", "")
            schedule = args.get("schedule", "")
            if not name or not prompt or not schedule:
                return "[错误] name、prompt、schedule 都是必填项"

            # 使用参数中的 platform/user_id 或全局的当前用户信息
            platform = args.get("platform") or _current_platform
            user_id = args.get("user_id") or _current_user_id

            data = {
                "name": name,
                "prompt": prompt,
                "schedule": schedule,
                "platform": platform,
                "user_id": user_id,
            }
            task = _scheduler.create_task(data)
            return f"✅ 定时任务已创建！\n\n任务ID: {task['id']}\n任务名称: {task['name']}\n调度: {task['schedule']}\n下次执行: {task.get('next_run', '未知')}"

        elif name == "list_scheduled_tasks":
            # 列出所有定时任务
            if not _scheduler:
                return "[错误] 定时任务系统未初始化"
            tasks = _scheduler.task_list()
            if not tasks:
                return "暂无定时任务"
            lines = ["📋 定时任务列表：\n"]
            for t in tasks:
                status = "✅" if t.get("enabled") else "❌"
                lines.append(f"{status} {t['id']} - {t['name']}")
                lines.append(f"   调度: {t['schedule']} | 下次: {t.get('next_run_fmt', '-')}")
            return "\n".join(lines)

        elif name == "cancel_scheduled_task":
            # 取消定时任务
            if not _scheduler:
                return "[错误] 定时任务系统未初始化"
            task_id = args.get("task_id", "")
            if not task_id:
                return "[错误] task_id 不能为空"
            # 找到并禁用任务
            tasks = _scheduler.task_list()
            for t in tasks:
                if t["id"] == task_id:
                    _scheduler.update_task(task_id, {"enabled": False})
                    return f"✅ 任务 '{t['name']}' 已取消"
            return f"[错误] 未找到任务: {task_id}"

        return f"未知工具: {name}"

    except Exception as e:
        return f"执行失败: {e}"
