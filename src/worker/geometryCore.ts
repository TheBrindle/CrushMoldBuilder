// Pure geometry pipeline — no worker/DOM globals, so it can run under Node tests
// as well as inside the Web Worker. The Manifold WASM toplevel is passed in.

import * as THREE from 'three';
import { MeshBVH } from 'three-mesh-bvh';
import type { GeomArrays, Feature, Settings, Vec3, IntakeReport } from '../types';

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

/**
 * SDF closure: POSITIVE inside the part, negative outside (Manifold convention).
 *
 * Distance magnitude comes from the nearest point on the surface. The inside/
 * outside SIGN comes from RAYCAST PARITY — count how many times a ray from the
 * point crosses the (watertight) surface: odd = inside. This is robust at sharp
 * concave corners, where a nearest-face-normal test flips and spawns inverted
 * bubbles / tunnels in the offset surface.
 */
export function makeSDF(part: GeomArrays): (p: number[]) => number {
  const geom = new THREE.BufferGeometry();
  geom.setAttribute('position', new THREE.BufferAttribute(part.position, 3));
  geom.setIndex(new THREE.BufferAttribute(part.index, 1));
  const bvh = new MeshBVH(geom);

  const q = new THREE.Vector3();
  const target = { point: new THREE.Vector3(), distance: 0, faceIndex: -1 };
  const ray = new THREE.Ray();
  // Oblique, irrational-ish direction so the ray rarely grazes an edge/vertex.
  const dir = new THREE.Vector3(0.30151, 0.55276, 0.77689).normalize();

  return (p: number[]) => {
    q.set(p[0], p[1], p[2]);
    bvh.closestPointToPoint(q, target);
    ray.origin.copy(q);
    ray.direction.copy(dir);
    const hits = bvh.raycast(ray, THREE.DoubleSide);
    const inside = (hits.length & 1) === 1;
    return (inside ? 1 : -1) * target.distance;
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
  del(outer);
  del(cavity);

  const geom = manifoldToArrays(shell);
  const volume = shell.volume();
  const status = String(shell.status());
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

// ---------- mesh intake diagnostics ----------

export function inspectCore(wasm: ManifoldWasm, geom: GeomArrays): IntakeReport {
  const pos = geom.position;
  const idx = geom.index;
  const triangles = idx.length / 3;
  const vertices = pos.length / 3;

  const b = computeBounds(pos);
  const size: Vec3 = [b.max[0] - b.min[0], b.max[1] - b.min[1], b.max[2] - b.min[2]];

  // Edge use counts (undirected) + connected components (union-find on vertices).
  const edgeUse = new Map<number, number>();
  const ekey = (u: number, v: number) => (u < v ? u * vertices + v : v * vertices + u);
  const parent = new Int32Array(vertices);
  for (let i = 0; i < vertices; i++) parent[i] = i;
  const find = (x: number): number => {
    while (parent[x] !== x) {
      parent[x] = parent[parent[x]];
      x = parent[x];
    }
    return x;
  };
  const uni = (a: number, c: number) => {
    const ra = find(a);
    const rc = find(c);
    if (ra !== rc) parent[ra] = rc;
  };

  let degenerateTris = 0;
  const ax = [0, 0, 0];
  const bx = [0, 0, 0];
  const cx = [0, 0, 0];
  const scale = Math.max(size[0], size[1], size[2]) || 1;
  const areaEps = scale * scale * 1e-10;
  for (let t = 0; t < triangles; t++) {
    const i0 = idx[t * 3];
    const i1 = idx[t * 3 + 1];
    const i2 = idx[t * 3 + 2];
    for (let k = 0; k < 3; k++) {
      ax[k] = pos[i0 * 3 + k];
      bx[k] = pos[i1 * 3 + k];
      cx[k] = pos[i2 * 3 + k];
    }
    const e1x = bx[0] - ax[0], e1y = bx[1] - ax[1], e1z = bx[2] - ax[2];
    const e2x = cx[0] - ax[0], e2y = cx[1] - ax[1], e2z = cx[2] - ax[2];
    const crx = e1y * e2z - e1z * e2y;
    const cry = e1z * e2x - e1x * e2z;
    const crz = e1x * e2y - e1y * e2x;
    const area = 0.5 * Math.sqrt(crx * crx + cry * cry + crz * crz);
    if (area < areaEps) degenerateTris++;

    const e = [ekey(i0, i1), ekey(i1, i2), ekey(i2, i0)];
    for (const k of e) edgeUse.set(k, (edgeUse.get(k) ?? 0) + 1);
    uni(i0, i1);
    uni(i1, i2);
  }

  let boundaryEdges = 0;
  let nonManifoldEdges = 0;
  for (const c of edgeUse.values()) {
    if (c === 1) boundaryEdges++;
    else if (c > 2) nonManifoldEdges++;
  }

  const roots = new Set<number>();
  for (let t = 0; t < triangles; t++) roots.add(find(idx[t * 3]));
  const components = roots.size;

  // Feed it to Manifold — the ultimate ingest test.
  let manifoldStatus = '(not tested)';
  let genus = NaN;
  let volume = NaN;
  let invertedNormals = false;
  try {
    const m = arraysToManifold(wasm, geom);
    manifoldStatus = String(m.status());
    if (manifoldStatus === 'NoError') {
      try {
        genus = m.genus();
      } catch {
        /* older builds */
      }
      volume = m.volume();
      invertedNormals = volume < 0;
    }
    del(m);
  } catch (e) {
    manifoldStatus = 'NotManifold (' + (e instanceof Error ? e.message : 'rejected') + ')';
  }

  const watertight = boundaryEdges === 0 && nonManifoldEdges === 0;

  const messages: string[] = [];
  let level: 'ok' | 'warn' | 'fail' = 'ok';
  const fail = (m: string) => {
    messages.push(m);
    level = 'fail';
  };
  const warn = (m: string) => {
    messages.push(m);
    if (level === 'ok') level = 'warn';
  };

  if (boundaryEdges > 0) fail(`${boundaryEdges} open edge(s) — mesh has holes / is not closed.`);
  if (nonManifoldEdges > 0) fail(`${nonManifoldEdges} non-manifold edge(s) — edges shared by >2 faces.`);
  if (manifoldStatus !== 'NoError' && !manifoldStatus.startsWith('NotManifold'))
    fail(`Manifold rejected the mesh: ${manifoldStatus}.`);
  else if (manifoldStatus.startsWith('NotManifold')) fail(`Manifold rejected the mesh.`);
  if (components > 1)
    warn(`${components} separate pieces — extra/floating bodies in the input?`);
  if (invertedNormals) warn(`Inverted normals (negative volume) — faces may be flipped.`);
  if (degenerateTris > 0) warn(`${degenerateTris} degenerate (zero-area) triangle(s).`);
  if (scale < 1) warn(`Very small (largest dim ${scale.toFixed(2)} mm) — check units?`);
  if (scale > 1000) warn(`Very large (largest dim ${scale.toFixed(0)} mm) — check units?`);
  if (messages.length === 0) messages.push('No issues found — closed, single-piece, manifold.');

  return {
    triangles,
    vertices,
    boundaryEdges,
    nonManifoldEdges,
    components,
    degenerateTris,
    bbox: { min: [b.min[0], b.min[1], b.min[2]], max: [b.max[0], b.max[1], b.max[2]], size },
    manifoldStatus,
    genus,
    volume,
    watertight,
    invertedNormals,
    level,
    messages,
  };
}
