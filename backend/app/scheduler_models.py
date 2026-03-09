from pydantic import BaseModel
from typing import Optional, List
from datetime import datetime

class ScheduleTask(BaseModel):
    id: str
    name: str
    description: str
    trigger_type: str = "once"
    trigger_time: Optional[str] = None
    interval_seconds: Optional[int] = None
    cron_expression: Optional[str] = None
    prompt: str
    enabled: bool = True
    created_at: int
    updated_at: int
    last_run_at: Optional[int] = None
    next_run_at: Optional[int] = None
    run_count: int = 0

class ScheduleTaskCreate(BaseModel):
    id: Optional[str] = None
    name: str
    description: str = ""
    trigger_type: str = "once"
    trigger_time: Optional[str] = None
    interval_seconds: Optional[int] = None
    cron_expression: Optional[str] = None
    prompt: str

class ScheduleTaskUpdate(BaseModel):
    name: Optional[str] = None
    description: Optional[str] = None
    trigger_type: Optional[str] = None
    trigger_time: Optional[str] = None
    interval_seconds: Optional[int] = None
    cron_expression: Optional[str] = None
    prompt: Optional[str] = None
    enabled: Optional[bool] = None

class HeartbeatStatus(BaseModel):
    is_alive: bool
    last_heartbeat: Optional[int] = None
    uptime_seconds: float
    tasks_running: int
    tasks_pending: int
    memory_usage_mb: float
