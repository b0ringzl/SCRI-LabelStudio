"""Meaningful regression fixtures; these are not the real-data validation."""
import csv
import json
import tempfile
import unittest
from pathlib import Path
import numpy as np
import cv2
from pointcloud_io import open_binary, write_pcd, xyz
from import_scene_dataset import read_poses, convert_pose, prepare, WORLD_ZUP, CAMERA_FLU


def pose_file(path, delimiter='\t', ids=('1', '2')):
    with path.open('w', newline='', encoding='utf-8-sig') as f:
        out = csv.writer(f, delimiter=delimiter)
        out.writerow(['Image id'] + [f'T{r}{c}' for r in range(3) for c in range(4)])
        for i, key in enumerate(ids):
            matrix = np.eye(4); matrix[:3, 3] = [i*2, 3, 4]
            out.writerow([key] + matrix[:3, :].ravel().tolist())


class SceneImportTests(unittest.TestCase):
    def test_binary_padding_and_corruption(self):
        with tempfile.TemporaryDirectory(prefix='scri-pcd-') as td:
            p = Path(td)/'cloud.pcd'
            write_pcd(p, np.array([[1, 2, 3], [4, 5, 6]]), [7, 8])
            original = p.read_bytes()
            p.write_bytes(original + b'\0'*3902)
            data, h = open_binary(p)
            self.assertEqual(h['paddingBytes'], 3902)
            np.testing.assert_array_equal(xyz(data), [[1, 2, 3], [4, 5, 6]])
            del data  # Release Windows memory map before replacing the fixture.
            p.write_bytes(original[:-1])
            with self.assertRaisesRegex(ValueError, 'Truncated'): open_binary(p)
            p.write_bytes(original + b'BAD')
            with self.assertRaisesRegex(ValueError, 'nonzero'): open_binary(p)

    def test_pose_formats_and_reject_invalid(self):
        with tempfile.TemporaryDirectory(prefix='scri-pose-') as td:
            p = Path(td)/'CameraPoseInSlam.csv'
            for delimiter in ('\t', ','):
                pose_file(p, delimiter)
                self.assertEqual(set(read_poses(p)), {'1', '2'})
            pose_file(p, ids=('001', '1'))
            with self.assertRaisesRegex(ValueError, 'duplicate'): read_poses(p)
            pose_file(p)
            p.write_text(p.read_text(encoding='utf-8-sig').replace('1.0', '2.0'), encoding='utf-8')
            with self.assertRaisesRegex(ValueError, 'rigid'): read_poses(p)

    def test_coordinate_profiles_and_direction(self):
        m = np.eye(4); m[:3, 3] = [10, 20, 30]
        result = convert_pose(m, origin=np.array([8, 19, 27]))
        np.testing.assert_allclose(result[:3, 3], [2, 3, -1])
        # A panorama's forward ray (-Z) maps to source FLU +X, then world +X.
        np.testing.assert_allclose(result[:3, :3] @ [0, 0, -1], [1, 0, 0])
        np.testing.assert_allclose(convert_pose(np.linalg.inv(m), direction='world-to-camera'), convert_pose(m))
        np.testing.assert_allclose(convert_pose(m, 'y-up', 'viewer'), m)
        np.testing.assert_allclose(convert_pose(m, camera_axes='opencv')[:3, :3], WORLD_ZUP @ np.diag([1, -1, -1]))
        self.assertAlmostEqual(np.linalg.det(WORLD_ZUP @ CAMERA_FLU), 1)

    def test_new_dataset_full_extent_and_missing_pose_gate(self):
        with tempfile.TemporaryDirectory(prefix='scri-import-') as td:
            root = Path(td); source = root/'unseen_dataset'; source.mkdir()
            imgs = source/'imgs'; imgs.mkdir(); pose_file(imgs/'CameraPoseInSlam.csv')
            for name in ('1.jpg', '2.jpg'):
                cv2.imencode('.jpg', np.zeros((64, 128, 3), np.uint8))[1].tofile(imgs/name)
            points = np.array([[0, 0, 0], [1000, 20, 200], [-900, -40, -30], [1, 2, 3]], dtype=np.float32)
            write_pcd(source/'DenseMap.pcd', points, np.arange(4))
            out = root/'prepared'
            meta = prepare(source, out, point_budget=10)
            np.testing.assert_allclose(meta['sourceBounds'], meta['sampleBounds'])
            self.assertIsNone(meta['spatialCrop'])
            self.assertEqual(meta['matchedPoseCount'], 2)
            self.assertNotIn('panoramaYawOffsetDeg', meta)
            result = json.loads((out/'registration.json').read_text())
            np.testing.assert_allclose(np.array(result['frames'][0]['cameraToCloud']).reshape(4,4), convert_pose(read_poses(imgs/'CameraPoseInSlam.csv')['1'], origin=[2,3,4]))
            with self.assertRaises(FileExistsError): prepare(source, out)
            cv2.imencode('.jpg', np.zeros((64, 128, 3), np.uint8))[1].tofile(imgs/'3.jpg')
            with self.assertRaisesRegex(ValueError, 'no pose'): prepare(source, root/'should-fail')
            self.assertFalse((root/'should-fail').exists())


if __name__ == '__main__': unittest.main()
