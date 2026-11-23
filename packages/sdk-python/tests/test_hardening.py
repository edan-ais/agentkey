"""Scoped permissions, positive confirmation, approval-page protections and the hosted (cloud) login flow."""
import base64, json, os, subprocess, tempfile, threading, time, unittest, uuid, http.client
from http.server import BaseHTTPRequestHandler, HTTPServer
from pathlib import Path
from urllib.error import HTTPError
import sys; sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from tryagentkey import agentkey, LocalVault, encode_api_key, AgentKeyError
from tryagentkey.core import project_scope
from tryagentkey.approve import approve
from tryagentkey.runtime import RuntimeKey, scope_binding, open_grant_envelope
from cryptography.hazmat.primitives.asymmetric.x25519 import X25519PrivateKey, X25519PublicKey
from cryptography.hazmat.primitives.kdf.hkdf import HKDF
from cryptography.hazmat.primitives.ciphers.aead import AESGCM
from cryptography.hazmat.primitives import hashes, serialization

ROOT = Path(__file__).resolve().parents[3]
def node(code, env=None):
    return subprocess.check_output(["node", "--input-type=module", "-e", code], cwd=ROOT, env={**os.environ, **(env or {})}, text=True).strip()

try:
    from playwright.sync_api import sync_playwright
except ImportError:
    sync_playwright = None

PW = "pw-123"
FORM = b"<!doctype html><form method=post action=/done><input name=user autocomplete=username><input type=password name=pw><button>Go</button></form>"
class Site(BaseHTTPRequestHandler):
    def log_message(self, *a): pass
    def _html(self, b): self.send_response(200); self.send_header("Content-Type", "text/html"); self.end_headers(); self.wfile.write(b)
    def do_GET(self):
        if self.path == "/blank": return self._html(b"")
        if self.path == "/about": return self._html(b"<h1>About</h1><p>No form here.</p>")
        self._html(FORM)
    def do_POST(self):
        b = self.rfile.read(int(self.headers["Content-Length"])).decode()
        self._html(b"<h1>Welcome</h1><a href=/logout>Sign out</a>" if f"pw={PW}" in b else b"Wrong password" + FORM)

def site():
    srv = HTTPServer(("127.0.0.1", 0), Site); threading.Thread(target=srv.serve_forever, daemon=True).start()
    return srv, f"http://127.0.0.1:{srv.server_address[1]}"

def approver(calls, password=PW, duration="standing"):
    def f(o, n, l, mode="save", project=""):
        calls.append(mode)
        return {"username": "me", "password": password, "duration": duration} if mode == "save" else {"approved": True, "duration": duration}
    return f

@unittest.skipIf(sync_playwright is None, "playwright not installed")
class PositiveConfirmation(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.srv, cls.url = site(); cls.p = sync_playwright().start(); cls.b = cls.p.chromium.launch(headless=True)
    @classmethod
    def tearDownClass(cls):
        cls.b.close(); cls.p.stop(); cls.srv.shutdown()
    def ak(self, calls, home=None, cwd=None, **k):
        return agentkey(mode="local", home=home or tempfile.mkdtemp(), cwd=cwd or tempfile.mkdtemp(), approve=approver(calls, **k))
    def test_signed_in_needs_evidence(self):
        r = self.ak([]).login(self.url + "/login", page=self.b.new_page())
        self.assertTrue(r["signed_in"]); self.assertEqual(r["confirmed_by"], "sign_out_control")
    def test_wrong_password_is_unverified(self):
        r = self.ak([], password="nope").login(self.url + "/login", page=self.b.new_page())
        self.assertFalse(r["signed_in"]); self.assertEqual(r["outcome"], "unverified")
    def test_blank_and_unsupported_pages_fail(self):
        ak = self.ak([])
        self.assertEqual(ak.login(self.url + "/blank", page=self.b.new_page())["code"], "blank_page")
        self.assertEqual(ak.login(self.url + "/about", page=self.b.new_page())["code"], "no_login_form")
    def test_scoped_reuse_and_revoke(self):
        home, cwd, calls = tempfile.mkdtemp(), tempfile.mkdtemp(), []
        r = self.ak(calls, home, cwd).login(self.url + "/login", page=self.b.new_page()); self.assertTrue(r["signed_in"])
        self.ak(calls, home, cwd).login(self.url + "/login", page=self.b.new_page()); self.assertEqual(calls, ["save"], "standing permission reused")
        self.ak(calls, home).login(self.url + "/login", page=self.b.new_page()); self.assertEqual(calls, ["save", "allow"], "other project asks once, no retyping")
        # Revoke from the JS CLI code path; the Python agent sees it at once.
        node("import {openVault} from './packages/sdk/local/vault.mjs';openVault(process.env.H).revoke(process.env.P)", {"H": home, "P": r["permission_id"]})
        self.ak(calls, home, cwd).login(self.url + "/login", page=self.b.new_page()); self.assertEqual(calls[-1], "allow")
    def test_only_this_time(self):
        home, cwd, calls = tempfile.mkdtemp(), tempfile.mkdtemp(), []
        self.ak(calls, home, cwd, duration="once").login(self.url + "/login", page=self.b.new_page())
        self.assertEqual(LocalVault(home).permissions(), [])

class Scope(unittest.TestCase):
    def test_project_scope_matches_js(self):
        d = tempfile.mkdtemp()
        js = json.loads(node("import {projectScope} from './packages/sdk/local/index.mjs';process.stdout.write(JSON.stringify(projectScope(process.env.D)))", {"D": d}))
        self.assertEqual(js, project_scope(d))
    def test_permission_written_by_python_is_honoured_by_js(self):
        home = tempfile.mkdtemp(); v = LocalVault(home); v.put_login("https://a.example", "u", "secret-pw")
        g = v.grant("https://a.example", "p1", "bot", project="x")
        out = node("import {openVault} from './packages/sdk/local/vault.mjs';const v=openVault(process.env.H);process.stdout.write(JSON.stringify([v.findPermission({origin:'https://a.example',project_id:'p1',agent:'bot'}),v.findPermission({origin:'https://a.example',project_id:'p2',agent:'bot'})]))", {"H": home})
        a, b = json.loads(out); self.assertEqual(a["id"], g["id"]); self.assertIsNone(b); self.assertNotIn("secret-pw", out)
        v.put_login("https://a.example", "u", "changed"); self.assertIsNone(v.find_permission("https://a.example", "p1", "bot"))

class ApprovePage(unittest.TestCase):
    def test_protections(self):
        links, res = [], {}
        t = threading.Thread(target=lambda: res.update(r=approve("https://a.example", "Bot", links.append, open_browser=False, timeout=10))); t.start()
        while not links: time.sleep(0.01)
        u = links[0]; port = int(u.split(":")[2].split("/")[0]); path = "/" + u.split("/", 3)[3]
        def req(method, headers=None, body=""):
            c = http.client.HTTPConnection("127.0.0.1", port); c.request(method, path, body=body, headers=headers or {}); s = c.getresponse().status; c.close(); return s
        self.assertEqual(req("GET", {"Host": "evil.example"}), 404)
        self.assertEqual(req("POST", {"Origin": "https://evil.example", "Content-Type": "application/x-www-form-urlencoded"}, "password=x"), 403)
        for _ in range(5): self.assertEqual(req("POST", {"Content-Type": "application/x-www-form-urlencoded"}, "password=x"), 400)
        t.join(5); self.assertIsNone(res["r"])

# ---------- hosted (cloud) flow ----------
A, EX, KY, RQ, GR, OP = (str(uuid.UUID(int=i, version=4)) for i in range(1, 7))
def seal(binding, payload, pub_b64):
    eph = X25519PrivateKey.generate()
    shared = eph.exchange(X25519PublicKey.from_public_bytes(base64.b64decode(pub_b64)))
    k = HKDF(algorithm=hashes.SHA256(), length=32, salt=b"AgentKey.executor.v1", info=binding).derive(shared)
    iv = os.urandom(12); ct = AESGCM(k).encrypt(iv, json.dumps(payload).encode(), binding)
    raw = eph.public_key().public_bytes(serialization.Encoding.Raw, serialization.PublicFormat.Raw)
    return lambda v: base64.b64encode(json.dumps({"version": v, "ephemeralPublicKey": base64.b64encode(raw).decode(), "sealed": base64.b64encode(iv + ct).decode()}).encode()).decode()

class CloudWorld:
    def __init__(self):
        self.calls, self.pub, self.target, self.outcome = [], None, None, None
    def __call__(self, req, timeout=None, **kw):
        u, m = req.full_url, req.get_method(); body = json.loads(req.data) if req.data else None
        path = u.split("/api/public/agentkey-api", 1)[-1] if "/api/public/agentkey-api" in u else u
        self.calls.append((m, path))
        def ok(j):
            class R:
                def __enter__(s): return s
                def __exit__(s, *a): return False
                def read(s): return json.dumps(j).encode()
            return R()
        if "auth/v1/token" in u: return ok({"access_token": "agent-token", "expires_in": 3600})
        if path == "/v1/executor/pairings":
            assert req.headers["Authorization"] == "Bearer agent-token"; return ok({"approval_url": "https://agentkey.waiwiser.com/extension/pair?pairing=" + A, "pairing_id": A})
        if path == "/v1/executor/redeem":
            self.pub = body["public_key"]; b = "\n".join(["AgentKey.deviceSession.v1", A, self.pub]).encode()
            return ok({"pairing_id": A, "sealed_session": seal(b, {"pairing_id": A, "access_token": "rt-token", "refresh_token": "r", "expires_at": int(time.time()) + 3600}, self.pub)(1)})
        if path == "/v1/executor/self": return ok({"executors": [{"enabled": True, "public_key": self.pub, "executor_id": EX, "key_id": KY}]})
        if path == "/v1/executor/targets": self.target = body["target_id"]; return ok({"target": {}})
        if path == "/v2/target-requests": return ok({"request_id": RQ, "status": "pending", "request_url": "https://agentkey.waiwiser.com/r/" + RQ})
        if path == "/v1/requests/" + RQ: return ok({"request_id": RQ, "state": "approved", "grant_id": GR, "executor_key_id": KY})
        if path == f"/v1/grants/{GR}/use": return ok({"operation_id": OP, "status": "awaiting_existing_browser"})
        if path == f"/v1/executor/target-operations/{OP}/claim":
            assert req.headers["Authorization"] == "Bearer rt-token"
            now = int(time.time() * 1000)
            scope = {"ownerID": A, "requestID": RQ, "agentID": A, "executorID": EX, "executorKeyID": KY, "itemID": A, "itemVersion": 1, "origin": "https://site.example",
                     "action": "credential.fill", "expiresAt": now // 1000 + 300, "maxUses": 1,
                     "deliveryTarget": {"version": 2, "targetID": self.target, "executorPublicKey": self.pub, "origin": "https://site.example", "expiresAt": now + 200000}}
            return ok({"scope": scope, "encoded": seal(scope_binding(scope), {"scope": scope, "username": "me", "password": PW}, self.pub)(2)})
        if path == f"/v1/executor/operations/{OP}/complete": self.outcome = body["outcome"]; return ok({"recorded": True})
        raise HTTPError(u, 404, "nope", {}, None)

SIGN = {"url": "https://auth.example/auth/v1/token?grant_type=password", "email": "a@agentkey.invalid", "password": "agent-pw", "apikey": "pub"}

class RuntimeCrypto(unittest.TestCase):
    def test_key_export_is_js_compatible(self):
        k = RuntimeKey.generate(); ex = k.export()
        out = node("import {importRuntimeKey} from './packages/agentkey-runtime/index.mjs';const k=await importRuntimeKey(JSON.parse(process.env.K));process.stdout.write(k.publicKeyB64)", {"K": json.dumps(ex)})
        self.assertEqual(out, k.public_key_b64)
        self.assertEqual(RuntimeKey.load(ex).public_key_b64, k.public_key_b64)
    def test_binding_matches_js(self):
        now = int(time.time())
        s = {"ownerID": A, "requestID": RQ, "agentID": A, "executorID": EX, "executorKeyID": KY, "itemID": A, "itemVersion": 3, "origin": "https://site.example",
             "action": "credential.fill", "expiresAt": now + 300, "maxUses": 1, "auxOrigins": ["https://b.example", "https://a.example"]}
        js = node("import {scopeBinding} from './packages/agentkey-runtime/index.mjs';process.stdout.write(Buffer.from(scopeBinding(JSON.parse(process.env.S))).toString('base64'))", {"S": json.dumps(s)})
        self.assertEqual(base64.b64decode(js), scope_binding(s))
        st = {"ownerID": A, "standingGrantID": GR, "agentID": A, "executorID": EX, "executorKeyID": KY, "itemID": A, "itemVersion": 1, "origin": "https://site.example", "action": "credential.fill"}
        js = node("import {scopeBinding} from './packages/agentkey-runtime/index.mjs';process.stdout.write(Buffer.from(scopeBinding(JSON.parse(process.env.S))).toString('base64'))", {"S": json.dumps(st)})
        self.assertEqual(base64.b64decode(js), scope_binding(st))
    def test_wrong_scope_cannot_open(self):
        k = RuntimeKey.generate(); now = int(time.time())
        s = {"ownerID": A, "requestID": RQ, "agentID": A, "executorID": EX, "executorKeyID": KY, "itemID": A, "itemVersion": 1, "origin": "https://site.example", "action": "credential.fill", "expiresAt": now + 300, "maxUses": 1}
        enc = seal(scope_binding(s), {"scope": s, "username": "u", "password": "p"}, k.public_key_b64)(1)
        self.assertEqual(open_grant_envelope(enc, s, k)["password"], "p")
        with self.assertRaises(AgentKeyError): open_grant_envelope(enc, {**s, "origin": "https://evil.example"}, k)

@unittest.skipIf(sync_playwright is None, "playwright not installed")
class HostedLogin(unittest.TestCase):
    def run_login(self, password_ok=True, verify=None):
        world, links, cwd = CloudWorld(), [], tempfile.mkdtemp()
        ak = agentkey(mode="cloud", api_key=encode_api_key(A, SIGN), cwd=cwd, opener=world, on_link=lambda u, w: links.append(w), poll=0.01)
        with sync_playwright() as p:
            b = p.chromium.launch(headless=True); page = b.new_page()
            def handle(route):
                r = route.request
                if r.method == "POST":
                    good = password_ok and f"pw={PW}" in (r.post_data or "")
                    return route.fulfill(status=200, content_type="text/html", body="<h1>Home</h1><a href=/logout>Sign out</a>" if good else "Wrong" + FORM.decode())
                route.fulfill(status=200, content_type="text/html", body=FORM.decode())
            page.route("https://site.example/**", handle)
            r = ak.login("https://site.example/login", page=page, **({"verify": verify} if verify else {}))
            b.close()
        return r, world, links, cwd
    def test_one_call_signs_in_and_reports_completed(self):
        r, world, links, cwd = self.run_login()
        self.assertTrue(r["signed_in"]); self.assertEqual(world.outcome, "completed"); self.assertNotIn(PW, json.dumps(r))
        self.assertEqual(links, ["trust this agent browser once", "approve sign-in to site.example"])
        saved = json.loads(Path(cwd, ".agentkey", "runtime.json").read_text())
        self.assertEqual(oct(Path(cwd, ".agentkey", "runtime.json").stat().st_mode & 0o777), "0o600")
        self.assertEqual(saved["key"]["publicKeyB64"], world.pub)
    def test_unconfirmed_submission_is_unknown_not_success(self):
        r, world, _, _ = self.run_login(password_ok=False)
        self.assertFalse(r["signed_in"]); self.assertEqual(world.outcome, "unknown")

if __name__ == "__main__":
    unittest.main()
