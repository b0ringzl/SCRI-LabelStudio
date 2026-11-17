import type { BufferGeometry } from 'three';
import type { RoadMarkingBox, RoadMarkingType, Vec3 } from './types';

export const MARKING_TYPES: Record<RoadMarkingType, string> = {
  diamond: '菱形标线', arrow: '导向箭头', crosswalk: '斑马线', 'stop-line': '停止线',
  'dashed-line': '车道虚线段', 'solid-line': '车道实线段', 'text-symbol': '文字或符号', other: '其他标识',
};

export type XZ = [x: number, z: number];
export interface Footprint { center: XZ; size: RoadMarkingBox['size']; yaw: number }
const CELL = 2;
export const MIN_SIDE = 0.12;
export const CORNER_SIGNS: XZ[] = [[-1, -1], [1, -1], [1, 1], [-1, 1]];

export function rotate([x, z]: XZ, yaw: number): XZ {
  const a = yaw * Math.PI / 180;
  return [Math.cos(a)*x - Math.sin(a)*z, Math.sin(a)*x + Math.cos(a)*z];
}

export function offset(center: XZ, delta: XZ): XZ {
  return [center[0] + delta[0], center[1] + delta[1]];
}

export function footprintCorners(box: Footprint) {
  return CORNER_SIGNS.map(([x,z]) => offset(box.center, rotate([x*box.size[0]/2,z*box.size[1]/2],box.yaw)));
}

export function resizeFootprint(box: Footprint, corner: number, cursor: XZ): Footprint {
  const [sx, sz] = CORNER_SIGNS[corner];
  const anchor = footprintCorners(box)[(corner+2)%4];
  const [dx,dz] = rotate([cursor[0]-anchor[0],cursor[1]-anchor[1]],-box.yaw);
  const size: Footprint['size'] = [Math.max(MIN_SIDE, dx*sx), Math.max(MIN_SIDE, dz*sz)];
  return { ...box, size, center: offset(anchor, rotate([sx*size[0]/2,sz*size[1]/2],box.yaw)) };
}

export const normalizeYaw = (a: number) => ((a + 180) % 360 + 360) % 360 - 180;
export const angleAt = (center: XZ, point: XZ) => Math.atan2(point[0]-center[0],center[1]-point[1])*180/Math.PI;
export const footprintOf = (box: RoadMarkingBox): Footprint => ({center:[box.center[0],box.center[2]],size:box.size,yaw:box.yaw});

interface GroundCell { floor: number; points: number[] }

export function indexGround(geometry: BufferGeometry) {
  const position = geometry.getAttribute('position');
  const rows = new Map<number, Map<number, GroundCell>>();
  for (let i=0; i<position.count; i++) {
    const x = Math.floor(position.getX(i)/CELL), z = Math.floor(position.getZ(i)/CELL), y = position.getY(i);
    if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) continue;
    let row = rows.get(z);
    if (!row) rows.set(z,row=new Map());
    const cell = row.get(x);
    if (cell) cell.floor = Math.min(cell.floor,y);
    else row.set(x,{floor:y,points:[]});
  }
  for (let i=0; i<position.count; i++) {
    const cell = rows.get(Math.floor(position.getZ(i)/CELL))?.get(Math.floor(position.getX(i)/CELL));
    const y = position.getY(i);
    if (cell && Number.isFinite(y) && y <= cell.floor+.32) {
      cell.points.push(i);
    }
  }
  function forEachIn(min: XZ, max: XZ, visit: (index: number) => void) {
    for (let z=Math.floor(min[1]/CELL);z<=Math.floor(max[1]/CELL);z++) {
      const row = rows.get(z);
      if (!row) continue;
      for (let x=Math.floor(min[0]/CELL);x<=Math.floor(max[0]/CELL);x++) {
        row.get(x)?.points.forEach(visit);
      }
    }
  }
  function heightAt([x,z]: XZ): number | undefined {
    let bestDistance = 3.5**2;
    let best: number | undefined;
    forEachIn([x-3.5,z-3.5],[x+3.5,z+3.5], i => {
      const distance = (x-position.getX(i))**2+(z-position.getZ(i))**2;
      if (distance < bestDistance) { bestDistance=distance; best=position.getY(i); }
    });
    return best;
  }
  return {forEachIn,heightAt};
}

export function placeFootprint(box: Footprint, type: RoadMarkingType, ground: ReturnType<typeof indexGround>): RoadMarkingBox | undefined {
  const height = ground.heightAt(box.center);
  if (height === undefined) return;
  const corners = footprintCorners(box).map(([x,z]): Vec3 => [x,ground.heightAt([x,z]) ?? height,z]) as RoadMarkingBox['corners'];
  return {kind:'road-marking-box',type,center:[box.center[0],height,box.center[1]],size:box.size,yaw:box.yaw,corners};
}
