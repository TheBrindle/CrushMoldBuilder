import { create } from 'zustand';
import * as THREE from 'three';
import '../lib/bvh'; // side-effect: accelerated raycast + computeBoundsTree
import type { Feature, FeatureType, Settings, Vec3 } from '../types';
import { DEFAULT_SETTINGS } from '../types';
import { parseSTL, toArrays, fromArrays, exportSTL } from '../lib/geometry';
import { openSTL, saveSTL } from '../lib/fileAccess';
import { generateShell as wGenerateShell, bake as wBake } from '../worker/geometryClient';

export type Mode = 'idle' | 'vent' | 'fill';

interface Busy {
  phase: string;
  value?: number;
}

interface State {
  partGeom: THREE.BufferGeometry | null;
  shellGeom: THREE.BufferGeometry | null;
  moldGeom: THREE.BufferGeometry | null;
  partName: string | null;
  features: Feature[];
  selectedId: string | null;
  settings: Settings;
  mode: Mode;
  busy: Busy | null;
  error: string | null;
  showPart: boolean;

  openPart: () => Promise<void>;
  generateShell: () => Promise<void>;
  setMode: (m: Mode) => void;
  addFeature: (type: FeatureType, position: Vec3, normal: Vec3, wallThickness: number) => void;
  removeFeature: (id: string) => void;
  selectFeature: (id: string | null) => void;
  clearFeatures: () => void;
  updateSettings: (patch: Partial<Settings>) => void;
  bakeAndSave: () => Promise<void>;
  setShowPart: (v: boolean) => void;
  dismissError: () => void;
}

function dispose(g: THREE.BufferGeometry | null) {
  g?.dispose();
}

export const useStore = create<State>((set, get) => ({
  partGeom: null,
  shellGeom: null,
  moldGeom: null,
  partName: null,
  features: [],
  selectedId: null,
  settings: DEFAULT_SETTINGS,
  mode: 'idle',
  busy: null,
  error: null,
  showPart: true,

  openPart: async () => {
    try {
      const opened = await openSTL();
      if (!opened) return;
      set({ busy: { phase: 'Reading STL…' } });
      const geom = parseSTL(opened.buffer);
      const s = get();
      dispose(s.partGeom);
      dispose(s.shellGeom);
      dispose(s.moldGeom);
      set({
        partGeom: geom,
        shellGeom: null,
        moldGeom: null,
        features: [],
        selectedId: null,
        mode: 'idle',
        partName: opened.name,
        busy: null,
        showPart: true,
      });
    } catch (e) {
      set({ busy: null, error: e instanceof Error ? e.message : String(e) });
    }
  },

  generateShell: async () => {
    const { partGeom, settings } = get();
    if (!partGeom) return;
    try {
      const arrays = toArrays(partGeom);
      const { geom, status } = await wGenerateShell(
        arrays,
        settings.thickness,
        settings.edgeLength,
        (phase, value) => set({ busy: { phase, value } }),
      );
      if (status !== 'NoError') {
        set({ busy: null, error: `Shell generation returned status: ${status}` });
        return;
      }
      const shellGeom = fromArrays(geom);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (shellGeom as any).computeBoundsTree();
      const s = get();
      dispose(s.shellGeom);
      dispose(s.moldGeom);
      set({
        shellGeom,
        moldGeom: null,
        features: [],
        selectedId: null,
        busy: null,
        showPart: false,
      });
    } catch (e) {
      set({ busy: null, error: e instanceof Error ? e.message : String(e) });
    }
  },

  setMode: (m) => set((s) => ({ mode: s.mode === m ? 'idle' : m })),

  addFeature: (type, position, normal, wallThickness) =>
    set((s) => ({
      features: [
        ...s.features,
        { id: crypto.randomUUID(), type, position, normal, wallThickness },
      ],
    })),

  removeFeature: (id) =>
    set((s) => ({
      features: s.features.filter((f) => f.id !== id),
      selectedId: s.selectedId === id ? null : s.selectedId,
    })),

  selectFeature: (id) => set({ selectedId: id }),

  clearFeatures: () => set({ features: [], selectedId: null }),

  updateSettings: (patch) => set((s) => ({ settings: { ...s.settings, ...patch } })),

  bakeAndSave: async () => {
    const { shellGeom, features, settings, partName } = get();
    if (!shellGeom) return;
    try {
      const arrays = toArrays(shellGeom);
      const { geom, status } = await wBake(
        arrays,
        features,
        settings,
        (phase, value) => set({ busy: { phase, value } }),
      );
      if (status !== 'NoError') {
        set({ busy: null, error: `Bake returned status: ${status}` });
        return;
      }
      const moldGeom = fromArrays(geom);
      const s = get();
      dispose(s.moldGeom);
      set({ moldGeom, busy: { phase: 'Saving STL…' } });
      const blob = exportSTL(moldGeom);
      const base = (partName ?? 'part').replace(/\.stl$/i, '');
      await saveSTL(blob, `${base}-mold.stl`);
      set({ busy: null });
    } catch (e) {
      set({ busy: null, error: e instanceof Error ? e.message : String(e) });
    }
  },

  setShowPart: (v) => set({ showPart: v }),
  dismissError: () => set({ error: null }),
}));
