const zh = {
  // Auth
  'auth.email': '邮箱',
  'auth.password': '密码',
  'auth.login': '登录',
  'auth.register': '注册',
  'auth.goLogin': '去登录',
  'auth.hasAccount': '已有账号？',
  'auth.noAccount': '没有账号？',
  'auth.networkError': '网络错误，请重试',
  'auth.err.invalidCredentials': '邮箱或密码错误',
  'auth.err.emailNotConfirmed': '请先验证邮箱',
  'auth.err.alreadyRegistered': '该邮箱已注册，请直接登录',
  'auth.err.passwordTooShort': '密码至少需要 6 个字符',
  'auth.err.invalidEmail': '邮箱格式不正确',
  'auth.err.rateLimited': '操作过于频繁，请稍后再试',
  'auth.err.wait60s': '请等待 60 秒后再试',

  // Project management
  'project.untitled': '未命名',
  'project.rename': '重命名',
  'project.delete': '删除项目',
  'project.cancel': '取消',
  'project.save': '保存',

  // Editor status
  'editor.current': '当前',
  'editor.versions': '个版本',
  'editor.done': '完成',
  'editor.count': (n: number) => `${n} 个`,

  // AI status
  'status.thinking': '正在发现有趣的可能...',
  'status.analyzingImage': '分析图片中...',
  'status.generatingTips': '正在生成修图建议 Ready to Suprise',
  'status.imageGenerated': '图片已生成',
  'status.writingScript': '正在写视频脚本...',
  'status.submittingVideo': '提交视频任务...',
  'status.videoRendering': '视频渲染中',
  'status.videoRenderingEllipsis': '视频渲染中...',
  'status.videoDone': '视频已生成',
  'status.scriptDone': '脚本已就绪',
  'status.scriptFailed': '脚本生成失败',
  'status.scriptFailedRetry': '脚本生成失败，请重试',
  'status.creatingStory': '正在创作视频故事...',

  // Tips bar
  'tips.continueEditing': '继续编辑',
  'tips.more': '更多',
  'tips.reload': '重新加载修图建议',

  // Agent chat
  'chat.currentImage': '当前图（编辑基础）',
  'chat.originalImage': '原图（人脸参考）',
  'chat.promptCard': '📋 发给 Gemini 的 prompt',
  'chat.expand': '展开 ▼',
  'chat.collapse': '收起 ▲',
  'chat.inputImages': '传入图片',
  'chat.imageLabel': '图',
  'chat.placeholder': '你想怎么修改这张图片？',
  'chat.viewInChat': '在 Chat 里看 ↗',
  'chat.editImage': '编辑图片',

  // Video result card
  'video.title': (n: number) => `视频 ${n}`,
  'video.noVideos': '还没有视频',
  'video.newVideo': '新视频',
  'video.completed': '已完成',
  'video.rendering': '渲染中',
  'video.failed': '失败',
  'video.abandoned': '已放弃',
  'video.abandon': '放弃',
  'video.detail': '详情',
  'video.count': (n: number) => `视频 · ${n} 个`,

  // Animate sheet
  'animate.title': '生成视频',
  'animate.detailTitle': '视频详情',
  'animate.autoScript': '✨ 自动生成脚本',
  'animate.generateVideo': '🎬 生成视频',
  'animate.submitting': '提交中...',
  'animate.aiWriting': '✨ AI 正在写脚本...',
  'animate.aiWritingShort': 'AI 正在写...',
  'animate.aiRetry': 'AI 重试',
  'animate.aiRewrite': 'AI 重写',
  'animate.aiAnalyzing': 'AI 正在分析照片...',
  'animate.storyPlaceholder': '描述你的视频故事...',
  'animate.storyLabel': '✨ 视频故事',
  'animate.noScript': '（无脚本）',
  'animate.allImagesRemoved': '所有图片已移除',
  'animate.duration': '时长',
  'animate.status': '状态',
  'animate.smart': '智能',
  'animate.seconds': (n: number) => `${n} 秒`,
  'animate.costEstimate': '费用预估',
  'animate.costByDuration': '按实际时长',
  'animate.errUnavailable': '视频服务暂时不可用，请稍后重试',
  'animate.errFailed': '视频服务出错，请稍后重试',

  // Status bar
  'statusbar.likeEffect': '喜欢这个效果？你想怎么修改告诉我 👉🏻',

  // Canvas
  'canvas.videoRendering': '视频渲染中',
  'canvas.usuallyTakes': '通常需要 3–5 分钟',
  'canvas.generateVideo': '生成视频',

  // Annotation toolbar
  'annotation.placeholder': '你想对标记的地方怎么改...',
  'annotation.defaultPrompt': '请根据标注修改图片',

  // Editor inline UI
  'editor.generatingImage': 'AI 正在生成图片...',
  'editor.errorRetry': '出错了，请重试',

  // Editor inline strings
  'editor.greeting': 'Hi! 想怎么编辑这张照片？',
  'editor.tipsSuffix': '\n\n正在为你想一些好玩的修图点子~',
  'editor.agentThinking': 'Agent 正在思考...',
  'editor.makeVideo': '✨ 帮我把这些照片做成一段视频',

  // Preview generation
  'status.generatingPreviews': (done: number, total: number) => `正在生成预览图 ${done}/${total}`,

  // Misc
  'misc.toolUse': '工具调用',
  'misc.error': '错误',
  'misc.retry': '重试',
  'misc.saveSuccess': '保存成功',
  'misc.shootingTime': '拍摄时间',
  'misc.usingModel': '使用模型',
} as const;

export type TranslationKey = keyof typeof zh;
export default zh;
