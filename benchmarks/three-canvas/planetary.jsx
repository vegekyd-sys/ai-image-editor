import { AbsoluteFill } from 'remotion';
import { ThreeCanvas } from '@remotion/three';
// Editable composition source for run_code(runtime: "composition").
const tau = Math.PI * 2;
const pitch = 0.72;
const bore = 0.146;
const gearDepth = { depth: 0.23, bevelEnabled: true, bevelSize: 0.012, bevelThickness: 0.018, bevelSegments: 2, curveSegments: 24 };

function circle(radius) {
  const path = new THREE.Path();
  path.absarc(0, 0, radius, 0, tau, true);
  return path;
}

function gearShape(count, radius, internal) {
  const shape = new THREE.Shape();
  const teeth = internal ? new THREE.Path() : shape;
  const profile = [[0, -0.078], [0.18, -0.078], [0.35, 0.062], [0.65, 0.062], [0.82, -0.078]];
  for (let tooth = 0; tooth < count; tooth++) {
    for (const [fraction, depth] of profile) {
      const a = (tooth + fraction) * tau / count;
      const r = radius + depth * (internal ? -1 : 1);
      const x = r * Math.cos(a), y = r * Math.sin(a);
      if (tooth === 0 && fraction === 0) teeth.moveTo(x, y);
      else teeth.lineTo(x, y);
    }
  }
  teeth.closePath();
  if (internal) {
    shape.absarc(0, 0, radius + 0.33, 0, tau, false);
    shape.holes.push(teeth);
  } else {
    shape.holes.push(circle(bore));
    for (let i = 0; i < 3; i++) {
      const a = i * tau / 3;
      const hole = new THREE.Path();
      hole.absarc(0.40 * Math.cos(a), 0.40 * Math.sin(a), 0.125, 0, tau, true);
      shape.holes.push(hole);
    }
  }
  return shape;
}

function Disc({ radius, height, color, position }) {
  return <mesh position={position} rotation={[Math.PI / 2, 0, 0]}>
    <cylinderGeometry args={[radius, radius, height, 42]} />
    <meshStandardMaterial color={color} metalness={0.28} roughness={0.4} />
  </mesh>;
}

function Gear({ shape, color }) {
  return <mesh>
    <extrudeGeometry args={[shape, gearDepth]} />
    <meshStandardMaterial color={color} metalness={0.38} roughness={0.33} />
  </mesh>;
}

function Gearbox({ input, reveal }) {
  const wheel = useMemo(() => gearShape(18, pitch, false), []);
  const ring = useMemo(() => gearShape(54, 3 * pitch, true), []);
  const orbit = input / 4;
  return <group>
    <Gear shape={ring} color="#263c49" />
    {Array.from({ length: 12 }, (_, i) => {
      const a = i * tau / 12;
      return <Disc key={i} radius={i === 3 ? 0.068 : 0.040} height={0.027}
        position={[2.37 * Math.cos(a), 2.37 * Math.sin(a), 0.262]}
        color={i === 3 ? '#fc7840' : '#afbec4'} />;
    })}
    <group rotation={[0, 0, input]}>
      <Gear shape={wheel} color="#ff772c" />
      <Disc radius={0.058} height={0.025} position={[0, 0.535, 0.264]} color="#412b24" />
    </group>
    <group rotation={[0, 0, orbit]}>
      {[0, 1, 2].map(i => {
        const a = i * tau / 3;
        return <group key={i} position={[2 * pitch * Math.cos(a), 2 * pitch * Math.sin(a), 0]}>
          <group rotation={[0, 0, -input + orbit + Math.PI / 18]}>
            <Gear shape={wheel} color="#69abba" />
          </group>
          <Disc radius={0.105} height={0.45} position={[0, 0, 0.115]} color="#293f4c" />
        </group>;
      })}
      <group position={[0, 0, -0.34 - reveal * 0.56]}>
        {[0, 1, 2].map(i => {
          const a = i * tau / 3;
          return <group key={i} rotation={[0, 0, a]}>
            <mesh position={[pitch, 0, 0]}><boxGeometry args={[2 * pitch, 0.25, 0.16]} /><meshStandardMaterial color="#435f75" /></mesh>
            <Disc radius={0.19} height={0.17} position={[2 * pitch, 0, 0]} color="#435f75" />
          </group>;
        })}
        <Disc radius={0.29} height={0.23} position={[0, 0, 0]} color="#405b72" />
      </group>
    </group>
  </group>;
}

export default function Composition(props) {
  const frame = useCurrentFrame();
  const { width, height, durationInFrames } = useVideoConfig();
  const t = frame / (durationInFrames - 1);
  const sweep = Math.sin(Math.PI * t);
  const clean = props.cleanPlate;
  const input = tau * 4 * t;
  const phase = t < 0.33 ? 0 : t < 0.67 ? 1 : 2;
  const captions = [props.inputLabel, props.orbitLabel, props.outputLabel];
  return <AbsoluteFill style={{ backgroundColor: '#f1ede2', color: '#1c303a', fontFamily: 'sans-serif' }}>
    <ThreeCanvas width={width} height={height} camera={{ position: [0, 0, 8], fov: 39 }}>
      <hemisphereLight args={['#fff8e7', '#7592a0', 2.1]} />
      <directionalLight position={[-3, 5, 7]} intensity={3} />
      <directionalLight position={[3, -2, 2]} color="#b9deff" intensity={1.2} />
      <group position={[clean ? 0 : 1.53, 0.06, 0]} rotation={[0.20 + sweep * 0.45, -0.28 + 0.60 * Math.sin(t * tau), -0.08]}>
        <Gearbox input={input} reveal={sweep} />
      </group>
    </ThreeCanvas>
    {!clean && <AbsoluteFill style={{ padding: '38px 46px', justifyContent: 'space-between', pointerEvents: 'none' }}>
      <div style={{ fontSize: 14, fontWeight: 700, letterSpacing: 3 }}>MECHANISM STUDIES　 /　 01</div>
      <div style={{ maxWidth: 350 }}>
        <div style={{ fontSize: 67, lineHeight: 0.98, fontWeight: 760, letterSpacing: -4 }}>{props.title}</div>
        <div style={{ width: 46, height: 5, backgroundColor: '#f57432', margin: '22px 0 18px' }} />
        <div style={{ fontSize: 21, lineHeight: 1.28, maxWidth: 292 }}>{captions[phase]}</div>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, fontSize: 14, fontWeight: 600 }}>
        <span style={{ background: '#fb8437', width: 10, height: 10, borderRadius: '50%' }} /> SUN
        <span style={{ background: '#69abba', width: 10, height: 10, borderRadius: '50%', marginLeft: 10 }} /> PLANETS
      </div>
    </AbsoluteFill>}
  </AbsoluteFill>;
}
