"""One-line AgentKey for Python: `ak = agentkey()`; `ak.login(url, page=page)`.
Free Local Mode by default; cloud mode when AGENTKEY_API_KEY is set. The public login result never includes passwords; local host code must be trusted.
Works with sync and async Playwright: sync pages return the result, async pages return an awaitable."""
import asyncio, hashlib, inspect, os, time, uuid
from urllib.parse import urlparse
from urllib.request import urlopen
from .env import read_env
from .errors import AgentKeyError
from .keys import decode_api_key
from .client import AgentKeyClient, token_source
from .local_vault import LocalVault
from .approve import approve as _approve
from .fill import fill_login
from .confirm import SYNC, sleep as _sleep, wait_confirmed
from .runtime import AgentKeyRuntime, RuntimeKey, file_store

def _origin(url):
    u = urlparse(url)
    if u.scheme != "https" and not (u.scheme == "http" and u.hostname in ("localhost", "127.0.0.1", "::1")):
        raise AgentKeyError("invalid_url", "Use the site's https sign-in page.")
    return f"{u.scheme}://{u.netloc}"

def project_scope(cwd=None):
    """Same project id as the JS SDK: sha256(real path of the project folder)[:16]."""
    p = os.path.realpath(cwd or os.getcwd())
    return {"project_id": hashlib.sha256(p.encode()).hexdigest()[:16], "project": os.path.basename(p)}

def _drive(coro):
    """Runs a coroutine that never truly suspends (sync Playwright page)."""
    try:
        coro.send(None)
    except StopIteration as e:
        return e.value
    coro.close()
    raise AgentKeyError("sync_driver_suspended")

def _run(page, make):
    if inspect.iscoroutinefunction(getattr(page, "goto", None)):
        return make()
    tok = SYNC.set(True)
    try:
        return _drive(make())
    finally:
        SYNC.reset(tok)

async def _maybe(v):
    return await v if inspect.isawaitable(v) else v

async def _io(fn, *a, **k):
    """Blocking network call: inline for sync pages, in a worker thread for async pages."""
    return fn(*a, **k) if SYNC.get() else await asyncio.to_thread(fn, *a, **k)

class LocalVaultView:
    """Metadata and explicitly named developer secrets, never saved website passwords.

    This is an API boundary for trusted host code, not an isolation boundary against
    arbitrary Python running as the same OS user. Use a separate trusted runtime
    when the caller itself must not be able to inspect credential memory/files.
    """
    __slots__ = ("__vault",)
    def __init__(self, vault): self.__vault = vault
    def sites(self): return self.__vault.sites()
    def permissions(self): return self.__vault.permissions()
    def revoke(self, target): return self.__vault.revoke(target)
    def forget(self, origin): return self.__vault.forget(origin)
    def get_secret(self, name): return self.__vault.get_secret(name)
    def set_secret(self, name, value): return self.__vault.set_secret(name, value)
    def secret_names(self): return self.__vault.secret_names()

class LocalAgentKey:
    mode = "local"
    def __init__(self, home=None, on_link=None, approve=_approve, agent_name="your agent", cwd=None, permission_days=None):
        self.__vault, self._on_link, self._approve, self._name = LocalVault(home), on_link, approve, str(agent_name)
        self._proj, self._days = project_scope(cwd), permission_days
        self.__vault.init()
        self.vault = LocalVaultView(self.__vault)

    def status(self):
        return {"mode": "local", "sites": self.__vault.sites(), "permissions": self.__vault.permissions(), "secrets": self.__vault.secret_names()}

    def secret(self, name):
        return self.__vault.get_secret(name)

    def permissions(self):
        return self.__vault.permissions()

    def revoke(self, target):
        """Revoke by permission id, site origin, or 'all'. Takes effect at once, even in a running agent."""
        return self.__vault.revoke(target if target == "all" or len(target) == 36 else _origin(target))

    def login(self, url, page, verify=None, success_selector=None):
        """Sync with sync Playwright; returns an awaitable inside async code."""
        return _run(page, lambda: self._login(url, page, verify, success_selector))

    async def _permit(self, origin):
        pid, agent = self._proj["project_id"], self._name
        have = self.__vault.find_permission(origin, pid, agent)
        if have: return have
        saved = self.__vault.has_login(origin)
        mode = "allow" if saved else "save"
        args = (origin, self._name, self._on_link)
        kw = {"mode": mode, "project": self._proj["project"]}
        got = self._approve(*args, **kw) if SYNC.get() else await asyncio.to_thread(self._approve, *args, **kw)
        if not got: return None
        if not saved: self.__vault.put_login(origin, got["username"], got["password"])
        return self.__vault.grant(origin, pid, agent, project=self._proj["project"], max_uses=1 if got.get("duration") == "once" else None,
                                expires_at=time.time() + self._days * 86400 if self._days else None)

    async def _login(self, url, page, verify, success_selector):
        _origin(url)
        if str(page.url) != url:
            await _maybe(page.goto(url))
        origin = _origin(str(page.url))  # after redirects, e.g. a single sign-on page
        perm = await self._permit(origin)
        if not perm:
            return {"site": urlparse(origin).netloc, "signed_in": False, "outcome": "denied", "origin": origin, "code": "request_denied"}
        pid = self._proj["project_id"]
        r = await fill_login(page, lambda: self.__vault._use_credential(perm["id"], origin, pid, self._name), origin=origin, verify=verify,
                             success_selector=success_selector, on_handoff=lambda p: print(f"\nAgentKey: {urlparse(origin).netloc} needs you (a check or code). Finish it in the browser window; your agent continues automatically.\n"))
        return {**r, "site": urlparse(origin).netloc, "signed_in": r["outcome"] == "completed", "origin": origin, "permission_id": perm["id"]}  # never includes the password

class CloudAgentKey:
    mode = "cloud"
    def __init__(self, api_key, base_url, cwd=None, on_link=None, label="Agent browser", opener=urlopen, poll=2.0, store=None, runtime=None):
        k = decode_api_key(api_key)
        self.agent_id, self._base, self._open, self._poll, self._label = k["agent_id"], base_url, opener, poll, label
        self._token = token_source(k, opener)
        self.client = AgentKeyClient(base_url, self._token, opener=opener)
        self._store = store or file_store(os.path.join(cwd or os.getcwd(), ".agentkey", "runtime.json"))
        self._on_link = on_link or (lambda u, why: print(f"\nAgentKey: {why}\n  here is your link → {u}\n"))
        self._rt = runtime

    def status(self):
        return {"mode": "cloud", "agent_id": self.agent_id, **self.client.inventory()}
    def guide(self, goal=None):
        return self.client.guide(goal)
    def request(self, origin, site_name, executor_id, signin_url=None):
        return self.client.request(self.agent_id, executor_id, origin, site_name, signin_url)

    def ensure_runtime(self, timeout=600):
        """Trust this agent browser once (owner taps the link), then reuse it from .agentkey/runtime.json."""
        if self._rt: return self._rt
        saved = self._store["load"]()
        if saved and saved.get("key") and saved.get("session"):
            exported = saved["key"]
            self._rt = AgentKeyRuntime(self._base, RuntimeKey.load(exported), saved["session"], lambda s: self._store["save"]({"key": exported, "session": s}), self._open)
        else:
            key = RuntimeKey.generate(); exported = key.export()
            rt, link = AgentKeyRuntime.enroll(self._token(), self.agent_id, self._base, self._label, key, self._open,
                                              lambda s: self._store["save"]({"key": exported, "session": s}))
            self._rt = rt
            if link: self._on_link(link, "trust this agent browser once")
        self._rt.wait_until_enabled(timeout=timeout, interval=self._poll)
        return self._rt

    def _wait_approved(self, request_id, timeout):
        end = time.monotonic() + timeout
        while True:
            s = self.client.request_status(request_id)
            if s.get("state") == "approved" and s.get("grant_id"): return s
            if s.get("state") and s["state"] != "pending": raise AgentKeyError("request_" + s["state"], "The owner did not approve this login.")
            if time.monotonic() > end: raise AgentKeyError("approval_pending", "Still waiting for the owner. Call login() again to keep waiting.")
            time.sleep(self._poll)

    def login(self, url, page, verify=None, success_selector=None, timeout=600):
        """One call: owner approval -> fill in your own page -> positive confirmation."""
        return _run(page, lambda: self._login(url, page, verify, success_selector, timeout))

    async def _login(self, url, page, verify, success_selector, timeout):
        t = urlparse(url)
        if t.scheme != "https": raise AgentKeyError("invalid_url", "Use an https sign-in page.")
        origin = f"https://{t.netloc}"
        cur = urlparse(str(page.url))
        if f"{cur.scheme}://{cur.netloc}" != origin:
            await _maybe(page.goto(url))
        rt = await _io(self.ensure_runtime, timeout)
        e = await _io(rt.enrollment)
        target = await _io(rt.register_target, origin)
        req = await _io(self.client.request_target, self.agent_id, e["executor_id"], target["target_id"])
        if req.get("status") != "approved" and req.get("request_url"):
            self._on_link(req["request_url"], f"approve sign-in to {t.hostname}")
        ok = await _io(self._wait_approved, req["request_id"], timeout)
        op = await _io(self.client.use, ok["grant_id"], origin, ok.get("executor_key_id") or e["key_id"], str(uuid.uuid4()))
        if not op.get("operation_id"): raise AgentKeyError(op.get("code") or "operation_unavailable", op.get("next_action"))
        signin_url = str(page.url)
        confirm = verify or (lambda p: wait_confirmed(p, 8, verify=None, success_selector=success_selector, signin_url=signin_url, submitted=True))
        r = await rt.fill_operation(op["operation_id"], page, verify=confirm, target_bound=True)
        return {"site": t.hostname, "signed_in": r["outcome"] == "completed", "outcome": r["outcome"], "operation_id": r["operation_id"]}

    def with_auth(self, url, fn, page, **kw):
        r = self.login(url, page, **kw)
        if inspect.isawaitable(r):
            async def go():
                res = await r
                if not res["signed_in"]: raise AgentKeyError("not_signed_in")
                return await _maybe(fn(page, res))
            return go()
        if not r["signed_in"]: raise AgentKeyError("not_signed_in")
        return fn(page, r)

def agentkey(mode=None, api_key=None, env=None, cwd=None, **kw):
    cfg = read_env(env, cwd)
    mode = mode or cfg["mode"] or ("cloud" if (api_key or cfg["api_key"]) else "local")
    if mode == "local":
        return LocalAgentKey(cwd=cwd, **kw)
    if mode != "cloud":
        raise AgentKeyError("invalid_mode", "AGENTKEY_MODE must be local or cloud.")
    key = api_key or cfg["api_key"]
    if not key:
        raise AgentKeyError("missing_api_key", "Cloud mode needs AGENTKEY_API_KEY. Run `npx tryagentkey link`.")
    return CloudAgentKey(key, cfg["base_url"], cwd=cwd, **kw)
