# Crush Mold Builder

A local-first browser app that turns a part STL (e.g. an egg) into a **watertight,
resin-printable crush mold**: it shells the part to a set wall thickness, lets you
click the surface to place a fill port and vents, and bakes everything into one
manifold STL — all client-side, nothing uploaded.

**Live demo:** _deploying on Vercel — link coming soon._

**Pipeline:** Open part STL → Generate shell (set offset) → click to place vents +
fill port → Bake & Save mold STL. Units are millimetres throughout (1 unit = 1 mm).

## Quick start

```bash
npm install
npm run dev          # http://localhost:5173
```

Open `samples/egg.stl` (also served at `/egg.stl`) to try it immediately.

## Scripts

| Command | What it does |
| --- | --- |
| `npm run dev` | Dev server |
| `npm run build` | Type-check + production build (emits PWA service worker) |
| `npm run preview` | Serve the production build |
| `npm test` | Headless pipeline test (mesh → shell → bake → STL round-trip) |
| `npm run test:smoke` | Headless engine test (boolean + level-set math) |
| `node scripts/make-egg.mjs` | Regenerate `samples/egg.stl` |

## Install as an app (PWA)

`npm run build` produces an installable PWA. Serve `dist/` (or `npm run preview`),
then in Chrome/Edge use the install icon in the address bar. It gets its own window
and desktop icon, works fully offline (the Manifold WASM is precached), and uses the
File System Access API for native Open/Save.

## Deploy (Vercel)

Fully static, client-side only — no backend. Import the repo into Vercel; it
auto-detects Vite (build `npm run build`, output `dist/`) and redeploys on every
push. No environment variables or special headers needed — the Manifold WASM is
single-threaded, so no cross-origin isolation is required.

## How it works

- **three.js + react-three-fiber** — viewer and click→surface raycasting.
- **three-mesh-bvh** — fast picking, inward thickness ray, and the signed-distance
  field used for shelling.
- **manifold-3d (WASM)** — guaranteed-watertight boolean engine. Runs in a Web
  Worker so the UI never blocks. The main thread never touches WASM; geometry
  crosses the worker boundary as transferable typed arrays.
- **Shell** = build an SDF from the part (positive inside), extract the outward
  offset surface with `Manifold.levelSet(sdf, bounds, edgeLength, -thickness)`, then
  subtract the part to leave the wall.
- **Placement is data; booleans bake at export** — clicks store `{point, normal,
  type}` and draw cheap proxies; the actual unions/cuts happen once in `Bake & Save`.

### Source map

```
src/
  worker/geometryCore.ts    pure pipeline (shell, feature builders, bake) — tested in Node
  worker/geometry.worker.ts thin worker wrapper around the core
  worker/geometryClient.ts  main-thread promise/progress wrapper
  lib/geometry.ts           STL parse/export, weld-by-position, array<->geometry
  lib/fileAccess.ts         File System Access API open/save (+ fallback)
  lib/bvh.ts                three-mesh-bvh raycast registration
  state/store.ts            zustand store + orchestration
  components/Viewport.tsx   r3f canvas, picker, feature proxies
  components/ControlsPanel.tsx  UI
```

## Notes / current limits (v1)

- The part STL should be a closed solid; it's welded by position on import. If it
  isn't perfectly watertight the cavity falls back to a level-set surface.
- Vents/fill ports pierce the full wall (thickness is measured per-click by an
  inward ray). Vents double as resin drain points — place them at high spots.
- Not yet: drag-to-reposition, variable thickness, auto-vent, 3MF export. Placement
  is currently committed on click; bake/save produces the STL.
