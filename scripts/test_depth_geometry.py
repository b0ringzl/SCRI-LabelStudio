"""Known-geometry recovery, scale ambiguity and rejection tests (not model QA)."""
import unittest
import numpy as np
from scipy.spatial.transform import Rotation
from depth_geometry import rays, align_depth, sample_erp
from registration_worker import project


def fixture():
    height, width = 384, 768
    direction = rays(height, width)
    lon = np.arctan2(direction[..., 0], -direction[..., 2])
    lat = np.arcsin(direction[..., 1])
    radial = 9+1.8*np.sin(3*lon+.8*lat)+1.3*np.cos(5*lon-lat*2)+.9*np.sin(lat*6+lon)
    points = (direction*radial[..., None])[35:-35:3, ::3].reshape(-1, 3)
    return points, radial/2.3, {'position': [.13, -.08, .1], 'rotation': [2.5, -.8, .7]}


class DepthGeometryTest(unittest.TestCase):
    def test_pixel_centers_and_camera_axes(self):
        direction = rays(128, 256)
        u, v, _ = project(direction.reshape(-1, 3)*8, np.eye(4), 256, 128)
        expected_u, expected_v = np.meshgrid(np.arange(256)+.5, np.arange(128)+.5)
        np.testing.assert_allclose(u, expected_u.ravel(), atol=1e-10)
        np.testing.assert_allclose(v, expected_v.ravel(), atol=1e-10)
        image = np.broadcast_to(np.arange(256), (128, 256)).astype(float)
        np.testing.assert_allclose(sample_erp(image, u, v), image.ravel(), atol=1e-8)

    def test_scale_and_six_dof_recovery(self):
        points, depth, prior = fixture()
        result = align_depth(points, depth, prior)
        print('Depth known-geometry recovery:', result, flush=True)
        rotation_error = np.rad2deg(Rotation.from_euler('YXZ', result['registration']['rotation'], degrees=True).magnitude())
        self.assertLess(rotation_error, .4)
        self.assertLess(np.linalg.norm(result['registration']['position']), .08)
        self.assertLess(abs(result['metrics']['scaleAfter']-2.3), .05)
        self.assertEqual(result['status'], 'candidate')
        self.assertFalse(result['independentlyVerified'])

    def test_featureless_and_invalid_inputs_rejected(self):
        points, depth, prior = fixture()
        with self.assertRaisesRegex(ValueError, 'structure'):
            align_depth(points, np.ones_like(depth), prior)
        with self.assertRaisesRegex(ValueError, 'positive'):
            align_depth(points, depth*0, prior)
        points[0, 0] = np.nan
        with self.assertRaisesRegex(ValueError, 'finite'):
            align_depth(points, depth, prior)


if __name__ == '__main__':
    unittest.main()
