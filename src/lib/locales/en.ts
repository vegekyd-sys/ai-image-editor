const en = {
  // Auth
  'auth.email': 'Email',
  'auth.password': 'Password',
  'auth.login': 'Sign in',
  'auth.register': 'Sign up',
  'auth.goLogin': 'Sign in',
  'auth.hasAccount': 'Already have an account?',
  'auth.noAccount': "Don't have an account?",
  'auth.networkError': 'Network error, please try again',
  'auth.err.invalidCredentials': 'Invalid email or password',
  'auth.err.emailNotConfirmed': 'Please verify your email first',
  'auth.err.alreadyRegistered': 'Email already registered, please sign in',
  'auth.err.passwordTooShort': 'Password must be at least 6 characters',
  'auth.err.invalidEmail': 'Invalid email format',
  'auth.err.rateLimited': 'Too many attempts, please try again later',
  'auth.err.wait60s': 'Please wait 60 seconds before trying again',
  'auth.err.invalidInviteCode': 'Invalid or expired invite code',
  'auth.err.inviteCodeRequired': 'Invite code is required for new accounts',
  'auth.inviteCodePlaceholder': 'Enter invite code',
  'auth.activate': 'Activate',
  'auth.activated': 'Activated!',
  'auth.noInviteCode': "Don't have an invite code?",
  'auth.joinWaitlist': 'Join waitlist',
  'auth.waitlistSuccess': 'You\'re on the list!',
  'auth.waitlistSuccessDesc': 'We\'ll send you an invite code soon.',
  'auth.createAccount': 'Create your account',
  'auth.back': 'Back',

  // Project management
  'project.untitled': 'Untitled',
  'project.rename': 'Rename',
  'project.delete': 'Delete project',
  'project.cancel': 'Cancel',
  'project.save': 'Save',

  // Editor status
  'editor.current': 'Current',
  'editor.versions': 'versions',
  'editor.done': 'Done',
  'editor.count': (n: number) => `${n}`,

  // AI status
  'status.thinking': 'Discovering possibilities...',
  'status.analyzingImage': 'Analyzing image...',
  'status.generatingTips': 'Generating edit suggestions...',
  'status.imageGenerated': 'Image generated',
  'status.writingScript': 'Writing video script...',
  'status.submittingVideo': 'Submitting video task...',
  'status.videoRendering': 'Video rendering',
  'status.videoRenderingEllipsis': 'Video rendering...',
  'status.videoDone': 'Video generated',
  'status.scriptDone': 'Script ready',
  'status.scriptFailed': 'Script generation failed',
  'status.scriptFailedRetry': 'Script generation failed, please retry',
  'status.creatingStory': 'Creating video story...',

  // Tips bar
  'tips.continueEditing': 'Commit',
  'tips.more': 'More',
  'tips.reload': 'Reload edit suggestions',

  // Agent chat
  'chat.currentImage': 'Current image (edit base)',
  'chat.originalImage': 'Original (face reference)',
  'chat.promptCard': '📋 Prompt sent to Gemini',
  'chat.expand': 'Expand ▼',
  'chat.collapse': 'Collapse ▲',
  'chat.inputImages': 'Input images',
  'chat.imageLabel': 'img',
  'chat.placeholder': 'How would you like to edit?',
  'chat.viewInChat': 'View in Chat ↗',
  'chat.editImage': 'Edit image',

  // Video result card
  'video.title': (n: number) => `Video ${n}`,
  'video.noVideos': 'No videos yet',
  'video.newVideo': 'New video',
  'video.completed': 'Completed',
  'video.rendering': 'Rendering',
  'video.failed': 'Failed',
  'video.abandoned': 'Abandoned',
  'video.abandon': 'Abandon',
  'video.detail': 'Detail',
  'video.count': (n: number) => `${n} video${n !== 1 ? 's' : ''}`,

  // Animate sheet
  'animate.title': 'Generate video',
  'animate.detailTitle': 'Video details',
  'animate.autoScript': '✨ Auto-generate script',
  'animate.generateVideo': '🎬 Generate video',
  'animate.submitting': 'Submitting...',
  'animate.aiWriting': '✨ AI is writing script...',
  'animate.aiWritingShort': 'AI writing...',
  'animate.aiRetry': 'AI retry',
  'animate.aiRewrite': 'AI rewrite',
  'animate.aiAnalyzing': 'AI analyzing photos...',
  'animate.storyPlaceholder': 'Describe your video story...',
  'animate.storyLabel': '✨ Video story',
  'animate.hintLabel': 'Requirements',
  'animate.hintPlaceholder': 'e.g. cinematic, slow motion, emotional...',
  'animate.noScript': '(no script)',
  'animate.allImagesRemoved': 'All images removed',
  'animate.imageCount': (n: number) => `${n} image${n !== 1 ? 's' : ''}`,
  'animate.duration': 'Duration',
  'animate.status': 'Status',
  'animate.smart': 'Smart',
  'animate.seconds': (n: number) => `${n}s`,
  'animate.costEstimate': 'Est. cost',
  'animate.costByDuration': 'By actual duration',
  'animate.errUnavailable': 'Video service temporarily unavailable, please try again later',
  'animate.errFailed': 'Video service error, please try again later',

  // Status bar
  'statusbar.likeEffect': 'Like this effect? Tell me how to adjust it 👉🏻',

  // Canvas
  'canvas.loading': 'Loading...',
  'canvas.videoExpired': 'Video link expired',
  'canvas.videoRendering': 'Video rendering',
  'canvas.usuallyTakes': 'Usually takes 3–5 minutes',
  'canvas.generateVideo': 'Generate video',
  'canvas.layerTool': 'Layers',
  'canvas.layering': 'Separating layers...',
  'canvas.layerLabel': (n: number) => `Layer ${n}`,
  'canvas.resetLayers': 'Reset',
  'canvas.layerFailed': 'Layer split failed',
  'canvas.layerEmpty': 'No layers available',
  'canvas.layerDelete': 'Delete layer',
  'canvas.layerResize': 'Drag to resize',

  // Annotation toolbar
  'annotation.placeholder': 'How should I edit the marked area?',
  'annotation.defaultPrompt': 'Edit the image based on my annotations',

  // Editor inline UI
  'editor.generatingImage': 'AI is generating image...',
  'editor.errorRetry': 'Something went wrong, please retry',

  // Editor inline strings
  'editor.greeting': 'Hi! How would you like to edit this photo?',
  'editor.tipsSuffix': '\n\nComing up with some fun edit ideas...',
  'editor.agentThinking': 'Agent is thinking...',
  'editor.makeVideo': '✨ Turn these photos into a video for me',

  // Preview generation
  'status.generatingPreviews': (done: number, total: number) => `Generating previews ${done}/${total}`,

  // Misc
  'misc.toolUse': 'Tool use',
  'misc.error': 'Error',
  'misc.retry': 'Retry',
  'misc.saveSuccess': 'Saved successfully',
  'misc.shootingTime': 'Shot on',
  'misc.usingModel': 'Model',
} as const;

export default en;
