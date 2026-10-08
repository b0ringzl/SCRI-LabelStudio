export type Vec3 = [number, number, number];
export type UV = [number, number];
export type ToolMode = 'navigate' | 'cuboid' | 'cloud-paint' | 'pano-point' | 'pano-polygon';
export type Page = 'review' | 'workspace' | 'tasks' | 'sources' | 'ontology' | 'registration' | 'models';

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
  pointCloud?: Cuboid;
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
