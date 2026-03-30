'use client';

interface ChangelogEntry {
  date: string;
  en: { title: string; items: string[] };
  zh: { title: string; items: string[] };
}

const CHANGELOG: ChangelogEntry[] = [
  {
    date: '2026-03-30',
    en: { title: 'Video & Performance', items: [
      'Video first frame preview in canvas',
      'Click video in chat → jump to GUI playback',
      'Desktop: double-click video to play',
      'Bedrock prompt caching for faster agent',
    ]},
    zh: { title: '视频与性能', items: [
      '画布中展示视频真实首帧',
      '聊天中点击视频跳转到画布播放',
      '桌面端：双击视频直接播放',
      'Bedrock prompt 缓存加速 Agent 响应',
    ]},
  },
  {
    date: '2026-03-28',
    en: { title: 'Video MCP & Foldin', items: [
      'Video generation via MCP (write script + render)',
      'Foldin (SeeDance 2.0) video provider',
    ]},
    zh: { title: '视频 MCP 与 Foldin', items: [
      '通过 MCP 生成视频（写脚本 + 渲染）',
      'Foldin（SeeDance 2.0）视频供应商',
    ]},
  },
  {
    date: '2026-03-25',
    en: { title: 'Safety & Editor Refactor', items: [
      'NSFW auto-routing: Gemini blocked → Qwen fallback',
      'Editor refactored: -312 lines, cleaner architecture',
      'Accessibility attributes for automation testing',
    ]},
    zh: { title: '安全与编辑器重构', items: [
      'NSFW 自动路由：Gemini 拒绝 → 自动切 Qwen',
      '编辑器重构：精简 312 行，架构更清晰',
      '自动化测试的无障碍属性',
    ]},
  },
  {
    date: '2026-03-20',
    en: { title: 'Multi-Model Router', items: [
      'Unified image generation with auto fallback',
      'Gemini / Qwen / Pony / WAI model support',
      'MCP text-to-image + model selection',
    ]},
    zh: { title: '多模型路由', items: [
      '统一生图入口，自动 fallback',
      '支持 Gemini / Qwen / Pony / WAI 模型',
      'MCP 文生图 + 模型选择',
    ]},
  },
  {
    date: '2026-03-16',
    en: { title: 'MCP API', items: [
      'MCP server for external agents (edit image + rotate camera)',
      'Bearer token authentication',
      'stdio + HTTP dual mode',
    ]},
    zh: { title: 'MCP 开放接口', items: [
      '面向外部 Agent 的 MCP 服务（编辑图片 + 旋转相机）',
      'Bearer token 鉴权',
      'stdio + HTTP 双模式',
    ]},
  },
  {
    date: '2026-03-14',
    en: { title: 'Desktop & Gestures', items: [
      'Resizable CUI panel on desktop',
      'Pull-down gesture to enter chat (iOS Photos style)',
      'Multi-image upload + drag-and-drop in chat',
    ]},
    zh: { title: '桌面端与手势', items: [
      '桌面端可调整聊天面板宽度',
      '下拉手势进入聊天（iOS 相册风格）',
      '多图上传 + 拖放到聊天',
    ]},
  },
  {
    date: '2026-03-08',
    en: { title: 'Performance', items: [
      'Supabase Image Transformations (-94% transfer)',
      'AI output PNG→JPEG compression',
      'Progressive loading with draft preview',
    ]},
    zh: { title: '性能优化', items: [
      'Supabase 图片变换（传输减少 94%）',
      'AI 输出 PNG→JPEG 压缩',
      '渐进式加载 + 草稿预览过渡',
    ]},
  },
  {
    date: '2026-03-04',
    en: { title: 'i18n & Video Timeline', items: [
      'English / Chinese language support',
      'Snapshot animation with video timeline',
      'Kling AI video generation with sound',
      'Camera rotate (3D virtual camera control)',
    ]},
    zh: { title: '多语言与视频时间线', items: [
      '中英文双语支持',
      'Snapshot 动画与视频时间线',
      'Kling AI 视频生成（带声音）',
      '相机旋转（3D 虚拟相机控制）',
    ]},
  },
  {
    date: '2026-02-24',
    en: { title: 'Agent & Chat UI', items: [
      'Makaron Agent (Claude Sonnet) as AI brain',
      'Full-screen chat with hero transition animations',
      'PiP thumbnail with edge-collapse',
      'IndexedDB local cache for instant reload',
      'Supabase migrated to Tokyo for lower latency',
    ]},
    zh: { title: 'Agent 与聊天界面', items: [
      'Makaron Agent（Claude Sonnet）作为 AI 大脑',
      '全屏聊天 + hero 飞行过渡动画',
      'PiP 缩略图边缘收起',
      'IndexedDB 本地缓存，重进秒开',
      'Supabase 迁移到东京，降低延迟',
    ]},
  },
  {
    date: '2026-02-17',
    en: { title: 'Annotation & Captions', items: [
      'Paintbrush annotation mode for guided editing',
      'Captions category (text overlay on images)',
      'Reference image upload in chat (up to 3)',
      'Projects page gallery redesign',
    ]},
    zh: { title: '标注与文字', items: [
      '画笔标注模式，引导式编辑',
      '文字分类（图片上添加标题/文案）',
      '聊天中上传参考图（最多 3 张）',
      '项目页 gallery 重新设计',
    ]},
  },
  {
    date: '2026-02-10',
    en: { title: 'Tips & Preview', items: [
      'Category-based preview (enhance / creative / wild)',
      'Two-click interaction: preview → commit',
      'Before/after comparison (long press)',
      'Tips prompt V42 architecture',
    ]},
    zh: { title: 'Tips 与预览', items: [
      '按分类预览（增强 / 创意 / 狂野）',
      '两步交互：预览 → 确认',
      '长按对比（修改前后）',
      'Tips prompt V42 架构',
    ]},
  },
  {
    date: '2026-02-01',
    en: { title: 'Foundation', items: [
      'Supabase Auth (email + password)',
      'Cloud persistence (Storage + Database)',
      'Project gallery with snapshot thumbnails',
      'Image upload with client-side compression',
      'AI image editing via Gemini',
    ]},
    zh: { title: '基础架构', items: [
      'Supabase 认证（邮箱 + 密码）',
      '云端持久化（Storage + Database）',
      '项目列表与 snapshot 缩略图',
      '图片上传 + 客户端压缩',
      'Gemini AI 图片编辑',
    ]},
  },
];

export default function Changelog({ onClose, locale }: { onClose: () => void; locale: string }) {
  const isZh = locale === 'zh';

  return (
    <div
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center"
      onClick={onClose}
    >
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" />

      {/* Modal — full screen on mobile, centered card on desktop */}
      <div
        className="relative w-full h-full sm:h-auto sm:max-w-md sm:mx-4 sm:max-h-[80dvh] sm:rounded-2xl overflow-hidden flex flex-col"
        style={{ background: 'rgba(20,20,20,0.97)', border: '1px solid rgba(255,255,255,0.08)' }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex-shrink-0 flex items-center justify-between px-5 py-4" style={{ borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
          <h2 className="text-base font-semibold" style={{ color: 'rgba(255,255,255,0.85)' }}>
            {isZh ? '更新日志' : "What's New"}
          </h2>
          <button
            onClick={onClose}
            className="w-7 h-7 flex items-center justify-center rounded-full"
            style={{ background: 'rgba(255,255,255,0.08)' }}
          >
            <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="rgba(255,255,255,0.5)" strokeWidth="1.5" strokeLinecap="round">
              <line x1="2" y1="2" x2="10" y2="10" /><line x1="10" y1="2" x2="2" y2="10" />
            </svg>
          </button>
        </div>

        {/* Scrollable entries */}
        <div className="flex-1 overflow-y-auto overscroll-contain px-5 pb-6" style={{ WebkitOverflowScrolling: 'touch' }}>
          {CHANGELOG.map((entry, i) => {
            const loc = isZh ? entry.zh : entry.en;
            return (
              <div key={entry.date} className={i > 0 ? 'mt-5' : 'mt-3'}>
                <div className="flex items-center gap-2.5 mb-1.5">
                  <span className="text-[11px] font-mono tabular-nums" style={{ color: 'rgba(192,38,211,0.7)' }}>
                    {entry.date}
                  </span>
                  <span className="text-[13px] font-medium" style={{ color: 'rgba(255,255,255,0.75)' }}>
                    {loc.title}
                  </span>
                </div>
                <ul className="flex flex-col gap-1 pl-1">
                  {loc.items.map((item, j) => (
                    <li key={j} className="flex gap-2 text-[12.5px] leading-[1.5]" style={{ color: 'rgba(255,255,255,0.45)' }}>
                      <span style={{ color: 'rgba(255,255,255,0.15)', flexShrink: 0 }}>·</span>
                      {item}
                    </li>
                  ))}
                </ul>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
