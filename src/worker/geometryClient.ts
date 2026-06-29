// Main-thread wrapper around the geometry worker.
// Promise-based generateShell() / bake() / inspect() with a progress callback.

import type {
  GeomArrays,
  Feature,
  Settings,
  IntakeReport,
  WorkerRequest,
  WorkerResponse,
} from '../types';

type ProgressCb = (phase: string, value?: number) => void;

// Omit over a union keeps only shared keys; distribute to preserve each variant.
type DistributiveOmit<T, K extends keyof T> = T extends unknown ? Omit<T, K> : never;

export interface ShellResult {
  geom: GeomArrays;
  volume: number;
  status: string;
}

interface Pending {
  resolve: (r: unknown) => void;
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
        p.resolve({
          geom: msg.geom,
          volume: msg.volume,
          status: msg.status,
        } satisfies ShellResult);
      } else if (msg.type === 'inspectResult') {
        pending.delete(msg.id);
        p.resolve(msg.report);
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

function send<T>(
  req: DistributiveOmit<WorkerRequest, 'id'>,
  transfer: Transferable[],
  onProgress?: ProgressCb,
): Promise<T> {
  const w = getWorker();
  const id = nextId++;
  return new Promise<T>((resolve, reject) => {
    pending.set(id, { resolve: resolve as (r: unknown) => void, reject, onProgress });
    w.postMessage({ ...req, id } as WorkerRequest, transfer);
  });
}

export function generateShell(
  part: GeomArrays,
  thickness: number,
  edgeLength: number,
  onProgress?: ProgressCb,
): Promise<ShellResult> {
  const partCopy: GeomArrays = { position: part.position.slice(), index: part.index.slice() };
  return send<ShellResult>(
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
): Promise<ShellResult> {
  const shellCopy: GeomArrays = { position: shell.position.slice(), index: shell.index.slice() };
  return send<ShellResult>(
    { type: 'bake', shell: shellCopy, features, settings },
    [shellCopy.position.buffer, shellCopy.index.buffer],
    onProgress,
  );
}

export function inspect(geom: GeomArrays): Promise<IntakeReport> {
  const copy: GeomArrays = { position: geom.position.slice(), index: geom.index.slice() };
  return send<IntakeReport>({ type: 'inspect', geom: copy }, [
    copy.position.buffer,
    copy.index.buffer,
  ]);
}
