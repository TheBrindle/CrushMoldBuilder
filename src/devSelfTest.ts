// DEV-only: exercise the real browser worker + Manifold WASM path once on load,
// so we can confirm the in-browser engine works (not just the Node tests).
// Tree-shaken out of production (imported only under import.meta.env.DEV).
import * as THREE from 'three';
import { mergeVertices } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { generateShell, bake } from './worker/geometryClient';
import { useStore } from './state/store';
import { parseSTL, toArrays, fromArrays } from './lib/geometry';

// DEV harness so an automated browser check can drive the real store/worker/view
// without poking the OS file picker. Never bundled in production.
(window as unknown as { __mold?: unknown }).__mold = {
  store: useStore,
  loadUrl: async (url = '/egg.stl') => {
    const buf = await (await fetch(url)).arrayBuffer();
    const geom = parseSTL(buf);
    useStore.setState({
      partGeom: geom,
      shellGeom: null,
      moldGeom: null,
      features: [],
      partName: 'egg.stl',
      showPart: true,
    });
    return { tris: geom.index!.count / 3 };
  },
  // Bake via the real worker but DISPLAY the result (no OS save dialog) so an
  // automated check can see the actual holes/funnel in the mesh.
  bakePreview: async () => {
    const s = useStore.getState();
    if (!s.shellGeom) return { error: 'no shell' };
    const r = await bake(toArrays(s.shellGeom), s.features, s.settings);
    const moldGeom = fromArrays(r.geom);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (moldGeom as any).computeBoundsTree();
    useStore.setState({ shellGeom: moldGeom, moldGeom });
    return { status: r.status, tris: r.geom.index.length / 3 };
  },
};

export async function runEngineSelfTest() {
  try {
    const ico = new THREE.IcosahedronGeometry(8, 2);
    ico.deleteAttribute('normal');
    const g = mergeVertices(ico);
    const position = new Float32Array(g.getAttribute('position').array as ArrayLike<number>);
    const index = new Uint32Array(g.index!.array as ArrayLike<number>);

    const t0 = performance.now();
    const r = await generateShell({ position, index }, 2, 1.5);
    const ms = (performance.now() - t0).toFixed(0);
    // eslint-disable-next-line no-console
    console.log(
      `[engine] OK — browser worker + WASM. shell tris=${r.geom.index.length / 3}, status=${r.status}, ${ms}ms`,
    );
    (window as unknown as { __engineOK?: boolean }).__engineOK = r.status === 'NoError';
  } catch (e) {
    // eslint-disable-next-line no-console
    console.error('[engine] SELF-TEST FAILED', e);
    (window as unknown as { __engineOK?: boolean }).__engineOK = false;
  }
}
