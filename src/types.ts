export type Vec3 = [number, number, number];
export type UV = [number, number];
export type ToolMode = 'navigate' | 'cuboid' | 'cloud-paint' | 'pano-point' | 'pano-polygon' | 'tie-point' | 'target-box';
export type Page = 'review' | 'workspace' | 'tasks' | 'sources' | 'ontology' | 'registration' | 'models' | 'training';

export interface ClassDefinition {
  id: string;
  name: string;
  color: string;
  shortcut: string;
}

export interface Registration {
  position: Vec3;
  rotation: Vec3; // yaw, pitch, roll in degrees; camera looks toward -Z at zero rotation
}

export interface PanoramaFrame {
  id: string;
  name: string;
  url: string;
  utcSeconds?: number;
  initialRegistration?: Registration;
}

export interface TiePoint {
  id: string;
  frameId: string;
  cloud: Vec3;
  uv: UV;
}

export interface RegistrationEvidence {
  source: 'ins-approximate' | 'imported' | 'manual' | 'tie-points' | 'color-yaw' | 'auto-nid';
  updatedAt: string;
  medianErrorDeg?: number;
  maxErrorDeg?: number;
  colorMargin?: number;
  modelVersion?: string;
  algorithmVersion?: string;
  signal?: string;
  optimizationMetrics?: Record<string, number>;
}

export interface TargetObservation {
  frameId: string;
  bounds: [number, number, number, number]; // two panorama corners, normalized UV
  center: UV;
  vertices?: UV[]; // exact spherical silhouette; omitted on legacy rectangles
  extent?: 'surface' | 'object'; // missing in 0.14.0 and older: a single visible surface
}

export interface Cuboid {
  kind: 'cuboid';
  center: Vec3;
  size: Vec3;
  yaw?: number; // degrees around +Y; optional for older saved annotations
}

export interface Annotation {
  id: string;
  classId: string;
  name: string;
  visible: boolean;
  origin: 'manual' | 'prediction';
  confidence?: number; // optional model score in [0, 1]; not shown for manual annotations
  modelId?: string;
  modelVersion?: string;
  pointCloud?: Cuboid;
  panoramaFrameId?: string;
  observations?: TargetObservation[];
  triangulation?: { baselineM: number; maxRayAngleDeg: number; medianRayMissM: number; nearestCloudPointM: number; reviewed: boolean; stale?: boolean; method?: 'silhouette'; supportPointCount?: number; extent?: 'surface' | 'object' };
  panorama?:
    | { kind: 'point'; uv: UV }
    | { kind: 'polygon'; vertices: UV[] };
}

export interface PairTask {
  id: string;
  name: string;
  location: string;
  pointCloudName: string;
  panoramaName: string;
  pointCloudUrl?: string;
  panoramaUrl: string;
  frames?: PanoramaFrame[];
  initialPoseSource?: 'imported' | 'ins-approximate';
  coverageLabel?: string;
  pointDisplayRanges?: Array<{start:number;count:number;spacing:number}>;
  isDemo?: boolean;
  createdAt: string;
}

export interface PredictionRequest {
  schemaVersion: '0.2';
  taskId: string;
  pointCloudAssetId: string;
  panoramaAssetId: string;
  pointCount: number;
  coordinateSystem: string;
  registration: Registration;
  classes: ClassDefinition[];
}

export interface PredictionResponse {
  schemaVersion: '0.2';
  annotations: Annotation[];
  semanticPointLabels?: Array<{ pointIndex: number; classId: string; confidence?: number }>;
  modelVersion?: string;
  warnings?: string[];
}
