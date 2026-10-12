import { useEffect, useMemo, useRef, useState } from 'react';
import { Canvas, useFrame } from '@react-three/fiber';
import { EffectComposer, Bloom } from '@react-three/postprocessing';
import * as THREE from 'three';
import { Check } from 'lucide-react';

/**
 * The one loud moment: the two sealed limits meet and settle (FE_plan §7.4).
 * Lazy-loaded (three.js stays out of the theatre's initial bundle) and always
 * paired with a 2D fallback for reduced-motion / no-WebGL / slow devices.
 */

function prefersReducedMotion(): boolean {
  return typeof matchMedia !== 'undefined' && matchMedia('(prefers-reduced-motion: reduce)').matches;
}

function hasWebGL(): boolean {
  try {
    const canvas = document.createElement('canvas');
    return Boolean(
      window.WebGLRenderingContext &&
        (canvas.getContext('webgl2') || canvas.getContext('webgl')),
    );
  } catch {
    return false;
  }
}

function Curve() {
  const curve = useMemo(
    () =>
      new THREE.CatmullRomCurve3([
        new THREE.Vector3(-1.5, 0, 0),
        new THREE.Vector3(0, 0.42, 0),
        new THREE.Vector3(1.5, 0, 0),
      ]),
    [],
  );
  const positions = useMemo(() => new Float32Array(520 * 3), []);
  const seeds = useMemo(() => {
    const a = new Float32Array(520 * 2);
    for (let i = 0; i < 520; i++) {
      a[i * 2] = Math.random();
      a[i * 2 + 1] = Math.random() * Math.PI * 2;
    }
    return a;
  }, []);
  const ref = useRef<THREE.Points>(null);
  const tmp = useMemo(() => new THREE.Vector3(), []);

  useFrame((state) => {
    const geo = ref.current?.geometry;
    if (!geo) return;
    const pos = geo.getAttribute('position') as THREE.BufferAttribute;
    const t = state.clock.elapsedTime;
    for (let i = 0; i < 520; i++) {
      const baseT = seeds[i * 2] ?? 0;
      const phase = seeds[i * 2 + 1] ?? 0;
      const tt = (baseT + t * 0.16) % 1;
      curve.getPoint(tt, tmp);
      const spread = 0.18 * Math.sin(t * 1.1 + phase);
      pos.setXYZ(
        i,
        tmp.x,
        tmp.y * (0.5 + Math.sin(tt * Math.PI)) + spread * 0.5,
        Math.cos(phase) * spread,
      );
    }
    pos.needsUpdate = true;
  });

  return (
    <points ref={ref}>
      <bufferGeometry>
        <bufferAttribute attach="attributes-position" args={[positions, 3]} />
      </bufferGeometry>
      <pointsMaterial
        size={0.055}
        color="#ffd36b"
        transparent
        opacity={0.9}
        sizeAttenuation
        depthWrite={false}
        blending={THREE.AdditiveBlending}
      />
    </points>
  );
}

function Orb({ x, color }: { x: number; color: string }) {
  const ref = useRef<THREE.Mesh>(null);
  useFrame((state) => {
    if (ref.current) ref.current.position.y = Math.sin(state.clock.elapsedTime * 1.4 + x) * 0.08;
  });
  return (
    <mesh ref={ref} position={[x, 0, 0]}>
      <sphereGeometry args={[0.34, 48, 48]} />
      <meshStandardMaterial color={color} emissive={color} emissiveIntensity={2.4} toneMapped={false} />
    </mesh>
  );
}

function DealFlash({ label }: { label: string }) {
  return (
    <div className="grid h-full w-full place-items-center bg-[radial-gradient(60%_80%_at_50%_50%,color-mix(in_oklab,var(--color-teal)_35%,transparent),transparent)]">
      <div className="flex flex-col items-center gap-2 text-teal">
        <Check className="h-8 w-8" aria-hidden="true" />
        <span className="font-display text-lg font-semibold">{label}</span>
      </div>
    </div>
  );
}

export default function Handshake({ label = 'Deal closed', onDone }: { label?: string; onDone?: () => void }) {
  const [capable] = useState(() => typeof window !== 'undefined' && hasWebGL() && !prefersReducedMotion());

  useEffect(() => {
    const id = setTimeout(() => onDone?.(), 2800);
    return () => clearTimeout(id);
  }, [onDone]);

  if (!capable) return <DealFlash label={label} />;

  return (
    <Canvas dpr={[1, 1.8]} camera={{ position: [0, 0, 5], fov: 42 }} gl={{ antialias: true, alpha: true }}>
      <color attach="background" args={['#14162b']} />
      <ambientLight intensity={0.45} />
      <Orb x={-1.5} color="#f2a900" />
      <Orb x={1.5} color="#ff5a6e" />
      <pointLight position={[-1.5, 0, 1]} color="#f2a900" intensity={6} distance={6} />
      <pointLight position={[1.5, 0, 1]} color="#ff5a6e" intensity={6} distance={6} />
      <Curve />
      <EffectComposer>
        <Bloom intensity={1.15} luminanceThreshold={0.2} mipmapBlur />
      </EffectComposer>
    </Canvas>
  );
}
