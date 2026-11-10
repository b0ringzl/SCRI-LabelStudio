"""Check that spatial sampling preserves isolated geometry among repeated points."""
import tempfile
from pathlib import Path
import numpy as np
from prepare_trial_scene import DTYPE, extract

with tempfile.TemporaryDirectory(prefix='scri-voxel-') as directory:
    cloud = Path(directory)/'fixture.pcd'
    points = np.zeros(10040, dtype=DTYPE)
    points['x'][:10000] = .001
    points['y'][:10000] = .001
    points['z'][:10000] = .001
    points['x'][10000:] = np.arange(40)*.1+1
    points['rgb'][:] = 0x33aa66
    header = f'FIELDS x y z rgb\nSIZE 4 4 4 4\nTYPE F F F U\nCOUNT 1 1 1 1\nPOINTS {len(points)}\nDATA binary\n'
    cloud.write_bytes(header.encode()+points.tobytes())
    sampled, eligible, total = extract(cloud, np.zeros(3), np.eye(3), 10, 1000, .02)
    assert eligible == total == len(points)
    assert len(sampled) == 41, 'repeat observations must not crowd out isolated landmarks'
    assert np.all(sampled['rgb'] == 0x33aa66)
    assert np.allclose(np.sort(-sampled['z']), np.sort(points['x'][np.r_[0,10000:10040]]))
    assert len(np.unique(np.column_stack([sampled[k] for k in ('x','y','z')]),axis=0)) == 41
    cloud.write_bytes(header.encode()+points[:10].tobytes())
    try: extract(cloud,np.zeros(3),np.eye(3),10,1000,.02)
    except ValueError as error: assert 'file length' in str(error)
    else: raise AssertionError('truncated PCD must be rejected')
print('Spatial coverage, packed RGB preservation and truncated PCD rejection passed')
