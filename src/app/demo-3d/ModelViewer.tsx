'use client';

import { Suspense } from 'react';
import { Canvas } from '@react-three/fiber';
import { OrbitControls, useGLTF, Environment, Center } from '@react-three/drei';

function Model({ url }: { url: string }) {
  const { scene } = useGLTF(url);
  return (
    <Center>
      <primitive object={scene} />
    </Center>
  );
}

export default function ModelViewer({ glbUrl }: { glbUrl: string }) {
  return (
    <Canvas
      camera={{ position: [0, 0.5, 2.5], fov: 45 }}
      style={{ width: '100%', height: '100%', background: '#0a0a0a' }}
    >
      <ambientLight intensity={0.5} />
      <directionalLight position={[5, 5, 5]} intensity={1} />
      <Suspense fallback={null}>
        <Model url={glbUrl} />
        <Environment preset="city" />
      </Suspense>
      <OrbitControls
        enablePan={false}
        enableZoom={true}
        minDistance={1}
        maxDistance={5}
        autoRotate
        autoRotateSpeed={2}
      />
    </Canvas>
  );
}
