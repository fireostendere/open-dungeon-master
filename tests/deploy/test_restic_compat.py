"""Offline compatibility checks for both restic copy command generations."""
import unittest
from unittest.mock import patch
from test_ops import Fake, ops, seed
from pathlib import Path
import tempfile
import contextlib
import io

class ResticCompatibilityTests(unittest.TestCase):
    def setUp(self):
        self.temp=tempfile.TemporaryDirectory();self.root=Path(self.temp.name)/'odm';seed(self.root);self.c=Fake(self.root)
        self.output=contextlib.redirect_stdout(io.StringIO());self.output.__enter__()
    def tearDown(self):self.output.__exit__(None,None,None);self.temp.cleanup()
    def test_modern_restic_copy_uses_explicit_source(self):
        with patch.object(self.c,'run',return_value='copy --from-repo --from-password-file'):
            self.c.sync_remote()
        invocation=next(x for x in self.c.calls if x[0]=='restic' and x[1][0]=='copy')
        self.assertIn('--from-repo',invocation[1]);self.assertIn(str(self.root/'backups'),invocation[1])
        self.assertTrue((self.c.config_dir/'last-offsite.json').exists())
    def test_legacy_restic_copy_separates_source_destination_and_passwords(self):
        ops.write_json(self.c.config_dir/'remote.json',{'repository':'s3:https://example.test/backup','environment':{'AWS_ACCESS_KEY_ID':'fixture'}})
        with patch.object(self.c,'run',side_effect=['copy --repo2 --password-file2','']) as run:
            self.c.sync_remote()
        call=run.call_args;args=call.args[0]
        self.assertEqual(args[:4],['restic','-r',str(self.root/'backups'),'copy'])
        self.assertEqual(args[args.index('--repo2')+1],'s3:https://example.test/backup')
        self.assertEqual(args[args.index('--password-file2')+1],str(self.c.config_dir/'remote.password'))
        self.assertEqual(call.kwargs['env']['RESTIC_PASSWORD_FILE'],str(self.c.config_dir/'backup.password'))
        self.assertEqual(call.kwargs['env']['AWS_ACCESS_KEY_ID'],'fixture')
    def test_failed_legacy_copy_does_not_claim_success(self):
        ops.write_json(self.c.config_dir/'remote.json',{'repository':'fixture-offsite'})
        with patch.object(self.c,'run',side_effect=['--repo2',ops.OpsError('fixture copy failed')]),self.assertRaises(ops.OpsError):
            self.c.sync_remote()
        self.assertFalse((self.c.config_dir/'last-offsite.json').exists())

if __name__=='__main__':unittest.main()
