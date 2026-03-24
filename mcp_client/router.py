from fastapi import APIRouter, Request

from core.config import MCP_CONFIG_FILE

router = APIRouter()


@router.get("/mcp/servers")
async def get_mcp_servers(request: Request):
    mcp_manager = request.app.state.mcp_manager
    return {"servers": mcp_manager.server_list()}


@router.post("/mcp/reload")
async def reload_mcp(request: Request):
    mcp_manager = request.app.state.mcp_manager
    await mcp_manager.cleanup()
    mcp_manager._servers.clear()
    mcp_manager._exit_stacks.clear()
    await mcp_manager.load_from_config(MCP_CONFIG_FILE)
    return {"servers": mcp_manager.server_list()}
