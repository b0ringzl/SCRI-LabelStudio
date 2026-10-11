import type { DistillationManifestV1, TeacherProvider } from './distillation';

// These are transport contracts for an external training service. This repository does not run training.
export interface DistillationImageSetV1 {
  schemaVersion: '1.0';
  imageSetId: string;
  state: 'validating' | 'ready' | 'rejected';
  imageCount?: number;
  error?: string;
}

export interface DistillationDatasetCreateV1 {
  schemaVersion: '1.0';
  imageSetId: string; // server-side immutable image collection, keyed by manifest.imageKey
  manifest: DistillationManifestV1;
}

export interface DistillationDatasetV1 {
  schemaVersion: '1.0';
  datasetId: string;
  state: 'validating' | 'ready' | 'rejected';
  sampleCount?: number;
  missingImageKeys?: string[];
  manifestSha256?: string;
  error?: string;
}

export interface DistillationJobCreateV1 {
  schemaVersion: '1.0';
  trainDatasetId: string;
  evaluationDatasetId: string; // separate, human-verified holdout; must not overlap training images
  student: { modelId: string; recipeId: string; baseVersion?: string };
  labelSelection: {
    includeManual: boolean;
    includeImportedPredictions: boolean;
    teacherProviders: TeacherProvider[];
  };
  seed: number;
}

export interface DistillationMetricV1 {
  name: string;
  baseline?: number;
  student: number;
  higherIsBetter: boolean;
  byClass?: Record<string, number>;
}

export interface DistillationJobV1 {
  schemaVersion: '1.0';
  jobId: string;
  state: 'queued' | 'running' | 'succeeded' | 'failed' | 'cancelled';
  progress?: number; // 0..1, informational only
  trainingSampleCount?: number;
  sourceCounts?: Record<string, number>;
  metrics?: DistillationMetricV1[];
  modelArtifactId?: string; // opaque reference; never an automatic deployment
  error?: string;
}
