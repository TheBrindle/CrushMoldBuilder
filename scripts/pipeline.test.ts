// Headless test of the REAL pipeline (mesh -> SDF -> shell -> bake), using the
// same geometryCore the worker uses. Validates watertightness, feature
// orientation, and material change. Run: npx tsx scripts/pipeline.test.ts
import Module from 'manifold-3d';
import * as THREE from 'three';
import { mergeVertices } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { writeFileSync } from 'node:fs';
import {
  generateShellCore,
  bakeCore,
  inspectCore,
  arraysToManifold,
} from '../src/worker/geometryCore';
import { exportSTL, fromArrays, parseSTL } from '../src/lib/geometry';
import { makeStarPrism, starValleyAngleDeg } from './shapes';
import { DEFAULT_SETTINGS, type Feature, type GeomArrays, type Vec3 } from '../src/types';

let failures = 0;
function ok(name: string, cond: boolean, detail = '') {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
  if (!cond) failures++;
}
function maxAxis(geom: GeomArrays, axis: number) {
  let m = -Infinity;
  for (let i = axis; i < geom.position.length; i += 3) m = Math.max(m, geom.position[i]);
  return m;
}

// --- build an egg-ish ellipsoid part (clean closed manifold) ---
const ico = new THREE.IcosahedronGeometry(10, 4);
ico.deleteAttribute('normal'); // weld by position only (same as STL import)
ico.deleteAttribute('uv');
const geo = mergeVertices(ico);
const posAttr = geo.getAttribute('position') as THREE.BufferAttribute;
for (let i = 0; i < posAttr.count; i++) posAttr.setZ(i, posAttr.getZ(i) * 1.3); // elongate -> egg
posAttr.needsUpdate = true;
const part: GeomArrays = {
  position: new Float32Array(posAttr.array as ArrayLike<number>),
  index: new Uint32Array(geo.index!.array as ArrayLike<number>),
};
const partTopZ = maxAxis(part, 2);
console.log(`part: ${part.position.length / 3} verts, ${part.index.length / 3} tris, topZ=${partTopZ.toFixed(2)}`);

const wasm = await Module();
wasm.setup();
const S = { ...DEFAULT_SETTINGS };

console.log('\n=== Intake checker ===');
const rep = inspectCore(wasm, part);
ok('clean egg: watertight', rep.watertight, `boundary=${rep.boundaryEdges} nonManifold=${rep.nonManifoldEdges}`);
ok('clean egg: 1 component', rep.components === 1, `${rep.components}`);
ok('clean egg: manifold NoError', rep.manifoldStatus === 'NoError', rep.manifoldStatus);
ok('clean egg: level ok', rep.level === 'ok', `${rep.level} :: ${rep.messages.join(' | ')}`);
// holey mesh (drop a triangle) must FAIL with open edges
const holey = { position: part.position, index: part.index.slice(0, part.index.length - 3) };
const repH = inspectCore(wasm, holey);
ok('holey mesh: flags open edges + fail', repH.boundaryEdges > 0 && repH.level === 'fail', `open=${repH.boundaryEdges} level=${repH.level}`);

console.log('\n=== Tight sub-90° star: clean shell + intact cavity (no SDF artifacts) ===');
{
  const star = makeStarPrism(6, 12, 2.5, 12); // sharp concave valleys
  const valley = starValleyAngleDeg(6, 12, 2.5);
  ok('valley is a sub-90° inner corner', valley < 90, `${valley.toFixed(0)}°`);

  // Input is clean -> proves any artifacts come from the offset, not the STL.
  const rin = inspectCore(wasm, star);
  ok('star input is clean manifold', rin.level !== 'fail' && rin.components === 1 && rin.watertight,
    `level=${rin.level} comp=${rin.components} water=${rin.watertight}`);

  const ss = generateShellCore(wasm, star, 2, 1.0);
  ok('star shell status NoError', ss.status === 'NoError', ss.status);

  // Topology check: exactly one solid wall (+), one cavity void (-) ~ the star,
  // and genus -1 (a single void, i.e. NO swiss-cheese tunnels from sign errors).
  const m = arraysToManifold(wasm, ss.geom);
  const vols = (m.decompose() as unknown[]).map((p) => (p as { volume(): number }).volume());
  const positive = vols.filter((v) => v > 1e-6);
  const negative = vols.filter((v) => v < -1e-6);
  ok('one solid wall, no positive island debris', positive.length === 1, `positive comps=${positive.length}`);
  ok('mold cavity preserved (one void ≈ star volume)',
    negative.length === 1 && Math.abs(Math.abs(negative[0]) - rin.volume) < rin.volume * 0.05,
    `void=${negative[0]?.toFixed(1)} starVol=${rin.volume.toFixed(1)}`);
  ok('no tunnels — genus = -1 (parity-sign SDF)', m.genus() === -1, `genus=${m.genus()}`);
}

console.log('\n=== Shell ===');
const shell = generateShellCore(wasm, part, S.thickness, S.edgeLength);
const shellTopZ = maxAxis(shell.geom, 2);
ok('shell status NoError', shell.status === 'NoError', shell.status);
ok('shell non-empty', shell.geom.index.length > 0, `${shell.geom.index.length / 3} tris`);
ok('shell volume > 0', shell.volume > 0, shell.volume.toFixed(1));
ok(
  'outer surface grew by ~thickness',
  Math.abs(shellTopZ - (partTopZ + S.thickness)) < S.edgeLength + 0.6,
  `shellTopZ=${shellTopZ.toFixed(2)} vs partTopZ+t=${(partTopZ + S.thickness).toFixed(2)}`,
);

console.log('\n=== Fill port orientation (funnel must point OUTWARD, +Z) ===');
const fill: Feature = {
  id: 'f1',
  type: 'fill',
  position: [0, 0, shellTopZ] as Vec3, // click point on outer surface, top pole
  normal: [0, 0, 1] as Vec3,
  wallThickness: S.thickness,
};
const moldFill = bakeCore(wasm, shell.geom, [fill], S);
const moldFillTopZ = maxAxis(moldFill.geom, 2);
ok('fill bake status NoError', moldFill.status === 'NoError', moldFill.status);
ok(
  'funnel sticks out by ~funnelHeight',
  Math.abs(moldFillTopZ - (shellTopZ + S.funnelHeight)) < 1.0,
  `moldTopZ=${moldFillTopZ.toFixed(2)} vs shellTopZ+fh=${(shellTopZ + S.funnelHeight).toFixed(2)}`,
);
ok('fill added material (volume up)', moldFill.volume > shell.volume, `${moldFill.volume.toFixed(1)} > ${shell.volume.toFixed(1)}`);

console.log('\n=== Vent (through-hole must REMOVE material) ===');
const vent: Feature = {
  id: 'v1',
  type: 'vent',
  position: [0, 0, shellTopZ] as Vec3,
  normal: [0, 0, 1] as Vec3,
  wallThickness: S.thickness,
};
const moldVent = bakeCore(wasm, shell.geom, [vent], S);
ok('vent bake status NoError', moldVent.status === 'NoError', moldVent.status);
ok('vent removed material (volume down)', moldVent.volume < shell.volume, `${moldVent.volume.toFixed(1)} < ${shell.volume.toFixed(1)}`);

console.log('\n=== Combined (fill + 3 vents) stays watertight ===');
const many: Feature[] = [
  fill,
  vent,
  { id: 'v2', type: 'vent', position: [9, 0, 4] as Vec3, normal: [1, 0, 0.3] as Vec3, wallThickness: S.thickness },
  { id: 'v3', type: 'vent', position: [-9, 0, 4] as Vec3, normal: [-1, 0, 0.3] as Vec3, wallThickness: S.thickness },
];
const moldAll = bakeCore(wasm, shell.geom, many, S);
ok('combined bake status NoError', moldAll.status === 'NoError', moldAll.status);
ok('combined non-empty', moldAll.geom.index.length > 0, `${moldAll.geom.index.length / 3} tris`);

console.log('\n=== STL out (export binary STL, then re-import) ===');
const blob = exportSTL(fromArrays(moldAll.geom));
const outBuf = await blob.arrayBuffer();
writeFileSync('samples/test-mold.stl', Buffer.from(outBuf));
const reimported = parseSTL(outBuf);
const outTris = reimported.index!.count / 3;
ok('exported STL is non-trivial', outBuf.byteLength > 1000, `${(outBuf.byteLength / 1024).toFixed(0)} KB`);
ok('re-imported STL has triangles', outTris > 0, `${outTris} tris`);

console.log(`\n${failures === 0 ? 'ALL PIPELINE TESTS PASSED' : failures + ' TEST(S) FAILED'}`);
process.exit(failures === 0 ? 0 : 1);
