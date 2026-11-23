"""Agent API client. Same validation and output allowlists as the JS AgentKeyClient."""
import json, time, re, uuid
from urllib.parse import urlparse
from urllib.request import Request, urlopen
from urllib.error import HTTPError
from .errors import AgentKeyError
from .env import DEFAULT_BASE

_UUID = re.compile(r"^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$", re.I)

def _id(v):
    if not isinstance(v, str) or not _UUID.match(v):
        raise AgentKeyError("invalid_id")
    return v

def _origin(o):
    u = urlparse(o)
    if u.scheme != "https" or f"https://{u.netloc}" != o or "@" in u.netloc:
        raise AgentKeyError("invalid_origin")
    return o

class _NoRedirect:
    pass

class AgentKeyClient:
    def __init__(self, base_url=DEFAULT_BASE, token=None, opener=urlopen, ssl_context=None):
        u = urlparse(base_url)
        if u.scheme != "https" or u.username or u.password or u.query or u.fragment or u.path.rstrip("/") not in ("", "/api/public/agentkey-api"):
            raise AgentKeyError("invalid_service")
        self.base_url = f"https://{u.netloc}{u.path.rstrip('/')}"
        self.token, self._open, self._ssl = token, opener, ssl_context

    def _call(self, path, body=None, keep=()):
        data = json.dumps(body).encode() if body is not None else None
        req = Request(self.base_url + path, data=data, method="POST" if body is not None else "GET",
                      headers={"Authorization": "Bearer " + self.token(), "Content-Type": "application/json"})
        try:
            with self._open(req, timeout=15, **({"context": self._ssl} if self._ssl else {})) as r:
                j = json.loads(r.read() or b"{}")
        except HTTPError as e:
            try:
                code = json.loads(e.read() or b"{}").get("error", "request_failed")
            except Exception:
                code = "request_failed"
            raise AgentKeyError(str(code)[:80]) from None
        return {k: j[k] for k in keep if k in j}

    def guide(self, goal=None):
        return self._call("/v1/guide", {"goal": goal} if goal else {}, ("next_action", "steps", "path", "instructions"))

    def inventory(self):
        return self._call("/v1/inventory", None, ("sites", "items"))

    def request(self, agent_id, executor_id, origin, site_name, signin_url=None):
        body = {"agent_id": _id(agent_id), "executor_id": _id(executor_id), "origin": _origin(origin), "protocol_version": "1", "site_name": site_name.strip()[:120]}
        if signin_url:
            body["signin_url"] = signin_url
        return self._call("/v1/requests", body, ("site_name", "request_id", "status", "grant_id", "expires_at", "request_url", "signin_link", "code", "next_action"))

    def request_target(self, agent_id, executor_id, target_id):
        if not isinstance(target_id, str) or not re.fullmatch(r"[a-f0-9]{32}", target_id):
            raise AgentKeyError("invalid_target")
        return self._call("/v2/target-requests", {"agent_id": _id(agent_id), "executor_id": _id(executor_id), "target_id": target_id},
                          ("request_id", "status", "origin", "executor_id", "executor_key_id", "expires_at", "request_url", "next_action"))

    def request_status(self, request_id):
        return self._call("/v1/requests/" + _id(request_id), None, ("request_id", "agent_id", "agent_name", "executor_id", "executor_key_id", "origin", "action", "state", "expires_at", "grant_id"))

    def use(self, grant_id, origin, executor_key_id, idempotency_key=None):
        return self._call(f"/v1/grants/{_id(grant_id)}/use", {"origin": _origin(origin), "executor_key_id": _id(executor_key_id), "idempotency_key": _id(idempotency_key or str(uuid.uuid4()))}, ("operation_id", "status", "code", "next_action"))

    def receipt(self, operation_id):
        return self._call("/v1/operations/" + _id(operation_id), None, ("operation_id", "grant_id", "status", "reserved_at", "finished_at"))

def token_source(key, opener=urlopen):
    """Signs the agent in with its own key bundle; caches the access token."""
    cur = {}
    def get():
        if cur.get("exp", 0) > time.time() + 60:
            return cur["token"]
        req = Request(key["url"], data=json.dumps({"email": key["email"], "password": key["password"]}).encode(), method="POST",
                      headers={"apikey": key["apikey"], "Content-Type": "application/json"})
        try:
            with opener(req, timeout=15) as r:
                j = json.loads(r.read())
        except HTTPError:
            raise AgentKeyError("agent_sign_in_failed", "The owner may have removed this agent. Run `npx tryagentkey link` again.") from None
        cur.update(token=j["access_token"], exp=time.time() + j.get("expires_in", 3600))
        return cur["token"]
    return get
