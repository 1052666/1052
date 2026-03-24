import asyncio
import json
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles

from core.config import MCP_CONFIG_FILE
from core.skill_manager import SkillManager
from core.scheduler import TaskScheduler
from core.tools import set_scheduler
from mcp_client.manager import MCPManager
from im_integration.manager import IMManager
import routers.chat as chat_router
import routers.config as config_router
import routers.skills as skills_router
import routers.scheduler as scheduler_router
import routers.im as im_router
import mcp_client.router as mcp_router

SKILLS_DIR  = Path(__file__).parent / "skills"
DATA_DIR    = Path(__file__).parent / "data"
OUTPUT_DIR  = DATA_DIR / "1111"


# ─── Lifespan ─────────────────────────────────────────────────────
@asynccontextmanager
async def lifespan(app: FastAPI):
    # MCP
    app.state.mcp_manager = MCPManager()
    await app.state.mcp_manager.load_from_config(MCP_CONFIG_FILE)

    # Skills
    app.state.skill_manager = SkillManager(SKILLS_DIR)
    app.state.skill_manager.load_all()
    watcher_task = asyncio.create_task(app.state.skill_manager.watch())

    # Scheduler
    app.state.scheduler = TaskScheduler(DATA_DIR)
    app.state.scheduler.load()
    app.state.scheduler.set_app_state(app.state)  # 设置 app_state 用于发送消息
    set_scheduler(app.state.scheduler)  # 让 tools.py 可以访问
    scheduler_loop = asyncio.create_task(app.state.scheduler.run_loop())

    # IM 集成 (Telegram / 飞书)
    app.state.im_manager = IMManager()
    app.state.im_manager.setup_chat_handler(
        lambda msgs: chat_stream_handler(msgs, app.state)
    )
    await app.state.im_manager.load_from_config()

    # 进化模式管理器
    from im_integration.evolution import evolution_manager
    evolution_manager.set_app_state(app.state)

    yield

    watcher_task.cancel()
    scheduler_loop.cancel()
    await app.state.mcp_manager.cleanup()
    await app.state.im_manager.cleanup()


# ─── Chat handler for IM ──────────────────────────────────────────
async def chat_stream_handler(messages: list, app_state):
    """为 IM 提供的流式聊天处理器"""
    from openai import AsyncOpenAI
    from core.config import load_config, read_system_prompt, read_preferences
    from core.tools import BUILTIN_TOOLS, INVOKE_SKILL_TOOL, execute_builtin_tool

    cfg = load_config()
    api_key = cfg.get("api_key", "")
    if not api_key:
        yield {"type": "error", "content": "未配置 API Key"}
        return

    client = AsyncOpenAI(
        api_key=api_key,
        base_url=cfg.get("base_url", "https://api.openai.com/v1"),
    )

    # 构造系统提示
    system_content = read_system_prompt()

    # 解析用户信息（从 IM 传入）
    platform = "telegram"
    user_id = ""
    # 检查第一条消息是否是用户信息
    if messages and messages[0].get("role") == "system" and "[用户信息]" in messages[0].get("content", ""):
        info = messages[0]["content"]
        messages = messages[1:]  # 删除用户信息消息
        # 解析 platform 和 user_id
        import re
        platform_match = re.search(r'platform=(\w+)', info)
        user_id_match = re.search(r'user_id=(\d+)', info)
        if platform_match:
            platform = platform_match.group(1)
        if user_id_match:
            user_id = user_id_match.group(1)

    # 设置当前用户信息（供定时任务工具使用）
    from core.tools import set_current_user
    set_current_user(platform, user_id)

    # 注入当前时间
    from datetime import datetime
    current_time = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    time_section = f"""

---

## 当前时间

**当前时间**: {current_time}

请根据当前时间回答问题，不要假设知识库的截止时间。如果用户询问关于今天、昨天、明天等时间相关的问题，请基于当前时间计算。
"""
    system_content += time_section

    # 注入用户信息（用于定时任务）
    if user_id:
        user_section = f"""

---

## 当前用户

**平台**: {platform}
**用户ID**: {user_id}

创建定时任务时会自动使用上述用户信息，任务结果将发送到这里。
"""
        system_content += user_section

    preferences = read_preferences()
    if preferences.strip():
        system_content += f"\n\n---\n\n用户偏好:\n{preferences}\n\n---"

    skill_section = app_state.skill_manager.get_system_prompt_section()
    if skill_section:
        system_content += skill_section

    full_messages = [{"role": "system", "content": system_content}] + messages

    # 工具
    all_tools = BUILTIN_TOOLS.copy()
    if app_state.skill_manager.skill_list():
        all_tools.append(INVOKE_SKILL_TOOL)
    all_tools += app_state.mcp_manager.get_openai_tools()

    total_assistant_text = ""

    try:
        while True:
            stream = await client.chat.completions.create(
                model=cfg.get("model", "gpt-4o-mini"),
                messages=full_messages,
                tools=all_tools,
                tool_choice="auto",
                stream=True,
                temperature=cfg.get("temperature", 0.7),
                max_tokens=cfg.get("max_tokens", 32768),
            )

            full_content = ""
            tool_calls = {}

            async for chunk in stream:
                if not chunk.choices:
                    continue
                choice = chunk.choices[0]
                delta = choice.delta

                if delta.content:
                    full_content += delta.content
                    total_assistant_text += delta.content
                    yield {"type": "delta", "content": delta.content}

                if delta.tool_calls:
                    for tc in delta.tool_calls:
                        idx = tc.index
                        if idx not in tool_calls:
                            tool_calls[idx] = {"id": "", "name": "", "args": ""}
                        if tc.id:
                            tool_calls[idx]["id"] = tc.id
                        if tc.function and tc.function.name:
                            tool_calls[idx]["name"] = tc.function.name
                        if tc.function and tc.function.arguments:
                            tool_calls[idx]["args"] += tc.function.arguments

            # 判断是否需要工具调用
            if not tool_calls:
                yield {"type": "done"}
                break

            # 执行工具调用
            for tc in tool_calls.values():
                try:
                    args = json.loads(tc["args"])
                except:
                    args = {}

                mcp_resolved = app_state.mcp_manager.resolve_mcp_tool(tc["name"])
                is_skill = tc["name"] == "invoke_skill"

                yield {"type": "tool_call", "name": tc["name"]}

                if is_skill:
                    result = app_state.skill_manager.invoke(args.get("name", ""))
                elif mcp_resolved:
                    result = await app_state.mcp_manager.call_tool(mcp_resolved[0], mcp_resolved[1], args)
                else:
                    result = await execute_builtin_tool(tc["name"], args)

                yield {"type": "tool_result", "name": tc["name"], "result": result}

                # 将工具结果添加到消息历史
                full_messages.append({
                    "role": "assistant",
                    "content": full_content or None,
                    "tool_calls": [{
                        "id": tc["id"],
                        "type": "function",
                        "function": {"name": tc["name"], "arguments": tc["args"]}
                    }],
                })
                full_messages.append({
                    "role": "tool",
                    "tool_call_id": tc["id"],
                    "content": result,
                })

    except Exception as e:
        yield {"type": "error", "content": str(e)}


# ─── App ──────────────────────────────────────────────────────────
app = FastAPI(lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

# ─── Routers ─────────────────────────────────────────────────────
app.include_router(chat_router.router)
app.include_router(config_router.router)
app.include_router(mcp_router.router)
app.include_router(skills_router.router)
app.include_router(scheduler_router.router)
app.include_router(im_router.router)

# ─── Static files ─────────────────────────────────────────────────
app.mount("/static", StaticFiles(directory="static"), name="static")

# ─── Output files (AI 生成文件) ───────────────────────────────────
OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
app.mount("/files", StaticFiles(directory=str(OUTPUT_DIR)), name="output_files")


@app.get("/")
async def root():
    return FileResponse("static/index.html")


# ─── Entry point ──────────────────────────────────────────────────
if __name__ == "__main__":
    import uvicorn
    print("启动 AI 聊天服务器...")
    print("访问 http://localhost:8000 打开聊天页面")
    uvicorn.run(app, host="0.0.0.0", port=8000)
