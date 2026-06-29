/// <reference lib="webworker" />
// Geometry worker: owns the Manifold WASM module and dispatches to the pure core.
// The main thread only ever sends/receives plain typed arrays.

import ManifoldModule from 'manifold-3d';
import type { WorkerRequest, WorkerResponse } from '../types';
import { generateShellCore, bakeCore, type ManifoldWasm } from './geometryCore';

let wasm: ManifoldWasm = null;
async function getWasm(): Promise<ManifoldWasm> {
  if (!wasm) {
    wasm = await ManifoldModule();
    wasm.setup();
  }
  return wasm;
}

const ctx = self as unknown as DedicatedWorkerGlobalScope;

function post(msg: WorkerResponse, transfer?: Transferable[]) {
  ctx.postMessage(msg, transfer ?? []);
}

ctx.onmessage = async (e: MessageEvent<WorkerRequest>) => {
  const req = e.data;
  try {
    const w = await getWasm();
    const onPhase = (phase: string, value?: number) =>
      post({ id: req.id, type: 'progress', phase, value });

    let result;
    if (req.type === 'generateShell') {
      result = generateShellCore(w, req.part, req.thickness, req.edgeLength, onPhase);
    } else {
      result = bakeCore(w, req.shell, req.features, req.settings, onPhase);
    }

    post(
      { id: req.id, type: 'result', geom: result.geom, volume: result.volume, status: result.status },
      [result.geom.position.buffer, result.geom.index.buffer],
    );
  } catch (err) {
    post({
      id: req.id,
      type: 'error',
      message: err instanceof Error ? `${err.message}\n${err.stack ?? ''}` : String(err),
    });
  }
};
