// Shared types for Crush Mold Builder.
// Geometry crosses the worker boundary as plain typed arrays (transferable).

export type Vec3 = [number, number, number];

/** Position + index buffers for a triangle mesh. Units = millimetres. */
export interface GeomArrays {
  position: Float32Array; // x,y,z per vertex
  index: Uint32Array; // 3 vertex indices per triangle
}

export type FeatureType = 'vent' | 'fill';

export interface Feature {
  id: string;
  type: FeatureType;
  /** Click point on the shell outer surface (world space, mm). */
  position: Vec3;
  /** Outward surface normal at the click point (unit). */
  normal: Vec3;
  /** Local wall thickness measured by the inward ray (mm); falls back to global. */
  wallThickness: number;
}

export interface Settings {
  /** Shell wall thickness (mm). */
  thickness: number;
  /** Approx. max triangle edge length for the level-set remesh (mm). Lower = finer/slower. */
  edgeLength: number;
  /** Vent through-hole diameter (mm). */
  ventDia: number;
  /** Fill-port bore diameter (mm). */
  boreDia: number;
  /** Funnel diameter where it meets the surface (mm). */
  funnelBaseDia: number;
  /** Funnel diameter at the top / mouth (mm). */
  funnelTopDia: number;
  /** Funnel height standing proud of the surface (mm). */
  funnelHeight: number;
}

export const DEFAULT_SETTINGS: Settings = {
  thickness: 2,
  edgeLength: 1.0,
  ventDia: 1,
  boreDia: 3,
  funnelBaseDia: 5,
  funnelTopDia: 8,
  funnelHeight: 4,
};

// ---- Worker message protocol ----

/** Diagnostic report on an imported mesh. */
export interface IntakeReport {
  triangles: number;
  vertices: number;
  boundaryEdges: number; // open edges (holes) — edge used by 1 triangle
  nonManifoldEdges: number; // edge shared by >2 triangles
  components: number; // disconnected surface pieces
  degenerateTris: number; // ~zero-area triangles
  bbox: { min: Vec3; max: Vec3; size: Vec3 };
  manifoldStatus: string; // result of feeding it to Manifold
  genus: number;
  volume: number; // signed; < 0 implies inverted/flipped normals
  watertight: boolean;
  invertedNormals: boolean;
  level: 'ok' | 'warn' | 'fail';
  messages: string[];
}

export interface ShellRequest {
  id: number;
  type: 'generateShell';
  part: GeomArrays;
  thickness: number;
  edgeLength: number;
}

export interface InspectRequest {
  id: number;
  type: 'inspect';
  geom: GeomArrays;
}

export interface BakeRequest {
  id: number;
  type: 'bake';
  shell: GeomArrays;
  features: Feature[];
  settings: Settings;
}

export type WorkerRequest = ShellRequest | BakeRequest | InspectRequest;

export interface ProgressMessage {
  id: number;
  type: 'progress';
  phase: string;
  value?: number; // 0..1 when known
}

export interface ResultMessage {
  id: number;
  type: 'result';
  geom: GeomArrays;
  volume: number;
  status: string;
}

export interface InspectResultMessage {
  id: number;
  type: 'inspectResult';
  report: IntakeReport;
}

export interface ErrorMessage {
  id: number;
  type: 'error';
  message: string;
}

export type WorkerResponse =
  | ProgressMessage
  | ResultMessage
  | InspectResultMessage
  | ErrorMessage;
