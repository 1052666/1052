"""
Session Store - 基于 JSON 文件的会话存储

职责：
- 按 platform + user_id 管理会话
- 持久化到 data/sessions.json
- 支持跨平台消息查询
- 兼容旧版 conversation.json 迁移
"""

import json
import time
from datetime import datetime
from pathlib import Path
from typing import Optional, List, Dict

from core.config import DATA_DIR, CONVERSATION_FILE


# 会话文件路径
SESSIONS_FILE = DATA_DIR / "sessions.json"


class Session:
    """单个会话对象，对应一个 platform + user_id 组合"""

    def __init__(self, platform: str, user_id: str, messages: Optional[List[Dict]] = None):
        self.platform = platform
        self.user_id = user_id
        self.messages: List[Dict] = messages or []

    def _session_key(self) -> str:
        """生成会话唯一键"""
        return f"{self.platform}:{self.user_id}"

    def add_message(self, role: str, content: str):
        """添加一条消息，自动附加元数据"""
        msg = {
            "role": role,
            "content": content,
            "_meta": {
                "platform": self.platform,
                "user_id": self.user_id,
                "timestamp": time.time(),
            },
        }
        self.messages.append(msg)

    def get_conversation_messages(self) -> List[Dict]:
        """获取可供 LLM 消费的消息列表（仅保留 role + content）"""
        return [
            {"role": m["role"], "content": m["content"]}
            for m in self.messages
            if m.get("content")
        ]

    def compact(self, summary: str, preserve_recent: int = 2):
        """
        压缩会话：用摘要替换旧消息，保留最近几条

        Args:
            summary: AI 生成的对话摘要
            preserve_recent: 保留最近多少条消息
        """
        # 保留最近的消息
        recent = self.messages[-preserve_recent:] if len(self.messages) > preserve_recent else []

        # 用摘要消息 + 最近消息替换整个历史
        summary_msg = {
            "role": "system",
            "content": f"[对话摘要]\n{summary}",
            "_meta": {
                "platform": self.platform,
                "user_id": self.user_id,
                "timestamp": time.time(),
                "is_summary": True,
            },
        }
        self.messages = [summary_msg] + recent

    def to_dict(self) -> Dict:
        """序列化为字典"""
        return {
            "platform": self.platform,
            "user_id": self.user_id,
            "messages": self.messages,
        }

    @classmethod
    def from_dict(cls, data: Dict) -> "Session":
        """从字典反序列化"""
        return cls(
            platform=data.get("platform", "web"),
            user_id=data.get("user_id", ""),
            messages=data.get("messages", []),
        )


class SessionStore:
    """会话存储管理器，所有会话持久化到一个 JSON 文件"""

    def __init__(self):
        self._sessions: Dict[str, Session] = {}
        self._load()

    def _session_key(self, platform: str, user_id: str) -> str:
        """生成会话唯一键"""
        return f"{platform}:{user_id}"

    def _load(self):
        """从文件加载所有会话"""
        if not SESSIONS_FILE.exists():
            self._sessions = {}
            return

        try:
            raw = json.loads(SESSIONS_FILE.read_text(encoding="utf-8"))
            for key, data in raw.items():
                self._sessions[key] = Session.from_dict(data)
        except (json.JSONDecodeError, Exception) as e:
            print(f"[SessionStore] 加载会话文件失败: {e}")
            self._sessions = {}

    def _save_all(self):
        """将所有会话写入文件"""
        DATA_DIR.mkdir(parents=True, exist_ok=True)
        raw = {key: session.to_dict() for key, session in self._sessions.items()}
        SESSIONS_FILE.write_text(
            json.dumps(raw, ensure_ascii=False, indent=2),
            encoding="utf-8",
        )

    def get_or_create_session(self, platform: str, user_id: str) -> Session:
        """获取已有会话，不存在则创建新的"""
        key = self._session_key(platform, user_id)
        if key not in self._sessions:
            self._sessions[key] = Session(platform=platform, user_id=user_id)
        return self._sessions[key]

    def save_session(self, session: Session):
        """保存单个会话（写入磁盘）"""
        key = self._session_key(session.platform, session.user_id)
        self._sessions[key] = session
        self._save_all()

    def clear_session(self, platform: str, user_id: str):
        """清空指定会话"""
        key = self._session_key(platform, user_id)
        if key in self._sessions:
            del self._sessions[key]
        self._save_all()

    def get_all_recent_messages(self, limit: int = 30) -> List[Dict]:
        """
        获取所有平台的最近消息，按时间排序

        Args:
            limit: 最多返回多少条消息

        Returns:
            按时间升序排列的消息列表，每条消息包含 _meta 字段标识来源
        """
        all_msgs = []
        for session in self._sessions.values():
            all_msgs.extend(session.messages)

        # 按时间戳排序（没有时间戳的放最前面）
        all_msgs.sort(key=lambda m: m.get("_meta", {}).get("timestamp", 0))

        # 取最近 limit 条
        return all_msgs[-limit:]

    def migrate_legacy_conversation(self):
        """
        迁移旧版 conversation.json 到 SessionStore

        旧格式：data/conversation.json 是一个消息列表 [{"role": ..., "content": ...}, ...]
        迁移后放入 web: 默认会话，然后重命名旧文件
        """
        if not CONVERSATION_FILE.exists():
            return

        try:
            raw = json.loads(CONVERSATION_FILE.read_text(encoding="utf-8"))
        except (json.JSONDecodeError, Exception) as e:
            print(f"[SessionStore] 读取旧 conversation.json 失败: {e}")
            return

        if not isinstance(raw, list) or not raw:
            return

        # 如果已有 web 会话且有消息，跳过迁移避免重复
        web_key = self._session_key("web", "")
        if web_key in self._sessions and self._sessions[web_key].messages:
            return

        # 迁移到 web 默认会话
        session = Session(platform="web", user_id="")
        for msg in raw:
            if isinstance(msg, dict) and msg.get("role") and msg.get("content"):
                session.messages.append({
                    "role": msg["role"],
                    "content": msg["content"],
                    "_meta": {
                        "platform": "web",
                        "user_id": "",
                        "timestamp": msg.get("timestamp", 0),
                        "migrated": True,
                    },
                })

        if session.messages:
            self._sessions[web_key] = session
            self._save_all()

            # 重命名旧文件
            backup = CONVERSATION_FILE.with_suffix(".json.bak")
            CONVERSATION_FILE.rename(backup)
            print(f"[SessionStore] 已迁移 {len(session.messages)} 条旧消息，旧文件备份为 {backup.name}")


# 全局单例
_store: Optional[SessionStore] = None


def get_session_store() -> SessionStore:
    """获取全局 SessionStore 单例"""
    global _store
    if _store is None:
        _store = SessionStore()
    return _store
