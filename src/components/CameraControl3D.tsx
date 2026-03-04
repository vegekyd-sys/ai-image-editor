'use client';

import { useRef, useState, useCallback, useEffect, useMemo } from 'react';
import { Canvas, useThree, useFrame } from '@react-three/fiber';
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

/* ─── Image Plane ─── */
function ImagePlane({ imageUrl }: { imageUrl: string }) {
  const texture = useMemo(() => {
    const tex = new THREE.TextureLoader().load(imageUrl);
    tex.colorSpace = THREE.SRGBColorSpace;
    return tex;
  }, [imageUrl]);

  const [aspect, setAspect] = useState(1);
  useEffect(() => {
    const img = new Image();
    img.onload = () => setAspect(img.width / img.height);
    img.src = imageUrl;
  }, [imageUrl]);

  const maxW = 1.5;
  const w = aspect >= 1 ? maxW : maxW * aspect;
  const h = aspect >= 1 ? maxW / aspect : maxW;

  return (
    <mesh position={[0, h / 2 + 0.01, 0]} rotation={[0, 0, 0]}>
      <planeGeometry args={[w, h]} />
      <meshBasicMaterial map={texture} side={THREE.DoubleSide} />
    </mesh>
  );
}

/* ─── 3D Camera Model (box body + cylinder lens) ─── */
function CameraModel({ position }: { position: THREE.Vector3 }) {
  const ref = useRef<THREE.Group>(null);
  useFrame(() => {
    ref.current?.lookAt(CENTER);
  });
  return (
    <group ref={ref} position={position}>
      <mesh>
        <boxGeometry args={[0.16, 0.1, 0.1]} />
        <meshStandardMaterial color="#6699cc" />
      </mesh>
      <mesh position={[0, 0, 0.08]} rotation={[Math.PI / 2, 0, 0]}>
        <cylinderGeometry args={[0.03, 0.04, 0.06, 12]} />
        <meshStandardMaterial color="#4477aa" />
      </mesh>
    </group>
  );
}

/* ─── Draggable Handle ─── */
function Handle({
  position,
  color,
  onDrag,
}: {
  position: THREE.Vector3;
  color: string;
  onDrag: (e: { nativeEvent: PointerEvent }) => void;
}) {
  const [hovered, setHovered] = useState(false);
  return (
    <mesh
      position={position}
      onPointerOver={() => setHovered(true)}
      onPointerOut={() => setHovered(false)}
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      onPointerDown={(e: any) => { e.stopPropagation(); onDrag(e); }}
    >
      <sphereGeometry args={[hovered ? 0.09 : 0.07, 16, 16]} />
      <meshStandardMaterial
        color={color}
        emissive={color}
        emissiveIntensity={hovered ? 0.6 : 0.2}
      />
    </mesh>
  );
}

/* ─── Visual Guides ─── */
function AzimuthRing() {
  return (
    <mesh position={[0, 0.05, 0]} rotation={[-Math.PI / 2, 0, 0]}>
      <torusGeometry args={[BASE_DISTANCE, 0.008, 8, 64]} />
      <meshBasicMaterial color="#00ff88" transparent opacity={0.4} />
    </mesh>
  );
}

function DistanceLine({ from, to }: { from: THREE.Vector3; to: THREE.Vector3 }) {
  const ref = useRef<THREE.Line>(null);
  useEffect(() => {
    if (!ref.current) return;
    const geom = new THREE.BufferGeometry().setFromPoints([from, to]);
    ref.current.geometry = geom;
    return () => { geom.dispose(); };
  }, [from, to]);

  return (
    <primitive
      ref={ref}
      object={new THREE.Line(
        new THREE.BufferGeometry(),
        new THREE.LineBasicMaterial({ color: '#ffa500', transparent: true, opacity: 0.5 }),
      )}
    />
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
  const { gl, camera: threeCamera, size } = useThree();
  const dragging = useRef<'azimuth' | 'elevation' | 'distance' | null>(null);
  const startMouse = useRef({ x: 0, y: 0 });
  const startVal = useRef(0);

  const camModelPos = cameraPos(cam.azimuth, cam.elevation, cam.distance);

  // Azimuth handle — on the ring at current azimuth, elevation=0
  const azHandlePos = cameraPos(cam.azimuth, 0, 1.0);
  // Elevation handle — on a vertical arc
  const elHandlePos = cameraPos(cam.azimuth, cam.elevation, 0.75);
  // Distance handle — between camera and center
  const dsHandlePos = camModelPos.clone().lerp(CENTER, 0.5);

  const onPointerMove = useCallback(
    (e: PointerEvent) => {
      if (!dragging.current) return;
      const dx = e.clientX - startMouse.current.x;
      const dy = e.clientY - startMouse.current.y;

      if (dragging.current === 'azimuth') {
        const newAz = (startVal.current + dx * 0.8 + 360) % 360;
        onCameraChange({ ...cam, azimuth: newAz });
      } else if (dragging.current === 'elevation') {
        const newEl = Math.max(-30, Math.min(60, startVal.current - dy * 0.5));
        onCameraChange({ ...cam, elevation: newEl });
      } else if (dragging.current === 'distance') {
        const newDs = Math.max(0.6, Math.min(1.4, startVal.current + dy * 0.005));
        onCameraChange({ ...cam, distance: newDs });
      }
    },
    [cam, onCameraChange],
  );

  const onPointerUp = useCallback(() => {
    dragging.current = null;
    gl.domElement.style.cursor = '';
    window.removeEventListener('pointermove', onPointerMove);
    window.removeEventListener('pointerup', onPointerUp);
  }, [gl, onPointerMove]);

  const startDrag = useCallback(
    (type: 'azimuth' | 'elevation' | 'distance', e: { nativeEvent: PointerEvent }) => {
      const clientX = e.nativeEvent.clientX;
      const clientY = e.nativeEvent.clientY;
      dragging.current = type;
      startMouse.current = { x: clientX, y: clientY };
      startVal.current =
        type === 'azimuth' ? cam.azimuth : type === 'elevation' ? cam.elevation : cam.distance;
      gl.domElement.style.cursor = 'grabbing';
      window.addEventListener('pointermove', onPointerMove);
      window.addEventListener('pointerup', onPointerUp);
    },
    [cam, gl, onPointerMove, onPointerUp],
  );

  return (
    <>
      <ambientLight intensity={0.5} />
      <directionalLight position={[5, 10, 5]} intensity={0.8} />
      <gridHelper args={[6, 12, 0x1a1a1a, 0x111111]} />

      <ImagePlane imageUrl={imageUrl} />
      <CameraModel position={camModelPos} />
      <AzimuthRing />
      <DistanceLine from={camModelPos} to={CENTER} />

      <Handle position={azHandlePos} color="#00ff88" onDrag={(e) => startDrag('azimuth', e)} />
      <Handle position={elHandlePos} color="#ff69b4" onDrag={(e) => startDrag('elevation', e)} />
      <Handle position={dsHandlePos} color="#ffa500" onDrag={(e) => startDrag('distance', e)} />
    </>
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
  onCameraChange: (c: CameraState) => void;
  height?: number;
}) {
  return (
    <div style={{ width: '100%', height, borderRadius: 12, overflow: 'hidden', background: '#0a0a0a' }}>
      <Canvas
        camera={{ position: [3.5, 2.5, 3.5], fov: 50 }}
        onCreated={({ camera }) => camera.lookAt(CENTER)}
        gl={{ antialias: true, alpha: false }}
        style={{ touchAction: 'none' }}
      >
        <SceneContent imageUrl={imageUrl} camera={camera} onCameraChange={onCameraChange} />
      </Canvas>
    </div>
  );
}
