'use client';

import { useEffect, useState, useRef } from 'react';

// ─── Stats ─────────────────────────────────────────────────────────
const STATS = [
  { label: 'Commits', value: '182', icon: '⚡' },
  { label: 'Files Changed', value: '79', icon: '📁' },
  { label: 'Lines Added', value: '4,459', icon: '✨' },
  { label: 'Agents', value: '10+', icon: '🤖' },
];

// ─── Feature Sections ──────────────────────────────────────────────
interface FeatureSection {
  icon: string;
  zh: { title: string; features: string[] };
  en: { title: string; features: string[] };
  subtitle: string;
  accent: string; // tailwind gradient class
}

const SECTIONS: FeatureSection[] = [
  {
    icon: '🧠',
    subtitle: '15s AI Video Editing',
    zh: { title: '用聊天编辑视频 — 满足你的任何想象', features: [
      '"让这个小朋友加入生日派对" "换成赛博朋克风格" "再延长 5 秒" — 说出来就行',
      '多轮对话：不满意就继续聊，修改、延展、重来，直到满足你的想象',
      '续写故事：一段接一段，像导演连续剧一样创作完整叙事',
      '支持真人脸：你的照片，你的故事，你出演',
      '两大模型：Kling v3（快速）/ SeeDance 2.0（最强画质）',
    ]},
    en: { title: 'Edit Video by Chatting — Any Imagination, Fulfilled', features: [
      '"Put this kid in the party" "Make it cyberpunk" "Extend 5 more seconds" — just say it',
      'Multi-turn: not right? Keep chatting. Refine, extend, redo — until your imagination is satisfied',
      'Continue stories: chain clips into a narrative, like directing a series',
      'Real human faces: your photo, your story, you star in it',
      'Two top models: Kling v3 (fast) / SeeDance 2.0 (best quality)',
    ]},
    accent: 'from-fuchsia-500 to-purple-600',
  },
  {
    icon: '🎬',
    subtitle: 'Multi-Video Composition',
    zh: { title: '多视频合成 — 把素材变作品', features: [
      '上传多段视频，AI 理解每段的动作、场景、角色',
      '用对话指挥合成："让 @4 的小朋友加入 @6 的派对"',
      'SeeDance 最多 3 段参考视频融合（总长 ≤15s）',
      '智能路由：Agent 自动识别哪些是视频、哪些是图片',
    ]},
    en: { title: 'Multi-Video Composition — Turn Clips into Cinema', features: [
      'Upload multiple videos — AI understands motion, scene, and character in each',
      'Direct composition via chat: "Put the kid from @4 into @6\'s birthday party"',
      'SeeDance fuses up to 3 reference videos (total ≤15s)',
      'Smart routing: Agent auto-detects which refs are videos vs images',
    ]},
    accent: 'from-amber-400 to-orange-600',
  },
  {
    icon: '📤',
    subtitle: 'Upload',
    zh: { title: '视频上传 — 随处可传', features: [
      '项目页、Home 页、CUI 聊天 — 三入口上传视频',
      '上传即分析：Gemini 3.0 Flash 原生视频理解',
      '浏览器端自动转码，分辨率归一化',
      '超限自动压缩（无需手动处理）',
    ]},
    en: { title: 'Upload Video — From Anywhere', features: [
      'Projects page, Home page, or drag into chat — three upload paths',
      'Instant analysis on upload: Gemini 3.0 Flash native video understanding',
      'Browser-side auto transcode, resolution normalization',
      'Auto-compress when exceeding limits (no manual work needed)',
    ]},
    accent: 'from-cyan-400 to-blue-600',
  },
  {
    icon: '💬',
    subtitle: 'Chat = Director',
    zh: { title: '对话式创作 — 聊天就是导演', features: [
      '聊天内嵌视频播放器 — 生成即预览，无需跳转',
      '视频附件直接拖入对话',
      '"加个字幕"、"换个风格"、"延长到 10 秒" — 一句话搞定',
      '视频完成自动弹出 — 点击直达全屏播放',
    ]},
    en: { title: 'Chat-First — You Are the Director', features: [
      'Inline video player in chat — preview instantly, no page switch',
      'Drag video attachments directly into conversation',
      '"Add subtitles", "change the style", "extend to 10s" — one sentence does it',
      'Video auto-pops when done — tap to fullscreen',
    ]},
    accent: 'from-pink-400 to-rose-600',
  },
  {
    icon: '🎥',
    subtitle: 'Timeline',
    zh: { title: '视频进入时间线', features: [
      '视频和图片并列在时间线中，像翻相册一样滑动浏览',
      '方形圆点 = 视频，圆形 = 图片，一眼区分',
      '每段视频的创作过程完整保留 — 随时回溯、对比',
    ]},
    en: { title: 'Video in Timeline', features: [
      'Videos sit alongside photos — swipe through your creative history',
      'Square dot = video, circle = image — instant visual distinction',
      'Full creation history preserved — rewind and compare anytime',
    ]},
    accent: 'from-green-400 to-emerald-600',
  },
  {
    icon: '⚡',
    subtitle: '7x Faster',
    zh: { title: '性能飞跃 — 7 倍提速', features: [
      'SSR 骨架屏精确镜像编辑器布局',
      '打开项目从 2 秒等待变为瞬间可见',
      '适配全平台：桌面、移动端、iOS Safari',
    ]},
    en: { title: 'Performance Leap — 7x Faster', features: [
      'SSR skeleton precisely mirrors Editor layout',
      'Open project: from 2s wait to instant visibility',
      'Works everywhere: desktop, mobile, iOS Safari',
    ]},
    accent: 'from-violet-400 to-indigo-600',
  },
  {
    icon: '🖥️',
    subtitle: 'CLI',
    zh: { title: 'CLI 视频支持', features: [
      'chat --video 命令行视频输入',
      'Signed URL 上传（图片 + 视频，无大小限制）',
      '182 次提交 · 79 文件 · 10+ AI Agents 协作完成',
    ]},
    en: { title: 'CLI Video Support', features: [
      'chat --video command line input',
      'Signed URL upload (images + videos, no size limit)',
      '182 commits · 79 files · 10+ AI Agents collaborated',
    ]},
    accent: 'from-slate-400 to-zinc-600',
  },
];

// ─── Animated Counter ──────────────────────────────────────────────
function AnimatedNumber({ value, delay = 0 }: { value: string; delay?: number }) {
  const [display, setDisplay] = useState('0');
  const numericPart = value.replace(/[^0-9]/g, '');
  const suffix = value.replace(/[0-9,]/g, '');

  useEffect(() => {
    const target = parseInt(numericPart.replace(/,/g, ''), 10);
    const duration = 1800;
    const startTime = Date.now() + delay;

    const animate = () => {
      const elapsed = Date.now() - startTime;
      if (elapsed < 0) {
        requestAnimationFrame(animate);
        return;
      }
      const progress = Math.min(elapsed / duration, 1);
      // ease-out cubic
      const eased = 1 - Math.pow(1 - progress, 3);
      const current = Math.round(target * eased);
      setDisplay(current.toLocaleString() + suffix);
      if (progress < 1) requestAnimationFrame(animate);
    };
    requestAnimationFrame(animate);
  }, [numericPart, suffix, delay]);

  return <span>{display}</span>;
}

// ─── Particles Background ──────────────────────────────────────────
// Deterministic pseudo-random to avoid SSR/client hydration mismatch
const PARTICLES = Array.from({ length: 30 }, (_, i) => {
  const s = (i * 7919 + 1) % 997;
  const r = (n: number) => ((s * (n + 1) * 13) % 1000) / 1000;
  return {
    width: 2 + r(1) * 4,
    height: 2 + r(2) * 4,
    left: r(3) * 100,
    top: r(4) * 100,
    hue: 290 + r(5) * 40,
    dur: 6 + r(6) * 8,
    delay: r(7) * -10,
  };
});

function Particles() {
  return (
    <div className="absolute inset-0 overflow-hidden pointer-events-none">
      {PARTICLES.map((p, i) => (
        <div
          key={i}
          className="absolute rounded-full opacity-20"
          style={{
            width: `${p.width}px`,
            height: `${p.height}px`,
            left: `${p.left}%`,
            top: `${p.top}%`,
            background: `hsl(${p.hue}, 80%, 60%)`,
            animation: `float ${p.dur}s ease-in-out infinite`,
            animationDelay: `${p.delay}s`,
          }}
        />
      ))}
    </div>
  );
}

// ─── Main Component ────────────────────────────────────────────────
function useIsZh() {
  const [isZh, setIsZh] = useState(true);
  useEffect(() => {
    const locale = typeof document !== 'undefined'
      ? (document.cookie.match(/(?:^|; )locale=([^;]*)/)?.[1] || localStorage.getItem('locale') || navigator.language)
      : 'zh';
    setIsZh(locale.startsWith('zh'));
  }, []);
  return isZh;
}

export default function VideoInTimelineReleasePage() {
  const [visible, setVisible] = useState(false);
  const sectionsRef = useRef<(HTMLDivElement | null)[]>([]);
  const isZh = useIsZh();

  useEffect(() => {
    setVisible(true);

    // Intersection observer for scroll-in animation
    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            entry.target.classList.add('changelog-visible');
          }
        });
      },
      { threshold: 0.15 }
    );

    sectionsRef.current.forEach((el) => {
      if (el) observer.observe(el);
    });

    return () => observer.disconnect();
  }, []);

  return (
    <div className="makaron-ios-page makaron-ios-page-x min-h-screen bg-black text-white overflow-x-hidden relative">
      {/* CSS Animations */}
      <style>{`
        @keyframes float {
          0%, 100% { transform: translateY(0px) scale(1); }
          50% { transform: translateY(-20px) scale(1.2); }
        }
        @keyframes shimmer {
          0% { background-position: -200% center; }
          100% { background-position: 200% center; }
        }
        @keyframes pulse-ring {
          0% { transform: scale(0.8); opacity: 0.8; }
          50% { transform: scale(1.1); opacity: 0.3; }
          100% { transform: scale(0.8); opacity: 0.8; }
        }
        @keyframes slide-up {
          from { opacity: 0; transform: translateY(40px); }
          to { opacity: 1; transform: translateY(0); }
        }
        @keyframes fade-in {
          from { opacity: 0; }
          to { opacity: 1; }
        }
        @keyframes glow {
          0%, 100% { box-shadow: 0 0 20px rgba(217, 70, 239, 0.3), 0 0 60px rgba(217, 70, 239, 0.1); }
          50% { box-shadow: 0 0 30px rgba(217, 70, 239, 0.5), 0 0 80px rgba(217, 70, 239, 0.2); }
        }
        @keyframes timeline-draw {
          from { height: 0; }
          to { height: 100%; }
        }
        .changelog-section {
          opacity: 0;
          transform: translateY(30px);
          transition: opacity 0.7s ease-out, transform 0.7s ease-out;
        }
        .changelog-visible {
          opacity: 1 !important;
          transform: translateY(0) !important;
        }
        .shimmer-text {
          background: linear-gradient(
            90deg,
            rgba(217, 70, 239, 1) 0%,
            rgba(236, 72, 153, 1) 25%,
            rgba(255, 255, 255, 1) 50%,
            rgba(236, 72, 153, 1) 75%,
            rgba(217, 70, 239, 1) 100%
          );
          background-size: 200% auto;
          -webkit-background-clip: text;
          -webkit-text-fill-color: transparent;
          background-clip: text;
          animation: shimmer 4s linear infinite;
        }
        .stat-card {
          animation: glow 3s ease-in-out infinite;
        }
        .stat-card:nth-child(2) { animation-delay: 0.5s; }
        .stat-card:nth-child(3) { animation-delay: 1s; }
        .stat-card:nth-child(4) { animation-delay: 1.5s; }
      `}</style>

      <Particles />

      {/* ─── Hero Section ─────────────────────────────────────── */}
      <section className="relative min-h-[100dvh] flex flex-col items-center justify-center px-6 py-20">
        {/* Radial gradient backdrop */}
        <div
          className="absolute inset-0 pointer-events-none"
          style={{
            background: 'radial-gradient(ellipse 80% 50% at 50% 30%, rgba(168, 85, 247, 0.12) 0%, transparent 70%)',
          }}
        />

        {/* Version badge */}
        <div
          className={`mb-8 px-4 py-1.5 rounded-full border border-fuchsia-500/30 bg-fuchsia-500/10 text-fuchsia-300 text-sm font-mono tracking-wider transition-all duration-1000 ${visible ? 'opacity-100 translate-y-0' : 'opacity-0 -translate-y-4'}`}
        >
          MAKARON · 2026.05.21
        </div>

        {/* Title */}
        <h1
          className={`text-4xl sm:text-6xl md:text-7xl font-black text-center leading-tight mb-6 transition-all duration-1000 delay-200 ${visible ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-8'}`}
        >
          <span className="block text-white/90">{isZh ? '视频编辑，' : 'Video Editing,'}</span>
          <span className="shimmer-text">{isZh ? '像聊天一样简单' : 'As Easy As Chatting'}</span>
        </h1>

        {/* Subtitle */}
        <p
          className={`text-lg sm:text-xl text-white/50 text-center max-w-2xl mb-4 transition-all duration-1000 delay-400 ${visible ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-8'}`}
        >
          {isZh
            ? '"让这个小朋友加入那个生日派对" — 搞定。'
            : '"Put this kid into that birthday party" — Done.'}
        </p>
        <p
          className={`text-sm text-white/30 text-center max-w-xl mb-12 transition-all duration-1000 delay-500 ${visible ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-8'}`}
        >
          {isZh
            ? '15 秒视频 · 多轮修改 · 续写故事 · 合成多段素材 · 支持真人脸'
            : '15s video · multi-turn refinement · continue stories · compose clips · real faces'}
        </p>

        {/* Stats Grid */}
        <div
          className={`grid grid-cols-2 sm:grid-cols-4 gap-4 sm:gap-6 w-full max-w-3xl transition-all duration-1000 delay-700 ${visible ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-8'}`}
        >
          {STATS.map((stat, i) => (
            <div
              key={stat.label}
              className="stat-card relative flex flex-col items-center p-5 rounded-2xl border border-white/[0.06] bg-white/[0.03]"
            >
              <span className="text-2xl mb-2">{stat.icon}</span>
              <span className="text-2xl sm:text-3xl font-black text-white/90 tabular-nums">
                <AnimatedNumber value={stat.value} delay={800 + i * 200} />
              </span>
              <span className="text-xs text-white/40 mt-1 font-medium tracking-wide">
                {stat.label}
              </span>
            </div>
          ))}
        </div>

        {/* Scroll hint */}
        <div
          className={`absolute bottom-10 flex flex-col items-center gap-2 transition-all duration-1000 delay-1200 ${visible ? 'opacity-100' : 'opacity-0'}`}
        >
          <span className="text-xs text-white/30">{isZh ? '向下滚动' : 'Scroll down'}</span>
          <div className="w-5 h-8 rounded-full border border-white/20 flex items-start justify-center p-1">
            <div
              className="w-1.5 h-1.5 rounded-full bg-fuchsia-400"
              style={{ animation: 'float 2s ease-in-out infinite' }}
            />
          </div>
        </div>
      </section>

      {/* ─── Feature Sections ────────────────────────────────── */}
      <section className="relative max-w-4xl mx-auto px-6 pb-32">
        {/* Timeline line */}
        <div className="absolute left-[27px] sm:left-[39px] top-0 bottom-0 w-px bg-gradient-to-b from-fuchsia-500/40 via-purple-500/20 to-transparent" />

        {SECTIONS.map((section, i) => (
          <div
            key={i}
            ref={(el) => { sectionsRef.current[i] = el; }}
            className="changelog-section relative pl-14 sm:pl-20 mb-16 last:mb-0"
            style={{ transitionDelay: `${i * 80}ms` }}
          >
            {/* Timeline dot */}
            <div className="absolute left-4 sm:left-6 top-1 w-7 h-7 sm:w-9 sm:h-9 flex items-center justify-center">
              <div
                className="absolute inset-0 rounded-full opacity-40"
                style={{ animation: 'pulse-ring 3s ease-in-out infinite', animationDelay: `${i * 0.3}s` }}
              >
                <div className={`w-full h-full rounded-full bg-gradient-to-br ${section.accent} opacity-50`} />
              </div>
              <span className="relative text-base sm:text-lg">{section.icon}</span>
            </div>

            {/* Content Card */}
            <div className="rounded-2xl border border-white/[0.06] bg-white/[0.02] p-5 sm:p-6 hover:bg-white/[0.04] hover:border-white/[0.1] transition-all duration-300">
              {/* Section Header */}
              <div className="mb-4">
                <h3 className="text-lg sm:text-xl font-bold text-white/90 mb-1">
                  {isZh ? section.zh.title : section.en.title}
                </h3>
                <p className="text-xs sm:text-sm text-white/30 font-mono">
                  {section.subtitle}
                </p>
              </div>

              {/* Feature list */}
              <ul className="space-y-2.5">
                {(isZh ? section.zh.features : section.en.features).map((feature, j) => (
                  <li key={j} className="flex items-start gap-3 group">
                    <span
                      className={`flex-shrink-0 w-1.5 h-1.5 mt-2 rounded-full bg-gradient-to-r ${section.accent} group-hover:scale-150 transition-transform duration-200`}
                    />
                    <span className="text-sm text-white/55 leading-relaxed group-hover:text-white/75 transition-colors duration-200">
                      {feature}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        ))}
      </section>

      {/* ─── Footer ──────────────────────────────────────────── */}
      <footer className="relative border-t border-white/[0.06] py-16 px-6">
        <div className="max-w-4xl mx-auto text-center">
          {/* Credits */}
          <div className="mb-8">
            <p className="text-white/40 text-sm mb-2">
              Built by <span className="text-fuchsia-400/80 font-medium">@Tianyi</span> {isZh ? '和 10+ AI Agents 协作完成' : 'with 10+ AI Agents'}
            </p>
            <p className="text-white/25 text-xs">
              Claude Opus 4.6 · Sonnet 4.6 · Gemini 3.1 Flash · Kling v3 · SeeDance 2.0
            </p>
          </div>

          {/* Tagline */}
          <div className="inline-flex items-center gap-3 px-5 py-2.5 rounded-full border border-white/[0.06] bg-white/[0.02]">
            <span className="text-xl">🍬</span>
            <span className="text-sm font-semibold text-white/60 tracking-wide">
              Makaron — One Man Studio
            </span>
          </div>

          {/* Version */}
          <p className="mt-6 text-xs text-white/15 font-mono">
            video-in-timeline / 2026-05-21
          </p>
        </div>
      </footer>
    </div>
  );
}
