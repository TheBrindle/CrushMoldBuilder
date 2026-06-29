// Generate a clean, watertight sample egg STL for testing the app.
// Run: node scripts/make-egg.mjs  ->  samples/egg.stl
import * as THREE from 'three';
import { STLExporter } from 'three/examples/jsm/exporters/STLExporter.js';
import { mergeVertices } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { mkdirSync, writeFileSync } from 'node:fs';

// Icosphere -> no UV seams -> clean closed manifold after welding.
const ico = new THREE.IcosahedronGeometry(1, 24);
ico.deleteAttribute('normal');
const geo = mergeVertices(ico);

const SCALE = 15; // mm
const pos = geo.getAttribute('position');
for (let i = 0; i < pos.count; i++) {
  let x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
  const taper = 1 - 0.22 * z; // pointier at +z, rounder at -z => egg asymmetry
  x *= taper;
  y *= taper;
  z *= 1.32; // elongate
  pos.setXYZ(i, x * SCALE, y * SCALE, z * SCALE);
}
pos.needsUpdate = true;
geo.computeVertexNormals();

const data = new STLExporter().parse(new THREE.Mesh(geo), { binary: true });
mkdirSync('samples', { recursive: true });
writeFileSync('samples/egg.stl', Buffer.from(data.buffer ?? data));
console.log(`Wrote samples/egg.stl (${pos.count} verts, ${geo.index.count / 3} tris)`);
