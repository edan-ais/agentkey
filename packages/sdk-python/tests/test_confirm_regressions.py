import asyncio, unittest
import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "tryagentkey"))
from confirm import confirm_signed_in
class Handle:
 def __init__(self,text):self.text=text
 def is_visible(self):return True
 def evaluate(self,*a):return self.text
class Page:
 def __init__(self,url,text='Public page',sign_out=False,challenge=False,selector=False):
  self.url,self.text,self.sign_out,self.challenge,self.selector=url,text,sign_out,challenge,selector
 def evaluate(self,*a):return self.text
 def query_selector_all(self,s):
  if 'captcha' in s:return [Handle('challenge')] if self.challenge else []
  if 'logout' in s:return [Handle('Sign out')] if self.sign_out else []
  if s=='[data-authenticated]':return [Handle('Account')] if self.selector else []
  return []
class Confirmation(unittest.TestCase):
 def check(self,page,**opts):return asyncio.run(confirm_signed_in(page,**opts))
 def test_public_redirects_never_prove_login(self):
  for url in ['https://site.example/home','https://site.example/help','https://site.example/?error=denied','https://other.example/welcome']:
   with self.subTest(url=url):self.assertIsNone(self.check(Page(url),signin_url='https://site.example/login'))
 def test_explicit_verifier(self):self.assertEqual(self.check(Page('https://site.example/home'),verify=lambda _:True),'verify')
 def test_false_verifier(self):self.assertIsNone(self.check(Page('https://site.example/home',sign_out=True),verify=lambda _:False))
 def test_selector(self):self.assertEqual(self.check(Page('https://site.example/home',selector=True),success_selector='[data-authenticated]'),'success_selector')
 def test_sign_out(self):self.assertEqual(self.check(Page('https://site.example/home',sign_out=True)),'sign_out_control')
 def test_challenge_or_blank(self):
  self.assertIsNone(self.check(Page('https://site.example/home',sign_out=True,challenge=True)))
  self.assertIsNone(self.check(Page('https://site.example/home',text='',sign_out=True)))
if __name__=='__main__':unittest.main()
