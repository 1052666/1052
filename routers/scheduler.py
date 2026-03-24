from typing import Optional

from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel

router = APIRouter()


class TaskCreate(BaseModel):
    name:        str
    prompt:      str
    schedule:    str            # daily:09:00 | interval:30 | cron:... | once:ISO
    api_key:     str
    base_url:    Optional[str]   = "https://api.openai.com/v1"
    model:       Optional[str]   = "gpt-4o-mini"
    temperature: Optional[float] = 0.7
    max_tokens:  Optional[int]   = 2048
    enabled:     Optional[bool]  = True


class TaskUpdate(BaseModel):
    name:        Optional[str]   = None
    prompt:      Optional[str]   = None
    schedule:    Optional[str]   = None
    api_key:     Optional[str]   = None
    base_url:    Optional[str]   = None
    model:       Optional[str]   = None
    temperature: Optional[float] = None
    max_tokens:  Optional[int]   = None
    enabled:     Optional[bool]  = None


# ─── Task list / create ───────────────────────────────────────────

@router.get("/tasks")
async def list_tasks(request: Request):
    return {"tasks": request.app.state.scheduler.task_list()}


@router.post("/tasks")
async def create_task(body: TaskCreate, request: Request):
    return request.app.state.scheduler.create_task(body.model_dump())


# ─── Task detail / update / delete ────────────────────────────────

@router.put("/tasks/{task_id}")
async def update_task(task_id: str, body: TaskUpdate, request: Request):
    task = request.app.state.scheduler.update_task(
        task_id, body.model_dump(exclude_none=True)
    )
    if not task:
        raise HTTPException(status_code=404, detail=f"任务 '{task_id}' 不存在")
    return task


@router.delete("/tasks/{task_id}")
async def delete_task(task_id: str, request: Request):
    if not request.app.state.scheduler.delete_task(task_id):
        raise HTTPException(status_code=404, detail=f"任务 '{task_id}' 不存在")
    return {"ok": True}


# ─── Manual run ───────────────────────────────────────────────────

@router.post("/tasks/{task_id}/run")
async def run_task(task_id: str, request: Request):
    result = await request.app.state.scheduler.run_task(task_id)
    return {"result": result}


# ─── Context file ─────────────────────────────────────────────────

@router.get("/tasks/{task_id}/context")
async def get_context(task_id: str, request: Request):
    return {"content": request.app.state.scheduler.get_context(task_id)}


@router.delete("/tasks/{task_id}/context")
async def clear_context(task_id: str, request: Request):
    request.app.state.scheduler.clear_context(task_id)
    return {"ok": True}
