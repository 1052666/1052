import os
import json
import logging
import asyncio
import time
from typing import Dict, Optional, List, Callable, Awaitable
from datetime import datetime, timedelta
import psutil

from app.scheduler_models import ScheduleTask, ScheduleTaskCreate, ScheduleTaskUpdate, HeartbeatStatus

logger = logging.getLogger(__name__)

SCHEDULE_TASKS_DIR = os.path.join(os.path.dirname(__file__), "..", "..", "data", "schedule_tasks")

class TaskScheduler:
    def __init__(self):
        self.tasks: Dict[str, ScheduleTask] = {}
        self._running = False
        self._scheduler_task: Optional[asyncio.Task] = None
        self._heartbeat_task: Optional[asyncio.Task] = None
        self._last_heartbeat: Optional[float] = None
        self._start_time: Optional[float] = None
        self._on_task_trigger: Optional[Callable[[str, str], Awaitable[None]]] = None
    
    def ensure_tasks_dir(self):
        if not os.path.exists(SCHEDULE_TASKS_DIR):
            os.makedirs(SCHEDULE_TASKS_DIR)
    
    def load_all_tasks(self):
        self.ensure_tasks_dir()
        
        for filename in os.listdir(SCHEDULE_TASKS_DIR):
            if filename.endswith('.json'):
                file_path = os.path.join(SCHEDULE_TASKS_DIR, filename)
                try:
                    with open(file_path, 'r', encoding='utf-8') as f:
                        data = json.load(f)
                        task = ScheduleTask(**data)
                        self.tasks[task.id] = task
                except Exception as e:
                    logger.error(f"Failed to load task {filename}: {e}")
        
        logger.info(f"Loaded {len(self.tasks)} scheduled tasks")
    
    def save_task(self, task: ScheduleTask):
        self.ensure_tasks_dir()
        file_path = os.path.join(SCHEDULE_TASKS_DIR, f"{task.id}.json")
        with open(file_path, 'w', encoding='utf-8') as f:
            json.dump(task.model_dump(), f, indent=2, ensure_ascii=False)
    
    def create_task(self, create: ScheduleTaskCreate) -> ScheduleTask:
        import uuid
        current_time = int(time.time() * 1000)
        
        task_id = create.id if create.id else str(uuid.uuid4())[:8]
        
        task = ScheduleTask(
            id=task_id,
            name=create.name,
            description=create.description,
            trigger_type=create.trigger_type,
            trigger_time=create.trigger_time,
            interval_seconds=create.interval_seconds,
            cron_expression=create.cron_expression,
            prompt=create.prompt,
            created_at=current_time,
            updated_at=current_time
        )
        
        task.next_run_at = self._calculate_next_run(task)
        
        self.tasks[task_id] = task
        self.save_task(task)
        logger.info(f"Created scheduled task: {task_id} - {task.name}")
        return task
    
    def update_task(self, task_id: str, update: ScheduleTaskUpdate) -> Optional[ScheduleTask]:
        if task_id not in self.tasks:
            return None
        
        task = self.tasks[task_id]
        
        if update.name is not None:
            task.name = update.name
        if update.description is not None:
            task.description = update.description
        if update.trigger_type is not None:
            task.trigger_type = update.trigger_type
        if update.trigger_time is not None:
            task.trigger_time = update.trigger_time
        if update.interval_seconds is not None:
            task.interval_seconds = update.interval_seconds
        if update.cron_expression is not None:
            task.cron_expression = update.cron_expression
        if update.prompt is not None:
            task.prompt = update.prompt
        if update.enabled is not None:
            task.enabled = update.enabled
        
        task.updated_at = int(time.time() * 1000)
        task.next_run_at = self._calculate_next_run(task)
        
        self.save_task(task)
        logger.info(f"Updated scheduled task: {task_id}")
        return task
    
    def delete_task(self, task_id: str) -> bool:
        if task_id in self.tasks:
            task = self.tasks[task_id]
            file_path = os.path.join(SCHEDULE_TASKS_DIR, f"{task_id}.json")
            if os.path.exists(file_path):
                os.remove(file_path)
            del self.tasks[task_id]
            logger.info(f"Deleted scheduled task: {task_id}")
            return True
        return False
    
    def get_task(self, task_id: str) -> Optional[ScheduleTask]:
        return self.tasks.get(task_id)
    
    def get_all_tasks(self) -> List[ScheduleTask]:
        return list(self.tasks.values())
    
    def _calculate_next_run(self, task: ScheduleTask) -> Optional[int]:
        if not task.enabled:
            return None
        
        now = datetime.now()
        
        if task.trigger_type == "once":
            if task.trigger_time:
                try:
                    trigger_dt = datetime.fromisoformat(task.trigger_time)
                    if trigger_dt > now:
                        return int(trigger_dt.timestamp() * 1000)
                except:
                    pass
            return None
        
        elif task.trigger_type == "interval":
            if task.interval_seconds and task.interval_seconds > 0:
                next_run = now + timedelta(seconds=task.interval_seconds)
                return int(next_run.timestamp() * 1000)
        
        elif task.trigger_type == "cron":
            pass
        
        return None
    
    def set_task_trigger_callback(self, callback: Callable[[str, str], Awaitable[None]]):
        self._on_task_trigger = callback
    
    async def start(self):
        if self._running:
            return
        
        self.load_all_tasks()
        self._running = True
        self._start_time = time.time()
        
        self._scheduler_task = asyncio.create_task(self._scheduler_loop())
        self._heartbeat_task = asyncio.create_task(self._heartbeat_loop())
        
        logger.info("Task scheduler started")
    
    async def stop(self):
        self._running = False
        
        if self._scheduler_task:
            self._scheduler_task.cancel()
            try:
                await self._scheduler_task
            except asyncio.CancelledError:
                pass
        
        if self._heartbeat_task:
            self._heartbeat_task.cancel()
            try:
                await self._heartbeat_task
            except asyncio.CancelledError:
                pass
        
        logger.info("Task scheduler stopped")
    
    async def _scheduler_loop(self):
        while self._running:
            try:
                await self._check_tasks()
                await asyncio.sleep(1)
            except asyncio.CancelledError:
                break
            except Exception as e:
                logger.error(f"Scheduler loop error: {e}")
                await asyncio.sleep(5)
    
    async def _check_tasks(self):
        now = int(time.time() * 1000)
        
        for task in self.tasks.values():
            if not task.enabled:
                continue
            
            if task.next_run_at and task.next_run_at <= now:
                logger.info(f"Triggering task: {task.id} - {task.name}")
                
                task.last_run_at = now
                task.run_count += 1
                
                if task.trigger_type == "once":
                    task.enabled = False
                    task.next_run_at = None
                else:
                    task.next_run_at = self._calculate_next_run(task)
                
                self.save_task(task)
                
                if self._on_task_trigger:
                    try:
                        await self._on_task_trigger(task.id, task.prompt)
                    except Exception as e:
                        logger.error(f"Task trigger callback error: {e}")
    
    async def _heartbeat_loop(self):
        while self._running:
            try:
                self._last_heartbeat = time.time()
                await asyncio.sleep(30)
            except asyncio.CancelledError:
                break
            except Exception as e:
                logger.error(f"Heartbeat loop error: {e}")
    
    def get_heartbeat_status(self) -> HeartbeatStatus:
        running_tasks = sum(1 for t in self.tasks.values() if t.enabled)
        pending_tasks = sum(1 for t in self.tasks.values() if t.enabled and t.next_run_at)
        
        memory_info = psutil.Process().memory_info()
        memory_mb = memory_info.rss / (1024 * 1024)
        
        uptime = time.time() - self._start_time if self._start_time else 0
        
        return HeartbeatStatus(
            is_alive=self._running,
            last_heartbeat=int(self._last_heartbeat * 1000) if self._last_heartbeat else None,
            uptime_seconds=uptime,
            tasks_running=running_tasks,
            tasks_pending=pending_tasks,
            memory_usage_mb=round(memory_mb, 2)
        )

task_scheduler = TaskScheduler()
