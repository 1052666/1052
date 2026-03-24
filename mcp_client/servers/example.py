"""
示例 MCP 服务器 —— 演示如何用 FastMCP 创建自己的工具

运行方式（在项目根目录下）：
    python mcp/servers/example.py

然后在 data/mcp_servers.json 里添加：
{
  "mcpServers": {
    "示例工具": {
      "transport": "stdio",
      "command": "python",
      "args": ["mcp/servers/example.py"]
    }
  }
}
"""

import datetime
import httpx
from mcp.server import FastMCP

app = FastMCP("example-tools")


@app.tool()
async def get_current_time() -> str:
    """获取当前系统时间和日期"""
    now = datetime.datetime.now()
    return now.strftime("%Y年%m月%d日 %H:%M:%S")


@app.tool()
async def calculate(expression: str) -> str:
    """
    计算数学表达式

    Args:
        expression: 数学表达式，例如 "2 + 3 * 4" 或 "100 / 5"

    Returns:
        计算结果
    """
    try:
        allowed = set("0123456789+-*/()., ")
        if not all(c in allowed for c in expression):
            return "错误：只支持基本数学运算（+ - * / ()）"
        result = eval(expression)
        return f"{expression} = {result}"
    except Exception as e:
        return f"计算失败: {e}"


@app.tool()
async def fetch_url(url: str) -> str:
    """
    获取网页内容（纯文本）

    Args:
        url: 要获取内容的网址

    Returns:
        网页文本内容（前 2000 字符）
    """
    try:
        async with httpx.AsyncClient(follow_redirects=True, timeout=10) as client:
            resp = await client.get(url, headers={"User-Agent": "Mozilla/5.0"})
            resp.raise_for_status()
            return resp.text[:2000]
    except Exception as e:
        return f"获取失败: {e}"


if __name__ == "__main__":
    app.run(transport="stdio")
