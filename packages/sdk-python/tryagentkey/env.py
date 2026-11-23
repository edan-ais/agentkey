"""Reads AGENTKEY_* from the environment, then .env.local / .env (same rules as the JS SDK)."""
import os, re
from pathlib import Path

DEFAULT_BASE = "https://agentkey.waiwiser.com/api/public/agentkey-api"
_LINE = re.compile(r'^\s*(?:export\s+)?(AGENTKEY_[A-Z_]+)\s*=\s*"?([^"\r\n]*)"?\s*$')

def load_dotenv(cwd):
    out = {}
    for name in (".env.local", ".env"):
        try:
            for line in Path(cwd, name).read_text(encoding="utf-8").splitlines():
                m = _LINE.match(line)
                if m and m.group(1) not in out:
                    out[m.group(1)] = m.group(2)
        except OSError:
            pass
    return out

def read_env(env=None, cwd=None):
    env = os.environ if env is None else env
    f = load_dotenv(cwd or os.getcwd())
    get = lambda n: env.get(n) or f.get(n)
    return {
        "mode": get("AGENTKEY_MODE"),
        "api_key": get("AGENTKEY_API_KEY"),
        "base_url": get("AGENTKEY_BASE_URL") or get("AGENTKEY_API") or get("AGENTKEY_SERVICE_URL") or DEFAULT_BASE,
        "legacy_token": get("AGENTKEY_TOKEN") or get("AGENTKEY_ACCESS_TOKEN"),
    }

def agentkey_home(env=None):
    env = os.environ if env is None else env
    return Path(env.get("AGENTKEY_HOME") or Path.home() / ".agentkey")
