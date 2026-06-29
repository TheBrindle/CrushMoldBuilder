// Main-thread wrapper around the geometry worker.
// Exposes promise-based generateShell() / bake() with a progress callback.

import type {
  GeomArrays,
  Feature,
  Settings,
  WorkerRequest,
  WorkerResponse,
} from '../types';

type ProgressCb = (phase: string, value?: number) => void;

// Omit over a union keeps only shared keys; distribute to preserve each variant.
type DistributiveOmit<T, K extends keyof T> = T extends unknown ? Omit<T, K> : never;

interface Pending {
  resolve: (r: { geom: GeomArrays; volume: number; status: string }) => void;
  reject: (e: Error) => void;
  onProgress?: ProgressCb;
}

let worker: Worker | null = null;
let nextId = 1;
const pending = new Map<number, Pending>();

function getWorker(): Worker {
  if (!worker) {
    worker = new Worker(new URL('./geometry.worker.ts', import.meta.url), {
      type: 'module',
    });
    worker.onmessage = (e: MessageEvent<WorkerResponse>) => {
      const msg = e.data;
      const p = pending.get(msg.id);
      if (!p) return;
      if (msg.type === 'progress') {
        p.onProgress?.(msg.phase, msg.value);
      } else if (msg.type === 'result') {
        pending.delete(msg.id);
        p.resolve({ geom: msg.geom, volume: msg.volume, status: msg.status });
      } else {
        pending.delete(msg.id);
        p.reject(new Error(msg.message));
      }
    };
    worker.onerror = (e) => {
      const err = new Error(e.message || 'Worker crashed');
      for (const [, p] of pending) p.reject(err);
      pending.clear();
    };
  }
  return worker;
}

function send(
  req: DistributiveOmit<WorkerRequest, 'id'>,
  transfer: Transferable[],
  onProgress?: ProgressCb,
) {
  const w = getWorker();
  const id = nextId++;
  return new Promise<{ geom: GeomArrays; volume: number; status: string }>(
    (resolve, reject) => {
      pending.set(id, { resolve, reject, onProgress });
      w.postMessage({ ...req, id } as WorkerRequest, transfer);
    },
  );
}

export function generateShell(
  part: GeomArrays,
  thickness: number,
  edgeLength: number,
  onProgress?: ProgressCb,
) {
  // Copy buffers so the caller's geometry survives the transfer.
  const partCopy: GeomArrays = {
    position: part.position.slice(),
    index: part.index.slice(),
  };
  return send(
    { type: 'generateShell', part: partCopy, thickness, edgeLength },
    [partCopy.position.buffer, partCopy.index.buffer],
    onProgress,
  );
}

export function bake(
  shell: GeomArrays,
  features: Feature[],
  settings: Settings,
  onProgress?: ProgressCb,
) {
  const shellCopy: GeomArrays = {
    position: shell.position.slice(),
    index: shell.index.slice(),
  };
  return send(
    { type: 'bake', shell: shellCopy, features, settings },
    [shellCopy.position.buffer, shellCopy.index.buffer],
    onProgress,
  );
}
