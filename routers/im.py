"""
IM 集成路由 - Telegram、飞书配置、进化模式
"""

from fastapi import APIRouter, Request
from pydantic import BaseModel
from typing import Optional

from core.config import load_config, save_config

router = APIRouter()


class TelegramConfig(BaseModel):
    enabled: bool
    token: Optional[str] = None


class LarkConfig(BaseModel):
    enabled: bool
    app_id: Optional[str] = None
    app_secret: Optional[str] = None
    encrypt_key: Optional[str] = None           # 加密密钥（可选，用于消息加密）
    verification_token: Optional[str] = None    # 验证令牌（可选，用于回调验证）


class IMConfig(BaseModel):
    telegram: TelegramConfig
    lark: LarkConfig


@router.get("/im/status")
async def get_im_status(request: Request):
    """获取 IM 状态"""
    manager = request.app.state.im_manager
    return manager.get_status()


@router.get("/im/config")
async def get_im_config():
    """获取 IM 配置（敏感字段脱敏）"""
    cfg = load_config()
    im_cfg = cfg.get("im", {})

    tg = im_cfg.get("telegram", {})
    lark = im_cfg.get("lark", {})

    return {
        "telegram": {
            "enabled": tg.get("enabled", False),
            "token_set": bool(tg.get("token")),
            "token_hint": _mask_token(tg.get("token", "")) if tg.get("token") else "",
        },
        "lark": {
            "enabled": lark.get("enabled", False),
            "app_id_set": bool(lark.get("app_id")),
            "app_id": lark.get("app_id", "")[:8] + "..." if lark.get("app_id") else "",
            "app_secret_set": bool(lark.get("app_secret")),
            "encrypt_key_set": bool(lark.get("encrypt_key")),
            "verification_token_set": bool(lark.get("verification_token")),
        }
    }


@router.put("/im/config")
async def update_im_config(body: IMConfig, request: Request):
    """更新 IM 配置"""
    cfg = load_config()

    old_im = cfg.get("im", {})

    # 合并配置（保留旧值如果新值为空）
    new_cfg = {
        "telegram": {
            "enabled": body.telegram.enabled,
            "token": body.telegram.token or old_im.get("telegram", {}).get("token", ""),
        },
        "lark": {
            "enabled": body.lark.enabled,
            "app_id": body.lark.app_id or old_im.get("lark", {}).get("app_id", ""),
            "app_secret": body.lark.app_secret or old_im.get("lark", {}).get("app_secret", ""),
            "encrypt_key": body.lark.encrypt_key or old_im.get("lark", {}).get("encrypt_key", ""),
            "verification_token": body.lark.verification_token or old_im.get("lark", {}).get("verification_token", ""),
        }
    }

    # 如果显式传了空字符串，则清空
    if body.telegram.token == "":
        new_cfg["telegram"]["token"] = ""
    if body.lark.app_id == "":
        new_cfg["lark"]["app_id"] = ""
    if body.lark.app_secret == "":
        new_cfg["lark"]["app_secret"] = ""
    if body.lark.encrypt_key == "":
        new_cfg["lark"]["encrypt_key"] = ""
    if body.lark.verification_token == "":
        new_cfg["lark"]["verification_token"] = ""

    cfg["im"] = new_cfg
    save_config(cfg)

    # 重载 IM 管理器
    manager = request.app.state.im_manager
    await manager.reload()

    return {"ok": True}


@router.post("/im/reload")
async def reload_im(request: Request):
    """手动重载 IM"""
    manager = request.app.state.im_manager
    await manager.reload()
    return manager.get_status()


def _mask_token(token: str) -> str:
    """脱敏显示 Token"""
    if len(token) > 10:
        return token[:5] + "..." + token[-5:]
    return "***"


# ─── 进化模式 API ────────────────────────────────────────────────

@router.get("/im/evolution/status")
async def get_evolution_status():
    """获取进化模式状态"""
    from im_integration.evolution import evolution_manager
    status = evolution_manager.get_status()
    return {
        "active": status.active,
        "platform": status.platform,
        "user_id": status.user_id,
        "start_time": status.start_time,
        "log_file": status.log_file,
        "last_run": status.last_run,
        "result_count": status.result_count,
    }


class EvolutionStartRequest(BaseModel):
    platform: str = "web"
    user_id: str = "web_user"


@router.post("/im/evolution/start")
async def start_evolution(body: EvolutionStartRequest):
    """启动进化模式"""
    from im_integration.evolution import evolution_manager
    if evolution_manager.active:
        return {"ok": False, "message": "已经在进化模式中"}
    result = await evolution_manager.start(body.platform, body.user_id)
    return {"ok": True, "message": result}


@router.post("/im/evolution/stop")
async def stop_evolution():
    """停止进化模式"""
    from im_integration.evolution import evolution_manager
    if not evolution_manager.active:
        return {"ok": False, "message": "进化模式未启动"}
    result = await evolution_manager.stop()
    return {"ok": True, "message": result}


@router.get("/im/evolution/logs")
async def get_evolution_logs():
    """获取进化日志"""
    from im_integration.evolution import evolution_manager
    logs = evolution_manager.get_logs()
    return {"logs": logs}
