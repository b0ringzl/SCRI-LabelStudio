import copy
import json
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest
from extract_registration_poses import extract_poses


class PoseExtractionTests(unittest.TestCase):
    def setUp(self):
        self.export = {'schemaVersion': '0.2',
                       'frames': [{'id': 'f1', 'name': '1.jpg', 'utcSeconds': 1}, {'id': 'f2', 'name': '2.jpg'}],
                       'frameRegistrations': {'f1': {'position': [0, 1.6, 0], 'rotation': [20, -2, 1]},
                                              'f2': {'position': [1, 1.6, 0], 'rotation': [22, -2, 1]}}}

    def test_preserves_image_pose_and_optional_time(self):
        original = copy.deepcopy(self.export)
        result = extract_poses(self.export)
        self.assertEqual(result['frames'][0]['image'], '1.jpg')
        self.assertEqual(result['frames'][0]['registration'], self.export['frameRegistrations']['f1'])
        self.assertEqual(result['frames'][0]['utcSeconds'], 1)
        self.assertNotIn('utcSeconds', result['frames'][1])
        result['frames'][0]['registration']['position'][0] = 100
        self.assertEqual(self.export, original)

    def test_missing_pose_is_not_silently_filled(self):
        del self.export['frameRegistrations']['f2']
        with self.assertRaisesRegex(ValueError, 'Missing independent pose'):
            extract_poses(self.export)

    def test_rejects_ambiguous_names_and_nonfinite_coordinates(self):
        self.export['frames'][1]['name'] = '1.JPG'
        with self.assertRaisesRegex(ValueError, 'duplicate'):
            extract_poses(self.export)
        self.export['frames'][1]['name'] = '2.jpg'
        self.export['frameRegistrations']['f1']['rotation'][0] = float('nan')
        with self.assertRaisesRegex(ValueError, 'Invalid rotation'):
            extract_poses(self.export)

    def test_cli_does_not_overwrite_existing_output_or_input(self):
        with tempfile.TemporaryDirectory(prefix='scri-pose-extract-') as directory:
            source, output = Path(directory)/'export.json', Path(directory)/'poses.json'
            source.write_text(json.dumps(self.export), encoding='utf-8')
            script = Path(__file__).with_name('extract_registration_poses.py')
            subprocess.run([sys.executable, str(script), str(source), '--output', str(output)], check=True, capture_output=True)
            before = output.read_bytes()
            failed = subprocess.run([sys.executable, str(script), str(source), '--output', str(output)], capture_output=True)
            self.assertNotEqual(failed.returncode, 0)
            self.assertEqual(output.read_bytes(), before)
            self.assertEqual(json.loads(source.read_text()), self.export)


if __name__ == '__main__':
    unittest.main()
