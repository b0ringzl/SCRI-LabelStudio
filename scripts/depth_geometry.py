"""Scale-aware local LiDAR / predicted radial-depth alignment.

Only geometric diagnostics, never a claim of ground-truth calibration accuracy.
Coordinates match the viewer: camera +X right, +Y up, -Z forward; YXZ degrees.
"""
from __future__ import annotations
import time
import cv2
import numpy as np
from scipy.ndimage import gaussian_filter
from scipy.optimize import least_squares
from scipy.spatial.transform import Rotation
from registration_worker import pose_matrix, project, sample, visible_indices

VERSION = 'da2-radial-depth/1.0'


def sample_erp(image, u, v):
    # project() returns normalized angular coordinates scaled by W/H; image
    # samples are located at pixel centers, not at their upper-left corners.
    return sample(image, u-.5, v-.5)


def rays(height, width):
    u, v = np.meshgrid((np.arange(width)+.5)/width, (np.arange(height)+.5)/height)
    azimuth = (u-.5)*2*np.pi
    elevation = (.5-v)*np.pi
    return np.stack((np.sin(azimuth)*np.cos(elevation), np.sin(elevation),
                     -np.cos(azimuth)*np.cos(elevation)), axis=-1)


def align_depth(points, depth, prior):
    started = time.monotonic()
    points = np.asarray(points, dtype=np.float64)
    depth = np.asarray(depth, dtype=np.float64)
    if points.ndim != 2 or points.shape[1] != 3 or not 1000 <= len(points) <= 40000 or not np.isfinite(points).all():
        raise ValueError('Need 1000-40000 finite XYZ points')
    if depth.ndim != 2 or not 1.9 <= depth.shape[1]/depth.shape[0] <= 2.1:
        raise ValueError('Depth must be a 2:1 radial panorama')
    if not np.isfinite(depth).all() or np.min(depth) <= 0:
        raise ValueError('Depth must be positive and finite')
    initial = pose_matrix(prior)
    if not np.isfinite(initial).all():
        raise ValueError('Invalid prior pose')
    h, w = depth.shape
    log_depth = gaussian_filter(np.log(depth), sigma=1.1, mode=('nearest', 'wrap'))
    if np.std(log_depth) < .06:
        raise ValueError('Predicted depth has insufficient scene structure')
    ids = visible_indices(points, initial, 384, 192)
    u, v, distance = project(points[ids], initial, w, h)
    # Poles/sky and steep depth discontinuities are poor geometric constraints.
    gradient_y, gradient_x = np.gradient(log_depth)
    gradient = np.hypot(gradient_x, gradient_y)
    stable = (v > h*.13) & (v < h*.89) & (distance > 1.5) & (distance < 65)
    stable &= sample_erp(gradient, u, v) < .12
    ids = ids[stable]
    if len(ids) < 1500:
        raise ValueError('Too few visible stable surfaces; check cloud coverage and initial pose')
    if len(ids) > 14000:
        ids = ids[np.linspace(0, len(ids)-1, 14000).astype(int)]
    u0, v0, distance0 = project(points[ids], initial, w, h)
    # Hold out whole angular tiles, rather than adjacent interleaved samples.
    tile_x = np.floor(u0/w*48).astype(int)
    tile_y = np.floor(v0/h*24).astype(int)
    held = (tile_x*13+tile_y*7) % 5 == 0
    if min(held.sum(), (~held).sum()) < 250:
        raise ValueError('Insufficient angular coverage for independent held-out tiles')
    train, hold = ids[~held], ids[held]
    log_scale0 = float(np.median(np.log(distance0[~held])-sample_erp(log_depth, u0[~held], v0[~held])))

    def transform(x):
        matrix = initial.copy()
        matrix[:3, 3] += x[:3]
        matrix[:3, :3] = initial[:3, :3] @ Rotation.from_rotvec(np.deg2rad(x[3:6])).as_matrix()
        return matrix

    def residual(x, indices):
        u, v, radial = project(points[indices], transform(x), w, h)
        return np.log(np.maximum(radial, .1))-sample_erp(log_depth, u, v)-x[6]

    x0 = np.r_[np.zeros(6), log_scale0]
    bounds = (np.r_[[-.7]*3, [-5.5]*3, log_scale0-.22],
              np.r_[[.7]*3, [5.5]*3, log_scale0+.22])
    results = []
    for robust_loss in ('soft_l1', 'cauchy'):
        for yaw in (0., -2.5, 2.5):
            seed = x0.copy()
            seed[4] = yaw
            fit = least_squares(lambda x: residual(x, train), seed, bounds=bounds,
                                loss=robust_loss, f_scale=.06, x_scale=np.r_[[.3]*3, [2.]*3, .1],
                                diff_step=1e-3, max_nfev=65, ftol=1e-6, xtol=1e-5)
            # Common training-only score compares robust hypotheses. No held-out
            # measurements are used to pick a start, loss or scale.
            errors = np.abs(residual(fit.x, train))
            loss = np.median(errors)+.1*np.percentile(errors, 75)
            results.append((float(loss), fit.x))
    results.sort(key=lambda pair: pair[0])
    interior = [pair for pair in results if np.max(np.abs(pair[1][:3])) < .68
                and np.max(np.abs(pair[1][3:6])) < 5.35
                and abs(pair[1][6]-log_scale0) < .21
                and np.linalg.norm(pair[1][:3]) < .85
                and np.linalg.norm(pair[1][3:6]) < 6]
    # Bound-saturating starts are unsuitable local refinements even if their
    # training score is lower. Do not use held-out tiles to choose a fallback.
    x = (interior or results)[0][1]
    result = transform(x)
    train_before, train_after = np.abs(residual(x0, train)), np.abs(residual(x, train))
    held_before, held_after = np.abs(residual(x0, hold)), np.abs(residual(x, hold))
    before, after = float(np.median(train_before)), float(np.median(train_after))
    hb, ha = float(np.median(held_before)), float(np.median(held_after))
    rotation_change = float(np.rad2deg(Rotation.from_matrix(initial[:3, :3].T@result[:3, :3]).magnitude()))
    position_change = float(np.linalg.norm(result[:3, 3]-initial[:3, 3]))
    controls = []
    for yaw in (-18, -10, 10, 18):
        wrong = x.copy()
        wrong[4] += yaw
        errors = residual(wrong, hold)
        # Refitting only scale prevents a misleading scale mismatch in controls.
        controls.append(float(np.median(np.abs(errors-np.median(errors)))))
    contrast = float(np.median(controls)-ha)
    near_bound = bool(np.any(np.abs(x[:3]) > .68) or np.any(np.abs(x[3:6]) > 5.35)
                      or abs(x[6]-log_scale0) > .21)
    accepted = bool(before-after > max(.003, before*.025) and hb-ha > max(.002, hb*.02)
                    and np.percentile(held_after, 75) <= np.percentile(held_before, 75)
                    and ha < .22 and contrast > .006 and not near_bound
                    and position_change < .85 and rotation_change < 6.)
    reason = ('深度候选通过内部几何检查，仍需独立投影核验' if accepted else
              '深度预测已完成；位姿候选未通过留出区域、搜索边界或几何区分度检查，原位姿保留')
    metrics = {
        'depthBefore': before, 'depthAfter': after,
        'holdoutBefore': hb, 'holdoutAfter': ha,
        'holdoutP75Before': float(np.percentile(held_before, 75)),
        'holdoutP75After': float(np.percentile(held_after, 75)),
        'scaleBefore': float(np.exp(log_scale0)), 'scaleAfter': float(np.exp(x[6])),
        'visiblePoints': len(ids), 'holdoutPoints': len(hold),
        'rotationChangeDeg': rotation_change, 'positionChangeM': position_change,
        'durationSeconds': time.monotonic()-started, 'starts': len(results), 'contrast': contrast,
        'boundaryReached': int(near_bound),
    }
    return {
        'status': 'candidate' if accepted else 'rejected', 'reason': reason,
        'registration': {'position': result[:3, 3].tolist(),
                         'rotation': Rotation.from_matrix(result[:3, :3]).as_euler('YXZ', degrees=True).tolist()},
        'metrics': metrics, 'independentlyVerified': False,
    }
