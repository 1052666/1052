"""
飞书(Lark) Bot 集成 - 长连接模式，支持卡片消息和流式输出
"""

import asyncio
import json
from typing import Callable, Optional
from datetime import datetime

try:
    import lark_oapi as lark
    from lark_oapi import Client
    from lark_oapi.api.im.v1 import (
        CreateMessageRequest, CreateMessageRequestBody,
        UpdateMessageRequest, UpdateMessageRequestBody,
        GetMessageRequest
    )
    LARK_AVAILABLE = True
except ImportError:
    LARK_AVAILABLE = False

from core.config import DATA_DIR


class LarkBot:
    """飞书机器人，长连接模式，支持卡片消息"""

    def __init__(
        self,
        app_id: str,
        app_secret: str,
        encrypt_key: Optional[str] = None,
        verification_token: Optional[str] = None,
        chat_handler: Optional[Callable] = None
    ):
        self.app_id = app_id
        self.app_secret = app_secret
        self.encrypt_key = encrypt_key
        self.verification_token = verification_token
        self.chat_handler = chat_handler
        self.client: Optional[Client] = None
        self.ws_client = None
        self._enabled = False
        self._task: Optional[asyncio.Task] = None

    @property
    def enabled(self) -> bool:
        return self._enabled and LARK_AVAILABLE

    async def start(self):
        """启动飞书机器人"""
        if not LARK_AVAILABLE:
            print("[Lark] lark-oapi 未安装，跳过")
            return
        if not self.app_id or not self.app_secret:
            print("[Lark] AppID 或 AppSecret 未配置")
            return

        try:
            # 创建 client
            self.client = lark.Client.builder() \
                .app_id(self.app_id) \
                .app_secret(self.app_secret) \
                .log_level(lark.LogLevel.INFO) \
                .build()

            # 启动长连接
            self._task = asyncio.create_task(self._run_ws())
            self._enabled = True
            print(f"[Lark] 机器人已启动 (AppID: {self.app_id[:8]}...)")

        except Exception as e:
            print(f"[Lark] 启动失败: {e}")

    async def stop(self):
        """停止机器人"""
        if self._task and self._enabled:
            self._task.cancel()
            try:
                await self._task
            except asyncio.CancelledError:
                pass
            self._enabled = False
            print("[Lark] 机器人已停止")

    async def _run_ws(self):
        """运行 WebSocket 长连接"""
        try:
            from lark_oapi.adapter.websocket import WebSocketClient

            # 事件处理器
            async def on_message(data):
                try:
                    event = json.loads(data)
                    await self._handle_ws_event(event)
                except Exception as e:
                    print(f"[Lark] 消息处理错误: {e}")

            def on_error(error):
                print(f"[Lark] WebSocket 错误: {error}")

            def on_open():
                print("[Lark] WebSocket 连接已建立")

            def on_close():
                print("[Lark] WebSocket 连接已关闭")

            # 创建 WebSocket 客户端并连接
            self.ws_client = WebSocketClient(
                app_id=self.app_id,
                app_secret=self.app_secret,
                on_message=on_message,
                on_error=on_error,
                on_open=on_open,
                on_close=on_close
            )
            self.ws_client.start()

        except Exception as e:
            print(f"[Lark] WebSocket 运行失败: {e}")
            await asyncio.sleep(5)
            # 重连
            if self._enabled:
                self._task = asyncio.create_task(self._run_ws())

    async def _handle_ws_event(self, event: dict):
        """处理 WebSocket 事件"""
        try:
            event_type = event.get("header", {}).get("event_type", "")

            if event_type == "im.message.receive_v1":
                await self._handle_message(event)

        except Exception as e:
            print(f"[Lark] 事件处理错误: {e}")

    async def _handle_event(self, event):
        """处理飞书事件（兼容旧版 API）"""
        try:
            # 尝试解析 event 字段
            event_data = event
            if hasattr(event, 'event'):
                event_data = json.loads(event.event)

            event_type = event_data.get("header", {}).get("event_type", "")

            if event_type == "im.message.receive_v1":
                await self._handle_message(event_data)

        except Exception as e:
            print(f"[Lark] 事件处理错误: {e}")
            print(f"[Lark] 事件数据: {event}")

    async def _handle_message(self, event_data: dict):
        """处理用户消息"""
        if not self.chat_handler:
            return

        event = event_data.get("event", {})
        message = event.get("message", {})
        sender = event.get("sender", {}).get("sender_id", {}).get("open_id", "")
        chat_id = message.get("chat_id", "")
        chat_type = message.get("chat_type", "")  # p2p/group

        # 获取消息内容
        content = json.loads(message.get("content", "{}"))
        text = content.get("text", "").strip()

        if not text:
            return

        # 处理命令
        if text == "/new":
            self._clear_conversation(sender)
            await self._send_text(chat_id, "✅ 已新建对话")
            return

        if text in ["/help", "帮助"]:
            await self._send_text(
                chat_id,
                "🤖 1052 助理\n\n"
                "直接发送消息开始对话\n"
                "/new - 新建对话\n"
                "支持流式输出和工具调用"
            )
            return

        # 加载对话历史
        messages = self._load_conversation(sender)
        messages.append({"role": "user", "content": text})

        # 创建初始卡片
        card_msg_id = await self._create_streaming_card(chat_id, "💭 思考中...")

        # 流式处理
        full_response = ""
        last_update = 0

        try:
            async for chunk in self.chat_handler(messages):
                chunk_type = chunk.get("type")

                if chunk_type == "delta":
                    full_response += chunk.get("content", "")

                    # 节流更新卡片
                    if len(full_response) - last_update > 20:
                        await self._update_card(
                            card_msg_id,
                            full_response + "▌",
                            status="typing"
                        )
                        last_update = len(full_response)

                elif chunk_type == "tool_call":
                    tool_name = chunk.get("name", "")
                    await self._update_card(
                        card_msg_id,
                        f"🔧 使用工具: {tool_name}...",
                        status="tool"
                    )

                elif chunk_type == "error":
                    await self._update_card(
                        card_msg_id,
                        f"❌ 错误: {chunk.get('content', '')}",
                        status="error"
                    )
                    return

            # 最终更新
            final_text = full_response or "（无回复）"
            await self._update_card(
                card_msg_id,
                final_text,
                status="done"
            )

            # 保存对话
            messages.append({"role": "assistant", "content": full_response})
            self._save_conversation(sender, messages[-20:])

        except Exception as e:
            await self._update_card(
                card_msg_id,
                f"❌ 处理失败: {str(e)}",
                status="error"
            )

    async def _create_streaming_card(self, chat_id: str, initial_text: str) -> str:
        """创建流式卡片，返回消息 ID"""
        try:
            card_content = {
                "config": {"wide_screen_mode": True},
                "elements": [
                    {
                        "tag": "div",
                        "text": {
                            "tag": "lark_md",
                            "content": initial_text
                        }
                    }
                ]
            }

            body = CreateMessageRequestBody.builder() \
                .receive_id(chat_id) \
                .msg_type("interactive") \
                .content(json.dumps(card_content)) \
                .build()

            request = CreateMessageRequest.builder() \
                .request_body(body) \
                .build()

            response = self.client.im.v1.message.create(request)

            if response.success():
                return response.data.message_id
            else:
                print(f"[Lark] 创建卡片失败: {response.msg}")
                # 降级发送文本
                return await self._send_text(chat_id, initial_text)

        except Exception as e:
            print(f"[Lark] 创建卡片异常: {e}")
            return await self._send_text(chat_id, initial_text)

    async def _update_card(self, message_id: str, text: str, status: str = "typing"):
        """更新卡片内容"""
        try:
            # 截断文本
            if len(text) > 3000:
                text = text[:3000] + "\n\n...(内容已截断)"

            card_content = {
                "config": {"wide_screen_mode": True},
                "elements": [
                    {
                        "tag": "div",
                        "text": {
                            "tag": "lark_md",
                            "content": text
                        }
                    }
                ]
            }

            # 添加状态标签
            if status == "typing":
                card_content["elements"].append({
                    "tag": "note",
                    "elements": [{"tag": "plain_text", "content": "💭 思考中..."}]
                })

            body = UpdateMessageRequestBody.builder() \
                .content(json.dumps(card_content)) \
                .build()

            request = UpdateMessageRequest.builder() \
                .message_id(message_id) \
                .request_body(body) \
                .build()

            response = self.client.im.v1.message.patch(request)

            if not response.success():
                print(f"[Lark] 更新卡片失败: {response.msg}")

        except Exception as e:
            print(f"[Lark] 更新卡片异常: {e}")

    async def _send_text(self, chat_id: str, text: str) -> str:
        """发送纯文本消息（降级用）"""
        try:
            body = CreateMessageRequestBody.builder() \
                .receive_id(chat_id) \
                .msg_type("text") \
                .content(json.dumps({"text": text})) \
                .build()

            request = CreateMessageRequest.builder() \
                .request_body(body) \
                .build()

            response = self.client.im.v1.message.create(request)

            if response.success():
                return response.data.message_id
            else:
                print(f"[Lark] 发送文本失败: {response.msg}")
                return ""

        except Exception as e:
            print(f"[Lark] 发送文本异常: {e}")
            return ""

    def _load_conversation(self, user_id: str) -> list:
        """加载用户对话历史"""
        conv_file = DATA_DIR / "lark_conv" / f"{user_id}.json"
        if conv_file.exists():
            try:
                return json.loads(conv_file.read_text(encoding="utf-8"))
            except Exception:
                pass
        return []

    def _save_conversation(self, user_id: str, messages: list):
        """保存用户对话历史"""
        conv_file = DATA_DIR / "lark_conv" / f"{user_id}.json"
        conv_file.parent.mkdir(parents=True, exist_ok=True)
        conv_file.write_text(json.dumps(messages, ensure_ascii=False, indent=2), encoding="utf-8")

    def _clear_conversation(self, user_id: str):
        """清空对话历史"""
        conv_file = DATA_DIR / "lark_conv" / f"{user_id}.json"
        if conv_file.exists():
            conv_file.unlink()
