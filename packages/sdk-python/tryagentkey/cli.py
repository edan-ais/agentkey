"""`tryagentkey status | permissions | revoke <id|site|--all> | forget <site> | secret set NAME VALUE | secret get NAME | doctor`.
Linking a cloud key: `npx tryagentkey link`."""
import argparse, json, platform, sys
from .core import agentkey
from .env import read_env, agentkey_home
from .local_vault import LocalVault
from urllib.parse import urlparse

def _site(u):
    p = urlparse(u)
    return f"{p.scheme}://{p.netloc}"

def main(argv=None):
    p = argparse.ArgumentParser(prog="tryagentkey")
    sub = p.add_subparsers(dest="cmd", required=True)
    sub.add_parser("status"); sub.add_parser("doctor"); sub.add_parser("permissions")
    rv = sub.add_parser("revoke"); rv.add_argument("target", help="permission id, https://site, or --all")
    fg = sub.add_parser("forget"); fg.add_argument("site")
    s = sub.add_parser("secret"); s.add_argument("action", choices=["set", "get", "list"]); s.add_argument("name", nargs="?"); s.add_argument("value", nargs="?")
    a = p.parse_args(argv)
    if a.cmd == "doctor":
        cfg = read_env()
        print(json.dumps({"os": platform.system(), "python": platform.python_version(), "mode": cfg["mode"] or ("cloud" if cfg["api_key"] else "local"), "home": str(agentkey_home()), "api_key_set": bool(cfg["api_key"])}, indent=2)); return 0
    if a.cmd == "permissions":
        ps = LocalVault().permissions()
        print("\n".join(f"{p['id']}  {p['origin']} · {p['project']} · {p['agent']} · {'until revoked' if p['kind'] == 'standing' and not p['expires_at'] else p['expires_at'] or str(p['max_uses'] - p['uses']) + ' use left'}" for p in ps) or "No permissions."); return 0
    if a.cmd == "revoke":
        t = "all" if a.target in ("--all", "all") else a.target if len(a.target) == 36 else _site(a.target)
        n = LocalVault().revoke(t); print(f"Revoked {n} permission(s)." if n else "Nothing matched."); return 0
    if a.cmd == "forget":
        LocalVault().forget(_site(a.site)); print("Deleted the saved login and its permissions."); return 0
    ak = agentkey(mode="local") if a.cmd == "secret" else agentkey()
    if a.cmd == "status":
        print(json.dumps(ak.status(), indent=2)); return 0
    if a.action == "set": ak.vault.set_secret(a.name, a.value); print("saved"); return 0
    if a.action == "list": print("\n".join(ak.vault.secret_names())); return 0
    v = ak.secret(a.name)
    if v is None: print("not found", file=sys.stderr); return 1
    print(v); return 0

if __name__ == "__main__":
    sys.exit(main())
