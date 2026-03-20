"use client";

import { useState, useEffect, useRef } from "react";

// ─── Animated counter ───
function AnimatedNumber({ target, suffix = "" }: { target: number; suffix?: string }) {
  const [val, setVal] = useState(0);
  const ref = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    const observer = new IntersectionObserver(([e]) => {
      if (e.isIntersecting) {
        let start = 0;
        const step = Math.ceil(target / 40);
        const timer = setInterval(() => {
          start += step;
          if (start >= target) { setVal(target); clearInterval(timer); }
          else setVal(start);
        }, 30);
        observer.disconnect();
      }
    }, { threshold: 0.5 });
    if (ref.current) observer.observe(ref.current);
    return () => observer.disconnect();
  }, [target]);
  return <span ref={ref}>{val}{suffix}</span>;
}

// ─── Skill demo interactive ───
const SKILLS = [
  { name: "enhance", color: "#D946EF", prompt: "Add cinematic warm lighting with golden hour glow", emoji: "✨" },
  { name: "creative", color: "#34D399", prompt: "A tiny dragon perched on the shoulder, breathing sparkles", emoji: "🐉" },
  { name: "wild", color: "#FBBF24", prompt: "The coffee cup transforms into a swirling galaxy portal", emoji: "🌀" },
  { name: "captions", color: "#60A5FA", prompt: "Overlay elegant serif text: 'One Perfect Moment'", emoji: "✍️" },
];

export default function McpLanding() {
  const [activeSkill, setActiveSkill] = useState(0);
  const [copied, setCopied] = useState(false);
  const [mousePos, setMousePos] = useState({ x: 0, y: 0 });
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const rafRef = useRef<number>(0);

  const endpoint = "https://www.makaron.app/api/mcp";

  const codeSnippet = `const client = new Client({ name: 'my-agent' });
await client.connect('${endpoint}');

const result = await client.callTool({
  name: 'makaron_edit_image',
  arguments: {
    image: photo.url,
    editPrompt: '${SKILLS[activeSkill].prompt}',
    skill: '${SKILLS[activeSkill].name}'
  }
});`;

  function handleCopy() {
    navigator.clipboard.writeText(codeSnippet);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  // Mouse glow tail — follows cursor with smooth trailing delay
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    // Trail: array of points that lazily chase the cursor
    const TAIL_LEN = 50;
    const points: { x: number; y: number }[] = [];
    let mouseX = -100, mouseY = -100;
    let hasMoved = false;

    function resize() {
      canvas!.width = window.innerWidth;
      canvas!.height = window.innerHeight;
    }
    resize();
    window.addEventListener("resize", resize);

    const onMove = (e: MouseEvent) => {
      mouseX = e.clientX;
      mouseY = e.clientY;
      setMousePos({ x: e.clientX, y: e.clientY });
      if (!hasMoved) {
        // First move: seed all points at cursor so no flash from (0,0)
        hasMoved = true;
        for (let i = 0; i < TAIL_LEN; i++) points[i] = { x: mouseX, y: mouseY };
      }
    };
    window.addEventListener("mousemove", onMove);

    function draw() {
      ctx!.clearRect(0, 0, canvas!.width, canvas!.height);

      if (!hasMoved) { rafRef.current = requestAnimationFrame(draw); return; }

      // Head chases mouse, each subsequent point chases the one before it
      if (points.length === 0) {
        for (let i = 0; i < TAIL_LEN; i++) points.push({ x: mouseX, y: mouseY });
      }
      points[0].x += (mouseX - points[0].x) * 0.4;
      points[0].y += (mouseY - points[0].y) * 0.4;
      for (let i = 1; i < points.length; i++) {
        const ease = 0.25 - i * 0.003; // slower toward tail
        points[i].x += (points[i - 1].x - points[i].x) * Math.max(ease, 0.04);
        points[i].y += (points[i - 1].y - points[i].y) * Math.max(ease, 0.04);
      }

      // Draw the glowing tail as a tapered stroke
      ctx!.lineCap = "round";
      ctx!.lineJoin = "round";

      for (let i = 1; i < points.length; i++) {
        const t = 1 - i / points.length; // 1=head, 0=tail
        const width = 40 * t * t + 2;
        const alpha = 0.3 * t * t;

        ctx!.beginPath();
        ctx!.moveTo(points[i - 1].x, points[i - 1].y);
        ctx!.lineTo(points[i].x, points[i].y);
        ctx!.strokeStyle = `rgba(217, 70, 239, ${alpha})`;
        ctx!.lineWidth = width;
        ctx!.stroke();
      }

      // Glow at cursor head
      const headGrad = ctx!.createRadialGradient(points[0].x, points[0].y, 0, points[0].x, points[0].y, 50);
      headGrad.addColorStop(0, "rgba(217, 70, 239, 0.2)");
      headGrad.addColorStop(1, "rgba(217, 70, 239, 0)");
      ctx!.fillStyle = headGrad;
      ctx!.beginPath();
      ctx!.arc(points[0].x, points[0].y, 50, 0, Math.PI * 2);
      ctx!.fill();

      rafRef.current = requestAnimationFrame(draw);
    }
    rafRef.current = requestAnimationFrame(draw);

    return () => {
      cancelAnimationFrame(rafRef.current);
      window.removeEventListener("resize", resize);
      window.removeEventListener("mousemove", onMove);
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="min-h-screen bg-black text-white overflow-hidden" style={{ fontFamily: "'Space Grotesk', sans-serif" }}>
      {/* eslint-disable-next-line @next/next/no-css-tags */}
      <style>{`@import url('https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@300;400;500;600;700;800;900&family=JetBrains+Mono:wght@400;500;600;700&display=swap');
        @keyframes float { 0%,100% { transform: translateY(0px); } 50% { transform: translateY(-20px); } }
        @keyframes pulse-glow { 0%,100% { opacity: 0.4; } 50% { opacity: 0.8; } }
        @keyframes slide-up { from { opacity: 0; transform: translateY(40px); } to { opacity: 1; transform: translateY(0); } }
        .animate-slide-up { animation: slide-up 0.8s ease-out both; }
        .delay-1 { animation-delay: 0.1s; }
        .delay-2 { animation-delay: 0.2s; }
        .delay-3 { animation-delay: 0.3s; }
        .delay-4 { animation-delay: 0.4s; }
        .delay-5 { animation-delay: 0.5s; }
        .code-block:hover { border-color: rgba(217,70,239,0.3); box-shadow: 0 20px 80px rgba(217,70,239,0.08); }
        .skill-btn { transition: all 0.3s cubic-bezier(0.4,0,0.2,1); }
        .skill-btn:hover { transform: translateY(-2px); }
        .skill-btn.active { transform: scale(1.05); }
      `}</style>

      {/* ─── Mouse glow tail canvas (fixed to viewport, always visible on scroll) ─── */}
      <canvas
        ref={canvasRef}
        className="fixed inset-0 w-full h-full pointer-events-none z-[1]"
        style={{ filter: "blur(20px)" }}
      />

      {/* ─── Floating blur orbs (Apple-style) ─── */}
      <div className="fixed inset-0 pointer-events-none z-0 overflow-hidden">
        <div
          className="absolute w-[600px] h-[600px] rounded-full"
          style={{
            background: "radial-gradient(circle, rgba(217,70,239,0.12) 0%, transparent 70%)",
            filter: "blur(80px)",
            left: mousePos.x * 0.02 + 100,
            top: mousePos.y * 0.02 + 50,
            animation: "float 8s ease-in-out infinite",
          }}
        />
        <div
          className="absolute w-[500px] h-[500px] rounded-full"
          style={{
            background: "radial-gradient(circle, rgba(59,130,246,0.08) 0%, transparent 70%)",
            filter: "blur(100px)",
            right: -mousePos.x * 0.01 + 200,
            top: mousePos.y * 0.01 + 300,
            animation: "float 10s ease-in-out infinite 2s",
          }}
        />
        <div
          className="absolute w-[400px] h-[400px] rounded-full"
          style={{
            background: "radial-gradient(circle, rgba(52,211,153,0.06) 0%, transparent 70%)",
            filter: "blur(90px)",
            left: "40%",
            bottom: -100,
            animation: "float 12s ease-in-out infinite 4s",
          }}
        />
      </div>

      {/* ─── Nav ─── */}
      <nav className="relative z-10 flex items-center justify-between px-8 lg:px-12 h-16">
        <span className="text-lg font-extrabold tracking-tight">makaron</span>
        <div className="flex items-center gap-6">
          <a href="https://github.com/anthropics/model-context-protocol" target="_blank" rel="noopener" className="text-sm text-zinc-500 hover:text-zinc-300 transition-colors">Protocol</a>
          <a href="#docs" className="text-sm text-zinc-500 hover:text-zinc-300 transition-colors">Docs</a>
          <a href="https://github.com/vegekyd-sys/ai-image-editor" target="_blank" rel="noopener" className="text-sm text-zinc-500 hover:text-zinc-300 transition-colors">GitHub</a>
        </div>
      </nav>

      {/* ─── Hero ─── */}
      <section className="relative z-10 flex flex-col lg:flex-row items-start px-8 lg:px-20 pt-20 lg:pt-32 pb-20 gap-12 lg:gap-0 max-w-[1440px] mx-auto">
        {/* Left */}
        <div className="flex-1 flex flex-col gap-8">
          <span className="animate-slide-up text-[11px] font-bold tracking-[6px] text-fuchsia-500">MCP PROTOCOL</span>
          <h1 className="animate-slide-up delay-1">
            <span className="block text-5xl lg:text-[96px] font-black leading-[0.95] text-white">Your agent</span>
            <span className="block text-5xl lg:text-[96px] font-black leading-[0.95] text-white">can&apos;t see.</span>
          </h1>
          <p className="animate-slide-up delay-2 text-5xl lg:text-[96px] font-black leading-[0.95] text-fuchsia-500">
            We fix that.
          </p>
          <p className="animate-slide-up delay-3 text-lg text-zinc-500 leading-relaxed max-w-md">
            Two MCP tools. One HTTP call.<br />
            Now your AI agent can edit photos<br />
            and rotate camera angles.
          </p>
          <div className="animate-slide-up delay-4 flex items-center gap-4">
            <a
              href="#connect"
              className="px-10 py-4 bg-fuchsia-500 text-black font-bold rounded-full text-base hover:bg-fuchsia-400 transition-all hover:shadow-[0_8px_40px_rgba(217,70,239,0.4)] active:scale-95"
            >
              Connect now →
            </a>
          </div>
        </div>

        {/* Right — code block */}
        <div className="animate-slide-up delay-3 flex-1 flex justify-end">
          <div
            className="code-block relative w-full max-w-[580px] rounded-2xl border border-white/5 bg-[#0A0A0A] p-7 transition-all duration-500 backdrop-blur-sm"
            style={{ boxShadow: "0 12px 60px rgba(217,70,239,0.05)" }}
          >
            {/* Window dots */}
            <div className="flex gap-1.5 mb-4">
              <div className="w-2.5 h-2.5 rounded-full bg-red-500/20" />
              <div className="w-2.5 h-2.5 rounded-full bg-yellow-500/20" />
              <div className="w-2.5 h-2.5 rounded-full bg-green-500/20" />
            </div>
            <div className="h-px bg-white/5 mb-4" />

            {/* Code */}
            <pre className="text-[13px] leading-relaxed font-mono overflow-x-auto" style={{ fontFamily: "'JetBrains Mono', monospace" }}>
              <div className="text-zinc-600">{"// give your agent eyes"}</div>
              <div className="text-zinc-400">{"const client = new Client({ name: 'my-agent' });"}</div>
              <div className="text-zinc-200">{"await client.connect('"}<span className="text-fuchsia-400">makaron.app/api/mcp</span>{"');"}</div>
              <div className="h-3" />
              <div className="text-zinc-200">{"const edited = await client.callTool({"}</div>
              <div className="text-fuchsia-400">{"  name: 'makaron_edit_image',"}</div>
              <div className="text-zinc-200">{"  arguments: {"}</div>
              <div className="text-zinc-500">{"    image: photo.url,"}</div>
              <div>
                <span className="text-zinc-500">{"    editPrompt: '"}</span>
                <span className="transition-all duration-500" style={{ color: SKILLS[activeSkill].color }}>{SKILLS[activeSkill].prompt}</span>
                <span className="text-zinc-500">{"',"}</span>
              </div>
              <div>
                <span className="text-zinc-500">{"    skill: '"}</span>
                <span className="transition-all duration-500" style={{ color: SKILLS[activeSkill].color }}>{SKILLS[activeSkill].name}</span>
                <span className="text-zinc-500">{"'"}</span>
              </div>
              <div className="text-zinc-200">{"  }"}</div>
              <div className="text-zinc-200">{"});"}</div>
              <div className="h-3" />
              <div className="text-zinc-600">{"// → edited image returned in ~20s ✨"}</div>
            </pre>

            {/* Copy button */}
            <button
              onClick={handleCopy}
              className="absolute top-5 right-5 text-xs text-zinc-600 hover:text-zinc-300 transition-colors px-3 py-1 rounded border border-white/5 hover:border-white/10"
            >
              {copied ? "Copied!" : "Copy"}
            </button>
          </div>
        </div>
      </section>

      {/* ─── Interactive Skill Switcher ─── */}
      <section className="relative z-10 flex justify-center gap-3 pb-20 px-8">
        {SKILLS.map((s, i) => (
          <button
            key={s.name}
            onClick={() => setActiveSkill(i)}
            className={`skill-btn px-6 py-3 rounded-full text-sm font-semibold border transition-all ${
              activeSkill === i
                ? "active border-transparent text-black"
                : "border-white/10 text-zinc-500 hover:text-white hover:border-white/20"
            }`}
            style={activeSkill === i ? { backgroundColor: s.color, boxShadow: `0 4px 24px ${s.color}40` } : {}}
          >
            <span className="mr-2">{s.emoji}</span>
            {s.name}
          </button>
        ))}
      </section>

      {/* ─── Tools — 01 Edit anything ─── */}
      <section className="relative z-10 max-w-[1440px] mx-auto px-8 lg:px-20 py-20">
        <div className="flex items-start gap-10">
          <span className="text-[120px] font-black leading-none text-white/[0.03] select-none hidden lg:block">01</span>
          <div className="flex flex-col gap-4 max-w-2xl">
            <h2 className="text-4xl lg:text-[56px] font-extrabold leading-tight">Edit anything.</h2>
            <p className="text-lg text-zinc-600 leading-relaxed">
              Sunglasses on a statue. Cinematic lighting on a selfie.<br />
              A dragon perched on someone&apos;s shoulder.<br />
              Your prompt. Our model. Magic.
            </p>
            <div className="flex flex-wrap gap-3 mt-4">
              {SKILLS.map(s => (
                <span
                  key={s.name}
                  className="px-5 py-2 rounded-full text-sm font-semibold border transition-all hover:scale-105 cursor-default"
                  style={{ borderColor: s.color + "40", color: s.color }}
                >
                  {s.name}
                </span>
              ))}
            </div>
          </div>
        </div>

        <div className="h-px bg-white/[0.04] my-16" />

        <div className="flex items-start gap-10">
          <span className="text-[120px] font-black leading-none text-white/[0.03] select-none hidden lg:block">02</span>
          <div className="flex flex-col gap-4 max-w-2xl">
            <h2 className="text-4xl lg:text-[56px] font-extrabold leading-tight">See from anywhere.</h2>
            <p className="text-lg text-zinc-600 leading-relaxed">
              Front. Back. Bird&apos;s eye. Worm&apos;s eye.<br />
              Rotate the virtual camera 360° around any subject.<br />
              One parameter change. Entirely new perspective.
            </p>
            <div className="flex flex-wrap gap-3 mt-4">
              {[
                { label: "azimuth 0–360°", color: "#60A5FA" },
                { label: "elevation -30~60°", color: "#34D399" },
                { label: "distance 0.6~1.4", color: "#FBBF24" },
              ].map(p => (
                <span
                  key={p.label}
                  className="px-5 py-2 rounded-full text-sm font-semibold border transition-all hover:scale-105 cursor-default"
                  style={{ borderColor: p.color + "40", color: p.color }}
                >
                  {p.label}
                </span>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* ─── Stats ─── */}
      <section className="relative z-10 max-w-[1440px] mx-auto px-8 lg:px-20 py-16">
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-8">
          {[
            { n: 20, suffix: "s", label: "Average response" },
            { n: 2, suffix: "", label: "MCP tools" },
            { n: 4, suffix: "", label: "Skill templates" },
            { n: 0, suffix: "", label: "API keys required", display: "0" },
          ].map(s => (
            <div key={s.label} className="text-center">
              <div className="text-5xl lg:text-6xl font-black text-white">
                {s.display ?? <AnimatedNumber target={s.n} suffix={s.suffix} />}
              </div>
              <div className="text-sm text-zinc-600 mt-2">{s.label}</div>
            </div>
          ))}
        </div>
      </section>

      {/* ─── Full code section ─── */}
      <section id="connect" className="relative z-10 max-w-[1440px] mx-auto px-8 lg:px-20 py-20 flex flex-col items-center gap-8">
        <span className="text-[11px] font-bold tracking-[6px] text-fuchsia-500">SHIP IN MINUTES, NOT MONTHS</span>
        <h2 className="text-4xl lg:text-[52px] font-extrabold text-center">This is all you need.</h2>
        <div
          className="code-block w-full max-w-[900px] rounded-2xl border border-fuchsia-500/10 bg-[#0A0A0A] p-10 transition-all duration-500 relative"
          style={{ boxShadow: "0 20px 80px rgba(217,70,239,0.06)" }}
        >
          <button
            onClick={handleCopy}
            className="absolute top-6 right-6 text-xs text-zinc-600 hover:text-zinc-300 transition-colors px-3 py-1 rounded border border-white/5 hover:border-white/10"
          >
            {copied ? "Copied!" : "Copy"}
          </button>
          <pre className="text-[15px] leading-relaxed overflow-x-auto" style={{ fontFamily: "'JetBrains Mono', monospace" }}>
            <div className="text-zinc-600">{"// Connect to Makaron MCP"}</div>
            <div className="text-zinc-400">{"const client = new Client({ name: 'my-agent' });"}</div>
            <div className="text-zinc-200">{"await client.connect('"}<span className="text-fuchsia-400">{endpoint}</span>{"');"}</div>
            <div className="h-4" />
            <div className="text-zinc-600">{"// Your agent can now see and create"}</div>
            <div className="text-zinc-200">{"const result = await client.callTool({"}</div>
            <div className="text-fuchsia-400">{"  name: 'makaron_edit_image',"}</div>
            <div className="text-zinc-200">{"  arguments: {"}</div>
            <div className="text-zinc-500">{"    image: photo.url,"}</div>
            <div className="text-yellow-400">{"    editPrompt: 'Make it legendary',"}</div>
            <div className="text-emerald-400">{"    skill: 'enhance'"}</div>
            <div className="text-zinc-200">{"  }"}</div>
            <div className="text-zinc-200">{"});"}</div>
          </pre>
        </div>
        <p className="text-sm text-zinc-600">Works with any MCP-compatible agent — Claude Code, Cursor, custom agents, and more.</p>
      </section>

      {/* ─── Manifesto CTA ─── */}
      <section className="relative z-10 max-w-[1440px] mx-auto px-8 lg:px-20 py-28">
        <div className="relative overflow-hidden rounded-3xl p-12 lg:p-20" style={{ background: "linear-gradient(135deg, #0A0A0A 0%, #1A0025 100%)" }}>
          {/* Blur orb inside */}
          <div
            className="absolute w-[500px] h-[300px] rounded-full pointer-events-none"
            style={{
              background: "radial-gradient(circle, rgba(217,70,239,0.15) 0%, transparent 70%)",
              filter: "blur(100px)",
              right: -100,
              top: -50,
              animation: "pulse-glow 4s ease-in-out infinite",
            }}
          />
          <p className="relative text-xl lg:text-2xl text-zinc-600 leading-relaxed font-medium max-w-xl">
            Agents are blind.<br />
            They read. They write. They reason.<br />
            But they can&apos;t see a damn thing.
          </p>
          <h2 className="relative text-5xl lg:text-[96px] font-black leading-[0.95] mt-8">
            Give them<br />
            <span className="text-fuchsia-500">Makaron.</span>
          </h2>
          <div className="relative flex items-center gap-5 mt-10">
            <a
              href={endpoint}
              target="_blank"
              rel="noopener"
              className="px-12 py-5 bg-fuchsia-500 text-black font-bold rounded-full text-lg hover:bg-fuchsia-400 transition-all hover:shadow-[0_8px_60px_rgba(217,70,239,0.5)] active:scale-95"
              style={{ fontFamily: "'JetBrains Mono', monospace" }}
            >
              makaron.app/api/mcp
            </a>
            <span className="text-zinc-600 text-base">Open. Free. No key required.</span>
          </div>
        </div>
      </section>

      {/* ─── Footer ─── */}
      <footer className="relative z-10 flex items-center justify-between px-8 lg:px-20 py-6 border-t border-white/[0.04]">
        <span className="text-xs text-zinc-700">© 2026 Makaron — Built for the agentic era</span>
        <div className="flex gap-6">
          <a href="https://modelcontextprotocol.io" target="_blank" rel="noopener" className="text-xs text-zinc-600 hover:text-zinc-400 transition-colors">Protocol</a>
          <a href="https://github.com/vegekyd-sys/ai-image-editor" target="_blank" rel="noopener" className="text-xs text-zinc-600 hover:text-zinc-400 transition-colors">GitHub</a>
          <a href="#connect" className="text-xs text-zinc-600 hover:text-zinc-400 transition-colors">Docs</a>
        </div>
      </footer>
    </div>
  );
}
