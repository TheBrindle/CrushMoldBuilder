// Pure geometry pipeline — no worker/DOM globals, so it can run under Node tests
// as well as inside the Web Worker. The Manifold WASM toplevel is passed in.

import * as THREE from 'three';
import { MeshBVH } from 'three-mesh-bvh';
import type { GeomArrays, Feature, Settings, Vec3 } from '../types';

/* eslint-disable @typescript-eslint/no-explicit-any */
export type ManifoldWasm = any;
export type Manifold = any;

export type PhaseCb = (phase: string, value?: number) => void;

export interface CoreResult {
  geom: GeomArrays;
  volume: number;
  status: string;
}

// ---------- three <-> manifold conversion ----------

export function arraysToManifold(wasm: ManifoldWasm, geom: GeomArrays): Manifold {
  const { Manifold, Mesh } = wasm;
  return new Manifold(
    new Mesh({ numProp: 3, vertProperties: geom.position, triVerts: geom.index }),
  );
}

export function manifoldToArrays(m: Manifold): GeomArrays {
  const mesh = m.getMesh();
  const numProp: number = mesh.numProp;
  let position: Float32Array;
  if (numProp === 3) {
    position = new Float32Array(mesh.vertProperties);
  } else {
    const n = mesh.vertProperties.length / numProp;
    position = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) {
      position[i * 3] = mesh.vertProperties[i * numProp];
      position[i * 3 + 1] = mesh.vertProperties[i * numProp + 1];
      position[i * 3 + 2] = mesh.vertProperties[i * numProp + 2];
    }
  }
  return { position, index: new Uint32Array(mesh.triVerts) };
}

// ---------- signed distance field from the part mesh ----------

export function computeBounds(position: Float32Array) {
  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < position.length; i += 3) {
    for (let a = 0; a < 3; a++) {
      const v = position[i + a];
      if (v < min[a]) min[a] = v;
      if (v > max[a]) max[a] = v;
    }
  }
  return { min, max };
}

/** SDF closure: POSITIVE inside the part, negative outside (Manifold convention). */
export function makeSDF(part: GeomArrays): (p: number[]) => number {
  const geom = new THREE.BufferGeometry();
  geom.setAttribute('position', new THREE.BufferAttribute(part.position, 3));
  geom.setIndex(new THREE.BufferAttribute(part.index, 1));
  const bvh = new MeshBVH(geom);

  const pos = part.position;
  const idx = part.index;
  const q = new THREE.Vector3();
  const a = new THREE.Vector3();
  const b = new THREE.Vector3();
  const c = new THREE.Vector3();
  const ab = new THREE.Vector3();
  const ac = new THREE.Vector3();
  const nrm = new THREE.Vector3();
  const target = { point: new THREE.Vector3(), distance: 0, faceIndex: -1 };

  return (p: number[]) => {
    q.set(p[0], p[1], p[2]);
    bvh.closestPointToPoint(q, target);
    const fi = target.faceIndex;
    a.fromArray(pos, idx[fi * 3] * 3);
    b.fromArray(pos, idx[fi * 3 + 1] * 3);
    c.fromArray(pos, idx[fi * 3 + 2] * 3);
    ab.subVectors(b, a);
    ac.subVectors(c, a);
    nrm.crossVectors(ab, ac); // unnormalized; only sign of the dot matters
    const dot =
      (q.x - target.point.x) * nrm.x +
      (q.y - target.point.y) * nrm.y +
      (q.z - target.point.z) * nrm.z;
    return (dot < 0 ? 1 : -1) * target.distance;
  };
}

// ---------- world transform for a placed feature ----------

const _q = new THREE.Quaternion();
const _m = new THREE.Matrix4();
const _p = new THREE.Vector3();
const _n = new THREE.Vector3();
const _s = new THREE.Vector3(1, 1, 1);
const Z = new THREE.Vector3(0, 0, 1);

/** Column-major Mat4 (length 16) aligning local +Z to `normal`, origin at `point`. */
export function worldMatrix(point: Vec3, normal: Vec3): number[] {
  _p.set(point[0], point[1], point[2]);
  _n.set(normal[0], normal[1], normal[2]).normalize();
  _q.setFromUnitVectors(Z, _n);
  _m.compose(_p, _q, _s);
  return Array.from(_m.elements);
}

// ---------- feature builders ----------

export function buildVent(wasm: ManifoldWasm, f: Feature, s: Settings): Manifold {
  const r = s.ventDia / 2;
  const wall = f.wallThickness;
  const h = wall + 2; // 1mm clearance outside + through the wall + 1mm into cavity
  // Local +Z is the outward normal; the click point (z=0) is on the OUTER surface
  // and the wall runs inward (-Z). Span z: -(wall+1) .. +1 so it cleanly pierces.
  return wasm.Manifold.cylinder(h, r, r, 32, false)
    .translate([0, 0, -(wall + 1)])
    .transform(worldMatrix(f.position, f.normal));
}

export function buildFill(
  wasm: ManifoldWasm,
  f: Feature,
  s: Settings,
): { solid: Manifold; bore: Manifold } {
  const { Manifold } = wasm;
  const baseR = s.funnelBaseDia / 2;
  const topR = s.funnelTopDia / 2;
  const boreR = s.boreDia / 2;
  const fh = s.funnelHeight;
  const embed = 0.6;
  const M = worldMatrix(f.position, f.normal);
  const wall = f.wallThickness;

  const solid = Manifold.cylinder(fh + embed, baseR, topR, 48, false)
    .translate([0, 0, -embed])
    .transform(M);
  const bore = Manifold.cylinder(fh + wall + 2, boreR, boreR, 48, false)
    .translate([0, 0, -(wall + 1)])
    .transform(M);
  return { solid, bore };
}

// ---------- operations ----------

function del(m: Manifold | null | undefined) {
  try {
    m?.delete?.();
  } catch {
    /* noop */
  }
}

export function generateShellCore(
  wasm: ManifoldWasm,
  part: GeomArrays,
  thickness: number,
  edgeLength: number,
  onPhase?: PhaseCb,
): CoreResult {
  const { Manifold } = wasm;

  onPhase?.('Building distance field…');
  const sdf = makeSDF(part);
  const bb = computeBounds(part.position);
  const pad = thickness + 2 * edgeLength + 1;
  const bounds = {
    min: [bb.min[0] - pad, bb.min[1] - pad, bb.min[2] - pad],
    max: [bb.max[0] + pad, bb.max[1] + pad, bb.max[2] + pad],
  };

  onPhase?.('Remeshing outer surface (level set)…');
  const outer = Manifold.levelSet((p: number[]) => sdf(p), bounds, edgeLength, -thickness);

  onPhase?.('Forming cavity…');
  // Prefer the original mesh for cavity fidelity. new Manifold() THROWS on a
  // non-manifold input, so guard it and fall back to a guaranteed-manifold
  // level-set cavity if the imported STL isn't perfectly watertight.
  let cavity: Manifold | null = null;
  try {
    cavity = arraysToManifold(wasm, part);
    if (String(cavity.status()) !== 'NoError' || cavity.isEmpty()) {
      del(cavity);
      cavity = null;
    }
  } catch {
    cavity = null;
  }
  if (!cavity) {
    cavity = Manifold.levelSet((p: number[]) => sdf(p), bounds, edgeLength, 0);
  }

  onPhase?.('Subtracting cavity…');
  const shell = outer.subtract(cavity);

  const geom = manifoldToArrays(shell);
  const volume = shell.volume();
  const status = String(shell.status());
  del(outer);
  del(cavity);
  del(shell);
  return { geom, volume, status };
}

export function bakeCore(
  wasm: ManifoldWasm,
  shell: GeomArrays,
  features: Feature[],
  settings: Settings,
  onPhase?: PhaseCb,
): CoreResult {
  let mold = arraysToManifold(wasm, shell);

  features.forEach((f, i) => {
    onPhase?.(
      `Cutting feature ${i + 1}/${features.length} (${f.type})…`,
      (i + 1) / Math.max(1, features.length),
    );
    if (f.type === 'vent') {
      const v = buildVent(wasm, f, settings);
      const next = mold.subtract(v);
      del(mold);
      del(v);
      mold = next;
    } else {
      const { solid, bore } = buildFill(wasm, f, settings);
      const unioned = mold.add(solid);
      del(mold);
      del(solid);
      const next = unioned.subtract(bore);
      del(unioned);
      del(bore);
      mold = next;
    }
  });

  const geom = manifoldToArrays(mold);
  const volume = mold.volume();
  const status = String(mold.status());
  del(mold);
  return { geom, volume, status };
}
