'use client';

interface ChangelogEntry {
  date: string;
  en: { title: string; items: string[]; link?: { label: string; href: string } };
  zh: { title: string; items: string[]; link?: { label: string; href: string } };
}

const CHANGELOG: ChangelogEntry[] = [
  {
    date: '2026-06-21',
    en: { title: 'Major Video Model Upgrade', items: [
      'Grok 1.5 is here: turn a photo into video in about 30–40 seconds, with surprisingly strong results.',
      'SeeDance 2.0 is now available as the high-quality option, separate from Fast. It costs more, but delivers SOTA-level video quality.',
      'Kling O3 now supports 4K output, so you can create sharper, higher-end videos directly in Makaron.',
    ]},
    zh: { title: '视频模型重大升级', items: [
      'Grok 1.5 上线：可以把照片迅速动起来，通常 30–40 秒完成，效果非常出色。',
      'SeeDance 2.0 上线：这是区别于 Fast 的高画质版本，价格更高，但效果应该是目前 SOTA。',
      'Kling O3 支持 4K：可以直接输出更清晰、更高规格的视频。',
    ]},
  },
  {
    date: '2026-06-18',
    en: { title: 'Local Video Repair & Agent Workspace', items: [
      'See one awkward shot in an otherwise good video? Send a screenshot and tell Makaron what should change.',
      'Makaron will focus on that moment instead of asking you to regenerate the whole clip from scratch.',
      'You can say things like "make this frame Paris" or "the hand looks wrong here" — no exact timestamp required.',
      'After the new piece is ready, Makaron shows a clear next step to place it back into the full video.',
      'Agent workspace has been rebuilt so project files, generated clips, and intermediate outputs can be reused directly across follow-up steps.',
      'This means fewer manual file handoffs, faster FFmpeg-style edits, and a smoother path from one generated result to the next.',
      'This makes video revision feel closer to photo editing: point at the problem, fix only that part, keep the rest.',
    ]},
    zh: { title: '局部修视频 & Agent 工作区升级', items: [
      '一条视频整体都不错，只是某个画面不对？现在可以直接发截屏，告诉 Makaron 想怎么改。',
      '不用整条视频从头生成；Makaron 会把注意力放在这个画面附近，只重做这一小段。',
      '你可以像平时说话一样描述："这帧换成巴黎"、"这里手有点怪"、"大概这一秒不对"。',
      '新片段生成完成后，Makaron 会继续给出清晰的下一步，把它放回完整视频里。',
      'Agent 工作区完成了一次重写：项目素材、生成片段和中间文件都可以在后续步骤里直接复用。',
      '这会减少手动找文件和传文件的步骤，让 FFmpeg 这类合成、裁剪、拼接任务更快接上下一步。',
      '视频修改开始更像修图：指出问题，只改局部，保留其他已经满意的部分。',
    ]},
  },
  {
    date: '2026-06-07',
    en: { title: 'Voice Writing & Video Cuts', items: [
      'Makaron can now draft from spoken video: it listens to uploaded clips and turns speech into editing context.',
      'Turn a raw talking-head clip into a cleaner draft by asking Agent to tighten pauses, breaths, and dead air.',
      'Ask for the strongest lines, then cut around those moments to shape a sharper short video.',
      'Video edits, previews, and analysis results stay on the timeline, so the next prompt can keep building from the same material.',
    ]},
    zh: { title: '语音撰写与视频剪辑', items: [
      'Makaron 现在可以用视频里的口播来写稿：先听懂语音，再把逐字稿和时间点交给 Agent。',
      '可以直接让 Agent 收紧停顿、气口和废话，把一段原始口播剪成更干净的初稿。',
      '也可以让 Agent 找出金句，再围绕这些高光时刻剪出更有重点的短视频。',
      '剪好的视频、预览和分析结果都会留在时间线上，下一轮可以接着同一份素材继续改。',
    ]},
  },
  {
    date: '2026-06-05',
    en: { title: 'AI Search & Growth Readiness', items: [
      'Makaron is now easier for search engines and AI agents to understand, recommend, and route to.',
      'New public pages explain Makaron, key use cases, and indexable skill outcomes without changing the creation flow.',
      'Skill SEO pages now live under /skill/{skillId}, while /home/{skillId} stays focused on the product experience.',
      'llms.txt gives coding agents a clear map for when to use makaron-cli for images, videos, music, and creative assets.',
      'First-party marketing events now track the funnel from skill views to project creation, signup, checkout, and purchase.',
    ]},
    zh: { title: 'AI 搜索与增长准备', items: [
      'Makaron 现在更容易被搜索引擎和 AI Agent 理解、推荐和路由。',
      '新增公开页面，讲清 Makaron、核心 use case 和可索引的 skill 效果，同时不打断创作流程。',
      'Skill SEO 页迁到 /skill/{skillId}，/home/{skillId} 继续专注真实产品体验。',
      'llms.txt 为 coding agent 提供清晰地图，知道什么时候该用 makaron-cli 生成图片、视频、音乐和创意素材。',
      '第一方 marketing events 开始记录从 skill 浏览到创建项目、注册、checkout 和购买的漏斗。',
    ]},
  },
  {
    date: '2026-06-04',
    en: { title: 'Video Agent — From Generation to Editing', items: [
      'Makaron can now edit videos, not just generate them.',
      'Upload longer videos up to 120 seconds.',
      'Split, trim, caption, and combine clips by chatting.',
      'Finished edits go straight onto the timeline.',
      'Agent remembers files, previews, and results across turns.',
    ]},
    zh: { title: 'Video Agent — 从生成到剪辑', items: [
      'Makaron 现在不只是生成视频，也能剪视频。',
      '支持更长素材，最长可上传 120 秒。',
      '分段、裁剪、字幕、拼接，都可以聊天完成。',
      '剪好的结果会直接出现在时间线上。',
      'Agent 会记住文件、预览和结果，下一轮接着做。',
    ]},
  },
  {
    date: '2026-06-02',
    en: { title: 'Long Story Skill', items: [
      'Makaron now supports video creation beyond the 15-second limit.',
      'The new long story skill helps turn one idea into a longer, multi-segment video with a more continuous narrative.',
      'Before rendering, you can review anchors, storyboards, and the script step by step.',
    ]},
    zh: { title: 'Long Story Skill', items: [
      'Makaron 现在支持超过 15 秒的视频生成。',
      '新的 long story skill 可以把一个想法扩展成更长、分段连续的故事视频。',
      '在正式生成前，用户可以逐步查看并确认锚定物、分镜和脚本。',
    ]},
  },
  {
    date: '2026-05-31',
    en: { title: 'Agent Prompt Rebuild', items: [
      'Much faster first response: Agent now starts from a compact router prompt instead of eagerly loading every skill file.',
      'Cleaner media modes: image, video, design, music, and run_code have clearer routing instead of one long patched prompt.',
      'Smarter image editing: direct edits go straight to generation; image analysis is only used when it changes the decision.',
      'Skills stay powerful but lighter: Agent discovers skills first, then reads the full SKILL.md only when needed.',
      'Video intent respected: scripts still have a review gate by default, but explicit "submit now" requests can render immediately.',
    ]},
    zh: { title: 'Agent Prompt 重构', items: [
      '首字更快：Agent 现在从简洁 router prompt 启动，不再提前加载所有 skill 文件。',
      '模式更清晰：图片、视频、Design、音乐、run_code 各自分流，不再像在长 prompt 上打补丁。',
      '图片编辑更直接：明确修图会直接生成，只有真正需要判断时才分析图片。',
      'Skill 更轻但能力保留：Agent 先发现 skill，只有要用时才读取完整 SKILL.md。',
      '视频更懂意图：默认仍先确认脚本，但用户明确说“直接提交渲染”时可以立即生成。',
    ]},
  },
  {
    date: '2026-05-21',
    en: { title: 'AI Video Editing — As Easy As Chatting', items: [
      '"Put this kid into that birthday party" — just say it, and it happens. 15-second video, any idea.',
      'Multi-turn editing: not right? Keep chatting. Refine, extend, redo — until your imagination is satisfied.',
      'Continue stories: one video after another, like directing a series.',
      'Compose multiple clips: upload your videos, AI understands motion, scene, character — and fuses them.',
      'Real human faces supported. Your photo, your story.',
      'Videos in timeline: swipe through creative history like a photo album.',
    ], link: { label: 'View full release notes →', href: '/releases/video-in-timeline' }},
    zh: { title: 'AI 视频编辑 — 像聊天一样简单', items: [
      '"让这个小朋友加入那个生日派对" — 说出来就行，15 秒视频，任何想法。',
      '多轮编辑：不满意就继续聊。修改、延展、重来 — 直到满足你的想象。',
      '续写故事：一段接一段，像导演连续剧一样创作。',
      '多段素材合成：上传你的视频，AI 理解动作、场景、角色 — 融合成一个作品。',
      '支持真人脸。你的照片，你的故事。',
      '视频进入时间线：像翻相册一样滑动浏览创作历史。',
    ], link: { label: '查看完整发布说明 →', href: '/releases/video-in-timeline' }},
  },
  {
    date: '2026-05-15',
    en: { title: 'China Access & Cost Optimization', items: [
      'China users can now access Makaron without VPN',
      'Agent cost control: Anthropic context management prevents token explosion in long conversations (1.6M → 130K tokens)',
    ]},
    zh: { title: '中国用户开放 & 成本优化', items: [
      '中国用户无需 VPN 即可使用 Makaron',
      'Agent 成本控制：Anthropic context management 防止长对话 token 爆炸（160万 → 13万 tokens）',
    ]},
  },
  {
    date: '2026-05-12',
    en: { title: 'Agent Self-Registration', items: [
      'AI agents can now register themselves — get an API key programmatically, no human needed',
      'Claim flow: agents generate a link for humans to link the API key to their account',
      'New /agent page: full CLI docs optimized for LLM consumption, one-click copy',
      'Human/Agent mode toggle at the bottom of the page',
    ]},
    zh: { title: 'Agent 自注册', items: [
      'AI Agent 现在可以自注册 — 自动获取 API key，无需人类介入',
      'Claim 流程：Agent 生成链接，人类点击即可将 API key 绑定到自己的账号',
      '新增 /agent 页面：完整 CLI 文档，为 LLM 优化，一键复制',
      '页面底部 Human/Agent 模式切换',
    ]},
  },
  {
    date: '2026-05-11',
    en: { title: 'CLI — Works with OpenClaw & Hermes', items: [
      'CLI now fully compatible with OpenClaw & Hermes — external agents can create and edit projects with edit, video, and music commands',
      'Real-time sync: projects created or edited via CLI appear instantly in the browser with live progress updates',
      'Project sharing: every project has a public link — viewable without logging in',
      'Privacy control: long-press the Share button to toggle public/private',
    ]},
    zh: { title: 'CLI — 完美适配 OpenClaw & Hermes', items: [
      'CLI 完美适配 OpenClaw & Hermes — 外部 Agent 可创建和编辑项目，支持 edit、video、music 命令',
      '实时同步：通过 CLI 创建或编辑的项目即时出现在浏览器中，进度实时更新',
      '项目分享：每个项目都有公开链接 — 无需登录即可查看',
      '隐私控制：长按 Share 按钮可切换项目公开/私密状态',
    ]},
  },
  {
    date: '2026-05-08',
    en: { title: 'Storyboard Long Video — Live on Skill Marketplace', items: [
      'Break the 15s limit with director-grade storyboards — generate 30-60s cinematic videos with consistent characters, scenes, and style',
      'Powered by OpenAI Image 2 + SeeDance 2 — the two strongest models, with real human face support',
    ]},
    zh: { title: '分镜长视频 - 已上线 Skill 集市', items: [
      '用导演级分镜图突破 15s 限制，生成 30-60s 电影级长视频，人物/场景/风格全程一致',
      '基于 OpenAI Image 2 + SeeDance 2 两大最强模型，支持真人脸',
    ]},
  },
  {
    date: '2026-05-07',
    en: { title: 'Open Registration', items: [
      'Google sign-in: one tap to get started — no invite code needed',
      'Open registration: anyone can sign up with email + verification code',
    ]},
    zh: { title: '开放注册', items: [
      'Google 一键登录：无需邀请码，直接开始创作',
      '开放注册：任何人都可以用邮箱 + 验证码注册',
    ]},
  },
  {
    date: '2026-05-04',
    en: { title: 'SeeDance Real Human Faces', items: [
      'SeeDance now supports real human faces — generate videos with portrait photos, no more face detection blocks',
      'Model Selector: unified panel for image & video models, one-tap switch with auto mode',
      'Skill Selector: pick skills from CUI toolbar or Home page — upload, delete, drag-drop',
    ]},
    zh: { title: 'SeeDance 支持真人脸', items: [
      'SeeDance 支持真人脸了 — 用人物照片直接生成视频，不再被人脸检测拦截',
      '模型选择器：图片和视频模型统一面板，一键切换，支持自动模式',
      'Skill 选择器：CUI 工具栏和 Home 页均可选择 Skill — 上传、删除、拖拽安装',
    ]},
  },
  {
    date: '2026-05-01',
    en: { title: 'SeeDance 2.0 & Reference Video', items: [
      'SeeDance 2.0: world-class video model now available alongside Kling O3 — choose in the video panel or tell Agent in chat',
      'Reference video: use any video as a motion template — your photo person performs the same moves, expressions, and dance',
      'Video template skills: "Funny Face Challenge" — first skill with built-in reference video, more coming soon',
      'Three video script styles: continuous take, shot-by-shot, and video reference — Agent picks the best one for your scene',
    ]},
    zh: { title: 'SeeDance 2.0 & 参考视频', items: [
      'SeeDance 2.0：世界顶级视频模型，与 Kling O3 并列可选 — 在视频面板选择或对话中告诉 Agent',
      '参考视频：用任意视频作为动作模板 — 让照片中的人做出同样的动作、表情和舞蹈',
      '视频模板 Skill："搞怪表情挑战" — 首个内置参考视频的 Skill，更多即将上线',
      '三种视频脚本风格：一镜到底、分镜叙事、参考视频 — Agent 自动选择最适合的方式',
    ]},
  },
  {
    date: '2026-04-29',
    en: { title: 'Skill Marketplace', items: [
      'New Home page: browse 30+ skill templates — anime collabs, photo effects, video styles — tap to preview, swipe to explore',
      'One-tap create: pick a template, upload your photo, hit Create — the AI does the rest',
      'Share skills: generate a private link for friends to add your Skill in one click',
      'Skills page: manage all your skills — share, delete, upload custom ones',
    ]},
    zh: { title: 'Skill 市场', items: [
      '全新 Home 页：浏览 30+ Skill 模板 — 动漫合影、照片特效、视频风格 — 点击预览，滑动探索',
      '一键创作：选模板、上传照片、点 Create — AI 帮你搞定',
      '分享 Skill：生成私密链接发给朋友，一键添加到账号',
      'Skills 管理页：集中管理所有 Skill — 分享、删除、上传自定义 Skill',
    ]},
  },
  {
    date: '2026-04-26',
    en: { title: 'OpenAI Image 2', items: [
      'OpenAI Image 2: 3x faster (~60s) and 2x cheaper — best text rendering for posters, graphics, and marketing materials',
      'Context Mode: for design tasks (e-commerce, posters, web design, anime, game UI), Agent passes your request directly to Image 2 — better results than detailed instructions',
      'Smart aspect ratio: extreme ratios (1:3, 3:1) auto-use optimal sizes for text-heavy layouts',
    ]},
    zh: { title: 'OpenAI Image 2', items: [
      'OpenAI Image 2：提速 3 倍（~60s）、降价 2 倍 — 文字渲染最强，适合海报、营销图、平面设计',
      'Context Mode：设计类任务（电商、海报、网页、动漫、游戏 UI）Agent 直接传达需求 — 比详细指令效果更好',
      '智能比例：极端宽高比自动使用最优尺寸，适配长图排版',
    ]},
  },
  {
    date: '2026-04-22',
    en: { title: 'Billing & Subscriptions', items: [
      'Credit system: all AI features now tracked with credits — transparent per-model pricing',
      'Subscription plans: Basic / Pro / Business monthly plans with annual discount',
      'Cost optimization: prompt caching reduces AI token usage; tips previews now load on-demand — significantly lower per-session cost',
    ]},
    zh: { title: '计费 & 订阅', items: [
      'Credit 系统：所有 AI 功能按 credit 计费 — 按模型透明定价',
      '订阅计划：Basic / Pro / Business 月付方案，年付享 8 折',
      '成本优化：Prompt 缓存减少 AI token 消耗；Tips 预览改为按需加载，大幅降低每次使用成本',
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
                {loc.link && (
                  <a
                    href={loc.link.href}
                    className="inline-block mt-2 ml-1 text-[12.5px] font-medium"
                    style={{ color: 'rgba(192,38,211,0.9)' }}
                  >
                    {loc.link.label}
                  </a>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
