import { useMemo, useRef } from 'react';
import { Canvas, type ThreeEvent } from '@react-three/fiber';
import { OrbitControls, Bounds, Grid } from '@react-three/drei';
import * as THREE from 'three';
import { useStore } from '../state/store';
import type { Feature, Vec3 } from '../types';

const UP_Y = new THREE.Vector3(0, 1, 0);
const _ray = new THREE.Raycaster();
// three-mesh-bvh: only return the nearest hit (faster + what we want for thickness).
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

function PickTarget({ geometry }: { geometry: THREE.BufferGeometry }) {
  const meshRef = useRef<THREE.Mesh>(null);
  const mode = useStore((s) => s.mode);
  const addFeature = useStore((s) => s.addFeature);
  const fallback = useStore((s) => s.settings.thickness);

  const handleClick = (e: ThreeEvent<MouseEvent>) => {
    if (mode === 'idle' || !e.face) return;
    e.stopPropagation();
    const point = e.point.clone();
    const normal = e.face.normal
      .clone()
      .transformDirection(e.object.matrixWorld)
      .normalize();
    const wt = measureThickness(point, normal, meshRef.current!) ?? fallback;
    addFeature(
      mode,
      [point.x, point.y, point.z] as Vec3,
      [normal.x, normal.y, normal.z] as Vec3,
      wt,
    );
  };

  return (
    <mesh
      ref={meshRef}
      geometry={geometry}
      onClick={handleClick}
      castShadow
      receiveShadow
    >
      <meshStandardMaterial
        color="#dccfb4"
        roughness={0.85}
        metalness={0}
        side={THREE.DoubleSide}
      />
    </mesh>
  );
}

function FeatureProxy({ feature, selected }: { feature: Feature; selected: boolean }) {
  const settings = useStore((s) => s.settings);
  const select = useStore((s) => s.selectFeature);
  const removeFeature = useStore((s) => s.removeFeature);

  const quat = useMemo(() => {
    const n = new THREE.Vector3(...feature.normal).normalize();
    return new THREE.Quaternion().setFromUnitVectors(UP_Y, n);
  }, [feature.normal]);

  const pos = new THREE.Vector3(...feature.position);
  const color = feature.type === 'vent' ? '#e0564f' : '#4f8fe0';

  if (feature.type === 'vent') {
    const h = feature.wallThickness + 2;
    // match the real cut: centred on the wall mid-plane (inward by wall/2)
    const ventPos = pos
      .clone()
      .addScaledVector(new THREE.Vector3(...feature.normal), -feature.wallThickness / 2);
    return (
      <mesh
        position={ventPos}
        quaternion={quat}
        onClick={(e) => {
          e.stopPropagation();
          select(feature.id);
        }}
        onContextMenu={(e) => {
          e.stopPropagation();
          removeFeature(feature.id);
        }}
      >
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

  // fill funnel proxy: cone standing proud along +normal
  const fh = settings.funnelHeight;
  const offset = pos.clone().addScaledVector(new THREE.Vector3(...feature.normal), fh / 2);
  return (
    <mesh
      position={offset}
      quaternion={quat}
      onClick={(e) => {
        e.stopPropagation();
        select(feature.id);
      }}
      onContextMenu={(e) => {
        e.stopPropagation();
        removeFeature(feature.id);
      }}
    >
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
  const showPart = useStore((s) => s.showPart);
  const features = useStore((s) => s.features);
  const selectedId = useStore((s) => s.selectedId);

  const active = shellGeom ?? partGeom;
  const modelKey = active?.uuid ?? 'none';

  return (
    <>
      <ambientLight intensity={0.6} />
      <directionalLight position={[5, 10, 7]} intensity={1.1} castShadow />
      <directionalLight position={[-6, -4, -5]} intensity={0.35} />

      {active && (
        <Bounds key={modelKey} fit clip observe margin={1.3}>
          {/* Shell is the pick target once generated; otherwise show the raw part. */}
          {shellGeom ? (
            <PickTarget geometry={shellGeom} />
          ) : (
            partGeom && (
              <mesh geometry={partGeom}>
                <meshStandardMaterial color="#bfc6cf" roughness={0.7} metalness={0.05} />
              </mesh>
            )
          )}

          {/* faint ghost of the part once the shell exists */}
          {shellGeom && partGeom && showPart && (
            <mesh geometry={partGeom}>
              <meshStandardMaterial
                color="#8aa0b8"
                transparent
                opacity={0.18}
                depthWrite={false}
              />
            </mesh>
          )}

          {features.map((f) => (
            <FeatureProxy key={f.id} feature={f} selected={f.id === selectedId} />
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
