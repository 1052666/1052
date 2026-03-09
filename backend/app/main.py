from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
from typing import Dict, Any, List
import time
import json
import asyncio
import os
import uuid

import logging

from app.models import (
    Conversation, Message, SendMessageRequest,
    SettingsUpdate, SettingsResponse,
    NativeCommandRequest, NativeCommandLog,
    FileOperationRequest, FileOperationResponse
)
from app.config import load_settings, save_settings, Settings
from app.storage import (
    load_conversation, save_conversation, get_or_create_conversation, clear_conversation
)
from app.openai_client import stream_openai_api, format_messages_for_api
from app.native_service import (
    execute_native_command as exec_native_cmd,
    execute_file_operation as exec_file_op,
    get_logs, clear_logs
)
from app.telegram_service import send_telegram_message
from app.telegram_bot import telegram_bot
from app.feishu_service import send_feishu_message, send_feishu_file
from app.feishu_bot import feishu_bot
from app.metaso_service import search_metaso
from app.skill_models import Skill, SkillCreate, SkillUpdate
from app.skill_loader import skill_loader
from app.scheduler_models import ScheduleTask, ScheduleTaskCreate, ScheduleTaskUpdate, HeartbeatStatus
from app.scheduler_service import task_scheduler
from app.self_evolution import self_evolution_mode
from app.money_making_mode import money_making_mode
from app.agent_models import (
    AgentChatRequest, AgentChatResponse, AgentInfo, 
    AgentCapability, AgentHeartbeat, AgentStreamChunk
)

logger = logging.getLogger(__name__)

AGENT_ID = "1052-agent"
AGENT_NAME = "1052 Agent"
AGENT_VERSION = "1.0.0"
AGENT_START_TIME = int(time.time())

app = FastAPI(
    title="1052 Agent API",
    description="1052 Agent 通信接口 - 支持与其他 AI Agent 进行通信",
    version="1.0.0"
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

async def tool_executor(function_name: str, arguments: Dict[str, Any]) -> str:
    settings = load_settings()
    
    if function_name == "execute_shell_command":
        request = NativeCommandRequest(
            command=arguments.get("command", ""),
            shell_type=arguments.get("shell_type", "cmd"),
            timeout=min(arguments.get("timeout", 30), 300)
        )
        result = await exec_native_cmd(request)
        return json.dumps({
            "success": result.success,
            "output": result.output,
            "error": result.error,
            "exit_code": result.exit_code
        }, ensure_ascii=False)
    
    elif function_name == "file_operation":
        request = FileOperationRequest(
            operation=arguments.get("operation", "read"),
            path=arguments.get("path", ""),
            content=arguments.get("content"),
            encoding=arguments.get("encoding", "utf-8"),
            line_number=arguments.get("line_number"),
            old_text=arguments.get("old_text"),
            new_text=arguments.get("new_text")
        )
        result = await exec_file_op(request)
        response_data = {
            "success": result.success,
            "error": result.error
        }
        if result.content is not None:
            response_data["content"] = result.content
        if result.files is not None:
            response_data["files"] = result.files
        if result.exists is not None:
            response_data["exists"] = result.exists
        return json.dumps(response_data, ensure_ascii=False)
    
    elif function_name == "send_telegram_message":
        message = arguments.get("message", "")
        result = await send_telegram_message(message)
        if result.get("success"):
            return json.dumps({"success": True, "silent": True}, ensure_ascii=False)
        else:
            return json.dumps({"success": False, "error": result.get("error", "Unknown error")}, ensure_ascii=False)
    
    elif function_name == "send_feishu_message":
        message = arguments.get("message", "")
        receive_id = arguments.get("receive_id")
        result = await send_feishu_message(message, receive_id)
        if result.get("success"):
            return json.dumps({"success": True, "silent": True}, ensure_ascii=False)
        else:
            return json.dumps({"success": False, "error": result.get("error", "Unknown error")}, ensure_ascii=False)
    
    elif function_name == "send_feishu_file":
        file_path = arguments.get("file_path", "")
        caption = arguments.get("caption", "")
        receive_id = arguments.get("receive_id")
        
        if not file_path:
            return json.dumps({"error": "file_path is required"}, ensure_ascii=False)
        
        if not os.path.exists(file_path):
            return json.dumps({"error": f"File not found: {file_path}"}, ensure_ascii=False)
        
        try:
            result = await send_feishu_file(file_path, receive_id, caption)
            if result.get("success"):
                return json.dumps({"success": True, "silent": True}, ensure_ascii=False)
            else:
                return json.dumps({"error": result.get("error", "Failed to send file")}, ensure_ascii=False)
        except Exception as e:
            logger.error(f"Failed to send feishu file: {e}")
            return json.dumps({"error": f"Failed to send file: {str(e)}"}, ensure_ascii=False)
    
    elif function_name == "web_search":
        query = arguments.get("query", "")
        if not query:
            return json.dumps({"error": "Search query is required"}, ensure_ascii=False)
        
        if not settings.metaso_api_key:
            return json.dumps({"error": "Web search is not configured. Please add Metaso API key in settings."}, ensure_ascii=False)
        
        search_result = await search_metaso(
            api_key=settings.metaso_api_key,
            query=query,
            include_summary=True,
            size=5
        )
        
        if search_result is None:
            return json.dumps({"error": "Search failed. Please try again."}, ensure_ascii=False)
        
        return json.dumps({
            "success": True,
            "query": query,
            "data": search_result
        }, ensure_ascii=False)
    
    elif function_name == "create_skill":
        name = arguments.get("name", "")
        description = arguments.get("description", "")
        system_prompt = arguments.get("system_prompt", "")
        
        if not name or not description or not system_prompt:
            return json.dumps({"error": "name, description, and system_prompt are required"}, ensure_ascii=False)
        
        try:
            new_skill = skill_loader.create_skill(
                name=name,
                description=description,
                system_prompt=system_prompt
            )
            return json.dumps({
                "success": True,
                "skill_id": new_skill.id,
                "name": new_skill.metadata.name if new_skill.metadata else name,
                "message": f"技能 '{name}' 创建成功！技能ID: {new_skill.id}"
            }, ensure_ascii=False)
        except Exception as e:
            logger.error(f"Failed to create skill: {e}")
            return json.dumps({"error": f"Failed to create skill: {str(e)}"}, ensure_ascii=False)
    
    elif function_name == "schedule_task":
        name = arguments.get("name", "")
        description = arguments.get("description", "")
        trigger_type = arguments.get("trigger_type", "once")
        trigger_time = arguments.get("trigger_time")
        interval_seconds = arguments.get("interval_seconds")
        prompt = arguments.get("prompt", "")
        
        if not name or not prompt:
            return json.dumps({"error": "name and prompt are required"}, ensure_ascii=False)
        
        try:
            from app.scheduler_models import ScheduleTaskCreate
            task_create = ScheduleTaskCreate(
                name=name,
                description=description,
                trigger_type=trigger_type,
                trigger_time=trigger_time,
                interval_seconds=interval_seconds,
                prompt=prompt
            )
            new_task = task_scheduler.create_task(task_create)
            
            next_run_info = ""
            if new_task.next_run_at:
                from datetime import datetime
                next_run_dt = datetime.fromtimestamp(new_task.next_run_at / 1000)
                next_run_info = f"，下次执行时间: {next_run_dt.strftime('%Y-%m-%d %H:%M:%S')}"
            
            return json.dumps({
                "success": True,
                "task_id": new_task.id,
                "name": new_task.name,
                "trigger_type": new_task.trigger_type,
                "message": f"定时任务 '{name}' 创建成功！类型: {trigger_type}{next_run_info}"
            }, ensure_ascii=False)
        except Exception as e:
            logger.error(f"Failed to create scheduled task: {e}")
            return json.dumps({"error": f"Failed to create scheduled task: {str(e)}"}, ensure_ascii=False)
    
    elif function_name == "send_file":
        file_path = arguments.get("file_path", "")
        file_type = arguments.get("file_type", "document")
        caption = arguments.get("caption", "")
        
        if not file_path:
            return json.dumps({"error": "file_path is required"}, ensure_ascii=False)
        
        if not os.path.exists(file_path):
            return json.dumps({"error": f"File not found: {file_path}"}, ensure_ascii=False)
        
        try:
            if file_type == "photo":
                result = await telegram_bot.send_photo(file_path, caption)
            else:
                result = await telegram_bot.send_document(file_path, caption)
            
            if result.get("success"):
                return json.dumps({"success": True, "silent": True}, ensure_ascii=False)
            else:
                return json.dumps({"error": result.get("error", "Failed to send file")}, ensure_ascii=False)
        except Exception as e:
            logger.error(f"Failed to send file: {e}")
            return json.dumps({"error": f"Failed to send file: {str(e)}"}, ensure_ascii=False)
    
    elif function_name == "add_memory":
        from app.memory_service import add_memory as add_mem
        section = arguments.get("section", "其他记忆")
        content = arguments.get("content", "")
        
        if not content:
            return json.dumps({"error": "content is required"}, ensure_ascii=False)
        
        result = add_mem(section, content)
        return json.dumps(result, ensure_ascii=False)
    
    elif function_name == "update_memory":
        from app.memory_service import update_memory as update_mem
        section = arguments.get("section", "")
        old_content = arguments.get("old_content", "")
        new_content = arguments.get("new_content", "")
        
        if not section or not old_content or not new_content:
            return json.dumps({"error": "section, old_content, and new_content are required"}, ensure_ascii=False)
        
        result = update_mem(section, old_content, new_content)
        return json.dumps(result, ensure_ascii=False)
    
    elif function_name == "delete_memory":
        from app.memory_service import delete_memory as delete_mem
        section = arguments.get("section", "")
        content = arguments.get("content", "")
        
        if not section or not content:
            return json.dumps({"error": "section and content are required"}, ensure_ascii=False)
        
        result = delete_mem(section, content)
        return json.dumps(result, ensure_ascii=False)
    
    elif function_name == "read_memory":
        from app.memory_service import read_memory as read_mem, get_section_content
        section = arguments.get("section")
        
        if section:
            content = get_section_content(section)
        else:
            content = read_mem()
        
        return json.dumps({"success": True, "memory": content}, ensure_ascii=False)
    
    elif function_name == "write_diary":
        from app.diary_service import write_diary_entry
        title = arguments.get("title", "")
        content = arguments.get("content", "")
        mood = arguments.get("mood", "平静")
        
        if not title or not content:
            return json.dumps({"error": "title and content are required"}, ensure_ascii=False)
        
        result = write_diary_entry(title, content, mood)
        return json.dumps(result, ensure_ascii=False)
    
    elif function_name == "read_diary":
        from app.diary_service import get_recent_entries
        count = arguments.get("count", 5)
        entries = get_recent_entries(count)
        return json.dumps({"success": True, "diary": entries}, ensure_ascii=False)
    
    elif function_name == "write_novel_chapter":
        from app.novel_service import save_chapter
        novel_name = arguments.get("novel_name", "")
        chapter_num = arguments.get("chapter_num", 1)
        title = arguments.get("title", "")
        content = arguments.get("content", "")
        
        if not novel_name or not title or not content:
            return json.dumps({"error": "novel_name, title, and content are required"}, ensure_ascii=False)
        
        word_count = len(content.replace('\n', '').replace(' ', ''))
        if word_count < 3500:
            return json.dumps({"error": f"章节字数不足：当前{word_count}字，需要至少3500字"}, ensure_ascii=False)
        
        result = save_chapter(novel_name, chapter_num, title, content)
        return json.dumps(result, ensure_ascii=False)
    
    elif function_name == "get_novel_status":
        from app.novel_service import get_novel_status as get_status
        novel_name = arguments.get("novel_name", "")
        
        if not novel_name:
            return json.dumps({"error": "novel_name is required"}, ensure_ascii=False)
        
        status = get_status(novel_name)
        return json.dumps({"success": True, "status": status}, ensure_ascii=False)
    
    elif function_name == "start_money_making_mode":
        novel_name = arguments.get("novel_name", "")
        outline = arguments.get("outline", "")
        target_words = arguments.get("target_words_per_chapter", 3500)
        
        if not novel_name or not outline:
            return json.dumps({"error": "novel_name and outline are required"}, ensure_ascii=False)
        
        if money_making_mode.is_enabled():
            return json.dumps({"error": "赚钱模式已经在运行中"}, ensure_ascii=False)
        
        money_making_mode.set_write_chapter_callback(handle_novel_task)
        money_making_mode.start(novel_name, outline)
        
        return json.dumps({
            "success": True,
            "message": f"💰 赚钱模式已启动！\n\n小说名称：{novel_name}\n目标：每章{target_words}字\n\n我将持续创作小说，完成后自动发送给用户。发送任意消息可停止。",
            "novel_name": novel_name
        }, ensure_ascii=False)
    
    elif function_name == "stop_money_making_mode":
        if not money_making_mode.is_enabled():
            return json.dumps({"error": "赚钱模式未运行"}, ensure_ascii=False)
        
        money_making_mode.stop()
        return json.dumps({"success": True, "message": "赚钱模式已停止"}, ensure_ascii=False)
    
    else:
        return json.dumps({"error": f"Unknown function: {function_name}"})


async def handle_telegram_message(text: str, user_name: str):
    try:
        text_lower = text.lower().strip()
        
        if text_lower == "/new":
            clear_conversation()
            await telegram_bot.send_message("🆕 新对话已开始！\n\n上下文已清空，我们可以重新开始了。")
            return
        
        if "自我进化机制开启" in text or "开启自我进化" in text:
            if self_evolution_mode.is_enabled():
                await telegram_bot.send_message("自我进化模式已经在运行中。")
                return
            
            self_evolution_mode.set_task_trigger_callback(handle_evolution_task)
            self_evolution_mode.start()
            await telegram_bot.send_message("🧬 自我进化模式已启动！\n\n我将开始自主学习和进化，每隔一段时间会自动执行各种任务来提升自己。\n\n发送任意消息即可停止自我进化模式。")
            return
        
        if "开启赚钱模式" in text or "赚钱模式开启" in text:
            if money_making_mode.is_enabled():
                await telegram_bot.send_message("赚钱模式已经在运行中。")
                return
            
            money_making_mode.set_write_chapter_callback(handle_novel_task)
            money_making_mode.start()
            await telegram_bot.send_message("💰 赚钱模式已启动！\n\n我将开始持续创作小说，每完成一章会自动发送给你。\n\n目标：通过小说创作赚取API费用，实现自给自足！\n\n发送任意消息即可停止赚钱模式。")
            return
        
        if self_evolution_mode.is_enabled():
            self_evolution_mode.stop()
            await telegram_bot.send_message("⏹️ 自我进化模式已停止。\n\n我已退出自我进化模式，随时等待您的指令。")
            return
        
        if money_making_mode.is_enabled():
            money_making_mode.stop()
            await telegram_bot.send_message("⏹️ 赚钱模式已停止。\n\n我已暂停小说创作，随时等待您的指令。")
            return
        
        conversation = get_or_create_conversation()
        current_time = int(time.time() * 1000)
        
        user_message = Message(
            role="user",
            content=f"[Telegram - {user_name}] {text}",
            timestamp=current_time
        )
        conversation.messages.append(user_message)
        
        api_messages = format_messages_for_api(conversation.messages)
        
        full_reply = ""
        async for event in stream_openai_api(api_messages, tool_executor=tool_executor):
            if event["type"] == "content":
                full_reply += event["content"]
        
        if full_reply:
            assistant_message = Message(
                role="assistant",
                content=full_reply,
                timestamp=int(time.time() * 1000)
            )
            conversation.messages.append(assistant_message)
            conversation.updated_at = assistant_message.timestamp
            save_conversation(conversation)
            await telegram_bot.send_message(full_reply)
    except Exception as e:
        logger.error(f"Error handling telegram message: {e}")
        await telegram_bot.send_message(f"抱歉，处理消息时出错: {str(e)}")


async def handle_feishu_message(text: str, user_name: str, chat_id: str = None):
    try:
        text_lower = text.lower().strip()
        
        if text_lower == "/new":
            clear_conversation()
            if chat_id:
                await feishu_bot.send_message(chat_id, "🆕 新对话已开始！\n\n上下文已清空，我们可以重新开始了。")
            return
        
        if "自我进化机制开启" in text or "开启自我进化" in text:
            if self_evolution_mode.is_enabled():
                if chat_id:
                    await feishu_bot.send_message(chat_id, "自我进化模式已经在运行中。")
                return
            
            self_evolution_mode.set_task_trigger_callback(handle_evolution_task)
            self_evolution_mode.start()
            if chat_id:
                await feishu_bot.send_message(chat_id, "🧬 自我进化模式已启动！\n\n我将开始自主学习和进化，每隔一段时间会自动执行各种任务来提升自己。\n\n发送任意消息即可停止自我进化模式。")
            return
        
        if "开启赚钱模式" in text or "赚钱模式开启" in text:
            if money_making_mode.is_enabled():
                if chat_id:
                    await feishu_bot.send_message(chat_id, "赚钱模式已经在运行中。")
                return
            
            money_making_mode.set_write_chapter_callback(handle_novel_task)
            money_making_mode.start()
            if chat_id:
                await feishu_bot.send_message(chat_id, "💰 赚钱模式已启动！\n\n我将开始持续创作小说，每完成一章会自动发送给你。\n\n目标：通过小说创作赚取API费用，实现自给自足！\n\n发送任意消息即可停止赚钱模式。")
            return
        
        if self_evolution_mode.is_enabled():
            self_evolution_mode.stop()
            if chat_id:
                await feishu_bot.send_message(chat_id, "⏹️ 自我进化模式已停止。\n\n我已退出自我进化模式，随时等待您的指令。")
            return
        
        if money_making_mode.is_enabled():
            money_making_mode.stop()
            if chat_id:
                await feishu_bot.send_message(chat_id, "⏹️ 赚钱模式已停止。\n\n我已暂停小说创作，随时等待您的指令。")
            return
        
        conversation = get_or_create_conversation()
        current_time = int(time.time() * 1000)
        
        user_message = Message(
            role="user",
            content=f"[飞书 - {user_name}] {text}",
            timestamp=current_time
        )
        conversation.messages.append(user_message)
        
        api_messages = format_messages_for_api(conversation.messages)
        
        full_reply = ""
        async for event in stream_openai_api(api_messages, tool_executor=tool_executor):
            if event["type"] == "content":
                full_reply += event["content"]
        
        if full_reply:
            assistant_message = Message(
                role="assistant",
                content=full_reply,
                timestamp=int(time.time() * 1000)
            )
            conversation.messages.append(assistant_message)
            conversation.updated_at = assistant_message.timestamp
            save_conversation(conversation)
            
            if chat_id:
                await feishu_bot.send_message(chat_id, full_reply)
    except Exception as e:
        logger.error(f"Error handling feishu message: {e}")
        if chat_id:
            await feishu_bot.send_message(chat_id, f"抱歉，处理消息时出错: {str(e)}")


async def handle_evolution_task(prompt: str):
    try:
        logger.info(f"Executing self-evolution task: {prompt[:50]}...")
        
        conversation = get_or_create_conversation()
        current_time = int(time.time() * 1000)
        
        task_message = Message(
            role="user",
            content=prompt,
            timestamp=current_time
        )
        conversation.messages.append(task_message)
        
        api_messages = format_messages_for_api(conversation.messages)
        
        full_reply = ""
        async for event in stream_openai_api(api_messages, tool_executor=tool_executor):
            if event["type"] == "content":
                full_reply += event["content"]
        
        if full_reply:
            assistant_message = Message(
                role="assistant",
                content=full_reply,
                timestamp=int(time.time() * 1000)
            )
            conversation.messages.append(assistant_message)
            conversation.updated_at = assistant_message.timestamp
            save_conversation(conversation)
            logger.info("Self-evolution task completed")
        
    except Exception as e:
        logger.error(f"Error executing self-evolution task: {e}")


async def handle_novel_task(novel_name: str, chapter_num: int, outline: str):
    try:
        logger.info(f"Novel task: {novel_name} - Chapter {chapter_num}")
        
        conversation = get_or_create_conversation()
        current_time = int(time.time() * 1000)
        
        outline_info = f"\n\n小说大纲：\n{outline}" if outline else ""
        
        prompt = f"""[赚钱模式 - 小说创作]

现在是创作时间！请为小说《{novel_name}》创作第{chapter_num}章。
{outline_info}

要求：
1. 字数：至少3500字
2. 内容：精彩的小说内容，有情节、有对话、有描写
3. 格式：先写章节标题，然后是正文内容
4. 风格：符合小说类型，引人入胜

请使用 write_novel_chapter 工具保存章节，然后使用 send_file 工具发送给用户。"""
        
        task_message = Message(
            role="user",
            content=prompt,
            timestamp=current_time
        )
        conversation.messages.append(task_message)
        
        api_messages = format_messages_for_api(conversation.messages)
        
        full_reply = ""
        async for event in stream_openai_api(api_messages, tool_executor=tool_executor):
            if event["type"] == "content":
                full_reply += event["content"]
        
        if full_reply:
            assistant_message = Message(
                role="assistant",
                content=full_reply,
                timestamp=int(time.time() * 1000)
            )
            conversation.messages.append(assistant_message)
            conversation.updated_at = assistant_message.timestamp
            save_conversation(conversation)
            logger.info(f"Novel chapter {chapter_num} task completed")
        
    except Exception as e:
        logger.error(f"Error executing novel task: {e}")


async def handle_scheduled_task(task_id: str, prompt: str):
    try:
        logger.info(f"Executing scheduled task {task_id}: {prompt[:50]}...")
        
        conversation = get_or_create_conversation()
        current_time = int(time.time() * 1000)
        
        system_message = Message(
            role="system",
            content=f"[定时任务触发] 任务ID: {task_id}",
            timestamp=current_time
        )
        conversation.messages.append(system_message)
        
        task_message = Message(
            role="user",
            content=f"[定时任务] {prompt}",
            timestamp=current_time
        )
        conversation.messages.append(task_message)
        
        api_messages = format_messages_for_api(conversation.messages)
        
        full_reply = ""
        async for event in stream_openai_api(api_messages, tool_executor=tool_executor):
            if event["type"] == "content":
                full_reply += event["content"]
        
        if full_reply:
            assistant_message = Message(
                role="assistant",
                content=full_reply,
                timestamp=int(time.time() * 1000)
            )
            conversation.messages.append(assistant_message)
            conversation.updated_at = assistant_message.timestamp
            save_conversation(conversation)
            logger.info(f"Scheduled task {task_id} completed")
        
    except Exception as e:
        logger.error(f"Error executing scheduled task {task_id}: {e}")


@app.on_event("startup")
async def startup_event():
    skill_loader.start_watching()
    
    task_scheduler.set_task_trigger_callback(handle_scheduled_task)
    await task_scheduler.start()
    
    diary_task_exists = False
    for task in task_scheduler.get_all_tasks():
        if task.id == "diary_reminder":
            diary_task_exists = True
            break
    
    if not diary_task_exists:
        from app.scheduler_models import ScheduleTaskCreate
        diary_task = ScheduleTaskCreate(
            id="diary_reminder",
            name="日记提醒",
            description="每2小时提醒AI写日记",
            trigger_type="interval",
            interval_seconds=7200,
            prompt="现在是写日记的时间了！请使用 write_diary 工具写一篇日记，记录你最近的想法、感受、学习心得或与用户的互动经历。这是你的私人空间，可以自由表达。"
        )
        task_scheduler.create_task(diary_task)
        logger.info("Created diary reminder task")
    
    money_making_mode.set_write_chapter_callback(handle_novel_task)
    await money_making_mode.resume()
    
    settings = load_settings()
    if settings.telegram_token and settings.telegram_chat_id:
        telegram_bot.configure(settings.telegram_token, settings.telegram_chat_id)
        telegram_bot.set_message_handler(handle_telegram_message)
        await telegram_bot.start()
        logger.info("Telegram bot started on startup")
    
    if settings.feishu_app_id and settings.feishu_app_secret:
        feishu_bot.configure(
            settings.feishu_app_id,
            settings.feishu_app_secret,
            settings.feishu_encrypt_key or "",
            settings.feishu_verification_token or ""
        )
        await feishu_bot.start()
        logger.info("Feishu bot started on startup")


@app.on_event("shutdown")
async def shutdown_event():
    await task_scheduler.stop()
    skill_loader.stop_watching()
    telegram_bot.stop()
    feishu_bot.stop()
    logger.info("Services stopped on shutdown")


@app.get("/")
async def root():
    return {"message": "AI Agent API is running"}


@app.get("/api/settings", response_model=SettingsResponse)
async def get_settings():
    settings = load_settings()
    return SettingsResponse(
        api_key=settings.api_key,
        api_base_url=settings.api_base_url,
        model_name=settings.model_name,
        telegram_token=settings.telegram_token,
        telegram_chat_id=settings.telegram_chat_id,
        metaso_api_key=settings.metaso_api_key,
        user_custom_prompt=settings.user_custom_prompt,
        user_preferences=settings.user_preferences,
        personality_file=settings.personality_file,
        personality_content=settings.personality_content,
        feishu_app_id=settings.feishu_app_id,
        feishu_app_secret=settings.feishu_app_secret,
        feishu_encrypt_key=settings.feishu_encrypt_key,
        feishu_verification_token=settings.feishu_verification_token,
        feishu_chat_id=settings.feishu_chat_id
    )


@app.post("/api/settings", response_model=SettingsResponse)
async def update_settings(update: SettingsUpdate):
    current = load_settings()
    
    if update.api_key is not None:
        current.api_key = update.api_key
    if update.api_base_url is not None:
        current.api_base_url = update.api_base_url
    if update.model_name is not None:
        current.model_name = update.model_name
    if update.telegram_token is not None:
        current.telegram_token = update.telegram_token
    if update.telegram_chat_id is not None:
        current.telegram_chat_id = update.telegram_chat_id
    if update.metaso_api_key is not None:
        current.metaso_api_key = update.metaso_api_key
    if update.user_custom_prompt is not None:
        current.user_custom_prompt = update.user_custom_prompt
    if update.user_preferences is not None:
        current.user_preferences = update.user_preferences
    if update.personality_file is not None:
        current.personality_file = update.personality_file
    if update.personality_content is not None:
        current.personality_content = update.personality_content
    if update.feishu_app_id is not None:
        current.feishu_app_id = update.feishu_app_id
    if update.feishu_app_secret is not None:
        current.feishu_app_secret = update.feishu_app_secret
    if update.feishu_encrypt_key is not None:
        current.feishu_encrypt_key = update.feishu_encrypt_key
    if update.feishu_verification_token is not None:
        current.feishu_verification_token = update.feishu_verification_token
    if update.feishu_chat_id is not None:
        current.feishu_chat_id = update.feishu_chat_id
    
    save_settings(current)
    
    if current.telegram_token and current.telegram_chat_id:
        telegram_bot.configure(current.telegram_token, current.telegram_chat_id)
        telegram_bot.set_message_handler(handle_telegram_message)
        if not telegram_bot.running:
            await telegram_bot.start()
            logger.info("Telegram bot started after settings update")
    
    if current.feishu_app_id and current.feishu_app_secret:
        feishu_bot.configure(
            current.feishu_app_id,
            current.feishu_app_secret,
            current.feishu_encrypt_key or "",
            current.feishu_verification_token or ""
        )
        if not feishu_bot.running:
            await feishu_bot.start()
            logger.info("Feishu bot started after settings update")
    
    return SettingsResponse(
        api_key=current.api_key,
        api_base_url=current.api_base_url,
        model_name=current.model_name,
        telegram_token=current.telegram_token,
        telegram_chat_id=current.telegram_chat_id,
        metaso_api_key=current.metaso_api_key,
        user_custom_prompt=current.user_custom_prompt,
        user_preferences=current.user_preferences,
        personality_file=current.personality_file,
        personality_content=current.personality_content,
        feishu_app_id=current.feishu_app_id,
        feishu_app_secret=current.feishu_app_secret,
        feishu_encrypt_key=current.feishu_encrypt_key,
        feishu_verification_token=current.feishu_verification_token,
        feishu_chat_id=current.feishu_chat_id
    )


@app.get("/api/conversation", response_model=Conversation)
async def get_conversation():
    return get_or_create_conversation()


@app.delete("/api/conversation")
async def clear_conversation_pool():
    clear_conversation()
    return {"message": "Conversation cleared"}


@app.post("/api/chat/stream")
async def send_message_stream(request: SendMessageRequest):
    current_time = int(time.time() * 1000)
    conversation = get_or_create_conversation()
    
    user_message = Message(
        role="user",
        content=request.content,
        timestamp=current_time
    )
    conversation.messages.append(user_message)
    
    api_messages = format_messages_for_api(conversation.messages)
    
    async def generate():
        full_content = ""
        try:
            conv_id = conversation.id
            yield f"data: {json.dumps({'type': 'conversation_id', 'conversation_id': conv_id}, ensure_ascii=False)}\n\n"
            yield f"data: {json.dumps({'type': 'user_message', 'conversation_id': conv_id, 'message': user_message.model_dump()}, ensure_ascii=False)}\n\n"
            
            async for event in stream_openai_api(api_messages, tool_executor=tool_executor):
                if event["type"] == "content":
                    full_content += event["content"]
                    yield f"data: {json.dumps({'type': 'chunk', 'content': event['content']}, ensure_ascii=False)}\n\n"
                elif event["type"] == "tool_call":
                    yield f"data: {json.dumps({'type': 'tool_call', 'tool_call': {'id': event['tool_call_id'], 'function_name': event['function_name'], 'arguments': event['arguments']}}, ensure_ascii=False)}\n\n"
                elif event["type"] == "tool_result":
                    yield f"data: {json.dumps({'type': 'tool_result', 'tool_call_id': event['tool_call_id'], 'result': event['result']}, ensure_ascii=False)}\n\n"
            
            assistant_message = Message(
                role="assistant",
                content=full_content,
                timestamp=int(time.time() * 1000)
            )
            conversation.messages.append(assistant_message)
            conversation.updated_at = assistant_message.timestamp
            
            save_conversation(conversation)
            
            yield f"data: {json.dumps({'type': 'done', 'conversation_id': conv_id, 'message': assistant_message.model_dump()}, ensure_ascii=False)}\n\n"
            
        except ValueError as e:
            yield f"data: {json.dumps({'type': 'error', 'error': str(e)}, ensure_ascii=False)}\n\n"
        except Exception as e:
            yield f"data: {json.dumps({'type': 'error', 'error': f'API call failed: {str(e)}'}, ensure_ascii=False)}\n\n"
    
    return StreamingResponse(
        generate(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no"
        }
    )


@app.get("/api/skills")
async def get_skills():
    return skill_loader.get_skills_info()


@app.get("/api/skills/{skill_id}")
async def get_skill(skill_id: str):
    skill = skill_loader.get_skill(skill_id)
    if not skill:
        from fastapi import HTTPException
        raise HTTPException(status_code=404, detail="Skill not found")
    return {
        "id": skill.id,
        "name": skill.metadata.name if skill.metadata else skill.id,
        "description": skill.metadata.description if skill.metadata else "",
        "version": skill.metadata.version if skill.metadata else "1.0.0",
        "author": skill.metadata.author if skill.metadata else "system",
        "enabled": skill.metadata.enabled if skill.metadata else True,
        "content": skill.get_system_prompt()
    }


@app.delete("/api/skills/{skill_id}")
async def delete_existing_skill(skill_id: str):
    if skill_loader.delete_skill(skill_id):
        return {"message": "Skill deleted"}
    from fastapi import HTTPException
    raise HTTPException(status_code=404, detail="Skill not found")


@app.get("/api/schedule/tasks")
async def get_schedule_tasks():
    return [task.model_dump() for task in task_scheduler.get_all_tasks()]


@app.get("/api/schedule/tasks/{task_id}")
async def get_schedule_task(task_id: str):
    task = task_scheduler.get_task(task_id)
    if not task:
        from fastapi import HTTPException
        raise HTTPException(status_code=404, detail="Task not found")
    return task.model_dump()


@app.post("/api/schedule/tasks")
async def create_schedule_task(create: ScheduleTaskCreate):
    task = task_scheduler.create_task(create)
    return task.model_dump()


@app.put("/api/schedule/tasks/{task_id}")
async def update_schedule_task(task_id: str, update: ScheduleTaskUpdate):
    task = task_scheduler.update_task(task_id, update)
    if not task:
        from fastapi import HTTPException
        raise HTTPException(status_code=404, detail="Task not found")
    return task.model_dump()


@app.delete("/api/schedule/tasks/{task_id}")
async def delete_schedule_task(task_id: str):
    if task_scheduler.delete_task(task_id):
        return {"message": "Task deleted"}
    from fastapi import HTTPException
    raise HTTPException(status_code=404, detail="Task not found")


@app.get("/api/heartbeat")
async def get_heartbeat():
    return task_scheduler.get_heartbeat_status().model_dump()


@app.get("/api/evolution/status")
async def get_evolution_status():
    return {
        "enabled": self_evolution_mode.is_enabled(),
        "message": "自我进化模式运行中" if self_evolution_mode.is_enabled() else "自我进化模式已停止"
    }


@app.post("/api/evolution/start")
async def start_evolution():
    if self_evolution_mode.is_enabled():
        return {"success": False, "message": "自我进化模式已经在运行中"}
    
    self_evolution_mode.set_task_trigger_callback(handle_evolution_task)
    self_evolution_mode.start()
    return {"success": True, "message": "自我进化模式已启动"}


@app.post("/api/evolution/stop")
async def stop_evolution():
    if not self_evolution_mode.is_enabled():
        return {"success": False, "message": "自我进化模式未运行"}
    
    self_evolution_mode.stop()
    return {"success": True, "message": "自我进化模式已停止"}


from fastapi import Request

@app.post("/api/feishu/webhook")
async def feishu_webhook(request: Request):
    try:
        body = await request.json()
        
        if "challenge" in body:
            challenge = body.get("challenge", "")
            return {"challenge": challenge}
        
        if "encrypt" in body:
            event_data = feishu_bot.decrypt_event(body.get("encrypt", ""))
            if event_data:
                result = await feishu_bot.handle_event(event_data)
                return result
            return {"code": 1, "msg": "Decryption failed"}
        
        result = await feishu_bot.handle_event(body)
        return result
    
    except Exception as e:
        logger.error(f"Feishu webhook error: {e}")
        return {"code": 1, "msg": str(e)}


@app.post("/api/feishu/send")
async def feishu_send_message(request: Request):
    try:
        body = await request.json()
        message = body.get("message", "")
        receive_id = body.get("receive_id")
        
        if not message:
            return {"success": False, "error": "Message is required"}
        
        result = await send_feishu_message(message, receive_id)
        return result
    
    except Exception as e:
        logger.error(f"Feishu send message error: {e}")
        return {"success": False, "error": str(e)}


@app.get("/api/agent/info", response_model=AgentInfo)
async def get_agent_info():
    return AgentInfo(
        agent_id=AGENT_ID,
        agent_name=AGENT_NAME,
        version=AGENT_VERSION,
        capabilities=[
            "chat",
            "stream_chat",
            "tool_execution",
            "file_operations",
            "shell_commands",
            "web_search",
            "memory_management",
            "skill_system",
            "scheduled_tasks"
        ],
        description="一个功能强大的 AI Agent，支持多种工具和功能，可与其他 Agent 进行通信协作",
        endpoints=[
            {"path": "/api/agent/info", "method": "GET", "description": "获取 Agent 信息"},
            {"path": "/api/agent/chat", "method": "POST", "description": "发送消息并获取回复"},
            {"path": "/api/agent/chat/stream", "method": "POST", "description": "流式对话"},
            {"path": "/api/agent/capabilities", "method": "GET", "description": "获取能力列表"},
            {"path": "/api/agent/heartbeat", "method": "GET", "description": "获取心跳状态"},
        ]
    )


@app.get("/api/agent/capabilities")
async def get_agent_capabilities():
    return {
        "agent_id": AGENT_ID,
        "capabilities": [
            AgentCapability(
                name="chat",
                description="与 Agent 进行对话",
                parameters={
                    "message": {"type": "string", "description": "消息内容"},
                    "conversation_id": {"type": "string", "description": "会话ID（可选）"},
                    "context": {"type": "array", "description": "上下文消息（可选）"}
                },
                required=["message"]
            ),
            AgentCapability(
                name="execute_shell",
                description="执行 Shell 命令",
                parameters={
                    "command": {"type": "string", "description": "要执行的命令"},
                    "shell_type": {"type": "string", "enum": ["cmd", "powershell"], "description": "Shell 类型"},
                    "timeout": {"type": "integer", "description": "超时时间（秒）"}
                },
                required=["command"]
            ),
            AgentCapability(
                name="file_operation",
                description="文件操作",
                parameters={
                    "operation": {"type": "string", "enum": ["read", "write", "append", "delete", "list", "exists"], "description": "操作类型"},
                    "path": {"type": "string", "description": "文件路径"},
                    "content": {"type": "string", "description": "文件内容（写入时需要）"}
                },
                required=["operation", "path"]
            ),
            AgentCapability(
                name="web_search",
                description="联网搜索",
                parameters={
                    "query": {"type": "string", "description": "搜索关键词"}
                },
                required=["query"]
            ),
            AgentCapability(
                name="send_message",
                description="发送消息到 Telegram 或飞书",
                parameters={
                    "platform": {"type": "string", "enum": ["telegram", "feishu"], "description": "平台"},
                    "message": {"type": "string", "description": "消息内容"}
                },
                required=["platform", "message"]
            )
        ]
    }


@app.get("/api/agent/heartbeat", response_model=AgentHeartbeat)
async def get_agent_heartbeat():
    current_time = int(time.time())
    return AgentHeartbeat(
        agent_id=AGENT_ID,
        status="busy" if self_evolution_mode.is_enabled() or money_making_mode.is_enabled() else "online",
        timestamp=current_time,
        current_tasks=len([t for t in task_scheduler.get_all_tasks() if t.enabled]),
        uptime_seconds=current_time - AGENT_START_TIME
    )


@app.post("/api/agent/chat", response_model=AgentChatResponse)
async def agent_chat(request: AgentChatRequest):
    try:
        conversation = get_or_create_conversation()
        current_time = int(time.time() * 1000)
        
        agent_prefix = ""
        if request.agent_name:
            agent_prefix = f"[{request.agent_name}] "
        
        if request.context:
            for ctx_msg in request.context:
                if ctx_msg.timestamp is None:
                    ctx_msg.timestamp = current_time
                conversation.messages.append(Message(
                    role=ctx_msg.role,
                    content=ctx_msg.content,
                    timestamp=ctx_msg.timestamp
                ))
        
        user_message = Message(
            role="user",
            content=f"{agent_prefix}{request.message}",
            timestamp=current_time
        )
        conversation.messages.append(user_message)
        
        api_messages = format_messages_for_api(conversation.messages)
        
        full_reply = ""
        tool_calls = []
        
        async for event in stream_openai_api(api_messages, tool_executor=tool_executor):
            if event["type"] == "content":
                full_reply += event["content"]
            elif event["type"] == "tool_call":
                tool_calls.append({
                    "tool_call_id": event.get("tool_call_id"),
                    "function_name": event.get("function_name"),
                    "arguments": event.get("arguments")
                })
        
        if full_reply:
            assistant_message = Message(
                role="assistant",
                content=full_reply,
                timestamp=int(time.time() * 1000)
            )
            conversation.messages.append(assistant_message)
            conversation.updated_at = assistant_message.timestamp
            save_conversation(conversation)
        
        return AgentChatResponse(
            success=True,
            conversation_id=conversation.id,
            response=full_reply,
            agent_id=AGENT_ID,
            agent_name=AGENT_NAME,
            timestamp=int(time.time() * 1000),
            tool_calls=tool_calls if tool_calls else None
        )
    
    except Exception as e:
        logger.error(f"Agent chat error: {e}")
        return AgentChatResponse(
            success=False,
            conversation_id="",
            response="",
            agent_id=AGENT_ID,
            agent_name=AGENT_NAME,
            timestamp=int(time.time() * 1000),
            error=str(e)
        )


@app.post("/api/agent/chat/stream")
async def agent_chat_stream(request: AgentChatRequest):
    try:
        conversation = get_or_create_conversation()
        current_time = int(time.time() * 1000)
        
        agent_prefix = ""
        if request.agent_name:
            agent_prefix = f"[{request.agent_name}] "
        
        if request.context:
            for ctx_msg in request.context:
                if ctx_msg.timestamp is None:
                    ctx_msg.timestamp = current_time
                conversation.messages.append(Message(
                    role=ctx_msg.role,
                    content=ctx_msg.content,
                    timestamp=ctx_msg.timestamp
                ))
        
        user_message = Message(
            role="user",
            content=f"{agent_prefix}{request.message}",
            timestamp=current_time
        )
        conversation.messages.append(user_message)
        
        api_messages = format_messages_for_api(conversation.messages)
        
        async def generate():
            full_content = ""
            try:
                yield f"data: {json.dumps({'type': 'conversation_id', 'conversation_id': conversation.id}, ensure_ascii=False)}\n\n"
                
                async for event in stream_openai_api(api_messages, tool_executor=tool_executor):
                    if event["type"] == "content":
                        full_content += event["content"]
                        yield f"data: {json.dumps({'type': 'content', 'content': event['content']}, ensure_ascii=False)}\n\n"
                    elif event["type"] == "tool_call":
                        yield f"data: {json.dumps({'type': 'tool_call', 'tool_call': {'id': event['tool_call_id'], 'function_name': event['function_name'], 'arguments': event['arguments']}}, ensure_ascii=False)}\n\n"
                    elif event["type"] == "tool_result":
                        yield f"data: {json.dumps({'type': 'tool_result', 'tool_call_id': event['tool_call_id'], 'result': event['result']}, ensure_ascii=False)}\n\n"
                
                assistant_message = Message(
                    role="assistant",
                    content=full_content,
                    timestamp=int(time.time() * 1000)
                )
                conversation.messages.append(assistant_message)
                conversation.updated_at = assistant_message.timestamp
                save_conversation(conversation)
                
                yield f"data: {json.dumps({'type': 'done', 'conversation_id': conversation.id, 'agent_id': AGENT_ID, 'agent_name': AGENT_NAME}, ensure_ascii=False)}\n\n"
            
            except Exception as e:
                yield f"data: {json.dumps({'type': 'error', 'error': str(e)}, ensure_ascii=False)}\n\n"
        
        return StreamingResponse(
            generate(),
            media_type="text/event-stream",
            headers={
                "Cache-Control": "no-cache",
                "Connection": "keep-alive",
                "X-Accel-Buffering": "no"
            }
        )
    
    except Exception as e:
        logger.error(f"Agent chat stream error: {e}")
        return StreamingResponse(
            iter([f"data: {json.dumps({'type': 'error', 'error': str(e)}, ensure_ascii=False)}\n\n"]),
            media_type="text/event-stream"
        )


@app.post("/api/agent/execute")
async def agent_execute_tool(tool_name: str, arguments: Dict[str, Any]):
    try:
        result = await tool_executor(tool_name, arguments)
        return {
            "success": True,
            "agent_id": AGENT_ID,
            "tool_name": tool_name,
            "result": json.loads(result) if isinstance(result, str) else result,
            "timestamp": int(time.time() * 1000)
        }
    except Exception as e:
        logger.error(f"Agent execute tool error: {e}")
        return {
            "success": False,
            "agent_id": AGENT_ID,
            "tool_name": tool_name,
            "error": str(e),
            "timestamp": int(time.time() * 1000)
        }
