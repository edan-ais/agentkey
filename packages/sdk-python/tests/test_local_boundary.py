import sys,tempfile,unittest
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
from tryagentkey import agentkey
class Boundary(unittest.TestCase):
 def test_public_vault_has_no_website_credential_read_methods(self):
  ak=agentkey(mode='local',home=tempfile.mkdtemp())
  for name in ['reload','_read','_use_credential','put_login','grant','_data','_key']:
   self.assertFalse(hasattr(ak.vault,name),name)
  self.assertEqual(ak.vault.sites(),[])
  self.assertEqual(ak.vault.permissions(),[])
  ak.vault.set_secret('TEST_NAMED_SECRET','test-value')
  self.assertEqual(ak.vault.get_secret('TEST_NAMED_SECRET'),'test-value')
  self.assertEqual(ak.status()['secrets'],['TEST_NAMED_SECRET'])
if __name__=='__main__':unittest.main()
