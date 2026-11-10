import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';

// Recreate through public APIs to discard old orbit inertia/pan/zoom state.
// OrbitControls' constructor looks at the origin, so restore the actual camera
// before its first update. camera.up is also part of a rolled observation.
export function createOrbitFromCamera(camera: THREE.PerspectiveCamera, element: HTMLElement,
  target: THREE.Vector3, onChange: () => void) {
  const position = camera.position.clone();
  const quaternion = camera.quaternion.clone();
  const controls = new OrbitControls(camera, element);
  camera.position.copy(position);
  camera.quaternion.copy(quaternion);
  controls.target.copy(target);
  controls.enableDamping = true;
  controls.dampingFactor = 0.08;
  controls.update();
  controls.addEventListener('change', onChange);
  return controls;
}

export function observationOrbitTarget(camera: THREE.PerspectiveCamera) {
  camera.up.set(0, 1, 0).applyQuaternion(camera.quaternion);
  return camera.getWorldDirection(new THREE.Vector3()).multiplyScalar(10).add(camera.position);
}
