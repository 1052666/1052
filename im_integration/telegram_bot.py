"""
Telegram Bot 集成 - 支持流式输出
"""

import asyncio
import json
import re
from typing import Callable, Optional
from pathlib import Path

try:
    from telegram import Update, InlineKeyboardButton, InlineKeyboardMarkup
    from telegram.ext import (
        Application, CommandHandler, MessageHandler,
        CallbackQueryHandler, ContextTypes, filters
    )
    TELEGRAM_AVAILABLE = True
except ImportError:
    TELEGRAM_AVAILABLE = False

from core.config import DATA_DIR
from .evolution import evolution_manager

# 文件存储目录
UPLOAD_DIR = DATA_DIR / "2222"
UPLOAD_DIR.mkdir(parents=True, exist_ok=True)


def remove_thinking_tags(text: str) -> str:
    """移除思考标签及其内容"""
    return re.sub(r"<think>[\s\S]*?</think>", "", text)


def markdown_to_html(text: str) -> str:
    """
    将 Markdown 转换为 Telegram HTML 格式

    支持的 Markdown 标签:
    - **bold** -> <b>bold</b>
    - *italic* -> <i>italic</i>
    - `code` -> <code>code</code>
    - ```code block``` -> <pre>code block</pre>
    - [text](url) -> <a href="url">text</a>
    - # heading -> <b>heading</b>
    - - list -> • list
    - > quote -> <blockquote>quote</blockquote>
    """
    import html

    # 转义 HTML 特殊字符
    text = html.escape(text)

    # 代码块 (必须在其他转换之前)
    text = re.sub(r'```(\w*)\n([\s\S]*?)```', r'<pre>\2</pre>', text)
    text = re.sub(r'`([^`]+)`', r'<code>\1</code>', text)

    # 粗体和斜体
    text = re.sub(r'\*\*\*([^\*]+)\*\*\*', r'<b><i>\1</i></b>', text)
    text = re.sub(r'\*\*([^\*]+)\*\*', r'<b>\1</b>', text)
    text = re.sub(r'\*([^\*]+)\*', r'<i>\1</i>', text)
    text = re.sub(r'___([^_]+)___', r'<b><i>\1</i></b>', text)
    text = re.sub(r'__([^_]+)__', r'<b>\1</b>', text)
    text = re.sub(r'_([^_]+)_', r'<i>\1</i>', text)

    # 链接
    text = re.sub(r'\[([^\]]+)\]\(([^)]+)\)', r'<a href="\2">\1</a>', text)

    # 标题
    text = re.sub(r'^### (.+)$', r'<b>\1</b>', text, flags=re.MULTILINE)
    text = re.sub(r'^## (.+)$', r'<b>\1</b>', text, flags=re.MULTILINE)
    text = re.sub(r'^# (.+)$', r'<b>\1</b>', text, flags=re.MULTILINE)

    # 列表
    text = re.sub(r'^- (.+)$', r'• \1', text, flags=re.MULTILINE)
    text = re.sub(r'^\* (.+)$', r'• \1', text, flags=re.MULTILINE)

    # 引用
    text = re.sub(r'^> (.+)$', r'<blockquote>\1</blockquote>', text, flags=re.MULTILINE)

    # 删除线
    text = re.sub(r'~~([^~]+)~~', r'\1', text)

    # 换行处理 - 确保换行被正确显示
    text = text.replace('\n', '\n')

    return text


class TelegramBot:
    """Telegram 机器人，支持流式回复和文件处理"""

    def __init__(self, token: str, chat_handler: Optional[Callable] = None):
        self.token = token
        self.chat_handler = chat_handler
        self.app: Optional[Application] = None
        self._task: Optional[asyncio.Task] = None
        self._enabled = False
        self._max_retries = 3
        self._retry_delay = 1.0

    @property
    def enabled(self) -> bool:
        return self._enabled and TELEGRAM_AVAILABLE

    def get_health(self) -> dict:
        """获取健康状态"""
        return {
            "enabled": self.enabled,
            "app_initialized": self.app is not None,
            "updater_running": self.app and self.app.updater and self.app.updater.running if self.app else False,
            "token_set": bool(self.token)
        }

    async def start(self):
        """启动机器人"""
        if not TELEGRAM_AVAILABLE:
            print("[Telegram] python-telegram-bot 未安装，跳过")
            return
        if not self.token:
            print("[Telegram] Token 未配置")
            return

        try:
            self.app = Application.builder().token(self.token).build()

            # 注册处理器
            self.app.add_handler(CommandHandler("start", self._cmd_start))
            self.app.add_handler(CommandHandler("1052", self._cmd_menu))  # 命令菜单
            self.app.add_handler(CommandHandler("help", self._cmd_help))
            self.app.add_handler(CommandHandler("new", self._cmd_new))
            self.app.add_handler(CommandHandler("evolve", self._cmd_evolution))
            self.app.add_handler(CallbackQueryHandler(self._callback_handler))

            # 文字消息处理器
            self.app.add_handler(MessageHandler(filters.TEXT & ~filters.COMMAND, self._handle_text_message))
            # 图片处理器
            self.app.add_handler(MessageHandler(filters.PHOTO & ~filters.COMMAND, self._handle_photo_message))
            # 文档/文件处理器
            self.app.add_handler(MessageHandler(filters.Document.ALL & ~filters.COMMAND, self._handle_document_message))
            # 音频处理器
            self.app.add_handler(MessageHandler(filters.AUDIO & ~filters.COMMAND, self._handle_audio_message))
            # 视频处理器
            self.app.add_handler(MessageHandler(filters.VIDEO & ~filters.COMMAND, self._handle_video_message))
            # 语音处理器
            self.app.add_handler(MessageHandler(filters.VOICE & ~filters.COMMAND, self._handle_voice_message))

            # 启动轮询
            await self.app.initialize()
            await self.app.start()
            self._task = asyncio.create_task(self.app.updater.start_polling(drop_pending_updates=True))
            self._enabled = True
            print(f"[Telegram] 机器人已启动")

        except Exception as e:
            print(f"[Telegram] 启动失败: {e}")

    async def stop(self):
        """停止机器人"""
        if self.app and self._enabled:
            if self._task:
                self._task.cancel()
                try:
                    await self._task
                except asyncio.CancelledError:
                    pass
            await self.app.stop()
            await self.app.shutdown()
            self._enabled = False
            print("[Telegram] 机器人已停止")

    async def _cmd_start(self, update: Update, context: ContextTypes.DEFAULT_TYPE):
        """/start 命令"""
        await update.message.reply_text(
            "🤖 你好！我是 1052 助理\n\n"
            "直接发送消息开始对话\n"
            "/new - 新建对话\n"
            "/help - 查看帮助",
            parse_mode="HTML"
        )

    async def _cmd_menu(self, update: Update, context: ContextTypes.DEFAULT_TYPE):
        """/1052 命令 - 显示命令菜单"""
        menu_text = (
            "📋 <b>1052 可用命令</b>\n\n"
            "<code>/new</code> - 新建对话，清空上下文\n"
            "<code>/evolve</code> - 开启进化模式（自主思考）\n"
            "<code>/help</code> - 查看帮助\n\n"
            "直接发送消息与我对话"
        )
        await update.message.reply_text(menu_text, parse_mode="HTML")

    async def _cmd_help(self, update: Update, context: ContextTypes.DEFAULT_TYPE):
        """/help 命令"""
        await update.message.reply_text(
            "📖 使用帮助\n\n"
            "• 直接发送文字消息与我对话\n"
            "• 支持流式输出，实时显示回复\n"
            "• 支持发送图片、文件\n"
            "• /new 清空当前对话历史\n"
            "• /evolve 开启进化模式（自主思考）\n\n"
            "来自 1052 AI Agent",
            parse_mode="HTML"
        )

    async def _cmd_new(self, update: Update, context: ContextTypes.DEFAULT_TYPE):
        """/new 命令 - 清空对话"""
        chat_id = update.effective_chat.id
        user_id = update.effective_user.id

        # 清理对话历史
        conv_file = DATA_DIR / "telegram_conv" / f"{user_id}.json"
        if conv_file.exists():
            conv_file.unlink()

        await update.message.reply_text("✅ 已新建对话，历史已清空", parse_mode="HTML")

    async def _cmd_evolution(self, update: Update, context: ContextTypes.DEFAULT_TYPE):
        """/evolve 命令 - 开启进化模式"""
        if evolution_manager.active:
            await update.message.reply_text("⚠️ 已经在进化模式中，发送任意消息退出")
            return

        user_id = str(update.effective_user.id)

        await update.message.reply_text("🔄 开始进化模式，发送任意消息打断")

        # 使用共享的进化管理器
        result = await evolution_manager.start("telegram", user_id)
        # 忽略result，进化管理器会处理日志

    async def _exit_evolution_mode(self, bot, chat_id: int):
        """退出进化模式"""
        if not evolution_manager.active:
            return

        result = await evolution_manager.stop()
        await bot.send_message(chat_id=chat_id, text=f"✅ {result}")

    async def _callback_handler(self, update: Update, context: ContextTypes.DEFAULT_TYPE):
        """按钮回调处理"""
        query = update.callback_query
        await query.answer()

        # 可以在这里处理卡片按钮点击

    async def _handle_text_message(self, update: Update, context: ContextTypes.DEFAULT_TYPE):
        """处理文字消息"""
        # 进化模式下，任何消息都退出进化模式
        if evolution_manager.active:
            await self._exit_evolution_mode(context.bot, update.effective_chat.id)
            return
        await self._process_message(update, context, message_text=update.message.text, message_type="text")

    async def _handle_photo_message(self, update: Update, context: ContextTypes.DEFAULT_TYPE):
        """处理图片消息"""
        if evolution_manager.active:
            await self._exit_evolution_mode(context.bot, update.effective_chat.id)
            return
        # 获取最大分辨率的图片
        photo = update.message.photo[-1]
        file = await context.bot.get_file(photo.file_id)

        # 保存图片
        from datetime import datetime
        timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
        ext = "jpg"
        filename = f"photo_{timestamp}.{ext}"
        filepath = UPLOAD_DIR / filename

        await file.download_to_drive(custom_path=str(filepath))

        message_text = f"[用户发送了一张图片，已保存到 {filename}]"
        await self._process_message(update, context, message_text=message_text, message_type="photo", file_path=str(filepath))

    async def _handle_document_message(self, update: Update, context: ContextTypes.DEFAULT_TYPE):
        """处理文档消息"""
        if evolution_manager.active:
            await self._exit_evolution_mode(context.bot, update.effective_chat.id)
            return
        doc = update.message.document
        file = await context.bot.get_file(doc.file_id)

        # 获取文件名
        filename = doc.file_name or f"document_{doc.file_id}"
        filepath = UPLOAD_DIR / filename

        await file.download_to_drive(custom_path=str(filepath))

        message_text = f"[用户发送了文件 {filename}，已保存到 data/2222/]"
        await self._process_message(update, context, message_text=message_text, message_type="document", file_path=str(filepath))

    async def _handle_audio_message(self, update: Update, context: ContextTypes.DEFAULT_TYPE):
        """处理音频消息"""
        if evolution_manager.active:
            await self._exit_evolution_mode(context.bot, update.effective_chat.id)
            return
        audio = update.message.audio
        file = await context.bot.get_file(audio.file_id)

        filename = audio.file_name or f"audio_{audio.file_id}.mp3"
        filepath = UPLOAD_DIR / filename

        await file.download_to_drive(custom_path=str(filepath))

        message_text = f"[用户发送了音频 {filename}，已保存到 data/2222/]"
        await self._process_message(update, context, message_text=message_text, message_type="audio", file_path=str(filepath))

    async def _handle_video_message(self, update: Update, context: ContextTypes.DEFAULT_TYPE):
        """处理视频消息"""
        if evolution_manager.active:
            await self._exit_evolution_mode(context.bot, update.effective_chat.id)
            return
        video = update.message.video
        file = await context.bot.get_file(video.file_id)

        filename = video.file_name or f"video_{video.file_id}.mp4"
        filepath = UPLOAD_DIR / filename

        await file.download_to_drive(custom_path=str(filepath))

        message_text = f"[用户发送了视频 {filename}，已保存到 data/2222/]"
        await self._process_message(update, context, message_text=message_text, message_type="video", file_path=str(filepath))

    async def _handle_voice_message(self, update: Update, context: ContextTypes.DEFAULT_TYPE):
        """处理语音消息"""
        if evolution_manager.active:
            await self._exit_evolution_mode(context.bot, update.effective_chat.id)
            return
        voice = update.message.voice
        file = await context.bot.get_file(voice.file_id)

        from datetime import datetime
        timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
        filename = f"voice_{timestamp}.ogg"
        filepath = UPLOAD_DIR / filename

        await file.download_to_drive(custom_path=str(filepath))

        message_text = f"[用户发送了语音消息，已保存到 data/2222/{filename}]"
        await self._process_message(update, context, message_text=message_text, message_type="voice", file_path=str(filepath))

    async def _process_message(self, update: Update, context: ContextTypes.DEFAULT_TYPE, message_text: str, message_type: str = "text", file_path: str = None):
        """处理消息的核心逻辑"""
        import os

        if not self.chat_handler:
            await update.message.reply_text("❌ 聊天处理未配置", parse_mode="HTML")
            return

        user_id = update.effective_user.id
        chat_id = update.effective_chat.id

        # 发送"正在输入"状态
        await context.bot.send_chat_action(chat_id=chat_id, action="typing")

        # 加载对话历史
        messages = self._load_conversation(user_id)

        # 在消息开头插入用户信息（供定时任务使用）
        messages.insert(0, {
            "role": "system",
            "content": f"[用户信息] platform=telegram, user_id={user_id}"
        })

        # 构建消息内容
        content = message_text
        if file_path and message_type in ["photo", "document", "attachment"]:
            content = f"{message_text}\n[文件路径: {file_path}]"

        messages.append({"role": "user", "content": content})

        # 创建初始回复消息
        reply_msg = await update.message.reply_text("💭 思考中...", parse_mode="HTML")

        # 流式处理
        full_response = ""
        last_update_len = 0
        update_interval = 0.5  # 秒
        last_update_time = asyncio.get_event_loop().time()

        try:
            async for chunk in self.chat_handler(messages):
                chunk_type = chunk.get("type")
                print(f"[TG Bot] 收到 chunk: type={chunk_type}, content={str(chunk)[:200]}")

                if chunk_type == "delta":
                    content = chunk.get("content", "")
                    full_response += content

                    # 节流更新，避免频繁编辑
                    current_time = asyncio.get_event_loop().time()
                    if current_time - last_update_time >= update_interval:
                        # 确保截断到 3800 字符内，留出空间给末尾标记
                        display_text = remove_thinking_tags(full_response[-3800:])
                        display_html = markdown_to_html(display_text) + "▌"
                        if len(display_text) > last_update_len + 10:
                            await self._edit_with_retry(reply_msg, display_html, parse_mode="HTML")
                            last_update_len = len(display_text)
                            last_update_time = current_time

                elif chunk_type == "tool_call":
                    # 显示工具调用（不要替换之前的内容，只在末尾追加）
                    tool_name = chunk.get("name", "")
                    print(f"[TG Bot] 工具调用: {tool_name}")
                    # 截断过长的历史内容，保留末尾
                    display_text = remove_thinking_tags(full_response[-3800:])
                    tool_msg = f"{display_text}\n\n🔧 使用工具: {tool_name}..."
                    await self._edit_with_retry(reply_msg, tool_msg, parse_mode="HTML")

                elif chunk_type == "tool_result":
                    # 工具结果
                    result_content = str(chunk.get("result", ""))
                    print(f"[TG Bot] 工具结果: {result_content[:200]}")

                    # 检测 send_to_tg 工具返回的 [TG_FILE:xxx] 标记
                    tg_file_match = re.search(r'\[TG_FILE:([^\]]+)\]', result_content)
                    if tg_file_match:
                        file_path = tg_file_match.group(1)
                        await self._send_local_file(context.bot, chat_id, file_path)

                    # 更新消息显示继续思考
                    display_text = remove_thinking_tags(full_response[-3800:])
                    thinking_msg = display_text + "\n\n💭 继续思考中..."
                    await self._edit_with_retry(reply_msg, thinking_msg, parse_mode="HTML")
                    await context.bot.send_chat_action(chat_id=chat_id, action="typing")

                elif chunk_type == "file":
                    # AI 返回了文件，需要发送给用户
                    file_path = chunk.get("url", "")
                    caption = chunk.get("caption", "")
                    await self._send_local_file(context.bot, chat_id, file_path, caption)

                elif chunk_type == "error":
                    print(f"[TG Bot] 错误: {chunk.get('content', '')}")
                    error_text = f"❌ 错误: {chunk.get('content', '')}"
                    await self._edit_with_retry(reply_msg, error_text, parse_mode="HTML")
                    return

                elif chunk_type == "done":
                    print(f"[TG Bot] 流式结束")

            # 最终更新
            final_text = remove_thinking_tags(full_response[-3800:]) if full_response else "（无回复）"

            print(f"[TG Bot] final_text 长度: {len(final_text)}")
            print(f"[TG Bot] final_text 内容预览: {final_text[:500]}")

            # 提取文件链接并发送，然后从文本中移除
            # 支持三种格式：
            # 1. [TG_FILE:xxx] -> 直接是本地文件路径
            # 2. [FILE_URL:/files/xxx] -> 本地文件路径 data/1111/xxx
            # 3. [filename](/files/xxx) -> Markdown 链接格式，需要从 URL 提取路径
            all_files = []

            # 提取 [TG_FILE:xxx] 格式
            tg_file_pattern = re.findall(r'\[TG_FILE:([^\]]+)\]', final_text)
            for f in tg_file_pattern:
                all_files.append(("tg_file", f))

            # 提取 [FILE_URL:/files/xxx] 格式
            file_url_pattern = re.findall(r'\[FILE_URL:/files/([^\]]+)\]', final_text)
            for f in file_url_pattern:
                all_files.append(("file_url", f))

            # 提取 Markdown 链接格式 [filename](/files/xxx)
            md_link_pattern = re.findall(r'\[([^\]]+)\]\(/files/([^)]+)\)', final_text)
            for filename, url_path in md_link_pattern:
                all_files.append(("md_link", (filename, url_path)))

            print(f"[TG Bot] 找到文件: {all_files}")

            for file_info in all_files:
                file_type = file_info[0]
                file_path = None

                if file_type == "tg_file":
                    file_path = file_info[1]
                elif file_type == "file_url":
                    file_path = file_info[1]
                elif file_type == "md_link":
                    file_path = file_info[1][1]  # url_path

                if file_path:
                    await self._send_local_file(context.bot, chat_id, file_path)

            # 从文本中移除各种文件链接标记
            final_text = re.sub(r'\[TG_FILE:[^\]]+\]\n?', '', final_text)
            final_text = re.sub(r'\[FILE_URL:/files/[^\]]+\]\n?', '', final_text)
            final_text = re.sub(r'\[([^\]]+)\]\(/files/[^)]+\)\n?', '', final_text)
            print(f"[TG Bot] 移除链接后 final_text: {final_text[:500]}")
            final_text = final_text.strip()

            if not final_text:
                final_text = "（无回复）"

            # 转换为 HTML
            final_html = markdown_to_html(final_text)

            # 使用重试机制发送最终回复
            success = await self._edit_with_retry(reply_msg, final_html, parse_mode="HTML")
            if not success:
                # 如果编辑失败，发送新消息
                await self._send_with_retry(chat_id, final_html, parse_mode="HTML")

            # 保存对话
            messages.append({"role": "assistant", "content": full_response})
            self._save_conversation(user_id, messages[-20:])  # 保留最近20条

        except Exception as e:
            await self._edit_with_retry(reply_msg, f"❌ 处理失败: {str(e)}", parse_mode="HTML")

    def _load_conversation(self, user_id: int) -> list:
        """加载用户对话历史"""
        conv_file = DATA_DIR / "telegram_conv" / f"{user_id}.json"
        if conv_file.exists():
            try:
                return json.loads(conv_file.read_text(encoding="utf-8"))
            except Exception:
                pass
        return []

    def _save_conversation(self, user_id: int, messages: list):
        """保存用户对话历史"""
        conv_file = DATA_DIR / "telegram_conv" / f"{user_id}.json"
        conv_file.parent.mkdir(parents=True, exist_ok=True)
        conv_file.write_text(json.dumps(messages, ensure_ascii=False, indent=2), encoding="utf-8")

    async def _send_local_file(self, bot, chat_id: int, file_path: str, caption: str = ""):
        """
        根据文件类型发送本地文件到 Telegram
        支持: 图片(.png/.jpg/.jpeg/.gif/.webp)、视频(.mp4/.avi/.mov/.mkv)、音频(.mp3/.wav/.ogg/.m4a)、文档
        """
        import os

        # 解析文件路径
        if not file_path:
            return

        # 如果是 /files/xxx 格式，转换为本地路径
        if file_path.startswith("/files/"):
            filename = file_path[8:]
            local_path = str(DATA_DIR / "1111" / filename)
        elif file_path.startswith("data/1111/"):
            local_path = str(DATA_DIR / file_path[5:])
        elif not os.path.isabs(file_path):
            local_path = str(DATA_DIR / "1111" / file_path)
        else:
            local_path = file_path

        local_path = os.path.normpath(local_path)

        if not os.path.exists(local_path):
            print(f"[TG Bot] 文件不存在: {local_path}")
            return

        try:
            filename_lower = local_path.lower()
            if filename_lower.endswith(('.png', '.jpg', '.jpeg', '.gif', '.webp')):
                # sendPhoto - 图片最大 10MB
                await bot.send_photo(chat_id=chat_id, photo=local_path, caption=caption)
                print(f"[TG Bot] 图片发送成功: {local_path}")
            elif filename_lower.endswith(('.mp4', '.avi', '.mov', '.mkv')):
                # sendVideo - 视频最大 50MB
                await bot.send_video(chat_id=chat_id, video=local_path, caption=caption)
                print(f"[TG Bot] 视频发送成功: {local_path}")
            elif filename_lower.endswith(('.mp3', '.wav', '.m4a')):
                # sendAudio - MP3/M4A 格式
                await bot.send_audio(chat_id=chat_id, audio=local_path, caption=caption)
                print(f"[TG Bot] 音频发送成功: {local_path}")
            elif filename_lower.endswith(('.ogg',)):
                # sendVoice - OGG 格式，语音消息
                await bot.send_voice(chat_id=chat_id, voice=local_path, caption=caption)
                print(f"[TG Bot] 语音消息发送成功: {local_path}")
            else:
                # sendDocument - 其他所有文件
                await bot.send_document(chat_id=chat_id, document=local_path, caption=caption)
                print(f"[TG Bot] 文档发送成功: {local_path}")
        except Exception as e:
            print(f"[TG Bot] 文件发送失败: {e}")

    async def _edit_with_retry(self, message, text: str, parse_mode: str = None, max_retries: int = 3) -> bool:
        """
        带重试的 edit_text，支持消息过长时自动截断

        Returns:
            True if successful, False otherwise
        """
        # Telegram 消息限制 4096 字符
        MAX_MSG_LEN = 4096

        for attempt in range(max_retries):
            try:
                # 如果消息过长，截断
                if len(text) > MAX_MSG_LEN:
                    text = text[:MAX_MSG_LEN - 20] + "\n...(内容过长已截断)"

                if parse_mode:
                    await message.edit_text(text, parse_mode=parse_mode)
                else:
                    await message.edit_text(text)
                return True
            except Exception as e:
                error_str = str(e).lower()
                # 检查是否是消息过长错误
                if 'too long' in error_str or 'message too long' in error_str:
                    # 再次截断后重试
                    text = text[:MAX_MSG_LEN - 50] + "\n...(内容过长已截断)"
                    try:
                        if parse_mode:
                            await message.edit_text(text, parse_mode=parse_mode)
                        else:
                            await message.edit_text(text)
                        return True
                    except:
                        return False
                if any(kw in error_str for kw in ['timeout', 'network', 'connection', 'read', 'write', 'httpx', 'retry']):
                    print(f"[TG Bot] edit_text 重试 ({attempt + 1}/{max_retries}): {e}")
                    if attempt < max_retries - 1:
                        await asyncio.sleep(1.0 * (attempt + 1))
                    else:
                        print(f"[TG Bot] edit_text 最终失败: {e}")
                        return False
                else:
                    # 非网络错误，不重试
                    print(f"[TG Bot] edit_text 失败（不重试）: {e}")
                    return False
        return False

    async def _send_with_retry(self, chat_id: int, text: str, parse_mode: str = None, max_retries: int = 3) -> bool:
        """
        带重试的 send_message

        Returns:
            True if successful, False otherwise
        """
        bot = self.app.bot
        for attempt in range(max_retries):
            try:
                if parse_mode:
                    await bot.send_message(chat_id=chat_id, text=text, parse_mode=parse_mode)
                else:
                    await bot.send_message(chat_id=chat_id, text=text)
                return True
            except Exception as e:
                error_str = str(e).lower()
                if any(kw in error_str for kw in ['timeout', 'network', 'connection', 'read', 'write', 'httpx', 'retry']):
                    print(f"[TG Bot] send_message 重试 ({attempt + 1}/{max_retries}): {e}")
                    if attempt < max_retries - 1:
                        await asyncio.sleep(1.0 * (attempt + 1))
                    else:
                        print(f"[TG Bot] send_message 最终失败: {e}")
                        return False
                else:
                    print(f"[TG Bot] send_message 失败（不重试）: {e}")
                    return False
        return False
