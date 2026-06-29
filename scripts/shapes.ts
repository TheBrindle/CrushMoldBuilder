// Test-fixture geometry generators. Build clean, watertight manifolds with
// controllable sharp concave features for exercising the shell pipeline.
import * as THREE from 'three';
import { mergeVertices } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { GeomArrays } from '../src/types';

function toArrays(geo: THREE.BufferGeometry): GeomArrays {
  geo.deleteAttribute('normal');
  geo.deleteAttribute('uv');
  const merged = mergeVertices(geo);
  return {
    position: new Float32Array(merged.getAttribute('position').array as ArrayLike<number>),
    index: new Uint32Array(merged.index!.array as ArrayLike<number>),
  };
}

/**
 * A star prism: an N-point star extruded along Z. The valleys between points are
 * sharp concave (sub-90°) vertical corners — a stress test for the SDF offset.
 * Smaller innerR => sharper valleys.
 */
export function makeStarPrism(
  points = 6,
  outerR = 12,
  innerR = 2.5,
  height = 12,
): GeomArrays {
  const shape = new THREE.Shape();
  const step = Math.PI / points;
  for (let i = 0; i < points * 2; i++) {
    const r = i % 2 === 0 ? outerR : innerR;
    const a = i * step - Math.PI / 2;
    const x = Math.cos(a) * r;
    const y = Math.sin(a) * r;
    if (i === 0) shape.moveTo(x, y);
    else shape.lineTo(x, y);
  }
  shape.closePath();
  const geo = new THREE.ExtrudeGeometry(shape, { depth: height, bevelEnabled: false });
  geo.translate(0, 0, -height / 2);
  return toArrays(geo);
}

/** Interior (concave) angle at a star valley, in degrees — to confirm it's sub-90. */
export function starValleyAngleDeg(points: number, outerR: number, innerR: number): number {
  const step = Math.PI / points;
  // valley vertex at angle 0 (radius innerR); neighbours are outer vertices at ±step.
  const v = new THREE.Vector2(innerR, 0);
  const a = new THREE.Vector2(Math.cos(step) * outerR, Math.sin(step) * outerR);
  const b = new THREE.Vector2(Math.cos(-step) * outerR, Math.sin(-step) * outerR);
  const va = a.clone().sub(v).normalize();
  const vb = b.clone().sub(v).normalize();
  return (Math.acos(THREE.MathUtils.clamp(va.dot(vb), -1, 1)) * 180) / Math.PI;
}
