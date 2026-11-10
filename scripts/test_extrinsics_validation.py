import unittest
import csv
import json
import subprocess
import sys
import tempfile
from pathlib import Path
import cv2
import numpy as np

from validate_extrinsics import csv_matrix, hypotheses, nid, project


class ExtrinsicsMathTests(unittest.TestCase):
    def test_degree_yaw_and_translation_unit(self):
        row = dict(roll_deg=0, pitch_deg=0, yaw_deg=90, tx=100, ty=0, tz=0)
        matrix = csv_matrix(row, scale=.01)
        np.testing.assert_allclose(matrix @ [1, 0, 0, 1], [1, 1, 0, 1], atol=1e-12)
        with self.assertRaises(ValueError): csv_matrix({**row, 'yaw_deg': float('nan')})

    def test_inverse_and_basis_conjugation(self):
        row = dict(roll_deg=3, pitch_deg=7, yaw_deg=-9, tx=.1, ty=.2, tz=.3)
        items = {v['id']: v['matrix'] for v in hypotheses(row)}
        self.assertEqual(len(items), 49)
        for axes in ('FLU', 'FRU', 'RDF_optical', 'viewer_RUB'):
            direct = items[f'degrees/m/camera_to_body/{axes}']
            inverse = items[f'degrees/m/inverse/{axes}']
            np.testing.assert_allclose(direct @ inverse, np.eye(4), atol=1e-12)
            self.assertAlmostEqual(np.linalg.det(direct[:3, :3]), 1.)

    def test_spherical_projection_and_wrapping(self):
        u, v, _ = project(np.asarray([[1., 0., 0.], [0., 1., 0.], [-1., 0., 0.]]), 1024, 512)
        np.testing.assert_allclose(u, [512, 256, 0], atol=1e-12)
        np.testing.assert_allclose(v, [256, 256, 256], atol=1e-12)

    def test_nid_dependent_and_independent_controls(self):
        bins = np.tile(np.arange(16), 16)
        self.assertAlmostEqual(nid(bins*16+8, bins), 0.)
        independent = np.repeat(np.arange(16), 16)*16+8
        self.assertAlmostEqual(nid(independent, bins), 1.)

    def test_cli_writes_unverified_report_without_modifying_inputs(self):
        with tempfile.TemporaryDirectory(prefix='extrinsics-test-') as temp:
            root = Path(temp); vmms = root/'vmms'; maps = vmms/'pointcloud'/'mapping'
            maps.mkdir(parents=True)
            angles = np.linspace(0, 2*np.pi, 6000, endpoint=False)
            points = np.column_stack([10*np.cos(angles), 10*np.sin(angles), np.zeros(6000), np.arange(6000) % 16])
            path = maps/'pointcloud_DS_0.pcd'
            with path.open('w') as f:
                f.write('VERSION 0.7\nFIELDS x y z intensity\nPOINTS 6000\nDATA ascii\n')
                np.savetxt(f, points, fmt='%.8f')
            original = path.read_bytes()
            fields = ['stream_id', 'frame_id', 'local_x', 'local_y', 'local_z', 'roll_rad', 'pitch_rad', 'heading_rad', 'source_image_relpath']
            with (root/'frames.csv').open('w', newline='') as f:
                writer = csv.DictWriter(f, fieldnames=fields); writer.writeheader()
                for i in range(4):
                    image = vmms/f'frame{i}.png'
                    image.write_bytes(cv2.imencode('.png', np.tile(np.arange(256, dtype=np.uint8), (128, 1)))[1].tobytes())
                    writer.writerow(dict(stream_id='test', frame_id=str(i), local_x=i*.01, local_y=0, local_z=0,
                                         roll_rad=0, pitch_rad=0, heading_rad=0, source_image_relpath=f'vmms/frame{i}.png'))
            (root/'extrinsics.csv').write_text('roll_deg,pitch_deg,yaw_deg,tx,ty,tz\n0,0,0,0,0,0\n')
            result = subprocess.run([sys.executable, str(Path(__file__).with_name('validate_extrinsics.py')),
                                     '--vmms', str(vmms), '--frames', str(root/'frames.csv'), '--extrinsics', str(root/'extrinsics.csv'),
                                     '--output', str(root/'results'), '--stream', 'test', '--count', '4', '--max-points', '1024',
                                     '--image-width', '256', '--yaw-step', '30'], capture_output=True, text=True)
            self.assertEqual(result.returncode, 0, result.stdout+result.stderr)
            report = json.loads((root/'results'/'report.json').read_text())
            self.assertFalse(report['applyRecommended'])
            self.assertEqual(len(report['hypotheses']), 49)
            self.assertEqual(len(report['framesTested']), 4)
            self.assertEqual(path.read_bytes(), original)


if __name__ == '__main__':
    unittest.main()
