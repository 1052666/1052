"""
IM 集成模块 - 支持 Telegram、飞书(Lark)、微信(WeChat)
"""

import sys

from .telegram_bot import TelegramBot
from .lark_bot import LarkBot

# 微信机器人仅在 Windows 上可用
if sys.platform == 'win32':
    from .wechat_bot import WeChatBot
else:
    WeChatBot = None

__all__ = ["TelegramBot", "LarkBot", "WeChatBot"]
