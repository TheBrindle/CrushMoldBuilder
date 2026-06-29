import { useEffect, useMemo, useRef, useState } from 'react';
import { Canvas, useThree, type ThreeEvent } from '@react-three/fiber';
import { OrbitControls, Bounds, Grid } from '@react-three/drei';
import * as THREE from 'three';
import { useStore } from '../state/store';
import type { Feature, Vec3 } from '../types';

const UP_Y = new THREE.Vector3(0, 1, 0);
const _ray = new THREE.Raycaster();
// three-mesh-bvh: only return the nearest hit.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
(_ray as any).firstHitOnly = true;

/** Cast inward from a surface point to find the opposite wall -> local thickness (mm). */
function measureThickness(point: THREE.Vector3, normal: THREE.Vector3, mesh: THREE.Mesh) {
  const back = 0.05;
  const origin = point.clone().addScaledVector(normal, -back);
  _ray.set(origin, normal.clone().multiplyScalar(-1));
  const hits = _ray.intersectObject(mesh, false);
  return hits.length ? hits[0].distance + back : null;
}

function FeatureProxy({
  feature,
  selected,
  onStartDrag,
}: {
  feature: Feature;
  selected: boolean;
  onStartDrag: (id: string) => void;
}) {
  const settings = useStore((s) => s.settings);
  const select = useStore((s) => s.selectFeature);
  const removeFeature = useStore((s) => s.removeFeature);

  const quat = useMemo(() => {
    const n = new THREE.Vector3(...feature.normal).normalize();
    return new THREE.Quaternion().setFromUnitVectors(UP_Y, n);
  }, [feature.normal]);

  const pos = new THREE.Vector3(...feature.position);
  const color = feature.type === 'vent' ? '#e0564f' : '#4f8fe0';
  const handlers = {
    onPointerDown: (e: ThreeEvent<PointerEvent>) => {
      e.stopPropagation();
      select(feature.id);
      onStartDrag(feature.id);
    },
    onContextMenu: (e: ThreeEvent<MouseEvent>) => {
      e.stopPropagation();
      removeFeature(feature.id);
    },
  };

  if (feature.type === 'vent') {
    const h = feature.wallThickness + 2;
    const ventPos = pos
      .clone()
      .addScaledVector(new THREE.Vector3(...feature.normal), -feature.wallThickness / 2);
    return (
      <mesh position={ventPos} quaternion={quat} {...handlers}>
        <cylinderGeometry args={[settings.ventDia / 2, settings.ventDia / 2, h, 20]} />
        <meshStandardMaterial
          color={color}
          emissive={selected ? color : '#000'}
          emissiveIntensity={selected ? 0.6 : 0}
          transparent
          opacity={0.85}
        />
      </mesh>
    );
  }

  const fh = settings.funnelHeight;
  const offset = pos.clone().addScaledVector(new THREE.Vector3(...feature.normal), fh / 2);
  return (
    <mesh position={offset} quaternion={quat} {...handlers}>
      <coneGeometry args={[settings.funnelTopDia / 2, fh, 28, 1, true]} />
      <meshStandardMaterial
        color={color}
        emissive={selected ? color : '#000'}
        emissiveIntensity={selected ? 0.6 : 0}
        transparent
        opacity={0.7}
        side={THREE.DoubleSide}
      />
    </mesh>
  );
}

function Scene() {
  const partGeom = useStore((s) => s.partGeom);
  const shellGeom = useStore((s) => s.shellGeom);
  const moldGeom = useStore((s) => s.moldGeom);
  const viewMode = useStore((s) => s.viewMode);
  const showPart = useStore((s) => s.showPart);
  const features = useStore((s) => s.features);
  const selectedId = useStore((s) => s.selectedId);
  const mode = useStore((s) => s.mode);
  const addFeature = useStore((s) => s.addFeature);
  const updateFeature = useStore((s) => s.updateFeature);
  const fallbackThickness = useStore((s) => s.settings.thickness);

  const { camera, gl, controls } = useThree();
  const shellMeshRef = useRef<THREE.Mesh>(null);
  const draggingRef = useRef<string | null>(null);
  const [, force] = useState(0);

  const showMold = viewMode === 'preview' && !!moldGeom;

  // place on click (only in a placing mode, edit view)
  const handlePlace = (e: ThreeEvent<MouseEvent>) => {
    if (mode === 'idle' || !e.face || draggingRef.current) return;
    e.stopPropagation();
    const point = e.point.clone();
    const normal = e.face.normal.clone().transformDirection(e.object.matrixWorld).normalize();
    const wt = measureThickness(point, normal, shellMeshRef.current!) ?? fallbackThickness;
    addFeature(
      mode,
      [point.x, point.y, point.z] as Vec3,
      [normal.x, normal.y, normal.z] as Vec3,
      wt,
    );
  };

  const startDrag = (id: string) => {
    draggingRef.current = id;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    if (controls) (controls as any).enabled = false;
    force((n) => n + 1);
  };

  // Surface-constrained drag: raycast the shell on pointer move while dragging.
  useEffect(() => {
    const dom = gl.domElement;
    const ndc = new THREE.Vector2();
    const rc = new THREE.Raycaster();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (rc as any).firstHitOnly = true;

    const onMove = (ev: PointerEvent) => {
      const id = draggingRef.current;
      const mesh = shellMeshRef.current;
      if (!id || !mesh) return;
      const rect = dom.getBoundingClientRect();
      ndc.x = ((ev.clientX - rect.left) / rect.width) * 2 - 1;
      ndc.y = -((ev.clientY - rect.top) / rect.height) * 2 + 1;
      rc.setFromCamera(ndc, camera);
      const hits = rc.intersectObject(mesh, false);
      if (hits.length && hits[0].face) {
        const p = hits[0].point;
        const n = hits[0].face.normal
          .clone()
          .transformDirection(mesh.matrixWorld)
          .normalize();
        const f = useStore.getState().features.find((x) => x.id === id);
        updateFeature(
          id,
          [p.x, p.y, p.z],
          [n.x, n.y, n.z],
          f?.wallThickness ?? fallbackThickness,
        );
      }
    };

    const onUp = () => {
      const id = draggingRef.current;
      if (!id) return;
      const mesh = shellMeshRef.current;
      const f = useStore.getState().features.find((x) => x.id === id);
      if (mesh && f) {
        const wt =
          measureThickness(
            new THREE.Vector3(...f.position),
            new THREE.Vector3(...f.normal),
            mesh,
          ) ?? fallbackThickness;
        updateFeature(id, f.position, f.normal, wt);
      }
      draggingRef.current = null;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      if (controls) (controls as any).enabled = true;
      force((n) => n + 1);
    };

    dom.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    return () => {
      dom.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
    };
  }, [camera, gl, controls, updateFeature, fallbackThickness]);

  const active = shellGeom ?? partGeom;
  const modelKey = active?.uuid ?? 'none';

  return (
    <>
      <ambientLight intensity={0.6} />
      <directionalLight position={[5, 10, 7]} intensity={1.1} castShadow />
      <directionalLight position={[-6, -4, -5]} intensity={0.35} />

      {active && (
        <Bounds key={modelKey} fit clip margin={1.3}>
          {showMold ? (
            <mesh geometry={moldGeom!}>
              <meshStandardMaterial
                color="#caa46a"
                roughness={0.8}
                metalness={0.02}
                side={THREE.DoubleSide}
              />
            </mesh>
          ) : shellGeom ? (
            <mesh ref={shellMeshRef} geometry={shellGeom} onClick={handlePlace}>
              <meshStandardMaterial
                color="#dccfb4"
                roughness={0.85}
                metalness={0}
                side={THREE.DoubleSide}
              />
            </mesh>
          ) : (
            partGeom && (
              <mesh geometry={partGeom}>
                <meshStandardMaterial color="#bfc6cf" roughness={0.7} metalness={0.05} />
              </mesh>
            )
          )}

          {!showMold && shellGeom && partGeom && showPart && (
            <mesh geometry={partGeom}>
              <meshStandardMaterial
                color="#8aa0b8"
                transparent
                opacity={0.18}
                depthWrite={false}
              />
            </mesh>
          )}

          {!showMold &&
            shellGeom &&
            features.map((f) => (
              <FeatureProxy
                key={f.id}
                feature={f}
                selected={f.id === selectedId}
                onStartDrag={startDrag}
              />
            ))}
        </Bounds>
      )}

      <Grid
        args={[200, 200]}
        cellSize={5}
        sectionSize={25}
        infiniteGrid
        fadeDistance={300}
        cellColor="#2a2f37"
        sectionColor="#3a4250"
        position={[0, -0.001, 0]}
      />

      <OrbitControls makeDefault enableDamping />
    </>
  );
}

export default function Viewport() {
  return (
    <Canvas
      shadows
      camera={{ position: [40, 30, 40], fov: 45, near: 0.1, far: 5000 }}
      style={{ background: 'linear-gradient(180deg,#1a1d23,#101216)' }}
    >
      <Scene />
    </Canvas>
  );
}
