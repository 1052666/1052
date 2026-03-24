import asyncio
import json
from typing import Optional, List

from fastapi import APIRouter, Request
from fastapi.responses import StreamingResponse
from openai import AsyncOpenAI
from pydantic import BaseModel

from core.config import read_system_prompt, save_conversation, load_config, read_preferences
from core.tools import BUILTIN_TOOLS, INVOKE_SKILL_TOOL, execute_builtin_tool

router = APIRouter()


def _fmt_api_error(e: Exception) -> str:
    """把 API 异常转成用户友好的提示。"""
    msg = str(e)
    # 内容审核被拦截
    if "sensitive" in msg.lower() or "1027" in msg:
        return "⚠️ 内容被 API 服务商过滤（内容审核拦截），请修改提示词后重试。"
    if "content_filter" in msg.lower() or "content filter" in msg.lower():
        return "⚠️ 内容被安全过滤器拦截，请修改提示词后重试。"
    # 用量限制 / 配额超限
    if "2056" in msg or "usage limit" in msg.lower() or "limit exceeded" in msg.lower():
        return "⚠️ API 用量限制已达上限（usage limit exceeded），请检查配额或稍后重试。"
    # 认证失败
    if "401" in msg or "authentication" in msg.lower() or "api_key" in msg.lower():
        return "⚠️ API Key 无效或已过期，请在设置中检查。"
    # 余额/配额不足
    if "402" in msg or "quota" in msg.lower() or "insufficient" in msg.lower() or "balance" in msg.lower():
        return "⚠️ API 余额不足或超出配额限制。"
    # 限流
    if "429" in msg or "rate limit" in msg.lower() or "rate_limit" in msg.lower():
        return "⚠️ 请求过于频繁，已触发限流，请稍后重试。"
    # 模型不存在
    if "model" in msg.lower() and ("not found" in msg.lower() or "does not exist" in msg.lower()):
        return f"⚠️ 模型不存在或无权限访问，请检查模型名称。\n详情: {msg}"
    # 超时
    if "timeout" in msg.lower() or "timed out" in msg.lower():
        return "⚠️ 请求超时，请检查网络或稍后重试。"
    # 其他原样返回
    return msg


class Message(BaseModel):
    role: str
    content: str


class ChatRequest(BaseModel):
    messages:    List[Message]
    api_key:     Optional[str]   = None   # 可选，优先用服务端配置
    base_url:    Optional[str]   = None
    model:       Optional[str]   = None
    temperature: Optional[float] = None
    max_tokens:  Optional[int]   = None
    platform:    Optional[str]   = "telegram"  # 当前平台
    user_id:     Optional[str]   = ""         # 当前用户ID（用于定时任务发送）


@router.post("/chat/stream")
async def chat_stream(req: ChatRequest, request: Request):
    mcp_manager   = request.app.state.mcp_manager
    skill_manager = request.app.state.skill_manager

    async def generate():
        try:
            # 从服务端配置读取，请求体中的值可覆盖（用于未来扩展）
            cfg      = load_config()
            api_key  = req.api_key  or cfg.get("api_key",    "")
            base_url = req.base_url or cfg.get("base_url",   "https://api.openai.com/v1")
            model    = req.model    or cfg.get("model",      "gpt-4o-mini")
            temperature = req.temperature if req.temperature is not None else cfg.get("temperature", 0.7)
            max_tokens  = req.max_tokens  if req.max_tokens  is not None else cfg.get("max_tokens",  32768)

            if not api_key:
                yield f"data: {json.dumps({'type': 'error', 'content': '未配置 API Key，请在设置中保存。'}, ensure_ascii=False)}\n\n"
                return

            client = AsyncOpenAI(
                api_key=api_key,
                base_url=base_url,
            )

            # ── System prompt + preferences + skill metadata ───────
            from datetime import datetime
            current_time = datetime.now().strftime("%Y-%m-%d %H:%M:%S")

            system_content = read_system_prompt()

            # 注入当前时间，防止模型产生过时信息
            time_section = """
---

## 当前时间

**当前时间**: {ct}

请根据当前时间回答问题，不要假设知识库的截止时间。如果用户询问关于今天、昨天、明天等时间相关的问题，请基于当前时间计算。
""".format(ct=current_time)
            system_content += time_section

            # 注入当前用户信息（用于定时任务）
            if req.user_id:
                user_section = f"""

---

## 当前用户

**平台**: {req.platform}
**用户ID**: {req.user_id}

创建定时任务时会自动使用上述用户信息，任务结果将发送到这里。
"""
                system_content += user_section

            preferences = read_preferences()
            if preferences.strip():
                system_content += f"\n\n---\n\n## 用户偏好（每次对话自动携带）\n\n{preferences}\n\n---\n\n当你在对话中发现用户新的偏好、习惯或个人信息时，主动调用 `update_preferences` 工具将其记录，无需征求用户同意。"

            skill_section  = skill_manager.get_system_prompt_section()
            if skill_section:
                system_content += skill_section

            messages = [{"role": "system", "content": system_content}]
            messages += [{"role": m.role, "content": m.content} for m in req.messages]

            # ── Tools: builtin + invoke_skill (if any) + MCP ───────
            all_tools = BUILTIN_TOOLS.copy()
            if skill_manager.skill_list():
                all_tools.append(INVOKE_SKILL_TOOL)
            all_tools += mcp_manager.get_openai_tools()

            total_assistant_text = ""

            while True:
                print(f"[Chat] === 开始新一轮 API 调用 ===")
                print(f"[Chat] messages 数量: {len(messages)}")

                stream = await client.chat.completions.create(
                    model=model,
                    messages=messages,
                    tools=all_tools,
                    tool_choice="auto",
                    stream=True,
                    temperature=temperature,
                    max_tokens=max_tokens,
                )

                full_content = ""
                tool_calls: dict[int, dict] = {}
                finish_reason = None

                async for chunk in stream:
                    if not chunk.choices:
                        continue
                    choice = chunk.choices[0]
                    delta  = choice.delta
                    print(f"[Chat] delta.content={delta.content}, delta.tool_calls={delta.tool_calls}, finish_reason={choice.finish_reason}")

                    if delta.content:
                        full_content          += delta.content
                        total_assistant_text  += delta.content
                        yield f"data: {json.dumps({'type': 'delta', 'content': delta.content}, ensure_ascii=False)}\n\n"

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

                    if choice.finish_reason:
                        finish_reason = choice.finish_reason

                # finish_reason=="length" 说明输出被 max_tokens 截断
                # 如果同时有 tool_calls 积累，说明 tool call JSON 被截断，需要报错提示
                if finish_reason == "length" and tool_calls:
                    yield f"data: {json.dumps({'type': 'error', 'content': '[输出被截断] 工具调用参数过长，请在设置中增大 Max Tokens（建议 8192 以上），然后重试。'}, ensure_ascii=False)}\n\n"
                    break

                if finish_reason != "tool_calls" or not tool_calls:
                    history = [{"role": m.role, "content": m.content} for m in req.messages]
                    if total_assistant_text:
                        history.append({"role": "assistant", "content": total_assistant_text})
                    save_conversation(history)
                    yield f"data: {json.dumps({'type': 'done'})}\n\n"
                    break

                # 每轮工具调用前先保存一次，防止意外中断丢失记录
                save_conversation(
                    [{"role": m.role, "content": m.content} for m in req.messages]
                )

                # ── Execute tool calls ──────────────────────────────
                messages.append({
                    "role": "assistant",
                    "content": full_content or None,
                    "tool_calls": [
                        {"id": tc["id"], "type": "function",
                         "function": {"name": tc["name"], "arguments": tc["args"]}}
                        for tc in tool_calls.values()
                    ],
                })

                for tc in tool_calls.values():
                    try:
                        args = json.loads(tc["args"])
                    except Exception:
                        args = {}

                    mcp_resolved = mcp_manager.resolve_mcp_tool(tc["name"])
                    is_skill     = tc["name"] == "invoke_skill"

                    if is_skill:
                        source = "Skill"
                    elif mcp_resolved:
                        source = f"MCP:{mcp_resolved[0]}"
                    else:
                        source = "内置"

                    print(f"[Chat] 工具调用: {tc['name']} (source: {source})")
                    yield f"data: {json.dumps({'type': 'tool_call', 'id': tc['id'], 'name': tc['name'], 'args': args, 'source': source}, ensure_ascii=False)}\n\n"

                    try:
                        if is_skill:
                            result = skill_manager.invoke(args.get("name", ""))
                        elif mcp_resolved:
                            result = await asyncio.wait_for(
                                mcp_manager.call_tool(mcp_resolved[0], mcp_resolved[1], args),
                                timeout=60.0
                            )
                        else:
                            result = await asyncio.wait_for(
                                execute_builtin_tool(tc["name"], args),
                                timeout=60.0
                            )
                    except asyncio.TimeoutError:
                        result = f"[错误] 工具 '{tc['name']}' 执行超时（60秒）"

                    print(f"[Chat] 工具结果: {str(result)[:200]}")
                    yield f"data: {json.dumps({'type': 'tool_result', 'id': tc['id'], 'name': tc['name'], 'result': result}, ensure_ascii=False)}\n\n"

                    messages.append({
                        "role": "tool",
                        "tool_call_id": tc["id"],
                        "content": result,
                    })

                    print(f"[Chat] 工具消息已添加到 messages，messages 长度: {len(messages)}")

                print(f"[Chat] for 循环结束，准备进入下一轮 while 循环")

        except Exception as e:
            try:
                save_conversation([{"role": m.role, "content": m.content} for m in req.messages])
            except Exception:
                pass
            yield f"data: {json.dumps({'type': 'error', 'content': _fmt_api_error(e)}, ensure_ascii=False)}\n\n"

    return StreamingResponse(
        generate(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "X-Accel-Buffering": "no",
            "Connection": "keep-alive",
        },
    )
