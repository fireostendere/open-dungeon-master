"""Fault injection around real filesystem swaps; service calls are simulated here."""
from pathlib import Path
import os
import unittest
from unittest.mock import patch

import test_ops as fixtures

ops = fixtures.ops


class RecoveryTransactions(unittest.TestCase):
    setUp = fixtures.OpsTests.setUp
    tearDown = fixtures.OpsTests.tearDown

    def snapshot_source(self):
        snapshot = self.c.backup()
        return self.c.saved[snapshot]

    def test_restart_recovers_when_crash_left_no_live_state_directory(self):
        snapshot = self.c.backup()
        active = self.c.active()
        ops.write_json(self.c.config_dir / 'transaction.json',
                       {'old': active, 'target': active, 'snapshot': snapshot})
        displaced = self.root / 'state-before-restore-interrupted'
        os.replace(self.root / 'state', displaced)
        self.c.running = False
        self.c.start()
        self.assertEqual((self.root / 'state/data/local-roleplay.sqlite').read_text(),
                         'characters and campaign before update')
        self.assertTrue(displaced.exists(), 'Never delete the displaced original state')
        self.assertFalse((self.c.config_dir / 'transaction.json').exists())
        self.assertTrue(self.c.probe())

    def test_copy_failure_keeps_original_state_and_credentials(self):
        source = self.snapshot_source()
        before = (self.c.config_dir / 'app.env').read_bytes()
        original_copy = ops.shutil.copytree
        def fail_copy(src, dst, *args, **kwargs):
            if Path(src) == source / 'state':
                Path(dst).mkdir(parents=True, exist_ok=True)
                (Path(dst) / 'partial').write_text('incomplete')
                raise OSError('simulated disk full')
            return original_copy(src, dst, *args, **kwargs)
        with patch.object(ops.shutil, 'copytree', side_effect=fail_copy):
            with self.assertRaises(OSError):
                self.c.replace_state(source)
        self.assertEqual((self.c.config_dir / 'app.env').read_bytes(), before)
        self.assertEqual((self.root / 'state/data/local-roleplay.sqlite').read_text(),
                         'characters and campaign before update')
        self.assertFalse(list(self.root.glob('.state-candidate-*')))

    def test_credential_write_failure_rolls_back_database_key_and_admin_together(self):
        source = self.snapshot_source()
        env = self.c.config_dir / 'app.env'
        admin = self.c.config_dir / 'admin.json'
        before = {p: p.read_bytes() for p in (env, admin)}
        ops.atomic(source / 'config/app.env', 'DB_ENCRYPTION_KEY=other-backup-key\n')
        ops.write_json(source / 'config/admin.json', {'username': 'older', 'password': 'older-password'})
        original_atomic = ops.atomic
        failed = False
        def fail_once(path, data, *args, **kwargs):
            nonlocal failed
            if Path(path) == admin and not failed:
                failed = True
                raise OSError('simulated credential write failure')
            return original_atomic(path, data, *args, **kwargs)
        with patch.object(ops, 'atomic', side_effect=fail_once):
            with self.assertRaises(OSError):
                self.c.replace_state(source)
        for path, content in before.items():
            self.assertEqual(path.read_bytes(), content)
        self.assertEqual((self.root / 'state/data/local-roleplay.sqlite').read_text(),
                         'characters and campaign before update')

    def test_failed_restore_readiness_returns_current_admin_file(self):
        snapshot = self.c.backup()
        env = self.c.config_dir / 'app.env'
        admin = self.c.config_dir / 'admin.json'
        ops.atomic(env, 'DB_ENCRYPTION_KEY=current-key\n')
        ops.write_json(admin, {'username': 'current', 'password': 'current-password'})
        before = {p: p.read_bytes() for p in (env, admin)}
        (self.root / 'state/data/local-roleplay.sqlite').write_text('current campaign')
        with patch.object(self.c, 'wait_ready', side_effect=[ops.OpsError('candidate failed'), None, None]):
            with self.assertRaises(ops.OpsError):
                self.c.restore(snapshot, yes=True)
        for path, content in before.items():
            self.assertEqual(path.read_bytes(), content)
        self.assertEqual((self.root / 'state/data/local-roleplay.sqlite').read_text(), 'current campaign')

    def test_candidate_is_fully_prepared_before_displacing_live_state(self):
        source = self.snapshot_source()
        live = self.root / 'state'
        original_copy = ops.shutil.copytree
        def observe_copy(src, dst, *args, **kwargs):
            self.assertTrue(live.is_dir(), 'Live state must remain in place while copying')
            return original_copy(src, dst, *args, **kwargs)
        with patch.object(ops.shutil, 'copytree', side_effect=observe_copy):
            displaced = self.c.replace_state(source)
        self.assertTrue(displaced.is_dir())
        self.assertTrue(live.is_dir())
        self.assertFalse(list(self.root.glob('.state-candidate-*')))

    def test_failure_to_displace_live_directory_preserves_original_error(self):
        source = self.snapshot_source()
        original_replace = ops.os.replace
        def fail_rename(src, dst):
            if Path(src) == self.root / 'state':
                raise OSError('simulated first rename failure')
            return original_replace(src, dst)
        with patch.object(ops.os, 'replace', side_effect=fail_rename):
            with self.assertRaisesRegex(OSError, 'simulated first rename failure'):
                self.c.replace_state(source)
        self.assertTrue((self.root / 'state/data/local-roleplay.sqlite').is_file())
        self.assertFalse(list(self.root.glob('.state-candidate-*')))

    def test_failure_to_install_prepared_directory_restores_displaced_original(self):
        source = self.snapshot_source()
        original_replace = ops.os.replace
        def fail_rename(src, dst):
            if Path(src).parent.name.startswith('.state-candidate-'):
                raise OSError('simulated second rename failure')
            return original_replace(src, dst)
        with patch.object(ops.os, 'replace', side_effect=fail_rename):
            with self.assertRaisesRegex(OSError, 'simulated second rename failure'):
                self.c.replace_state(source)
        self.assertEqual((self.root / 'state/data/local-roleplay.sqlite').read_text(),
                         'characters and campaign before update')
        self.assertFalse(list(self.root.glob('.state-candidate-*')))


if __name__ == '__main__':
    unittest.main()
