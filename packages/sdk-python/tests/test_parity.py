import json, os, subprocess, tempfile, threading, unittest, io
from http.server import BaseHTTPRequestHandler, HTTPServer
from pathlib import Path
import sys; sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from tryagentkey import encode_api_key, decode_api_key, LocalVault, agentkey, AgentKeyError
from tryagentkey.mcp_server import handler

ROOT = Path(__file__).resolve().parents[3]
SIGN = {"url": "https://x.supabase.co/auth/v1/token?grant_type=password", "email": "a@agentkey.invalid", "password": "p", "apikey": "k"}

def node(code, env=None):
    return subprocess.check_output(["node", "--input-type=module", "-e", code], cwd=ROOT, env={**os.environ, **(env or {})}, text=True).strip()

class Keys(unittest.TestCase):
    def test_js_key_decodes_in_python(self):
        k = node(f"import {{encodeApiKey}} from './packages/sdk/auto.mjs';process.stdout.write(encodeApiKey({{agent_id:'A',sign_in:{json.dumps(SIGN)}}}))")
        self.assertEqual(decode_api_key(k)["agent_id"], "A")
    def test_python_key_decodes_in_js(self):
        k = encode_api_key("B", SIGN)
        self.assertEqual(node(f"import {{decodeApiKey}} from './packages/sdk/auto.mjs';process.stdout.write(decodeApiKey('{k}').agent_id)"), "B")
    def test_bad_key(self):
        with self.assertRaises(AgentKeyError): decode_api_key("nope")

class Vault(unittest.TestCase):
    def test_vault_shared_with_js(self):
        home = tempfile.mkdtemp()
        node("import {openVault} from './packages/sdk/local/vault.mjs';openVault(process.env.H).setSecret('OPENAI','sk-1')", {"H": home})
        v = LocalVault(home); self.assertEqual(v.get_secret("OPENAI"), "sk-1")
        v.put_login("https://example.com", "me", "pw")
        out = node("import {openVault} from './packages/sdk/local/vault.mjs';process.stdout.write(JSON.stringify(openVault(process.env.H).sites()))", {"H": home})
        self.assertEqual(json.loads(out)[0]["username"], "me")
        self.assertNotIn("pw", out)
    def test_status_never_has_passwords(self):
        home = tempfile.mkdtemp(); LocalVault(home).put_login("https://e.com", "u", "secret-pw")
        ak = agentkey(mode="local", home=home)
        self.assertNotIn("secret-pw", json.dumps(ak.status()))

class Mcp(unittest.TestCase):
    def test_lifecycle(self):
        class C:
            def use(self, grant_id, **_):
                if grant_id.startswith("2"): raise AgentKeyError("grant_denied")
                return {"operation_id": "o", "status": "awaiting_existing_browser"}
        h = handler(C())
        self.assertEqual(h({"jsonrpc": "2.0", "id": 1, "method": "tools/list"})["error"]["code"], -32000)
        h({"jsonrpc": "2.0", "id": 1, "method": "initialize", "params": {"protocolVersion": "2025-06-18"}}); h({"jsonrpc": "2.0", "method": "notifications/initialized"})
        args = lambda g: {"grant_id": g, "origin": "https://github.com", "executor_key_id": "7" * 8, "idempotency_key": "k"}
        self.assertFalse(h({"jsonrpc": "2.0", "id": 2, "method": "tools/call", "params": {"name": "agentkey_use", "arguments": args("1")}})["result"]["isError"])
        self.assertTrue(h({"jsonrpc": "2.0", "id": 3, "method": "tools/call", "params": {"name": "agentkey_use", "arguments": args("2")}})["result"]["isError"])

LOGIN = b"""<!doctype html><form method=post action=/done><input name=user autocomplete=username><input type=password name=pw><button>Go</button></form>"""
class Site(BaseHTTPRequestHandler):
    def log_message(self, *a): pass
    def do_GET(self): self.send_response(200); self.end_headers(); self.wfile.write(LOGIN)
    def do_POST(self):
        b = self.rfile.read(int(self.headers["Content-Length"])).decode()
        Site.got = b; self.send_response(200); self.end_headers(); self.wfile.write(b"<h1>Welcome</h1>")

class LocalLogin(unittest.TestCase):
    def test_approve_then_fill_own_page(self):
        try:
            from playwright.sync_api import sync_playwright
        except ImportError:
            self.skipTest("playwright not installed")
        srv = HTTPServer(("127.0.0.1", 0), Site); threading.Thread(target=srv.serve_forever, daemon=True).start()
        url = f"http://127.0.0.1:{srv.server_address[1]}/login"
        ak = agentkey(mode="local", home=tempfile.mkdtemp(), approve=lambda o, n, l, **k: {"username": "me", "password": "pw-123", "duration": "standing"})
        with sync_playwright() as p:
            b = p.chromium.launch(headless=True); page = b.new_page()
            r = ak.login(url, page=page, verify=lambda p: p.locator("h1").inner_text() == "Welcome"); b.close()
        srv.shutdown()
        self.assertEqual(r["outcome"], "completed"); self.assertTrue(r["signed_in"]); self.assertNotIn("pw-123", json.dumps(r))
        self.assertIn("pw=pw-123", Site.got)

if __name__ == "__main__":
    unittest.main()
