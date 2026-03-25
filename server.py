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
from core.chat_engine import chat_stream
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
    """为 IM 提供的流式聊天处理器（委托给 chat_engine）"""
    async for chunk in chat_stream(messages, app_state):
        yield chunk


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
