"""ak_ API key: base64url JSON bundle of the agent's own sign-in (byte-compatible with the JS SDK)."""
import base64, json
from urllib.parse import urlparse
from .errors import AgentKeyError

PREFIX = "ak_"

def _b64(s):
    return base64.urlsafe_b64encode(s.encode()).decode().rstrip("=")

def encode_api_key(agent_id, sign_in):
    return PREFIX + _b64(json.dumps({"v": 1, "agent_id": agent_id, "url": sign_in["url"], "email": sign_in["email"], "password": sign_in["password"], "apikey": sign_in["apikey"]}, separators=(",", ":")))

def decode_api_key(key):
    if not isinstance(key, str) or not key.startswith(PREFIX):
        raise AgentKeyError("invalid_api_key", "AGENTKEY_API_KEY must start with ak_. Run `npx tryagentkey link`.")
    raw = key[len(PREFIX):]
    try:
        k = json.loads(base64.urlsafe_b64decode(raw + "=" * (-len(raw) % 4)).decode())
    except Exception:
        raise AgentKeyError("invalid_api_key", "AGENTKEY_API_KEY is damaged. Run `npx tryagentkey link` again.")
    if k.get("v") != 1 or urlparse(k.get("url", "")).scheme != "https" or not all(k.get(f) for f in ("agent_id", "email", "password", "apikey")):
        raise AgentKeyError("invalid_api_key", "AGENTKEY_API_KEY is not valid. Run `npx tryagentkey link` again.")
    return k
