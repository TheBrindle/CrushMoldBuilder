// three.js geometry helpers: STL parse/export, weld-by-position, array <-> geometry.
import * as THREE from 'three';
import { STLLoader } from 'three/examples/jsm/loaders/STLLoader.js';
import { STLExporter } from 'three/examples/jsm/exporters/STLExporter.js';
import { mergeVertices } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { GeomArrays } from '../types';

const loader = new STLLoader();
const exporter = new STLExporter();

/**
 * Parse STL bytes into a clean, indexed, position-welded geometry.
 * STL is flat triangle soup with per-face normals, so we drop normals BEFORE
 * merging — otherwise nothing welds and the mesh reads as non-manifold.
 */
export function parseSTL(buffer: ArrayBuffer): THREE.BufferGeometry {
  const raw = loader.parse(buffer);
  raw.deleteAttribute('normal');
  raw.deleteAttribute('uv');
  const merged = mergeVertices(raw); // weld purely by position
  merged.computeVertexNormals(); // smooth normals for display
  merged.computeBoundingBox();
  return merged;
}

/** Export an indexed geometry to a binary STL Blob. */
export function exportSTL(geometry: THREE.BufferGeometry): Blob {
  const mesh = new THREE.Mesh(geometry);
  // STLExporter binary output is an ArrayBuffer.
  const data = exporter.parse(mesh, { binary: true }) as unknown as ArrayBuffer;
  return new Blob([data], { type: 'model/stl' });
}

/** Extract position + Uint32 index arrays for the worker. Assumes indexed geometry. */
export function toArrays(geometry: THREE.BufferGeometry): GeomArrays {
  let geo = geometry;
  if (!geo.index) geo = mergeVertices(geo);
  const position = new Float32Array(
    (geo.getAttribute('position') as THREE.BufferAttribute).array as ArrayLike<number>,
  );
  const idxAttr = geo.index!;
  const index = new Uint32Array(idxAttr.array as ArrayLike<number>);
  return { position, index };
}

/** Build a display geometry (with smooth normals + BVH) from worker arrays. */
export function fromArrays(geom: GeomArrays): THREE.BufferGeometry {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(geom.position, 3));
  g.setIndex(new THREE.BufferAttribute(geom.index, 1));
  g.computeVertexNormals();
  g.computeBoundingBox();
  return g;
}

export function center(geometry: THREE.BufferGeometry): THREE.Vector3 {
  geometry.computeBoundingBox();
  const c = new THREE.Vector3();
  geometry.boundingBox!.getCenter(c);
  return c;
}
