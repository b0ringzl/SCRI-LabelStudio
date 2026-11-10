"""Known-pose recovery and failure tests for the real optimizer (no model mocks)."""
import base64
import unittest
import cv2
import numpy as np
from scipy.spatial.transform import Rotation
from registration_worker import nid,pose_matrix,project,solve


def synthetic_payload():
    width,height=1024,512
    def texture(u,v):
        return np.clip(.5+.17*np.sin(u*2*np.pi*13+v*8)+.14*np.cos(u*2*np.pi*7-v*11)+
                       .11*np.sin(u*2*np.pi*21)*np.cos(v*19),0,1)
    u,v=np.meshgrid((np.arange(width)+.5)/width,(np.arange(height)+.5)/height)
    image=(texture(u,v)*255).astype('uint8')
    pu,pv=np.meshgrid(np.linspace(.001,.999,210),np.linspace(.12,.88,70))
    lon=(pu-.5)*2*np.pi;lat=(.5-pv)*np.pi
    radius=9+2*np.sin(3*lon)+np.cos(7*lat)
    points=np.stack([radius*np.sin(lon)*np.cos(lat),radius*np.sin(lat),-radius*np.cos(lon)*np.cos(lat)],axis=-1).reshape(-1,3)
    # A nonlinear reflectance relationship exercises mutual information rather
    # than assuming LiDAR intensity equals photographic brightness.
    values=np.power(texture(pu,pv).reshape(-1),1.7)
    encoded=base64.b64encode(cv2.imencode('.png',image)[1]).decode()
    return {'schemaVersion':'registration/2.0','frameId':'known-pose',
        'imageDataUrl':'data:image/png;base64,'+encoded,'points':points.tolist(),'values':values.tolist(),
        'signal':'intensity','prior':{'position':[.2,-.1,.08],'rotation':[3,-1,1]}}


class RegistrationTest(unittest.TestCase):
    def test_camera_convention_and_seam(self):
        u,v,_=project(np.array([[0,0,-10],[10,0,0],[-10,0,0],[0,0,10]]),np.eye(4),1000,500)
        np.testing.assert_allclose(u,[500,750,250,0]);np.testing.assert_allclose(v,250)
        p={'position':[2,3,4],'rotation':[90,0,0]}
        np.testing.assert_allclose(pose_matrix(p)[:3,:3]@np.array([0,0,-1]),[-1,0,0],atol=1e-12)

    def test_nid_signal(self):
        a=np.linspace(0,1,10000)
        rng=np.random.default_rng(4)
        self.assertLess(nid(a,a**1.7),nid(a,rng.permutation(a)))

    def test_real_six_dof_recovery(self):
        result=solve(synthetic_payload());print('Known-pose recovery:',result['status'],result['metrics'],flush=True)
        self.assertEqual(result['status'],'candidate')
        error=Rotation.from_euler('YXZ',result['registration']['rotation'],degrees=True).magnitude()*180/np.pi
        self.assertLess(error,1.5)
        self.assertLess(np.linalg.norm(result['registration']['position']),.35)
        self.assertFalse(result['independentlyVerified'])

    def test_missing_signal_is_rejected(self):
        payload=synthetic_payload();payload['values']=[0]*len(payload['values'])
        with self.assertRaisesRegex(ValueError,'signal variation'):solve(payload)
        payload['points'][0][0]=float('nan')
        with self.assertRaisesRegex(ValueError,'Nonfinite'):solve(payload)


if __name__=='__main__':
    import sys,json
    if '--fixture' in sys.argv:print(json.dumps(synthetic_payload()))
    else:unittest.main()
