import importlib.util
import json
from pathlib import Path
import stat
import tempfile
import unittest
from unittest.mock import patch

spec = importlib.util.spec_from_file_location("configure_dockge", Path(__file__).resolve().parents[2] / "scripts" / "configure-dockge.py")
setup = importlib.util.module_from_spec(spec)
spec.loader.exec_module(setup)


class DockgeConfiguration(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name)
        (self.root / "docker").mkdir()
        (self.root / ".env.example").write_text("LAYERLING_ADMIN_PASSWORD=REPLACE_WITH_A_LONG_RANDOM_PASSWORD\nLAYERLING_DATA_VOLUME=layerling_classroom-data\nLAYERLING_PORT=4006\n")

    def tearDown(self):
        self.temp.cleanup()

    def test_inherits_credentials_and_keeps_the_existing_volume(self):
        legacy = self.root / "docker" / ".env.classroom"
        text = "# Existing setup\nLAYERLING_ADMIN_PASSWORD='test$literal#private'\nLAYERLING_BIND_ADDRESS=127.0.0.1\nLAYERLING_COOKIE_SECURE=true\n"
        legacy.write_text(text)
        setup.configure(self.root, True, "earlier-stack_classroom-data")
        current = setup.entries((self.root / ".env").read_text())
        self.assertEqual(current["LAYERLING_ADMIN_PASSWORD"], "'test$literal#private'")
        self.assertEqual(current["LAYERLING_DATA_VOLUME"], "earlier-stack_classroom-data")
        self.assertEqual(current["LAYERLING_BIND_ADDRESS"], "0.0.0.0")
        self.assertEqual(current["LAYERLING_COOKIE_SECURE"], "false")
        self.assertEqual(legacy.read_text(), text)
        self.assertEqual(stat.S_IMODE((self.root / ".env").stat().st_mode), 0o600)

    def test_preserves_root_settings_and_creates_a_private_backup(self):
        original = "LAYERLING_ADMIN_PASSWORD=existing-root-setting\nCUSTOM_FLAG=yes\n"
        (self.root / ".env").write_text(original)
        (self.root / "docker" / ".env.classroom").write_text("LAYERLING_ADMIN_PASSWORD=do-not-override\n")
        setup.configure(self.root, True, "layerling_classroom-data")
        self.assertEqual(setup.entries((self.root / ".env").read_text())["LAYERLING_ADMIN_PASSWORD"], "existing-root-setting")
        self.assertIn("CUSTOM_FLAG=yes", (self.root / ".env").read_text())
        backups = list(self.root.glob(".env.backup.*"))
        self.assertEqual(len(backups), 1)
        self.assertEqual(backups[0].read_text(), original)
        self.assertEqual(stat.S_IMODE(backups[0].stat().st_mode), 0o600)

    def test_repeat_is_idempotent(self):
        setup.configure(self.root, True, "layerling_classroom-data")
        initial = (self.root / ".env").read_text()
        setup.configure(self.root, True, "layerling_classroom-data")
        self.assertEqual((self.root / ".env").read_text(), initial)
        self.assertEqual(list(self.root.glob(".env.backup.*")), [])

    def test_refuses_a_conflicting_volume_without_changing_configuration(self):
        original = "LAYERLING_DATA_VOLUME=intentionally-different\n"
        (self.root / ".env").write_text(original)
        with self.assertRaises(ValueError):
            setup.configure(self.root, True, "current-data")
        self.assertEqual((self.root / ".env").read_text(), original)
        self.assertEqual(list(self.root.glob(".env.backup.*")), [])

    def test_refuses_env_symlinks(self):
        target = self.root / "elsewhere"
        target.write_text("keep this")
        (self.root / ".env").symlink_to(target)
        with self.assertRaises(ValueError):
            setup.configure(self.root, True, None)
        self.assertEqual(target.read_text(), "keep this")

    def test_detects_only_the_mounts_not_the_container_environment(self):
        with patch.object(setup, "docker", side_effect=["container-id", json.dumps([{"Destination": "/var/lib/layerling", "Type": "volume", "Name": "preserve-me"}])]) as docker:
            self.assertEqual(setup.existing_volume(), "preserve-me")
            self.assertIn("{{json .Mounts}}", docker.call_args.args)

    def test_does_not_automatically_replace_a_bind_mount(self):
        with patch.object(setup, "docker", side_effect=["container-id", json.dumps([{"Destination": "/var/lib/layerling", "Type": "bind", "Source": "/existing/data"}])]):
            with self.assertRaises(ValueError):
                setup.existing_volume()

    def test_ambiguous_containers_are_not_guessed(self):
        with patch.object(setup, "docker", return_value="one\ntwo"):
            with self.assertRaises(ValueError):
                setup.existing_volume()


if __name__ == "__main__":
    unittest.main()
