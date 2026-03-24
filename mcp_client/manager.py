import re
from contextlib import AsyncExitStack


class MCPManager:
    def __init__(self):
        # name -> {session, tools, status, error, config}
        self._servers: dict = {}
        self._exit_stacks: dict = {}

    async def load_from_config(self, config_file):
        """Load mcp_servers.json and connect to all servers."""
        if not config_file.exists():
            return
        import json
        try:
            cfg = json.loads(config_file.read_text(encoding="utf-8"))
        except Exception as e:
            print(f"[MCP] 读取配置失败: {e}")
            return

        for name, server_cfg in cfg.get("mcpServers", {}).items():
            if all(k.startswith("_") for k in server_cfg):
                continue
            print(f"[MCP] 连接服务器: {name} ...")
            await self.connect_server(name, server_cfg)

    async def connect_server(self, name: str, config: dict):
        """Connect (or reconnect) a single MCP server."""
        if name in self._exit_stacks:
            try:
                await self._exit_stacks[name].aclose()
            except Exception:
                pass

        exit_stack = AsyncExitStack()
        self._exit_stacks[name] = exit_stack

        try:
            transport = config.get("transport", "stdio")

            if transport == "stdio":
                from mcp import ClientSession, StdioServerParameters
                from mcp.client.stdio import stdio_client

                params = StdioServerParameters(
                    command=config["command"],
                    args=config.get("args", []),
                    env=config.get("env") or None,
                )
                read, write = await exit_stack.enter_async_context(stdio_client(params))

            elif transport == "sse":
                from mcp import ClientSession
                from mcp.client.sse import sse_client

                read, write = await exit_stack.enter_async_context(sse_client(config["url"]))

            else:
                raise ValueError(f"不支持的传输协议: {transport}")

            from mcp import ClientSession
            session = await exit_stack.enter_async_context(ClientSession(read, write))
            await session.initialize()

            tools_resp = await session.list_tools()

            self._servers[name] = {
                "session": session,
                "tools":   tools_resp.tools,
                "status":  "connected",
                "config":  config,
            }
            print(f"[MCP] {name} 已连接，工具: {[t.name for t in tools_resp.tools]}")

        except Exception as e:
            self._servers[name] = {
                "session": None,
                "tools":   [],
                "status":  "error",
                "error":   str(e),
                "config":  config,
            }
            print(f"[MCP] {name} 连接失败: {e}")

    async def call_tool(self, server_name: str, tool_name: str, args: dict) -> str:
        server = self._servers.get(server_name)
        if not server or server["status"] != "connected":
            return f"MCP 服务器 '{server_name}' 未连接"
        try:
            result = await server["session"].call_tool(tool_name, args)
            texts = [item.text for item in result.content if hasattr(item, "text")]
            return "\n".join(texts) if texts else "(无返回内容)"
        except Exception as e:
            return f"MCP 工具调用失败: {e}"

    def get_openai_tools(self) -> list:
        """Convert connected MCP tools to OpenAI function-call format."""
        tools = []
        for server_name, info in self._servers.items():
            if info["status"] != "connected":
                continue
            safe_server = re.sub(r"[^a-zA-Z0-9]", "_", server_name)
            for t in info["tools"]:
                safe_tool = re.sub(r"[^a-zA-Z0-9]", "_", t.name)
                key = f"mcp_{safe_server}_{safe_tool}"[:64]
                tools.append({
                    "type": "function",
                    "function": {
                        "name": key,
                        "description": f"[MCP:{server_name}] {t.description or ''}",
                        "parameters": t.inputSchema or {"type": "object", "properties": {}},
                    },
                })
        return tools

    def resolve_mcp_tool(self, key: str):
        """'mcp_serverName_toolName' → (server_name, tool_name) or None"""
        if not key.startswith("mcp_"):
            return None
        for server_name, info in self._servers.items():
            safe_server = re.sub(r"[^a-zA-Z0-9]", "_", server_name)
            prefix = f"mcp_{safe_server}_"
            if key.startswith(prefix):
                tool_name_key = key[len(prefix):]
                for t in info.get("tools", []):
                    safe_tool = re.sub(r"[^a-zA-Z0-9]", "_", t.name)
                    if safe_tool == tool_name_key:
                        return server_name, t.name
        return None

    def server_list(self) -> list:
        result = []
        for name, info in self._servers.items():
            result.append({
                "name":   name,
                "status": info["status"],
                "error":  info.get("error", ""),
                "tools":  [{"name": t.name, "description": t.description or ""}
                           for t in info.get("tools", [])],
            })
        return result

    async def cleanup(self):
        for es in self._exit_stacks.values():
            try:
                await es.aclose()
            except Exception:
                pass
