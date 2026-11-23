"""Free Local Mode vault, file-compatible with the JS SDK (~/.agentkey/vault.enc).
AES-256-GCM, key = HKDF(machine.key, hostname). Never stores website cookies.

A saved login is not permission. Each permission is scoped to one site, one saved login
version, one project folder and one agent name; standing (until revoked), single-use or
expiring. Every check re-reads the file, so a revoke takes effect in a running agent."""
import json, os, socket, uuid, datetime, time
from pathlib import Path
from cryptography.hazmat.primitives.ciphers.aead import AESGCM
from cryptography.hazmat.primitives.kdf.hkdf import HKDF
from cryptography.hazmat.primitives import hashes
from .errors import AgentKeyError
from .env import agentkey_home

AAD = b"AgentKey.local.vault.v1"

def _write(p, data):
    tmp = Path(f"{p}.{os.urandom(4).hex()}.tmp")
    fd = os.open(tmp, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
    with os.fdopen(fd, "wb") as f:
        f.write(data)
    try:
        os.chmod(tmp, 0o600)
    except OSError:
        pass
    os.replace(tmp, p)  # atomic on Windows, macOS and Linux

def _machine_key(home):
    home.mkdir(parents=True, exist_ok=True)
    p = home / "machine.key"
    if not p.exists():
        _write(p, os.urandom(32))
    return HKDF(algorithm=hashes.SHA256(), length=32, salt=socket.gethostname().encode(), info=AAD).derive(p.read_bytes())

def _now_iso():
    d = datetime.datetime.now(datetime.timezone.utc)
    return d.strftime("%Y-%m-%dT%H:%M:%S.") + f"{d.microsecond // 1000:03d}Z"

def _ts(iso):
    return datetime.datetime.fromisoformat(iso.replace("Z", "+00:00")).timestamp()

def normalize(d):
    """Older vaults stored unscoped approvals[origin]=True; those are dropped (ask once again, no retyping)."""
    if not d:
        return d
    d.setdefault("logins", {}); d.setdefault("permissions", {}); d.setdefault("secrets", {})
    for l in d["logins"].values():
        l.setdefault("item_id", str(uuid.uuid4())); l.setdefault("version", 1)
    d.pop("approvals", None)
    return d

def permission_valid(p, login, origin, project_id, agent, now=None):
    now = time.time() if now is None else now
    return bool(p and login and p.get("origin") == origin and p.get("project_id") == project_id and p.get("agent") == agent
                and p.get("item_id") == login.get("item_id") and p.get("item_version") == login.get("version") and not p.get("revoked_at")
                and (p.get("expires_at") is None or _ts(p["expires_at"]) > now)
                and (p.get("max_uses") is None or p.get("uses", 0) < p["max_uses"]))

def _public(p):
    return {"id": p["id"], "origin": p["origin"], "project": p.get("project", ""), "project_id": p["project_id"], "agent": p["agent"],
            "created_at": p["created_at"], "expires_at": p.get("expires_at"), "kind": "standing" if p.get("max_uses") is None else "limited",
            "uses": p.get("uses", 0), "max_uses": p.get("max_uses"), "last_used_at": p.get("last_used_at")}

def _self_valid(d, p):
    return permission_valid(p, d["logins"].get(p["origin"]), p["origin"], p["project_id"], p["agent"])

class LocalVault:
    def __init__(self, home=None):
        self.home = Path(home) if home else agentkey_home()
        self.file = self.home / "vault.enc"
        self._key = _machine_key(self.home)
        self._data = self._read()

    def _read(self):
        if not self.file.exists():
            return None
        raw = self.file.read_bytes()
        iv, tag, ct = raw[:12], raw[12:28], raw[28:]
        try:
            return normalize(json.loads(AESGCM(self._key).decrypt(iv, ct + tag, AAD)))
        except Exception:
            raise AgentKeyError("vault_unreadable", "The local vault was made on another computer or is damaged. Move ~/.agentkey/vault.enc aside and run `npx tryagentkey init`.")

    def reload(self):
        self._data = self._read()
        return self._data

    def _save(self):
        iv = os.urandom(12)
        out = AESGCM(self._key).encrypt(iv, json.dumps(self._data, separators=(",", ":")).encode(), AAD)
        _write(self.file, iv + out[-16:] + out[:-16])

    def exists(self):
        return self.reload() is not None

    @property
    def id(self):
        return (self._data or {}).get("vault_id")

    def init(self):
        self.reload()
        if self._data is None:
            self._data = {"v": 1, "vault_id": str(uuid.uuid4()), "logins": {}, "permissions": {}, "secrets": {}}
            self._save()
        return self._data["vault_id"]

    def sites(self):
        d = self.reload() or {"logins": {}, "permissions": {}}
        return [{"origin": o, "username": v["username"], "saved_at": v.get("saved_at"),
                 "permissions": sum(1 for p in d["permissions"].values() if p["origin"] == o and _self_valid(d, p))} for o, v in d["logins"].items()]

    def has_login(self, origin):
        d = self.reload()
        return bool(d and d["logins"].get(origin))

    def put_login(self, origin, username, password):
        self.init()
        prev = self._data["logins"].get(origin) or {}
        self._data["logins"][origin] = {"item_id": prev.get("item_id") or str(uuid.uuid4()), "version": prev.get("version", 0) + 1,
                                        "username": str(username or ""), "password": str(password), "saved_at": _now_iso()}
        for pid in [k for k, p in self._data["permissions"].items() if not _self_valid(self._data, p)]:
            del self._data["permissions"][pid]
        self._save()

    def grant(self, origin, project_id, agent, project="", expires_at=None, max_uses=None):
        self.init()
        l = self._data["logins"].get(origin)
        if not l: raise AgentKeyError("login_not_saved")
        if not project_id or not agent: raise AgentKeyError("scope_required")
        p = {"id": str(uuid.uuid4()), "origin": origin, "item_id": l["item_id"], "item_version": l["version"], "project_id": project_id,
             "project": str(project or ""), "agent": str(agent), "created_at": _now_iso(),
             "expires_at": datetime.datetime.fromtimestamp(expires_at, datetime.timezone.utc).strftime("%Y-%m-%dT%H:%M:%S.000Z") if expires_at else None,
             "max_uses": None if max_uses is None else max(1, int(max_uses)), "uses": 0, "last_used_at": None}
        self._data["permissions"][p["id"]] = p
        self._save()
        return _public(p)

    def find_permission(self, origin, project_id, agent):
        d = self.reload()
        if not d: return None
        l = d["logins"].get(origin)
        for p in d["permissions"].values():
            if permission_valid(p, l, origin, project_id, agent):
                return _public(p)
        return None

    def permissions(self):
        d = self.reload()
        return [_public(p) for p in d["permissions"].values() if _self_valid(d, p)] if d else []

    def _use_credential(self, permission_id, origin, project_id, agent):
        """Fill step only, right before typing. Re-checks from disk and counts the use; never returned to agents or tools."""
        d = self.reload()
        p = (d or {}).get("permissions", {}).get(permission_id)
        l = (d or {}).get("logins", {}).get(origin)
        if not permission_valid(p, l, origin, project_id, agent):
            raise AgentKeyError("permission_revoked", "This permission was revoked or ran out. Run ak.login again to ask the owner.")
        p["uses"] = p.get("uses", 0) + 1; p["last_used_at"] = _now_iso()
        if p.get("max_uses") is not None and p["uses"] >= p["max_uses"]:
            del d["permissions"][permission_id]
        self._save()
        return {"username": l["username"], "password": l["password"]}

    def revoke(self, target):
        d = self.reload()
        if not d: return 0
        gone = [k for k, p in d["permissions"].items() if target == "all" or k == target or p["origin"] == target]
        for k in gone: del d["permissions"][k]
        if gone: self._save()
        return len(gone)

    def forget(self, origin):
        if self.reload():
            self._data["logins"].pop(origin, None)
            for k in [k for k, p in self._data["permissions"].items() if p["origin"] == origin]:
                del self._data["permissions"][k]
            self._save()

    def set_secret(self, name, value):
        self.init(); self._data["secrets"][name] = str(value); self._save()

    def get_secret(self, name):
        return (self.reload() or {}).get("secrets", {}).get(name)

    def secret_names(self):
        return list((self.reload() or {}).get("secrets", {}))
