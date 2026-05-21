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
  title: string;
  subtitle: string;
  features: string[];
  accent: string; // tailwind gradient class
}

const SECTIONS: FeatureSection[] = [
  {
    icon: '🎬',
    title: '视频成为时间线一等公民',
    subtitle: 'Video as First-Class Timeline Entry',
    features: [
      '视频直接作为时间线 Snapshot（type=video, video_meta JSONB）',
      '方形圆点 = 视频，圆形 = 图片，一眼区分',
      '浏览器端视频封面提取（移除服务端 ffmpeg 依赖）',
      'VideoResultCard 实时渲染状态、时长标签、模型名称',
    ],
    accent: 'from-fuchsia-500 to-purple-600',
  },
  {
    icon: '📤',
    title: '视频上传 — 随处可传',
    subtitle: 'Upload Video from Anywhere',
    features: [
      '项目页、Home 页、CUI 聊天 — 三入口上传视频',
      '浏览器端 Remotion 转码，分辨率自动归一化',
      '超限自动压缩（SeeDance 分辨率限制）',
      '上传即分析：Gemini 3.0 Flash 原生视频理解',
      'Agent 新增 analyze_video 工具',
    ],
    accent: 'from-cyan-400 to-blue-600',
  },
  {
    icon: '🔗',
    title: '视频引用 & 多视频合成',
    subtitle: 'Video References & Multi-Video Composition',
    features: [
      'Media Index 取代 Image Index（<<<media_N>>> 格式）',
      '智能路由：Agent 引用 <<<media_4>>> → 自动检测是视频 → 注入 video_urls',
      'SeeDance 多视频合成（最多 3 段，总长 ≤15s）',
      '时长校验 + 清晰错误提示',
    ],
    accent: 'from-amber-400 to-orange-600',
  },
  {
    icon: '🎥',
    title: 'Remotion 视频渲染',
    subtitle: 'Remotion Video Support',
    features: [
      '<Video> 和 <OffthreadVideo> 正式进入 Remotion Scope',
      '视频 Design 直接渲染源 MP4',
      '视频预加载 — 切换 timeline 零卡顿',
      'Blob URL 跨切换缓存',
      'Design Harness 自动修正：<video> → <Video>，注入 premountFor',
    ],
    accent: 'from-green-400 to-emerald-600',
  },
  {
    icon: '💬',
    title: 'CUI 视频集成',
    subtitle: 'Chat-First Video Experience',
    features: [
      '聊天内嵌视频播放器（播放/暂停、音量、poster、进度条）',
      'CUI 消息支持视频附件',
      '视频缩略图 @N 角标',
      '提交后自动跳转到视频 Snapshot',
      '视频完成消息 — 点击直达',
    ],
    accent: 'from-pink-400 to-rose-600',
  },
  {
    icon: '⚡',
    title: 'SSR Skeleton — 性能飞跃',
    subtitle: 'LCP: 2105ms → 284ms (7x faster)',
    features: [
      '服务端渲染骨架屏精确镜像 Editor flex 布局',
      '适配桌面/移动端、safe-area-insets、iOS Safari',
      'LCP 从 2105ms 降至 284ms — 提速 7 倍',
    ],
    accent: 'from-violet-400 to-indigo-600',
  },
  {
    icon: '🖥️',
    title: 'CLI 视频支持',
    subtitle: 'Terminal-First Video Creation',
    features: [
      'chat --video 命令行视频输入',
      'v2 视频时间线轮询与创建',
      'Signed URL 上传（图片 + 视频，无大小限制）',
    ],
    accent: 'from-slate-400 to-zinc-600',
  },
  {
    icon: '🏗️',
    title: '架构升级',
    subtitle: 'Architecture Improvements',
    features: [
      'Renderer Registry — 声明式内容类型分发',
      '统一服务端 Context Building（移除前端 context）',
      '共享 CreateInputBox + useCreateInput Hook',
      'Postgres RPC 原子 sort_order（杜绝重复排序）',
      '统一视频占位符（processing/failed 状态）',
    ],
    accent: 'from-teal-400 to-cyan-600',
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
function Particles() {
  return (
    <div className="absolute inset-0 overflow-hidden pointer-events-none">
      {Array.from({ length: 30 }).map((_, i) => (
        <div
          key={i}
          className="absolute rounded-full opacity-20"
          style={{
            width: `${2 + Math.random() * 4}px`,
            height: `${2 + Math.random() * 4}px`,
            left: `${Math.random() * 100}%`,
            top: `${Math.random() * 100}%`,
            background: `hsl(${290 + Math.random() * 40}, 80%, 60%)`,
            animation: `float ${6 + Math.random() * 8}s ease-in-out infinite`,
            animationDelay: `${Math.random() * -10}s`,
          }}
        />
      ))}
    </div>
  );
}

// ─── Main Component ────────────────────────────────────────────────
export default function VideoInTimelineReleasePage() {
  const [visible, setVisible] = useState(false);
  const sectionsRef = useRef<(HTMLDivElement | null)[]>([]);

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
    <div className="min-h-screen bg-black text-white overflow-x-hidden relative">
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
          RELEASE: VIDEO IN TIMELINE
        </div>

        {/* Title */}
        <h1
          className={`text-4xl sm:text-6xl md:text-7xl font-black text-center leading-tight mb-6 transition-all duration-1000 delay-200 ${visible ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-8'}`}
        >
          <span className="block text-white/90">视频，</span>
          <span className="shimmer-text">正式进入时间线</span>
        </h1>

        {/* Subtitle */}
        <p
          className={`text-lg sm:text-xl text-white/50 text-center max-w-2xl mb-4 transition-all duration-1000 delay-400 ${visible ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-8'}`}
        >
          Makaron 有史以来最大的功能更新
        </p>
        <p
          className={`text-sm text-white/30 text-center max-w-xl mb-12 transition-all duration-1000 delay-500 ${visible ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-8'}`}
        >
          10+ AI Agents 协作完成 · 182 次提交 · 从上传到渲染，从 CLI 到 CUI，视频融入每一个触点
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
          <span className="text-xs text-white/30">向下滚动</span>
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
                  {section.title}
                </h3>
                <p className="text-xs sm:text-sm text-white/30 font-mono">
                  {section.subtitle}
                </p>
              </div>

              {/* Feature list */}
              <ul className="space-y-2.5">
                {section.features.map((feature, j) => (
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
              Built by <span className="text-fuchsia-400/80 font-medium">@vegekyd</span> and 10+ AI agents
            </p>
            <p className="text-white/25 text-xs">
              Claude Opus 4.6 / Sonnet 4.6 / Gemini 3.1 Flash / Kling v3 / SeeDance 2.0
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
            video-in-timeline / 2026-05-21 / dev branch
          </p>
        </div>
      </footer>
    </div>
  );
}
