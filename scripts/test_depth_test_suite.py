"""Exercise private suite roundtrip, corruption detection and both platform ZIPs."""
import json
from pathlib import Path
import stat
import struct
import tempfile
import unittest
import zipfile

from package_depth_test_suite import ROOT, prepare_suite, verify_suite, package_suite


class SuiteTest(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix="scri-depth-suite-")
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.source = self.root/"source"
        folder = self.source/"room"
        (folder/"panoramas").mkdir(parents=True)
        # Tiny binary XYZ fixture and JPEG SOF header; no real survey imagery.
        (folder/"scene-cloud.pcd").write_bytes(b"VERSION 0.7\nFIELDS x y z\nSIZE 4 4 4\nTYPE F F F\nCOUNT 1 1 1\nWIDTH 2\nHEIGHT 1\nPOINTS 2\nDATA binary\n"+struct.pack("<6f", 1, 2, 3, 4, 5, 6))
        (folder/"panoramas/one.jpg").write_bytes(b"\xff\xd8\xff\xc0\x00\x11\x08\x00\x02\x00\x04"+b"\0"*10)
        matrix = [1,0,0,3, 0,1,0,4, 0,0,1,5, 0,0,0,1]
        self.write(folder/"registration.json", {"schemaVersion":"registration/1.0", "frames":[{"image":"one.jpg", "cameraToCloud":matrix}]})
        self.write(folder/"source-metadata.json", {"sampledPointCount":2, "baseFrameName":"one.jpg"})
        self.write(self.source/"scene-catalog.json", {"schemaVersion":"scene-catalog/1.0", "scenes":[{"key":"room","directory":"room"}]})
        # Unlisted files must never enter the data package.
        (folder/"DO-NOT-PUBLISH.env").write_text("secret-fixture")
        (self.source/"unlisted").mkdir()
        (self.source/"unlisted/secret.txt").write_text("unlisted-fixture")
        self.plan = self.root/"plan.json"
        self.write(self.plan, {"schemaVersion":"depth-test-plan/1.0", "groundTruthAvailable":False,
                              "defaultSceneKey":"room", "cases":[{"sceneKey":"room","frame":"one.jpg"}]})

    def write(self, path, value):
        path.write_text(json.dumps(value), encoding="utf-8")

    def prepare(self):
        output = self.root/"prepared"
        prepare_suite(self.source, output, self.plan)
        return output

    def test_roundtrip_and_platform_packages(self):
        output = self.prepare()
        self.assertEqual(verify_suite(output)["scenes"][0]["pointCount"], 2)
        self.assertFalse((output/"scene-data/room/DO-NOT-PUBLISH.env").exists())
        original = self.source/"room/registration.json"
        self.assertEqual(original.read_bytes(), (output/"scene-data/room/registration.json").read_bytes())
        self.assertEqual(json.loads(original.read_text())["frames"][0]["cameraToCloud"][3], 3)
        version = json.loads((ROOT/"package.json").read_text())["version"]
        for platform in ("Windows", "macOS"):
            with zipfile.ZipFile(self.root/f"AtlasStudio-{platform}-v{version}.zip", "w") as app:
                app.writestr("app/scripts/serve.mjs", "// stub")
                app.writestr("app/README.md", "old readme")
            archive = package_suite(output, self.root, platform)
            with zipfile.ZipFile(archive) as zipped:
                self.assertIsNone(zipped.testzip())
                names = zipped.namelist()
                self.assertFalse(any("secret" in n.lower() or "DO-NOT" in n for n in names))
                suffix = "Start-Tests-Windows.bat" if platform == "Windows" else "Start-Tests-macOS.command"
                entry = next(n for n in names if n.endswith(suffix))
                self.assertIn(b"--scene-dir", zipped.read(entry))
                self.assertIn(b"44010", zipped.read(entry))
                if platform == "macOS":
                    self.assertEqual(stat.S_IMODE(zipped.getinfo(entry).external_attr >> 16), 0o755)
                target = self.root/platform
                zipped.extractall(target)
                verify_suite(next(target.iterdir()))
            with self.assertRaises(FileExistsError):
                package_suite(output, self.root, platform)
        with self.assertRaises(FileExistsError):
            self.prepare()

    def test_changed_image_is_detected(self):
        output = self.prepare()
        with (output/"scene-data/room/panoramas/one.jpg").open("ab") as stream:
            stream.write(b"changed")
        with self.assertRaisesRegex(ValueError, "Checksum mismatch"):
            verify_suite(output)

    def test_truncated_cloud_is_rejected(self):
        path = self.source/"room/scene-cloud.pcd"
        path.write_bytes(path.read_bytes()[:-4])
        with self.assertRaisesRegex(ValueError, "Truncated PCD"):
            self.prepare()

    def test_bad_frame_and_pose_are_rejected(self):
        path = self.source/"room/registration.json"
        value = json.loads(path.read_text())
        value["frames"][0]["cameraToCloud"][0] = 2
        self.write(path, value)
        with self.assertRaisesRegex(ValueError, "orthonormal"):
            self.prepare()
        value["frames"][0]["cameraToCloud"][0] = 1
        value["frames"][0]["image"] = "../one.jpg"
        self.write(path, value)
        with self.assertRaisesRegex(ValueError, "panorama name"):
            self.prepare()

    def test_catalog_cannot_escape(self):
        path = self.source/"scene-catalog.json"
        for escape in ("../room", "C:/private", "..\\room"):
            self.write(path, {"schemaVersion":"scene-catalog/1.0", "scenes":[{"key":"room","directory":escape}]})
            with self.assertRaises(ValueError):
                self.prepare()

    def test_missing_case_and_incomplete_hash_inventory(self):
        plan = json.loads(self.plan.read_text())
        plan["cases"][0]["frame"] = "missing.jpg"
        self.write(self.plan, plan)
        with self.assertRaisesRegex(ValueError, "paired image"):
            self.prepare()
        plan["cases"][0]["frame"] = "one.jpg"
        self.write(self.plan, plan)
        output = self.prepare()
        path = output/"test-suite.json"
        value = json.loads(path.read_text(encoding="utf-8"))
        value["files"].pop("scene-data/room/scene-cloud.pcd")
        self.write(path, value)
        with self.assertRaisesRegex(ValueError, "Incomplete checksum"):
            verify_suite(output)


if __name__ == "__main__":
    unittest.main()
