/**
 * Test CJK font rendering on Sandbox — 3 scenarios.
 */
import { Sandbox } from '@vercel/sandbox';
import { renderStillOnVercel } from '@remotion/vercel';
import fs from 'fs';

const SNAPSHOT_ID = process.env.REMOTION_SNAPSHOT_ID || 'snap_bQxE106GEs8iOSfgO2fgu93WGQ1t';

const code1 = `function Design() {
  return React.createElement(AbsoluteFill, {
    style: { background: "#1a1a2e", display: "flex", alignItems: "center", justifyContent: "center", flexDirection: "column" }
  },
    React.createElement("h1", { style: { color: "white", fontSize: 80, fontWeight: 900 } }, "各有千秋"),
    React.createElement("p", { style: { color: "#d946ef", fontSize: 24, letterSpacing: "0.3em", marginTop: 20 } }, "BEAUTY COLLECTION")
  );
}`;

const code2 = `function Design() {
  return React.createElement(AbsoluteFill, {
    style: { background: "#1a1a2e", display: "flex", alignItems: "center", justifyContent: "center", flexDirection: "column" }
  },
    React.createElement("link", { rel: "stylesheet", href: "https://fonts.googleapis.com/css2?family=Playfair+Display:wght@700&display=swap" }),
    React.createElement("h1", { style: { color: "white", fontSize: 72, fontFamily: "'Playfair Display', serif", fontWeight: 700 } }, "花样年华"),
    React.createElement("p", { style: { color: "#d946ef", fontSize: 28, letterSpacing: "0.2em", marginTop: 16 } }, "IN THE MOOD FOR LOVE")
  );
}`;

const code3 = `function Design() {
  const css = \`@import url('https://fonts.googleapis.com/css2?family=ZCOOL+KuaiLe&display=swap');\`;
  return React.createElement(AbsoluteFill, {
    style: { background: "linear-gradient(135deg, #1a1a2e, #2d1b4e)", display: "flex", alignItems: "center", justifyContent: "center", flexDirection: "column" }
  },
    React.createElement("style", null, css),
    React.createElement("div", { style: { fontFamily: "'ZCOOL KuaiLe', cursive", color: "white", fontSize: 96, textShadow: "0 0 40px rgba(217,70,239,0.5)" } }, "花样年华"),
    React.createElement("p", { style: { color: "rgba(255,255,255,0.5)", fontSize: 20, marginTop: 24, letterSpacing: "0.5em" } }, "BLOOMING YOUTH")
  );
}`;

console.log(`Creating Sandbox from ${SNAPSHOT_ID}...`);
const sandbox = await Sandbox.create({
  source: { type: "snapshot", snapshotId: SNAPSHOT_ID },
  resources: { vcpus: 4 },
  timeout: 3 * 60 * 1000,
});

// Test 4: CJK text in PROPS (Agent's actual pattern — code uses props.title, text in designProps)
const code4 = `function Design(props) {
  return React.createElement(AbsoluteFill, {
    style: { background: "#1a1a2e", display: "flex", alignItems: "center", justifyContent: "center", flexDirection: "column" }
  },
    React.createElement("h1", { style: { color: "#FFE135", fontSize: 85, fontWeight: 900, fontFamily: "'Noto Sans SC', sans-serif", textShadow: "5px 5px 0 #E8000D" } }, props.title),
    React.createElement("p", { style: { color: "rgba(255,255,255,0.6)", fontSize: 24, marginTop: 20, letterSpacing: "0.3em" } }, props.subtitle)
  );
}`;
const props4 = { title: "偷到爸爸手机了！", subtitle: "小摄影师の秘密行动" };

const tests = [
  { name: "No import (CJK in code)", code: code1, props: {}, file: "/tmp/font-cjk-1.jpeg" },
  { name: "Link tag (href: in JSX)", code: code2, props: {}, file: "/tmp/font-cjk-2.jpeg" },
  { name: "Style @import", code: code3, props: {}, file: "/tmp/font-cjk-3.jpeg" },
  { name: "CJK in props (Agent pattern)", code: code4, props: props4, file: "/tmp/font-cjk-4.jpeg" },
];

let passed = 0;
for (const t of tests) {
  console.log(`\n🧪 ${t.name}...`);
  const t0 = Date.now();
  try {
    await renderStillOnVercel({
      sandbox,
      compositionId: "dynamic-design",
      inputProps: { code: t.code, designProps: t.props || {}, fps: 30, durationInFrames: 1, width: 1080, height: 1350 },
      imageFormat: "jpeg", jpegQuality: 90, frame: 0,
      outputFile: "/tmp/still.jpeg", timeoutInMilliseconds: 30000,
    });
    const buf = await sandbox.readFileToBuffer({ path: "/tmp/still.jpeg" });
    fs.writeFileSync(t.file, buf);
    console.log(`  ✅ ${((Date.now()-t0)/1000).toFixed(1)}s, ${(buf.length/1024).toFixed(0)} KB → ${t.file}`);
    passed++;
  } catch (e) {
    console.log(`  ❌ ${e.message}`);
  }
}

await sandbox.stop();
console.log(`\n${passed}/${tests.length} passed`);
