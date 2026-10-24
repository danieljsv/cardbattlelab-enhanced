"""Exercise the real build CLI in a temporary output folder."""
import json
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest
import zipfile

ROOT = Path(__file__).resolve().parents[1]
SITE = ["https://cardbattlelab.com/*", "https://www.cardbattlelab.com/*"]


class BuildTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.output = Path(self.temp.name) / "generated"

    def build(self, output=None):
        return subprocess.run(
            [sys.executable, str(ROOT / "tools/build.py"), "--output-dir", str(output or self.output)],
            capture_output=True, text=True)

    def archive(self):
        return zipfile.ZipFile(next(self.output.glob("cardbattlelab-enhanced-*.zip")))

    def test_overlay_bundle_ships_in_both_packages(self):
        result = self.build()
        self.assertEqual(result.returncode, 0, result.stderr)
        chrome = (self.output / "extension/overlay.js").read_text()
        self.assertEqual((self.output / "android-assets/overlay/overlay.js").read_text(), chrome)
        # The card info stylesheet, then the rarity foil's.
        css = "\n".join((ROOT / "extension/overlay" / name).read_text() for name in ("overlay.css", "holo.css"))
        self.assertIn(f"window.__CBL_OVERLAY_CSS = {json.dumps(css)};", chrome)
        # Dependencies load before the runtime that uses them.
        order = [chrome.index(f"root.{name} =") for name in ("CBLFeatures", "CBLKeywords", "CBLIcons", "CBLLayout", "CBLResources", "CBLHolo")]
        order.append(chrome.index("window.CBLFoil = {"))
        self.assertEqual(order, sorted(order))
        self.assertLess(order[-1], chrome.index("window.__cblOverlays = {"))
        with self.archive() as package:
            self.assertEqual(package.read("overlay.js").decode(), chrome)

    def test_manifest_runs_the_settings_bridge_first(self):
        self.assertEqual(self.build().returncode, 0)
        manifest = json.loads((self.output / "extension/manifest.json").read_text())
        # The bridge runs first, in the extension's world, so the overlay starts with the settings.
        self.assertEqual(manifest["content_scripts"], [
            {"matches": SITE, "js": ["settings/features.js", "settings/bridge.js"], "run_at": "document_start"},
            {"matches": SITE, "js": ["overlay.js"], "run_at": "document_idle", "world": "MAIN"}])
        self.assertGreaterEqual(int(manifest["minimum_chrome_version"]), 111)  # MAIN world
        self.assertEqual(manifest["permissions"], ["storage"])
        self.assertNotIn("host_permissions", manifest)

    def test_settings_menu_ships_only_in_the_extension(self):
        self.assertEqual(self.build().returncode, 0)
        extension = self.output / "extension"
        manifest = json.loads((extension / "manifest.json").read_text())
        self.assertEqual(manifest["action"]["default_popup"], "settings/popup.html")
        self.assertEqual(manifest["options_ui"]["page"], "settings/popup.html")
        referenced = {"popup.html", "popup.css", "popup.js", "features.js", "bridge.js"}
        self.assertEqual({p.name for p in (extension / "settings").iterdir()}, referenced)
        self.assertEqual((extension / "settings/features.js").read_bytes(),
                         (ROOT / "extension/overlay/features.js").read_bytes())
        html = (extension / "settings/popup.html").read_text()
        for name in ("popup.css", "features.js", "popup.js", "../icons/cardbattlelab.png"):
            self.assertIn(name, html)
        with self.archive() as package:
            names = set(package.namelist())
        self.assertIn("manifest.json", names)
        self.assertTrue({f"settings/{name}" for name in referenced} <= names)
        # The Android app has no menu: every addition stays on.
        android = {p.relative_to(self.output / "android-assets").as_posix()
                   for p in (self.output / "android-assets").rglob("*") if p.is_file()}
        self.assertEqual(android, {"overlay/overlay.js"})

    def test_zip_is_named_by_the_manifest_version(self):
        self.assertEqual(self.build().returncode, 0)
        version = json.loads((ROOT / "extension/manifest.json").read_text())["version"]
        self.assertEqual([p.name for p in self.output.glob("*.zip")], [f"cardbattlelab-enhanced-{version}.zip"])

    def test_rebuild_replaces_the_last_build(self):
        self.assertEqual(self.build().returncode, 0)
        stale = self.output / "extension/stale.js"
        stale.write_text("old")
        result = self.build()
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertFalse(stale.exists())

    def test_refuses_an_output_folder_it_did_not_make(self):
        (self.output / "extension").mkdir(parents=True)
        (self.output / "extension/keep.txt").write_text("not ours")
        result = self.build()
        self.assertNotEqual(result.returncode, 0)
        self.assertTrue((self.output / "extension/keep.txt").exists())


if __name__ == "__main__":
    unittest.main()
