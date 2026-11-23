"""Local single-use Approve page on 127.0.0.1 (same protections as the JS SDK). The human types the
login here, never in the agent. Host must be this loopback address, a cross-site Origin is refused,
the form carries a one-time nonce, and the page closes after 5 bad submissions."""
import hmac, html, secrets, threading, webbrowser
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import parse_qs, urlparse

STYLE = "<style>:root{color-scheme:light dark}body{font:16px/1.5 system-ui,sans-serif;max-width:440px;margin:48px auto;padding:0 20px}input,button{display:block;width:100%;box-sizing:border-box;margin:8px 0;padding:12px;border-radius:8px;border:1px solid #8886;font:inherit}input[type=radio]{display:inline;width:auto;margin:0 6px 0 0}button{background:CanvasText;color:Canvas;font-weight:600}.muted{opacity:.7;font-size:14px}dl{font-size:14px}dt{opacity:.7}dd{margin:0 0 6px}</style>"
HEADERS = {"Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store", "X-Frame-Options": "DENY", "Referrer-Policy": "no-referrer",
           "Content-Security-Policy": "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; frame-ancestors 'none'; base-uri 'none'"}

def approve(origin, agent_name="your agent", on_link=None, mode="save", project="", timeout=600, open_browser=True, max_attempts=5):
    """mode 'save' -> {'username','password','duration'}; 'allow' -> {'approved': True, 'duration'}; None if denied/timed out."""
    token, nonce, result, done = secrets.token_hex(16), secrets.token_hex(16), {}, threading.Event()
    state = {"attempts": 0, "port": 0}
    e = html.escape
    host = urlparse(origin).netloc if origin else ""
    scope = f"<dl><dt>Agent</dt><dd>{e(agent_name)}</dd>" + (f"<dt>Project folder</dt><dd>{e(project)}</dd>" if project else "") + f"<dt>Website</dt><dd>{e(host)}</dd></dl>"
    dur = '<p class=muted>How long</p><label><input type=radio name=duration value=standing checked>Until I revoke it</label><label><input type=radio name=duration value=once>Only this time</label>'
    deny = f'<form method=post><input type=hidden name=nonce value="{nonce}"><input type=hidden name=deny value=1><button style="background:transparent;color:CanvasText">Deny</button></form>'
    if mode == "allow":
        body = f"<h1>Let {e(agent_name)} use your saved {e(host)} login?</h1>{scope}<p class=muted>{e(agent_name)} never sees the password. Revoke any time with <code>tryagentkey revoke</code>.</p><form method=post><input type=hidden name=nonce value=\"{nonce}\">{dur}<button>Allow</button></form>{deny}"
    else:
        body = f"<h1>Let {e(agent_name)} sign in to {e(host)}?</h1>{scope}<p class=muted>Saved only on this computer, locked to it. {e(agent_name)} never sees the password.</p><form method=post><input type=hidden name=nonce value=\"{nonce}\"><input name=username autocomplete=username placeholder=\"Username or email\"><input name=password type=password autocomplete=current-password placeholder=Password required>{dur}<button>Approve</button></form>{deny}"
    page = lambda b: f"<!doctype html><html lang=en><meta charset=utf-8><meta name=viewport content=\"width=device-width,initial-scale=1\"><title>AgentKey — Approve</title>{STYLE}{b}</html>"

    class H(BaseHTTPRequestHandler):
        def log_message(self, *a):
            pass
        def _send(self, code, b=""):
            self.send_response(code)
            for k, v in HEADERS.items(): self.send_header(k, v)
            self.end_headers(); self.wfile.write(b.encode())
        def _ok_target(self):
            return not done.is_set() and self.headers.get("Host") == f"127.0.0.1:{state['port']}" and self.path == "/approve/" + token
        def do_GET(self):
            if not self._ok_target(): return self._send(404, "Not found")
            self._send(200, page(body))
        def do_POST(self):
            if not self._ok_target(): return self._send(404, "Not found")
            o = self.headers.get("Origin")
            if o and o != "null" and o != f"http://127.0.0.1:{state['port']}": return self._send(403)
            n = int(self.headers.get("Content-Length") or 0)
            if n > 8192: return self._send(413)
            f = {k: v[0] for k, v in parse_qs(self.rfile.read(n).decode()).items()}
            def bad(msg):
                state["attempts"] += 1
                if state["attempts"] >= max_attempts:
                    done.set(); return self._send(400, page("<h1>Too many tries.</h1><p class=muted>This link is closed. Run your agent again for a new one.</p>"))
                self._send(400, page(f"<h1>{msg}</h1><p><a href=\"\">Try again</a></p>"))
            if not hmac.compare_digest(f.get("nonce", ""), nonce): return bad("This page expired.")
            if f.get("deny"):
                done.set(); return self._send(200, page("<h1>Denied.</h1><p class=muted>You can close this tab.</p>"))
            if mode == "save" and not f.get("password"): return bad("Password needed.")
            d = "once" if f.get("duration") == "once" else "standing"
            result.update({"username": f.get("username", ""), "password": f["password"], "duration": d} if mode == "save" else {"approved": True, "duration": d})
            done.set()
            self._send(200, page("<h1>Approved.</h1><p class=muted>You can close this tab — your agent is continuing.</p>"))

    srv = ThreadingHTTPServer(("127.0.0.1", 0), H)
    state["port"] = srv.server_address[1]
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    url = f"http://127.0.0.1:{state['port']}/approve/{token}"
    (on_link or (lambda u: print(f"\nAgentKey: approve {host}\n  here is your link → {u}\n")))(url)
    if open_browser:
        try:
            webbrowser.open(url)  # Windows, macOS and Linux
        except Exception:
            pass
    done.wait(timeout)
    srv.shutdown(); srv.server_close()
    return dict(result) or None
