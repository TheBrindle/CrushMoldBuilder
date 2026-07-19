import { create } from 'zustand';
import * as THREE from 'three';
import '../lib/bvh'; // side-effect: accelerated raycast + computeBoundsTree
import type { Feature, FeatureType, IntakeReport, Settings, Vec3 } from '../types';
import type { FeedbackKind } from '../lib/feedback';
import { DEFAULT_SETTINGS } from '../types';
import { parseSTL, toArrays, fromArrays, exportSTL } from '../lib/geometry';
import { openSTL, saveSTL } from '../lib/fileAccess';
import {
  generateShell as wGenerateShell,
  bake as wBake,
  inspect as wInspect,
} from '../worker/geometryClient';

export type Mode = 'idle' | 'vent' | 'fill';
export type ViewMode = 'edit' | 'preview';

interface Busy {
  phase: string;
  value?: number;
}

interface State {
  partGeom: THREE.BufferGeometry | null;
  shellGeom: THREE.BufferGeometry | null;
  moldGeom: THREE.BufferGeometry | null; // baked result (preview), null when stale
  partName: string | null;
  intakeReport: IntakeReport | null;
  features: Feature[];
  selectedId: string | null;
  settings: Settings;
  mode: Mode;
  viewMode: ViewMode;
  busy: Busy | null;
  error: string | null;
  showPart: boolean;
  feedback: { kind: FeedbackKind; image: string } | null;

  openPart: () => Promise<void>;
  generateShell: () => Promise<void>;
  setMode: (m: Mode) => void;
  addFeature: (type: FeatureType, position: Vec3, normal: Vec3, wallThickness: number) => void;
  updateFeature: (id: string, position: Vec3, normal: Vec3, wallThickness: number) => void;
  removeFeature: (id: string) => void;
  selectFeature: (id: string | null) => void;
  clearFeatures: () => void;
  updateSettings: (patch: Partial<Settings>) => void;
  previewMold: () => Promise<void>;
  setViewMode: (m: ViewMode) => void;
  bakeAndSave: () => Promise<void>;
  setShowPart: (v: boolean) => void;
  dismissError: () => void;
  openFeedback: (kind: FeedbackKind, image: string) => void;
  closeFeedback: () => void;
}

function dispose(g: THREE.BufferGeometry | null) {
  g?.dispose();
}

export const useStore = create<State>((set, get) => {
  // Any edit to features/settings/shell makes a baked preview stale.
  const invalidatePreview = () => {
    const m = get().moldGeom;
    if (m) dispose(m);
    return { moldGeom: null, viewMode: 'edit' as ViewMode };
  };

  return {
    partGeom: null,
    shellGeom: null,
    moldGeom: null,
    partName: null,
    intakeReport: null,
    features: [],
    selectedId: null,
    settings: DEFAULT_SETTINGS,
    mode: 'idle',
    viewMode: 'edit',
    busy: null,
    error: null,
    showPart: true,
    feedback: null,

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
          viewMode: 'edit',
          partName: opened.name,
          intakeReport: null,
          showPart: true,
          busy: { phase: 'Checking mesh…' },
        });
        // Mesh intake diagnostics.
        try {
          const report = await wInspect(toArrays(geom));
          set({ intakeReport: report });
        } catch {
          /* non-fatal: skip report */
        }
        set({ busy: null });
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
          viewMode: 'edit',
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
        features: [...s.features, { id: crypto.randomUUID(), type, position, normal, wallThickness }],
        ...invalidatePreview(),
      })),

    updateFeature: (id, position, normal, wallThickness) =>
      set((s) => ({
        features: s.features.map((f) =>
          f.id === id ? { ...f, position, normal, wallThickness } : f,
        ),
        ...invalidatePreview(),
      })),

    removeFeature: (id) =>
      set((s) => ({
        features: s.features.filter((f) => f.id !== id),
        selectedId: s.selectedId === id ? null : s.selectedId,
        ...invalidatePreview(),
      })),

    selectFeature: (id) => set({ selectedId: id }),

    clearFeatures: () => set({ features: [], selectedId: null, ...invalidatePreview() }),

    updateSettings: (patch) =>
      set((s) => ({ settings: { ...s.settings, ...patch }, ...invalidatePreview() })),

    previewMold: async () => {
      const { shellGeom, moldGeom, features, settings } = get();
      if (!shellGeom) return;
      if (moldGeom) {
        // already fresh — just show it
        set({ viewMode: 'preview' });
        return;
      }
      try {
        const arrays = toArrays(shellGeom);
        const { geom, status } = await wBake(arrays, features, settings, (phase, value) =>
          set({ busy: { phase, value } }),
        );
        if (status !== 'NoError') {
          set({ busy: null, error: `Bake returned status: ${status}` });
          return;
        }
        const baked = fromArrays(geom);
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (baked as any).computeBoundsTree();
        dispose(get().moldGeom);
        set({ moldGeom: baked, viewMode: 'preview', busy: null });
      } catch (e) {
        set({ busy: null, error: e instanceof Error ? e.message : String(e) });
      }
    },

    setViewMode: (m) => set({ viewMode: m }),

    bakeAndSave: async () => {
      const { shellGeom, features, settings, partName } = get();
      if (!shellGeom) return;
      try {
        let baked = get().moldGeom;
        if (!baked) {
          const arrays = toArrays(shellGeom);
          const { geom, status } = await wBake(arrays, features, settings, (phase, value) =>
            set({ busy: { phase, value } }),
          );
          if (status !== 'NoError') {
            set({ busy: null, error: `Bake returned status: ${status}` });
            return;
          }
          baked = fromArrays(geom);
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          (baked as any).computeBoundsTree();
          dispose(get().moldGeom);
          set({ moldGeom: baked, viewMode: 'preview' });
        }
        set({ busy: { phase: 'Saving STL…' } });
        const blob = exportSTL(baked);
        const base = (partName ?? 'part').replace(/\.stl$/i, '');
        await saveSTL(blob, `${base}-mold.stl`);
        set({ busy: null });
      } catch (e) {
        set({ busy: null, error: e instanceof Error ? e.message : String(e) });
      }
    },

    setShowPart: (v) => set({ showPart: v }),
    dismissError: () => set({ error: null }),
    openFeedback: (kind, image) => set({ feedback: { kind, image } }),
    closeFeedback: () => set({ feedback: null }),
  };
});
