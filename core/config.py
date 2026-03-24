import json
from pathlib import Path

# ─── Paths ────────────────────────────────────────────────────────
_ROOT = Path(__file__).parent.parent
DATA_DIR = _ROOT / "data"

SYSTEM_PROMPT_FILE   = DATA_DIR / "system_prompt.md"
MCP_CONFIG_FILE      = DATA_DIR / "mcp_servers.json"
CONVERSATION_FILE    = DATA_DIR / "conversation.json"
CONFIG_FILE          = DATA_DIR / "config.json"
PREFERENCES_FILE     = DATA_DIR / "preferences.md"


# ─── Helpers ──────────────────────────────────────────────────────
def read_system_prompt() -> str:
    if SYSTEM_PROMPT_FILE.exists():
        return SYSTEM_PROMPT_FILE.read_text(encoding="utf-8")
    return "You are a helpful assistant."


def load_conversation() -> list:
    if CONVERSATION_FILE.exists():
        try:
            return json.loads(CONVERSATION_FILE.read_text(encoding="utf-8"))
        except Exception:
            return []
    return []


def save_conversation(messages: list):
    DATA_DIR.mkdir(exist_ok=True)
    CONVERSATION_FILE.write_text(
        json.dumps(messages, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )


def read_preferences() -> str:
    if PREFERENCES_FILE.exists():
        return PREFERENCES_FILE.read_text(encoding="utf-8")
    return ""


def load_config() -> dict:
    if CONFIG_FILE.exists():
        try:
            return json.loads(CONFIG_FILE.read_text(encoding="utf-8"))
        except Exception:
            return {}
    return {}


def save_config(data: dict):
    DATA_DIR.mkdir(exist_ok=True)
    CONFIG_FILE.write_text(
        json.dumps(data, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )
