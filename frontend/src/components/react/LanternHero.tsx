import { Canvas, useFrame } from '@react-three/fiber';
import { useMemo, useRef } from 'react';
import type { Group } from 'three';

/** Deterministic pseudo-random in 0..1 so every load has the same lantern field. */
const rnd = (n: number) => {
  const x = Math.sin(n * 12.9898) * 43758.5453;
  return x - Math.floor(x);
};

const COLORS = ['#ffc233', '#f2a900', '#ff8a4c', '#ff5a6e'];

/** Floating lanterns drifting up, with a slow sway. Static when reduced motion is on. */
function Lanterns({ count, reduced }: { count: number; reduced: boolean }) {
  const group = useRef<Group>(null);
  const items = useMemo(
    () =>
      Array.from({ length: count }, (_, i) => ({
        x: (rnd(i + 1) - 0.5) * 7,
        y: rnd(i + 11) * 6 - 3,
        z: -2 + rnd(i + 21) * 3,
        r: 0.07 + rnd(i + 31) * 0.1,
        speed: 0.12 + rnd(i + 41) * 0.2,
        phase: rnd(i + 51) * Math.PI * 2,
        color: COLORS[i % COLORS.length]!,
      })),
    [count],
  );

  useFrame((state) => {
    if (reduced || !group.current) return;
    const t = state.clock.elapsedTime;
    group.current.children.forEach((mesh, i) => {
      const it = items[i]!;
      mesh.position.y = ((it.y + t * it.speed + 3) % 6) - 3;
      mesh.position.x = it.x + Math.sin(t * 0.6 + it.phase) * 0.3;
    });
  });

  return (
    <group ref={group}>
      {items.map((it, i) => (
        <mesh key={i} position={[it.x, it.y, it.z]}>
          <sphereGeometry args={[it.r, 16, 16]} />
          <meshBasicMaterial color={it.color} transparent opacity={0.8} />
        </mesh>
      ))}
    </group>
  );
}

function hasWebGL(): boolean {
  try {
    const c = document.createElement('canvas');
    return !!(c.getContext('webgl2') || c.getContext('webgl'));
  } catch {
    return false;
  }
}

/** Landing hero: lantern field over a marigold-to-chili sunset. Falls back to CSS alone. */
export default function LanternHero() {
  const reduced = typeof matchMedia !== 'undefined' && matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (!hasWebGL()) return null;
  return (
    <Canvas
      dpr={[1, 1.8]}
      camera={{ position: [0, 0, 6], fov: 45 }}
      gl={{ antialias: true, alpha: true }}
      aria-hidden="true"
      className="!absolute inset-0"
    >
      <Lanterns count={reduced ? 10 : 22} reduced={reduced} />
    </Canvas>
  );
}
