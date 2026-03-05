'use client';

import { useRef, useState, useCallback, useEffect, useMemo, Suspense } from 'react';
import { Canvas, useThree, useFrame } from '@react-three/fiber';
import { OrbitControls } from '@react-three/drei';
import * as THREE from 'three';
import type { CameraState } from '@/lib/camera-utils';

const CENTER = new THREE.Vector3(0, 0.75, 0);
const BASE_DISTANCE = 1.6;

// Spherical → Cartesian for the virtual camera model position
function cameraPos(azimuth: number, elevation: number, distance: number): THREE.Vector3 {
  const az = (azimuth * Math.PI) / 180;
  const el = (elevation * Math.PI) / 180;
  const r = BASE_DISTANCE * distance;
  return new THREE.Vector3(
    r * Math.sin(az) * Math.cos(el),
    r * Math.sin(el) + CENTER.y,
    r * Math.cos(az) * Math.cos(el),
  );
}

// Cartesian → Spherical (reverse: position → camera state)
function posToCamera(pos: THREE.Vector3): CameraState {
  const dx = pos.x;
  const dy = pos.y - CENTER.y;
  const dz = pos.z;
  const r = Math.sqrt(dx * dx + dy * dy + dz * dz);
  const elevation = Math.asin(dy / r) * (180 / Math.PI);
  let azimuth = Math.atan2(dx, dz) * (180 / Math.PI);
  if (azimuth < 0) azimuth += 360;
  const distance = r / BASE_DISTANCE;
  return {
    azimuth: Math.max(0, Math.min(360, azimuth)),
    elevation: Math.max(-30, Math.min(60, elevation)),
    distance: Math.max(0.6, Math.min(1.4, distance)),
  };
}

/* ─── Image Plane ─── */
function ImagePlane({ imageUrl }: { imageUrl: string }) {
  const texture = useMemo(() => {
    const tex = new THREE.TextureLoader().load(imageUrl);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.minFilter = THREE.LinearFilter;
    tex.magFilter = THREE.LinearFilter;
    return tex;
  }, [imageUrl]);

  const [aspect, setAspect] = useState(1);
  useEffect(() => {
    const img = new Image();
    img.onload = () => setAspect(img.width / img.height);
    img.src = imageUrl;
  }, [imageUrl]);

  const maxW = 2.2;
  const w = aspect >= 1 ? maxW : maxW * aspect;
  const h = aspect >= 1 ? maxW / aspect : maxW;

  return (
    <group position={[0, h / 2 + 0.01, 0]}>
      {/* Front: image texture */}
      <mesh>
        <planeGeometry args={[w, h]} />
        <meshBasicMaterial map={texture} side={THREE.FrontSide} />
      </mesh>
      {/* Back: mirrored image with dark overlay (faintly visible) */}
      <mesh rotation={[0, Math.PI, 0]} position={[0, 0, -0.001]}>
        <planeGeometry args={[w, h]} />
        <meshBasicMaterial map={texture} side={THREE.FrontSide} color="#444444" />
      </mesh>
    </group>
  );
}

/* ─── Draggable 3D Camera Model ─── */
function DraggableCameraModel({
  target,
  onDragUpdate,
  onDragStart,
  onDragEnd,
}: {
  target: THREE.Vector3;
  onDragUpdate: (newState: CameraState) => void;
  onDragStart?: () => void;
  onDragEnd?: () => void;
}) {
  const ref = useRef<THREE.Group>(null);
  const currentPos = useRef(target.clone());
  const isDragging = useRef(false);
  const [hovered, setHovered] = useState(false);
  const { gl } = useThree();

  // Smooth lerp when not dragging
  useFrame(() => {
    if (!ref.current) return;
    if (!isDragging.current) {
      currentPos.current.lerp(target, 0.12);
    }
    ref.current.position.copy(currentPos.current);
    ref.current.lookAt(CENTER);
  });

  // Drag: constrain to sphere around CENTER
  const startMouse = useRef({ x: 0, y: 0 });
  const startAz = useRef(0);
  const startEl = useRef(0);

  const onPointerMove = useCallback((e: PointerEvent) => {
    if (!isDragging.current) return;
    const dx = e.clientX - startMouse.current.x;
    // Horizontal drag only — azimuth changes, elevation stays fixed
    const newAz = (startAz.current + dx * 0.6 + 360) % 360;
    const cam = posToCamera(currentPos.current);
    const newPos = cameraPos(newAz, startEl.current, cam.distance);
    currentPos.current.copy(newPos);
    onDragUpdate({ azimuth: newAz, elevation: startEl.current, distance: cam.distance });
  }, [onDragUpdate]);

  const onPointerUp = useCallback(() => {
    isDragging.current = false;
    gl.domElement.style.cursor = '';
    onDragEnd?.();
    window.removeEventListener('pointermove', onPointerMove);
    window.removeEventListener('pointerup', onPointerUp);
  }, [gl, onPointerMove, onDragEnd]);

  const handlePointerDown = useCallback(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (e: any) => {
      e.stopPropagation();
      isDragging.current = true;
      onDragStart?.();
      const cam = posToCamera(currentPos.current);
      startMouse.current = { x: e.nativeEvent.clientX, y: e.nativeEvent.clientY };
      startAz.current = cam.azimuth;
      startEl.current = cam.elevation;
      gl.domElement.style.cursor = 'grabbing';
      window.addEventListener('pointermove', onPointerMove);
      window.addEventListener('pointerup', onPointerUp);
    },
    [gl, onPointerMove, onPointerUp],
  );

  return (
    <group
      ref={ref}
      position={target}
      onPointerOver={() => { setHovered(true); gl.domElement.style.cursor = 'grab'; }}
      onPointerOut={() => { if (!isDragging.current) { setHovered(false); gl.domElement.style.cursor = ''; } }}
      onPointerDown={handlePointerDown}
    >
      {/* Invisible large hit area for easy grabbing */}
      <mesh visible={false}>
        <sphereGeometry args={[0.35, 8, 8]} />
        <meshBasicMaterial />
      </mesh>
      {/* Camera body */}
      <mesh>
        <boxGeometry args={[0.32, 0.2, 0.2]} />
        <meshStandardMaterial
          color={hovered ? '#f0abfc' : '#e879f9'}
          emissive="#d946ef"
          emissiveIntensity={hovered ? 0.5 : 0.15}
        />
      </mesh>
      {/* Lens */}
      <mesh position={[0, 0, 0.16]} rotation={[Math.PI / 2, 0, 0]}>
        <cylinderGeometry args={[0.06, 0.08, 0.1, 16]} />
        <meshStandardMaterial color="#c026d3" />
      </mesh>
      {/* Viewfinder bump */}
      <mesh position={[0, 0.14, -0.03]}>
        <boxGeometry args={[0.1, 0.08, 0.08]} />
        <meshStandardMaterial color="#d946ef" />
      </mesh>
    </group>
  );
}

/* ─── Subtle orbit path ─── */
function OrbitPath() {
  return (
    <mesh position={[0, 0.02, 0]} rotation={[-Math.PI / 2, 0, 0]}>
      <torusGeometry args={[BASE_DISTANCE * 1.0, 0.006, 8, 64]} />
      <meshBasicMaterial color="#d946ef" transparent opacity={0.15} />
    </mesh>
  );
}

/* ─── Scene Content ─── */
function SceneContent({
  imageUrl,
  camera: cam,
  onCameraChange,
}: {
  imageUrl: string;
  camera: CameraState;
  onCameraChange: (c: CameraState) => void;
}) {
  const camModelPos = cameraPos(cam.azimuth, cam.elevation, cam.distance);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const orbitRef = useRef<any>(null);

  const handleDragStart = useCallback(() => {
    if (orbitRef.current) orbitRef.current.enabled = false;
  }, []);
  const handleDragEnd = useCallback(() => {
    if (orbitRef.current) orbitRef.current.enabled = true;
  }, []);

  return (
    <>
      <ambientLight intensity={0.6} />
      <directionalLight position={[5, 10, 5]} intensity={0.7} />
      <gridHelper args={[8, 16, 0x1a1a1a, 0x111111]} />

      <ImagePlane imageUrl={imageUrl} />
      <DraggableCameraModel
        target={camModelPos}
        onDragUpdate={onCameraChange}
        onDragStart={handleDragStart}
        onDragEnd={handleDragEnd}
      />
      <OrbitPath />

      <OrbitControls
        ref={orbitRef}
        target={CENTER}
        enablePan={false}
        minDistance={2}
        maxDistance={8}
        minPolarAngle={0.3}
        maxPolarAngle={Math.PI / 2 - 0.1}
      />
    </>
  );
}

/* ─── Loading Placeholder ─── */
function LoadingPlaceholder({ height }: { height: number }) {
  return (
    <div
      style={{ width: '100%', height, borderRadius: 12, background: '#0a0a0a' }}
      className="flex items-center justify-center"
    >
      <div className="flex flex-col items-center gap-3">
        <div className="relative">
          <svg width="36" height="36" viewBox="0 0 24 24" fill="none" className="text-fuchsia-500/40 animate-pulse">
            <path d="M15 16H9a2 2 0 0 1-2-2V9a2 2 0 0 1 2-2h6a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2z" stroke="currentColor" strokeWidth="1.5" />
            <circle cx="12" cy="11.5" r="1.5" stroke="currentColor" strokeWidth="1.5" />
          </svg>
          <div className="absolute inset-0 animate-spin" style={{ animationDuration: '2s' }}>
            <div className="w-1.5 h-1.5 rounded-full bg-fuchsia-500/50 absolute -top-1 left-1/2 -translate-x-1/2" />
          </div>
        </div>
        <span className="text-[11px] text-white/25">Loading 3D scene...</span>
      </div>
    </div>
  );
}

/* ─── Main Export ─── */
export default function CameraControl3D({
  imageUrl,
  camera,
  onCameraChange,
  height = 200,
}: {
  imageUrl: string;
  camera: CameraState;
  onCameraChange?: (c: CameraState) => void;
  height?: number;
}) {
  return (
    <Suspense fallback={<LoadingPlaceholder height={height} />}>
      <div style={{ width: '100%', height, borderRadius: 12, overflow: 'hidden', background: '#0a0a0a' }}>
        <Canvas
          camera={{ position: [3.5, 2.5, 3.5], fov: 45 }}
          onCreated={({ camera }) => camera.lookAt(CENTER)}
          gl={{ antialias: true, alpha: false }}
          style={{ touchAction: 'none' }}
        >
          <SceneContent
            imageUrl={imageUrl}
            camera={camera}
            onCameraChange={onCameraChange || (() => {})}
          />
        </Canvas>
      </div>
    </Suspense>
  );
}
