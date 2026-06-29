// Headless validation of the Manifold geometry engine + the shell (level-set) math.
// Run: node scripts/smoke.mjs
// No UI, no Vite — proves the core pipeline before we wire any React.

import Module from 'manifold-3d';

const PI = Math.PI;
let failures = 0;
function check(name, actual, expected, tolPct = 2) {
  const ok = Math.abs(actual - expected) <= Math.abs(expected) * (tolPct / 100);
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}: got ${actual.toFixed(3)}, expected ~${expected.toFixed(3)} (±${tolPct}%)`);
  if (!ok) failures++;
  return ok;
}

const wasm = await Module();
wasm.setup();
const { Manifold } = wasm;

console.log('=== Test A: boolean difference (cube - through-cylinder) ===');
{
  const cube = Manifold.cube([10, 10, 10], true);            // [-5,5]^3, vol 1000
  const drill = Manifold.cylinder(12, 2, 2, 64, true);        // Z axis, r=2, spans -6..6
  const result = cube.subtract(drill);
  const vol = result.volume();
  const expected = 1000 - PI * 2 * 2 * 10;                    // 1000 - hole(π r² h)
  check('cube-with-hole volume', vol, expected, 1);
  console.log('  status:', result.status?.() ?? '(n/a)', ' isEmpty:', result.isEmpty());
  cube.delete?.(); drill.delete?.(); result.delete?.();
}

console.log('\n=== Test B: set-offset shell via levelSet (analytic sphere SDF) ===');
{
  const R = 10;   // part radius
  const t = 2;    // wall thickness (our 2mm default, in sphere units)
  // SDF convention per Manifold: POSITIVE inside, negative outside.
  const sdf = (p) => R - Math.hypot(p[0], p[1], p[2]);
  const bounds = { min: [-(R + t + 1), -(R + t + 1), -(R + t + 1)],
                   max: [ (R + t + 1),  (R + t + 1),  (R + t + 1)] };
  const edgeLength = 0.5;

  // level = -t outsets the surface by t  -> sphere of radius R+t
  const outer = Manifold.levelSet(sdf, bounds, edgeLength, -t);
  // level = 0 -> original sphere radius R (the cavity)
  const inner = Manifold.levelSet(sdf, bounds, edgeLength, 0);

  const outerVol = outer.volume();
  const innerVol = inner.volume();
  check('outer sphere (R+t) volume', outerVol, (4 / 3) * PI * Math.pow(R + t, 3), 2);
  check('inner sphere (R) volume',   innerVol, (4 / 3) * PI * Math.pow(R, 3), 2);

  const shell = outer.subtract(inner);
  const shellVol = shell.volume();
  const expectedShell = (4 / 3) * PI * (Math.pow(R + t, 3) - Math.pow(R, 3));
  check('hollow shell volume', shellVol, expectedShell, 3);
  console.log('  shell isEmpty:', shell.isEmpty(), ' bbox:', JSON.stringify(shell.boundingBox()));

  outer.delete?.(); inner.delete?.(); shell.delete?.();
}

console.log('\n=== Test C: mesh round-trip (Manifold -> mesh arrays -> Manifold) ===');
{
  const a = Manifold.sphere(5, 32);
  const mesh = a.getMesh();
  console.log('  numProp:', mesh.numProp, ' verts:', mesh.vertProperties.length / mesh.numProp,
              ' tris:', mesh.triVerts.length / 3);
  // Rebuild from the raw arrays the way the worker will (numProp=3 position-only).
  const rebuilt = new wasm.Manifold(new wasm.Mesh({
    numProp: 3,
    vertProperties: mesh.vertProperties,
    triVerts: mesh.triVerts,
  }));
  check('round-trip volume preserved', rebuilt.volume(), a.volume(), 0.5);
  a.delete?.(); rebuilt.delete?.();
}

console.log(`\n${failures === 0 ? 'ALL TESTS PASSED' : failures + ' TEST(S) FAILED'}`);
process.exit(failures === 0 ? 0 : 1);
