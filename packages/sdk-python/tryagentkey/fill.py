"""Fills a saved login into the builder's OWN Playwright page (sync or async). Same rules as the JS SDK:
success needs positive confirmation; an uncertain submission is 'unverified' and never retried."""
from urllib.parse import urlparse
from .confirm import SYNC, USER, PASS, _a, page_state, confirm_signed_in, wait_confirmed, wait_for, sleep  # noqa: F401

def _fail(code):
    return {"outcome": "failed", "filled": False, "code": code}

def _origin_of(u):
    p = urlparse(u)
    return f"{p.scheme}://{p.netloc}"

async def fill_login(page, take_credential, origin=None, verify=None, success_selector=None, on_handoff=None, handoff_timeout=300, settle=8):
    """take_credential(): called only right before typing, after re-checking the page origin."""
    signin_url = str(page.url)
    first = await page_state(page)
    if first == "blank":
        return _fail("blank_page")
    if first == "clear":
        c = await confirm_signed_in(page, verify=verify, success_selector=success_selector, submitted=False) if (verify or success_selector) else None
        return {"outcome": "completed", "filled": False, "confirmed_by": c} if c else _fail("no_login_form")
    same = lambda: (not origin) or _origin_of(str(page.url)) == origin
    box = {}
    def cred():
        if "c" not in box:
            box["c"] = take_credential()
        return box["c"]
    filled = False
    try:
        for _ in range(3):
            if filled: break
            st = await page_state(page)
            if st in ("challenge", "blank", "clear"): break
            if not same(): return _fail("page_origin_mismatch")
            users = await _a(page.query_selector_all(USER))
            if len(users) > 1 and st != "login_form": return _fail("login_form_ambiguous")
            if users and cred().get("username"):
                await _a(users[0].fill(cred()["username"]))
            if st == "login_form":
                pw = await _a(page.query_selector_all(PASS))
                if len(pw) != 1: return _fail("login_form_ambiguous")
                if not same(): return _fail("page_origin_mismatch")
                await _a(pw[0].fill(cred()["password"])); await _a(pw[0].press("Enter")); filled = True
            else:
                await _a(users[0].press("Enter"))
                await wait_for(lambda: _ne(page, "username_step"), settle)
    finally:
        box.clear()
    if not filled and await page_state(page) != "challenge":
        return _fail("login_form_unsupported")
    opts = dict(verify=verify, success_selector=success_selector, signin_url=signin_url, submitted=True)
    async def done():
        return bool(await confirm_signed_in(page, **opts)) or (await page_state(page)) == "challenge"
    await wait_for(done, settle)
    c = await confirm_signed_in(page, **opts)
    if c:
        return {"outcome": "completed", "filled": True, "confirmed_by": c}
    if await page_state(page) == "challenge":
        if on_handoff: await _a(on_handoff(page))
        c = await wait_confirmed(page, handoff_timeout, 0.5, **opts)
        return {"outcome": "completed", "filled": True, "handoff": True, "confirmed_by": c} if c else {"outcome": "needs_you", "filled": True, "code": "handoff_timeout"}
    return {"outcome": "unverified", "filled": True, "code": "login_unconfirmed"}

async def _ne(page, st):
    return (await page_state(page)) != st
