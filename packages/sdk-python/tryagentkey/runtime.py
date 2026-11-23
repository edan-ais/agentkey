"""AgentKey runtime for an agent's own existing browser (Python port of @tryagentkey/runtime).
Never launches a browser or exports cookies. The private key and opened credentials stay in this
process; nothing here logs or returns them. Envelopes are byte-compatible with the JS runtime."""
import base64, hashlib, json, os, re, secrets, time
from urllib.parse import urlparse
from urllib.request import Request, urlopen
from urllib.error import HTTPError
from cryptography.hazmat.primitives.asymmetric.x25519 import X25519PrivateKey, X25519PublicKey
from cryptography.hazmat.primitives.kdf.hkdf import HKDF
from cryptography.hazmat.primitives.ciphers.aead import AESGCM
from cryptography.hazmat.primitives import hashes, serialization
from .errors import AgentKeyError
from .confirm import _a

UUID = re.compile(r"^[a-f0-9]{8}-[a-f0-9]{4}-[1-5][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$", re.I)
NAMES = ["ownerID", "requestID", "agentID", "executorID", "executorKeyID", "itemID"]
ALPHA = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789"
DEFAULT_BASE = "https://agentkey.waiwiser.com/api/public/agentkey-api"
_b64e = lambda b: base64.b64encode(b).decode()
_b64d = lambda s: base64.b64decode(s)
_u64e = lambda b: base64.urlsafe_b64encode(b).decode().rstrip("=")
_u64d = lambda s: base64.urlsafe_b64decode(s + "=" * (-len(s) % 4))

class RuntimeKey:
    def __init__(self, private_key):
        self.private_key = private_key
        self.public_key_b64 = _b64e(private_key.public_key().public_bytes(serialization.Encoding.Raw, serialization.PublicFormat.Raw))
    @classmethod
    def generate(cls):
        return cls(X25519PrivateKey.generate())
    def export(self):
        """Same shape as the JS exportRuntimeKey ({jwk, publicKeyB64}); keep it in the runtime's own secret store."""
        d = self.private_key.private_bytes(serialization.Encoding.Raw, serialization.PrivateFormat.Raw, serialization.NoEncryption())
        x = self.private_key.public_key().public_bytes(serialization.Encoding.Raw, serialization.PublicFormat.Raw)
        return {"jwk": {"crv": "X25519", "d": _u64e(d), "ext": True, "key_ops": ["deriveBits"], "kty": "OKP", "x": _u64e(x)}, "publicKeyB64": self.public_key_b64}
    @classmethod
    def load(cls, saved):
        k = cls(X25519PrivateKey.from_private_bytes(_u64d(saved["jwk"]["d"])))
        if saved.get("publicKeyB64") and saved["publicKeyB64"] != k.public_key_b64:
            raise AgentKeyError("invalid_runtime_key")
        return k

def _safe_int(v):
    return isinstance(v, int) and not isinstance(v, bool) and abs(v) <= 2**53 - 1

def _valid_origin(o):
    try:
        u = urlparse(o)
        return isinstance(o, str) and u.scheme == "https" and f"https://{u.netloc}" == o and "@" not in u.netloc and bool(u.netloc)
    except Exception:
        return False

def _target_binding(s, now_ms):
    if "deliveryTarget" not in s:
        return []
    t = s["deliveryTarget"]
    if (not isinstance(t, dict) or t.get("version") != 2 or not re.fullmatch(r"[a-f0-9]{32}", str(t.get("targetID", "")))
            or not re.fullmatch(r"[A-Za-z0-9+/]{43}=", str(t.get("executorPublicKey", ""))) or t.get("origin") != s.get("origin")
            or not _safe_int(t.get("expiresAt")) or t["expiresAt"] <= now_ms or t["expiresAt"] > now_ms + 300000 or s.get("maxUses") != 1):
        raise AgentKeyError("scope_mismatch")
    return ["AgentKey.deliveryTarget.v2", t["targetID"], t["executorPublicKey"], t["origin"], str(t["expiresAt"])]

def scope_binding(s, now_ms=None):
    now_ms = time.time() * 1000 if now_ms is None else now_ms
    if not isinstance(s, dict):
        raise AgentKeyError("scope_mismatch")
    if "auxOrigins" in s and (not isinstance(s["auxOrigins"], list) or len(s["auxOrigins"]) > 4 or not all(_valid_origin(o) for o in s["auxOrigins"])):
        raise AgentKeyError("scope_mismatch")
    aux = sorted(set(s.get("auxOrigins") or []))
    if "standingGrantID" in s:
        names = ["ownerID", "standingGrantID", "agentID", "executorID", "executorKeyID", "itemID"]
        if not all(isinstance(s.get(n), str) and UUID.match(s[n]) for n in names): raise AgentKeyError("scope_mismatch")
        if (not _safe_int(s.get("itemVersion")) or s["itemVersion"] < 1 or s.get("action") != "credential.fill" or not _valid_origin(s.get("origin"))
                or any(k in s for k in ("requestID", "expiresAt", "maxUses", "deliveryTarget"))):
            raise AgentKeyError("scope_mismatch")
        return "\n".join(["AgentKey.standing-envelope.v1", *[s[n].lower() for n in names], str(s["itemVersion"]), s["origin"], s["action"], *aux]).encode()
    if not all(isinstance(s.get(n), str) and UUID.match(s[n]) for n in NAMES): raise AgentKeyError("scope_mismatch")
    if (s.get("action") != "credential.fill" or not _valid_origin(s.get("origin")) or not _safe_int(s.get("itemVersion")) or not _safe_int(s.get("expiresAt"))
            or not _safe_int(s.get("maxUses")) or s["maxUses"] < 1 or s["maxUses"] > 3):
        raise AgentKeyError("scope_mismatch")
    if now_ms / 1000 >= s["expiresAt"]: raise AgentKeyError("inactive_grant")
    head = "AgentKey.envelope.v2" if s.get("deliveryTarget") else "AgentKey.envelope.v1"
    return "\n".join([head, *[s[n].lower() for n in NAMES], str(s["itemVersion"]), s["origin"], s["action"], str(s["expiresAt"]), str(s["maxUses"]), *aux, *_target_binding(s, now_ms)]).encode()

def _open_sealed(e, key, binding):
    peer = X25519PublicKey.from_public_bytes(_b64d(e["ephemeralPublicKey"]))
    shared = key.private_key.exchange(peer)
    k = HKDF(algorithm=hashes.SHA256(), length=32, salt=b"AgentKey.executor.v1", info=binding).derive(shared)
    c = _b64d(e["sealed"])
    if len(c) < 28: raise AgentKeyError("invalid_envelope")
    try:
        return json.loads(AESGCM(k).decrypt(c[:12], c[12:], binding))
    except Exception:
        raise AgentKeyError("scope_mismatch") from None

def open_session_envelope(encoded, pairing_id, key):
    binding = "\n".join(["AgentKey.deviceSession.v1", pairing_id.lower(), key.public_key_b64]).encode()
    e = json.loads(_b64d(encoded))
    if not isinstance(e, dict) or e.get("version") != 1: raise AgentKeyError("invalid_envelope")
    p = _open_sealed(e, key, binding)
    if p.get("pairing_id") != pairing_id or not isinstance(p.get("access_token"), str) or not isinstance(p.get("refresh_token"), str):
        raise AgentKeyError("invalid_envelope")
    return {"access_token": p["access_token"], "refresh_token": p["refresh_token"], "expires_at": p.get("expires_at") or 0}

def open_grant_envelope(encoded, scope, key):
    binding = scope_binding(scope)
    if not isinstance(encoded, str) or len(encoded) > 65536: raise AgentKeyError("invalid_envelope")
    e = json.loads(_b64d(encoded))
    if not isinstance(e, dict) or e.get("version") != (2 if scope.get("deliveryTarget") else 1): raise AgentKeyError("invalid_envelope")
    p = _open_sealed(e, key, binding)
    if (not isinstance(p, dict) or not p.get("scope") or scope_binding(p["scope"]) != binding or not isinstance(p.get("username"), str)
            or not isinstance(p.get("password"), str) or "session" in p):
        raise AgentKeyError("scope_mismatch")
    return {"username": p["username"], "password": p["password"]}

def _base(base_url):
    u = urlparse(base_url)
    if u.scheme != "https" or u.username or u.password or u.query or u.fragment or u.path.rstrip("/") not in ("", "/api/public/agentkey-api"):
        raise AgentKeyError("invalid_service")
    return f"https://{u.netloc}{u.path.rstrip('/')}"

class AgentKeyRuntime:
    def __init__(self, base_url=DEFAULT_BASE, key=None, session=None, on_session=None, opener=urlopen):
        self.base_url, self.key, self.session, self.on_session, self._open = _base(base_url), key, session, on_session, opener

    def _call(self, method, path, body=None, bearer=None):
        h = {}
        if bearer: h["Authorization"] = "Bearer " + bearer
        if body is not None: h["Content-Type"] = "application/json"
        req = Request(self.base_url + path, data=json.dumps(body).encode() if body is not None else None, method=method, headers=h)
        try:
            with self._open(req, timeout=15) as r:
                return json.loads(r.read() or b"{}")
        except HTTPError as e:
            try:
                j = json.loads(e.read() or b"{}")
            except Exception:
                j = {}
            raise AgentKeyError(str(j.get("code") or j.get("error") or "request_failed")[:80], j.get("help")) from None

    @classmethod
    def enroll(cls, agent_token, agent_id, base_url=DEFAULT_BASE, label=None, key=None, opener=urlopen, on_session=None):
        """Enroll a fresh runtime with the agent's own requester token. Returns (runtime, owner approval link)."""
        key = key or RuntimeKey.generate()
        rt = cls(base_url, key, None, on_session, opener)
        code = "".join(ALPHA[b % 36] for b in secrets.token_bytes(8))
        body = {"agent_id": agent_id, "code_hash": hashlib.sha256(code.encode()).hexdigest()}
        if label: body["label"] = label
        p = rt._call("POST", "/v1/executor/pairings", body, agent_token)
        red = rt._call("POST", "/v1/executor/redeem", {"code": code, "public_key": key.public_key_b64})
        rt.session = open_session_envelope(red["sealed_session"], red["pairing_id"], key)
        if on_session: on_session(rt.session)
        return rt, p.get("approval_url")

    def _token(self):
        if not self.session: raise AgentKeyError("not_enrolled")
        if self.session.get("expires_at") and self.session["expires_at"] * 1000 < time.time() * 1000 + 60000:
            self.session = self._call("POST", "/v1/executor/session/refresh", {"refresh_token": self.session["refresh_token"]})
            if self.on_session: self.on_session(self.session)
        return self.session["access_token"]

    def self_rows(self):
        rows = self._call("GET", "/v1/executor/self", None, self._token()).get("executors") or []
        return [e for e in rows if e.get("enabled") and e.get("public_key") == self.key.public_key_b64]

    def enrollment(self):
        rows = self.self_rows()
        if len(rows) != 1: raise AgentKeyError("executor_not_enabled")
        return rows[0]

    def wait_until_enabled(self, timeout=600, interval=3, sleep=time.sleep):
        end = time.monotonic() + timeout
        while True:
            rows = self.self_rows()
            if len(rows) == 1: return rows[0]
            if time.monotonic() > end: raise AgentKeyError("owner_approval_pending", "Still waiting for the owner to trust this agent browser.")
            sleep(interval)

    def register_target(self, origin, target_id=None, ttl_ms=300000):
        e = self.enrollment()
        target_id = target_id or secrets.token_hex(16)
        self._call("POST", "/v1/executor/targets", {"executor_id": e["executor_id"], "key_id": e["key_id"], "target_id": target_id, "origin": origin,
                                                     "expires_epoch_ms": int(time.time() * 1000) + min(ttl_ms, 300000)}, self._token())
        return {"target_id": target_id, "executor_id": e["executor_id"]}

    def complete(self, operation_id, outcome):
        return self._call("POST", f"/v1/executor/operations/{operation_id}/complete", {"outcome": outcome}, self._token())

    async def fill_operation(self, operation_id, page, verify=None, target_bound=False,
                             username_selector='input[autocomplete="username"],input[type="email"],input[name*="user" i],input[name*="email" i]',
                             password_selector='input[type="password"]', submit=True):
        """Claim one operation and fill it into the agent's EXISTING page. Fails closed unless the page origin matches the grant.
        Reports exactly one outcome; a submitted form is 'unknown' unless verify() confirms the signed-in state."""
        if not UUID.match(operation_id or ""): raise AgentKeyError("invalid_request")
        page_origin = _origin_of(page.url)
        claim = self._call("POST", f"/v1/executor/{'target-operations' if target_bound else 'operations'}/{operation_id}/claim", {}, self._token())
        cred, outcome, submitted, verification, failure = None, "failed", False, "not_requested", None
        try:
            if claim["scope"]["origin"] != page_origin or _origin_of(page.url) != page_origin:
                raise AgentKeyError("page_origin_mismatch")
            cred = open_grant_envelope(claim["encoded"], claim["scope"], self.key)
            pw = page.locator(password_selector)
            if await _a(pw.count()) != 1: raise AgentKeyError("login_form_ambiguous")
            user = page.locator(username_selector)
            uc = await _a(user.count())
            if uc > 1: raise AgentKeyError("login_form_ambiguous")
            if uc == 1: await _a(user.first.fill(cred["username"]))
            await _a(pw.fill(cred["password"]))
            cred = None
            if submit:
                submitted = True  # set before dispatch: a timeout may still have submitted
                await _a(pw.press("Enter"))
                if verify:
                    verification = "matched" if await _a(verify(page)) else "not_matched"
                    outcome = "completed" if verification == "matched" else "unknown"
                else:
                    outcome = "unknown"
            else:
                outcome = "completed"
        except Exception as e:
            failure = e
            outcome = "unknown" if submitted else "failed"
            if submitted and verify: verification = "unconfirmed"
        finally:
            cred = None
        self.complete(operation_id, outcome)  # exactly one completion attempt; never retry an uncertain submission
        if failure and not submitted: raise failure
        r = {"operation_id": operation_id, "outcome": outcome, "submitted": submitted, "verification": verification}
        if failure: r["code"] = "submission_unconfirmed"
        return r

def _origin_of(u):
    p = urlparse(str(u))
    return f"{p.scheme}://{p.netloc}"

def file_store(path):
    """Same file as the JS SDK: .agentkey/runtime.json ({key, session}), owner-only."""
    def load():
        try:
            with open(path, encoding="utf-8") as f: return json.load(f)
        except Exception:
            return None
    def save(v):
        os.makedirs(os.path.dirname(path), exist_ok=True)
        fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
        with os.fdopen(fd, "w", encoding="utf-8") as f: json.dump(v, f)
        try: os.chmod(path, 0o600)
        except OSError: pass
    return {"load": load, "save": save}
