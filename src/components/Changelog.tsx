'use client';

interface ChangelogEntry {
  date: string;
  en: { title: string; items: string[] };
  zh: { title: string; items: string[] };
}

const CHANGELOG: ChangelogEntry[] = [
  {
    date: '2026-04-23',
    en: { title: 'Skill Sharing & Management', items: [
      'Share skills: generate a private link and send it to friends — they can add the Skill to their account in one click',
      'Skills page: browse all your skills in one place, with share and delete actions',
      'User menu: Sign out replaced with a dropdown menu (Skills + Sign out)',
      'Claim page: beautiful preview card when opening a share link, with login redirect for new users',
      'Smart dedup: sharing the same skill returns the same link every time',
    ]},
    zh: { title: 'Skill 分享 & 管理', items: [
      '分享 Skill：生成私密链接发给朋友，朋友一键即可添加到自己账号',
      'Skills 页面：集中浏览所有 Skill，支持分享和删除操作',
      '用户菜单：Sign out 改为下拉菜单（Skills + Sign out）',
      '领取页面：打开分享链接后展示精美预览卡片，未登录自动引导登录',
      '智能去重：同一个 Skill 多次分享返回同一个链接',
    ]},
  },
  {
    date: '2026-04-23',
    en: { title: 'OpenAI Image 2 & Billing', items: [
      'OpenAI gpt-5.4-image-2: new image generation model via OpenRouter — superior text rendering for posters/graphics',
      'CUI model selector: cycle through Auto → Gemini → Qwen → OpenAI (purple pill)',
      'Token-based billing: per-model usage tracking for Gemini, OpenAI, Bedrock',
      'Subscription system: 3-tier Stripe recurring plans (Basic/Pro/Business) + one-time top-ups',
    ]},
    zh: { title: 'OpenAI Image 2 & 计费系统', items: [
      'OpenAI gpt-5.4-image-2：新增生图模型 — 文字渲染远超 Gemini，适合海报/营销图',
      'CUI 模型选择器：Auto → Gemini → Qwen → OpenAI 循环切换（紫色标签）',
      'Token 计费：Gemini、OpenAI、Bedrock 按模型用量计费',
      '订阅系统：Stripe 3 档周期订阅（Basic/Pro/Business）+ 单次充值',
    ]},
  },
  {
    date: '2026-04-20',
    en: { title: 'Headless Agent & CLI', items: [
      'Published on npm: `npx makaron-cli` — zero install, works anywhere with Node.js',
      'Makaron CLI: create projects, chat with Agent, generate images/videos — all from terminal',
      'Headless Agent: Agent runs without browser — results appear in project page automatically',
      'Fire-and-forget API: POST /api/agent/run returns immediately, Agent works in background',
      'Multi-image project creation: upload multiple photos at once via CLI or API',
      'Text-to-image: create empty project and let Agent generate from a text prompt',
      'Auto-naming: headless projects get named automatically after first Agent run',
    ]},
    zh: { title: 'Headless Agent & CLI', items: [
      '已发布 npm：`npx makaron-cli` — 无需安装，有 Node.js 即可使用',
      'Makaron CLI：终端创建项目、与 Agent 对话、生图/生视频，无需浏览器',
      'Headless Agent：Agent 脱离前端运行，结果自动出现在项目页',
      'Fire-and-forget API：POST /api/agent/run 立即返回，Agent 后台执行',
      '多图项目创建：CLI 或 API 一次上传多张照片',
      '文生图：创建空项目后 Agent 直接从文字 prompt 生成图片',
      '自动命名：headless 项目在首次 Agent 运行后自动获取名称',
    ]},
  },
  {
    date: '2026-04-19',
    en: { title: 'Preview = Export & Design Editor Polish', items: [
      'Preview = Export guarantee: drag/scale positions now identical in preview and exported video/image',
      'Mobile pinch-to-scale: two-finger zoom on editable elements, works anywhere on canvas',
      'Seek bar interaction: dragging seek bar cleanly exits design editor mode',
    ]},
    zh: { title: '预览=导出 & Design 编辑器优化', items: [
      '预览=导出保证：拖拽/缩放后的位置在预览和导出视频/图片中完全一致',
      '手机双指缩放：画布任意位置双指缩放编辑元素',
      '进度条交互：拖拽进度条自动退出编辑模式',
    ]},
  },
  {
    date: '2026-04-17',
    en: { title: 'Design Editor & Creative Tools', items: [
      'Design Editor: drag editable text elements to reposition — snap guidelines for precise alignment',
      'Agent creative tools: @remotion/paths (SVG path animation) + @remotion/noise (procedural textures)',
      'Design animations preserved: dragging no longer breaks Agent\'s rotate/scale/skew effects',
      'Double-tap to edit text: unified interaction on desktop and mobile',
      'Scale/resize editable elements: drag any corner handle to resize proportionally',
    ]},
    zh: { title: 'Design 编辑器 & 创意工具', items: [
      'Design 编辑器：可拖拽文字元素重新定位 — 智能辅助线精确对齐',
      'Agent 创意工具：@remotion/paths（SVG 路径动画）+ @remotion/noise（程序化纹理）',
      '动画效果保留：拖拽后 Agent 的旋转/缩放/倾斜特效不丢失',
      '双击编辑文字：桌面和手机统一交互',
      '缩放编辑元素：拖拽四角手柄等比缩放',
    ]},
  },
  {
    date: '2026-04-16',
    en: { title: 'Video Design Pro & Sandbox Rendering', items: [
      'Smarter video creation: 4-question creative check drives the entire workflow — plan, code, verify',
      'Rich kinetic typography: per-character animation, multi-layer text per scene, text that tells the story',
      'Remotion Sandbox: server-side frame rendering on Vercel — Agent previews any frame without browser',
      'CJK fonts + emoji in Sandbox: system Noto fonts + 30 pre-cached Google Fonts in Snapshot',
      'Cross-platform safe: iOS-friendly effects, gradient backgrounds, no heavy CJK web fonts',
      'Auto-save & publish: Agent saves code after every edit, publishes when satisfied',
      'Abort Agent: cancel background Agent from CUI',
    ]},
    zh: { title: 'Video Design Pro & Sandbox 渲染', items: [
      '更聪明的视频创作：四问创意自检驱动全流程 — 规划、编码、验证',
      '丰富的花字动效：逐字动画、每场景多层文字、文字就是画面的一部分',
      'Remotion Sandbox：服务端逐帧渲染 — Agent 无需浏览器即可预览任意帧',
      'Sandbox 中日韩字体 + Emoji：系统 Noto 字体 + 30 个预缓存 Google Fonts',
      '跨平台安全：iOS 友好特效，渐变背景代替模糊，不加载大型中文网络字体',
      '自动保存 & 发布：Agent 每次编辑后自动存代码，满意后发布',
      '中断 Agent：CUI 中可取消后台 Agent',
    ]},
  },
  {
    date: '2026-04-15',
    en: { title: 'Frame Preview & Draft Timeline', items: [
      'preview_frame: Agent captures any frame of a video design to check its own work before publishing',
      'Draft → Publish: run_code creates drafts, write_file publishes — only final designs land on timeline',
      'Multi-frame chat display: preview frames shown as scrollable gallery in conversation',
      'Agent model upgraded to Opus 4.6',
    ]},
    zh: { title: '逐帧预览 & 草稿时间线', items: [
      'preview_frame：Agent 可以截取视频任意帧来检查自己的作品，发布前自行校验',
      '草稿 → 发布：run_code 生成草稿，write_file 发布 — 时间线上只出现最终稿',
      '多帧聊天展示：截帧预览在对话中横向滚动展示',
      'Agent 模型升级到 Opus 4.6',
    ]},
  },
  {
    date: '2026-04-13',
    en: { title: 'Editable Text in Designs', items: [
      'Edit text directly: click any text element in a design to select, click Edit to modify — no Agent needed',
      'Frame-aware: video designs show only the text fields visible at the current frame',
      'Floating editor: shared panel with annotation toolbar — draggable on desktop, fixed on mobile',
      'Auto-persist: text edits saved to workspace automatically (debounced)',
    ]},
    zh: { title: 'Design 文字可编辑', items: [
      '直接编辑文字：点击 Design 中的文字选中，点 Edit 即可修改 — 无需 Agent',
      '帧感知：视频 Design 只显示当前帧可见的文字字段',
      '浮动编辑器：与标注工具共享面板 — 桌面可拖拽，移动端固定底部',
      '自动保存：文字编辑自动持久化到 workspace',
    ]},
  },
  {
    date: '2026-04-12',
    en: { title: 'Remotion Engine, Music & Background Agent', items: [
      'Remotion rendering: Agent generates React/CSS code → browser renders stills and animations with Remotion Player',
      'MP4 export: animated designs export as h264/mp4 directly in the browser',
      'Patch mode: edit existing designs incrementally (change text, colors, layout) without rewriting code',
      'Music: Suno AI background music — generate, preview 2 tracks, select and inject into design',
      'Background Agent: server-side persistence + automatic reconnect on page reload',
      'Agent switched to Sonnet 4.6 for 3-4x faster code generation',
      'Design intelligence: Agent sees design code in context, patches directly without reading files',
      'Video Design skill: cinematic 4-question self-check + 花字 (fancy text) guidelines',
    ]},
    zh: { title: 'Remotion 引擎、音乐配乐 & 后台 Agent', items: [
      'Remotion 渲染：Agent 生成 React/CSS 代码 → 浏览器渲染静态图和动画',
      'MP4 导出：animated design 直接在浏览器导出 h264/mp4',
      'Patch 模式：增量编辑现有 design（改文字、颜色、布局），无需重写代码',
      '音乐：Suno AI 配乐 — 生成、试听 2 首、选择后注入 Design',
      '后台 Agent：服务端持久化 + 刷新自动重连',
      'Agent 切换到 Sonnet 4.6，代码生成速度提升 3-4 倍',
      'Design 智能化：Agent 直接看到代码上下文，patch 修改无需读文件',
      '视频设计 Skill：电影感四问自检 + 花字引导',
    ]},
  },
  {
    date: '2026-04-05',
    en: { title: 'Workspace Agent & Code Execution', items: [
      'Workspace file system: skills and files stored in Supabase with persistent workspace_files table',
      'Agent run_code: execute JavaScript with sharp (image processing), satori (HTML→image), JSZip (packaging)',
      'Agent can create skills with reference images — any great result can become a reusable skill',
      'saveToWorkspace: upload files directly to Supabase Storage from run_code',
      'Skill packaging: Agent builds zip files for sharing, with download links in chat',
      'CUI improvements: clickable file chips (📄), collapsible code blocks, run_code status indicators',
      'Built-in skills (Makaron Mascot, Photo-to-Video) seeded as global workspace files',
      'GET/POST /api/skills unified through workspace — user_skills table replaced',
    ]},
    zh: { title: 'Workspace Agent & 代码执行', items: [
      'Workspace 文件系统：skill 和文件存储到 Supabase，workspace_files 表持久化',
      'Agent run_code：执行 JavaScript，预装 sharp（图片处理）、satori（HTML→图片）、JSZip（打包）',
      'Agent 可以创建带参考图的 skill — 任何做得好的结果都能固化成可复用 skill',
      'saveToWorkspace：run_code 中直接上传文件到 Supabase Storage',
      'Skill 打包：Agent 自动打 zip 包供分享，CUI 中显示下载链接',
      'CUI 优化：可点击文件标签（📄）、代码块折叠、run_code 状态指示',
      '内置 skill（Makaron 吉祥物、照片变视频）作为全局 workspace 文件种子',
      'GET/POST /api/skills 统一通过 workspace — 替换旧 user_skills 表',
    ]},
  },
  {
    date: '2026-04-02',
    en: { title: 'Skill-Driven Tips & Video Editing', items: [
      'Skill tips fusion: active skill injects character/IP context into tips generation',
      'Skill reference images passed to preview generation for accurate character rendering',
      'A/B tested: skill-only mode (no category .md templates) produces better results',
      'Category hints (enhance/creative/wild/captions) for parallel tip generation',
      'MCP video editing: new makaron_edit_video tool using Kling video_list API',
      'Skill upload drag & drop on project page',
    ]},
    zh: { title: 'Skill 驱动 Tips & 视频编辑', items: [
      'Skill Tips 融合：激活 skill 时将角色/IP 上下文注入 tips 生成',
      'Skill 参考图传给 preview 生图，确保角色渲染准确',
      'A/B 测试验证：纯 skill 模式（不用分类 .md 模板）效果更好',
      '分类含义提示（enhance/creative/wild/captions）用于并发 tip 生成',
      'MCP 视频编辑：新增 makaron_edit_video 工具，基于 Kling video_list API',
      '项目页 skill 上传支持拖放 zip',
    ]},
  },
  {
    date: '2026-04-01',
    en: { title: 'Skill System', items: [
      'SKILL.md-driven skill framework — define workflows with YAML frontmatter + markdown templates',
      'Built-in skills: Photo-to-Video (3-act story generation) & Makaron Mascot (Pixel Wizard character)',
      'User custom skills: upload zip with SKILL.md + assets, stored in DB',
      'Skill reference images as timeline snapshots for Agent context',
      'Skill pills in Editor UI with unified highlight style',
      'Skills API: list / create / delete with admin support',
    ]},
    zh: { title: 'Skill 技能系统', items: [
      'SKILL.md 驱动的技能框架 — YAML frontmatter + Markdown 模板定义工作流',
      '内置技能：照片变视频（3 幕故事生成）& Makaron 吉祥物（Pixel Wizard 角色）',
      '用户自定义技能：上传 zip（SKILL.md + 素材），存入数据库',
      '技能参考图作为时间线 snapshot 注入 Agent 上下文',
      '编辑器 Skill 选择 pill，统一高亮样式',
      'Skills API：列表 / 创建 / 删除，支持管理员操作',
    ]},
  },
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
        className="relative w-full h-full sm:h-auto sm:max-w-xl sm:mx-4 sm:max-h-[80dvh] sm:rounded-2xl overflow-hidden flex flex-col"
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
