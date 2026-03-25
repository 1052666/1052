"""
聊天引擎 - 处理流式对话逻辑
"""

import json
import re
import platform as platform_module
from datetime import datetime
from typing import AsyncIterable, Optional

from openai import AsyncOpenAI

from core.config import load_config, read_system_prompt, read_preferences
from core.tools import BUILTIN_TOOLS, INVOKE_SKILL_TOOL, execute_builtin_tool, set_current_user


def _get_system_info() -> dict:
    """获取当前系统信息"""
    system = platform_module.system()
    if system == "Windows":
        return {"system": "Windows", "shell": "CMD", "note": "使用 dir/cd/type 等命令"}
    elif system == "Darwin":
        return {"system": "macOS", "shell": "zsh/bash", "note": "使用 ls/cd/cat 等命令"}
    elif system == "Linux":
        return {"system": "Linux", "shell": "bash", "note": "使用 ls/cd/cat 等命令"}
    else:
        return {"system": system, "shell": "sh", "note": "使用标准 POSIX 命令"}


def _inject_time_and_user(system_content: str, platform: str, user_id: str) -> str:
    """注入时间、用户信息等到系统提示"""
    current_time = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    sys_info = _get_system_info()
    time_section = f"""

---

## 当前时间

**当前时间**: {current_time}

请根据当前时间回答问题，不要假设知识库的截止时间。如果用户询问关于今天、昨天、明天等时间相关的问题，请基于当前时间计算。
"""
    system_content += time_section

    # 注入系统信息
    system_section = f"""

---

## 服务器操作系统

**系统**: {sys_info["system"]}
**Shell**: {sys_info["shell"]}
**注意**: {sys_info["note"]}

当使用 run_cmd 工具执行命令时，请使用适用于 {sys_info["system"]} 的命令。
"""
    system_content += system_section

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

    return system_content


def _filter_tools_by_platform(all_tools: list, platform: str) -> list:
    """根据平台过滤发送工具"""
    if platform == "lark":
        # 飞书平台：移除 TG 工具
        return [t for t in all_tools if t["function"]["name"] != "send_to_tg"]
    elif platform == "telegram":
        # Telegram平台：移除 Lark 工具
        return [t for t in all_tools if t["function"]["name"] != "send_to_lark"]
    # Web平台：两者都不需要
    return all_tools


def _parse_user_info(messages: list) -> tuple[str, str, list]:
    """解析用户信息，返回 (platform, user_id, filtered_messages)"""
    platform = "telegram"
    user_id = ""

    if messages and messages[0].get("role") == "system" and "[用户信息]" in messages[0].get("content", ""):
        info = messages[0]["content"]
        messages = messages[1:]
        platform_match = re.search(r'platform=(\w+)', info)
        user_id_match = re.search(r'user_id=(\d+)', info)
        if platform_match:
            platform = platform_match.group(1)
        if user_id_match:
            user_id = user_id_match.group(1)

    return platform, user_id, messages


async def chat_stream(
    messages: list,
    app_state,
) -> AsyncIterable[dict]:
    """
    流式聊天处理器

    Args:
        messages: 消息列表
        app_state: FastAPI app.state，包含 skill_manager, mcp_manager, scheduler 等

    Yields:
        dict: {"type": "delta"|"done"|"error"|"tool_call"|"tool_result", ...}
    """
    cfg = load_config()
    api_key = cfg.get("api_key", "")
    if not api_key:
        yield {"type": "error", "content": "未配置 API Key"}
        return

    client = AsyncOpenAI(
        api_key=api_key,
        base_url=cfg.get("base_url", "https://api.openai.com/v1"),
    )

    # 解析用户信息
    platform, user_id, filtered_messages = _parse_user_info(messages)
    set_current_user(platform, user_id)

    # 构建系统提示
    system_content = read_system_prompt()
    system_content = _inject_time_and_user(system_content, platform, user_id)

    skill_section = app_state.skill_manager.get_system_prompt_section()
    if skill_section:
        system_content += skill_section

    full_messages = [{"role": "system", "content": system_content}] + filtered_messages

    # 构建工具列表
    all_tools = BUILTIN_TOOLS.copy()
    if app_state.skill_manager.skill_list():
        all_tools.append(INVOKE_SKILL_TOOL)
    all_tools += app_state.mcp_manager.get_openai_tools()
    all_tools = _filter_tools_by_platform(all_tools, platform)

    try:
        while True:
            stream = await client.chat.completions.create(
                model=cfg.get("model", "gpt-4o-mini"),
                messages=full_messages,
                tools=all_tools,
                tool_choice="auto",
                stream=True,
                temperature=max(cfg.get("temperature", 0.7), 0.3),
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

            if not tool_calls:
                yield {"type": "done"}
                break

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
