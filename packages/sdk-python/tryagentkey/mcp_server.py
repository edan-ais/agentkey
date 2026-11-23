"""AgentKey MCP over stdio for Python hosts (`uvx agentkey-mcp`). Same tools and allowlists as @tryagentkey/mcp."""
import json, sys, os
from .client import AgentKeyClient, token_source
from .keys import decode_api_key
from .env import read_env
from .errors import AgentKeyError

_ID = {"type": "string", "format": "uuid"}
TOOLS = [
    {"name": "agentkey_request", "description": "Request owner-approved credential use. Never returns credentials.", "inputSchema": {"type": "object", "properties": {"agent_id": _ID, "executor_id": _ID, "origin": {"type": "string", "format": "uri"}, "site_name": {"type": "string"}, "signin_url": {"type": "string"}}, "required": ["agent_id", "executor_id", "origin", "site_name"], "additionalProperties": False}},
    {"name": "agentkey_request_status", "description": "Read redacted approval status.", "inputSchema": {"type": "object", "properties": {"request_id": _ID}, "required": ["request_id"], "additionalProperties": False}},
    {"name": "agentkey_use", "description": "Use an active grant through its enrolled executor. Returns pending operation, not a secret.", "inputSchema": {"type": "object", "properties": {"grant_id": _ID, "origin": {"type": "string"}, "executor_key_id": _ID, "idempotency_key": _ID}, "required": ["grant_id", "origin", "executor_key_id", "idempotency_key"], "additionalProperties": False}},
    {"name": "agentkey_receipt", "description": "Read redacted executor operation receipt.", "inputSchema": {"type": "object", "properties": {"operation_id": _ID}, "required": ["operation_id"], "additionalProperties": False}},
]

def handler(client):
    st = {"init": False, "ready": False}
    def err(i, c, m): return {"jsonrpc": "2.0", "id": i, "error": {"code": c, "message": m}}
    def handle(msg):
        i = msg.get("id") if isinstance(msg, dict) else None
        if not isinstance(msg, dict) or msg.get("jsonrpc") != "2.0" or not isinstance(msg.get("method"), str):
            return err(None, -32600, "Invalid Request")
        if "id" not in msg:
            if msg["method"] == "notifications/initialized" and st["init"]: st["ready"] = True
            return None
        m = msg["method"]
        if m == "initialize":
            v = (msg.get("params") or {}).get("protocolVersion")
            if st["init"] or v not in ("2025-06-18", "2024-11-05"): return err(i, -32602, "Unsupported initialization")
            st["init"] = True
            return {"jsonrpc": "2.0", "id": i, "result": {"protocolVersion": v, "capabilities": {"tools": {}}, "serverInfo": {"name": "AgentKey", "version": "0.5.0"}}}
        if m == "ping": return {"jsonrpc": "2.0", "id": i, "result": {}}
        if not st["ready"]: return err(i, -32000, "Server not initialized")
        if m == "tools/list": return {"jsonrpc": "2.0", "id": i, "result": {"tools": TOOLS}}
        if m != "tools/call": return err(i, -32601, "Method not found")
        p = msg.get("params") or {}; name, a = p.get("name"), p.get("arguments") or {}
        tool = next((t for t in TOOLS if t["name"] == name), None)
        if not tool or not isinstance(a, dict) or any(k not in tool["inputSchema"]["properties"] or not isinstance(v, str) for k, v in a.items()) or any(k not in a for k in tool["inputSchema"]["required"]):
            return err(i, -32602, "Invalid params")
        try:
            if name == "agentkey_request": data = client.request(**a)
            elif name == "agentkey_request_status": data = client.request_status(a["request_id"])
            elif name == "agentkey_use": data = client.use(**a)
            else: data = client.receipt(a["operation_id"])
            res = {"content": [{"type": "text", "text": json.dumps(data)}], "isError": False}
        except Exception:
            res = {"content": [{"type": "text", "text": "AgentKey request failed"}], "isError": True}
        return {"jsonrpc": "2.0", "id": i, "result": res}
    return handle

def client_from_env(env=None):
    cfg = read_env(env)
    if cfg["api_key"]:
        return AgentKeyClient(cfg["base_url"], token_source(decode_api_key(cfg["api_key"])))
    if cfg["legacy_token"]:
        t = cfg["legacy_token"]; return AgentKeyClient(cfg["base_url"], lambda: t)
    return None

def serve(client, inp=sys.stdin, out=sys.stdout):
    h = handler(client)
    for line in inp:
        if not line.strip(): continue
        try:
            r = h(json.loads(line)) if len(line) <= 65536 else {"jsonrpc": "2.0", "id": None, "error": {"code": -32600, "message": "Request too large"}}
        except ValueError:
            r = {"jsonrpc": "2.0", "id": None, "error": {"code": -32700, "message": "Parse error"}}
        if r: out.write(json.dumps(r) + "\n"); out.flush()

def main():
    try:
        c = client_from_env()
    except AgentKeyError as e:
        sys.stderr.write(f"AgentKey setup problem: {e}\n"); sys.exit(1)
    if not c:
        sys.stderr.write("Set AGENTKEY_API_KEY (run `npx tryagentkey link`).\n"); sys.exit(1)
    serve(c)
