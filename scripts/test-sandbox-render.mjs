/**
 * E2E test: Vercel Sandbox rendering from Snapshot.
 * Tests the production path (REMOTION_SNAPSHOT_ID set).
 * Run: REMOTION_SNAPSHOT_ID=snap_xxx node scripts/test-sandbox-render.mjs
 */

const SNAPSHOT_ID = process.env.REMOTION_SNAPSHOT_ID || 'snap_9dzeGgBGDxyBP2anmlVehfgyI8eB';

const testDesign = {
  code: `function Design(props) {
    return React.createElement(AbsoluteFill, {
      style: { background: 'linear-gradient(135deg, #667eea, #764ba2)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexDirection: 'column' }
    },
      React.createElement('h1', { style: { color: 'white', fontSize: 72, fontWeight: 'bold' } }, props.title || 'Sandbox Test'),
      React.createElement('p', { style: { color: 'rgba(255,255,255,0.7)', fontSize: 28 } }, 'Rendered on Vercel Sandbox from Snapshot')
    );
  }`,
  width: 1080,
  height: 1350,
  props: { title: 'E2E Test' },
};

const { Sandbox } = await import('@vercel/sandbox');
const { renderStillOnVercel } = await import('@remotion/vercel');

let passed = 0;
let failed = 0;

async function test(name, fn) {
  try {
    await fn();
    passed++;
    console.log(`  ✅ ${name}`);
  } catch (err) {
    failed++;
    console.log(`  ❌ ${name}: ${err.message}`);
  }
}

function assert(condition, msg) {
  if (!condition) throw new Error(msg);
}

console.log(`\n🧪 Sandbox Render E2E Tests (snapshot: ${SNAPSHOT_ID})\n`);

// Test 1: Sandbox creation from snapshot
let sandbox;
const t0 = Date.now();
await test('Create Sandbox from snapshot', async () => {
  sandbox = await Sandbox.create({
    source: { type: 'snapshot', snapshotId: SNAPSHOT_ID },
    resources: { vcpus: 2 },
    timeout: 3 * 60 * 1000,
  });
  const elapsed = ((Date.now() - t0) / 1000).toFixed(1);
  assert(sandbox.sandboxId, 'No sandbox ID');
  assert(sandbox.status === 'running', `Status is ${sandbox.status}, expected running`);
  console.log(`    Sandbox ${sandbox.sandboxId} ready in ${elapsed}s`);
});

if (!sandbox) {
  console.log('\n❌ Cannot continue without sandbox\n');
  process.exit(1);
}

try {
  // Test 2: Render still frame
  let buffer1;
  await test('Render frame 0 (still design)', async () => {
    const t1 = Date.now();
    await renderStillOnVercel({
      sandbox,
      compositionId: 'dynamic-design',
      inputProps: { code: testDesign.code, designProps: testDesign.props },
      imageFormat: 'jpeg',
      jpegQuality: 90,
      frame: 0,
      outputFile: '/tmp/test-frame0.jpeg',
      timeoutInMilliseconds: 30000,
    });
    buffer1 = await sandbox.readFileToBuffer({ path: '/tmp/test-frame0.jpeg' });
    const elapsed = ((Date.now() - t1) / 1000).toFixed(1);
    assert(buffer1, 'No buffer returned');
    assert(buffer1.length > 1000, `Buffer too small: ${buffer1.length} bytes`);
    console.log(`    ${(buffer1.length / 1024).toFixed(0)} KB in ${elapsed}s`);
  });

  // Test 3: Warm render (reuse same sandbox)
  await test('Warm render frame 0 (same sandbox)', async () => {
    const t2 = Date.now();
    await renderStillOnVercel({
      sandbox,
      compositionId: 'dynamic-design',
      inputProps: { code: testDesign.code, designProps: { title: 'Warm Test' } },
      imageFormat: 'jpeg',
      jpegQuality: 90,
      frame: 0,
      outputFile: '/tmp/test-warm.jpeg',
      timeoutInMilliseconds: 30000,
    });
    const buf = await sandbox.readFileToBuffer({ path: '/tmp/test-warm.jpeg' });
    const elapsed = ((Date.now() - t2) / 1000).toFixed(1);
    assert(buf, 'No buffer returned');
    assert(buf.length > 1000, `Buffer too small: ${buf.length} bytes`);
    console.log(`    ${(buf.length / 1024).toFixed(0)} KB in ${elapsed}s`);
  });

  // Test 4: Animated design with specific frame
  const animCode = `function Design(props) {
    const frame = useCurrentFrame();
    const { fps } = useVideoConfig();
    const progress = frame / (fps * 5);
    const hue = Math.round(progress * 360);
    return React.createElement(AbsoluteFill, {
      style: { background: 'hsl(' + hue + ', 70%, 50%)', display: 'flex', alignItems: 'center', justifyContent: 'center' }
    },
      React.createElement('h1', { style: { color: 'white', fontSize: 64 } }, 'Frame ' + frame)
    );
  }`;
  const animDesign = {
    code: animCode,
    width: 1080,
    height: 1920,
    props: {},
    animation: { fps: 30, durationInSeconds: 5 },
  };

  await test('Render animated design at frame 75 (2.5s)', async () => {
    const t3 = Date.now();
    await renderStillOnVercel({
      sandbox,
      compositionId: 'dynamic-design',
      inputProps: { code: animDesign.code, designProps: animDesign.props, fps: 30, durationInFrames: 150, width: 1080, height: 1920 },
      imageFormat: 'jpeg',
      jpegQuality: 90,
      frame: 75,
      outputFile: '/tmp/test-anim75.jpeg',
      timeoutInMilliseconds: 30000,
    });
    const buf = await sandbox.readFileToBuffer({ path: '/tmp/test-anim75.jpeg' });
    const elapsed = ((Date.now() - t3) / 1000).toFixed(1);
    assert(buf, 'No buffer returned');
    assert(buf.length > 500, `Buffer too small: ${buf.length} bytes`);
    console.log(`    ${(buf.length / 1024).toFixed(0)} KB in ${elapsed}s`);
  });

  // Test 5: Render last frame of animation
  await test('Render last frame (frame 149)', async () => {
    const t4 = Date.now();
    await renderStillOnVercel({
      sandbox,
      compositionId: 'dynamic-design',
      inputProps: { code: animDesign.code, designProps: animDesign.props, fps: 30, durationInFrames: 150, width: 1080, height: 1920 },
      imageFormat: 'jpeg',
      jpegQuality: 90,
      frame: 149,
      outputFile: '/tmp/test-anim149.jpeg',
      timeoutInMilliseconds: 30000,
    });
    const buf = await sandbox.readFileToBuffer({ path: '/tmp/test-anim149.jpeg' });
    const elapsed = ((Date.now() - t4) / 1000).toFixed(1);
    assert(buf, 'No buffer returned');
    console.log(`    ${(buf.length / 1024).toFixed(0)} KB in ${elapsed}s`);
  });

} finally {
  await sandbox.stop().catch(() => {});
  console.log(`\n🛑 Sandbox stopped`);
}

console.log(`\n${'='.repeat(40)}`);
console.log(`Results: ${passed} passed, ${failed} failed`);
console.log(`${'='.repeat(40)}\n`);
process.exit(failed > 0 ? 1 : 0);
