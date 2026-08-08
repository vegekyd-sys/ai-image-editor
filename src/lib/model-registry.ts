export type ModelCategory = 'image' | 'video' | 'agent';

export interface ModelInfo {
  id: string;
  nameKey: string;
  descKey: string;
  category: ModelCategory;
  speedLabel?: string;
}

export const MODEL_REGISTRY: ModelInfo[] = [
  // Image
  { id: 'openai', nameKey: 'model.openai.name', descKey: 'model.openai.desc', category: 'image', speedLabel: '~50s' },
  { id: 'gemini', nameKey: 'model.gemini.name', descKey: 'model.gemini.desc', category: 'image', speedLabel: '~15s' },
  { id: 'gemini-lite', nameKey: 'model.geminiLite.name', descKey: 'model.geminiLite.desc', category: 'image', speedLabel: 'Lite' },
  { id: 'qwen', nameKey: 'model.qwen.name', descKey: 'model.qwen.desc', category: 'image', speedLabel: '~15s' },
  // Video
  { id: 'seedance-fast', nameKey: 'model.seedanceFast.name', descKey: 'model.seedanceFast.desc', category: 'video', speedLabel: '~180s' },
  { id: 'seedance-mini', nameKey: 'model.seedanceMini.name', descKey: 'model.seedanceMini.desc', category: 'video', speedLabel: 'Mini' },
  { id: 'seedance', nameKey: 'model.seedance.name', descKey: 'model.seedance.desc', category: 'video', speedLabel: '1080p' },
  { id: 'seedance-2.5', nameKey: 'model.seedance25.name', descKey: 'model.seedance25.desc', category: 'video', speedLabel: 'NEW · 30s' },
  { id: 'kling', nameKey: 'model.kling.name', descKey: 'model.kling.desc', category: 'video', speedLabel: '4K' },
  { id: 'grok', nameKey: 'model.grok.name', descKey: 'model.grok.desc', category: 'video', speedLabel: '30-40s' },
  { id: 'google-omni', nameKey: 'model.googleOmni.name', descKey: 'model.googleOmni.desc', category: 'video', speedLabel: '30-70s' },
  // Agent LLM
  { id: 'gpt-5.6-terra', nameKey: 'model.gpt56Terra.name', descKey: 'model.gpt56Terra.desc', category: 'agent', speedLabel: 'Default' },
  { id: 'gpt-5.6-sol', nameKey: 'model.gpt56Sol.name', descKey: 'model.gpt56Sol.desc', category: 'agent', speedLabel: 'Best' },
  { id: 'gpt-5.6-luna', nameKey: 'model.gpt56Luna.name', descKey: 'model.gpt56Luna.desc', category: 'agent', speedLabel: 'Fast' },
  { id: 'grok-4.5', nameKey: 'model.grok45.name', descKey: 'model.grok45.desc', category: 'agent', speedLabel: 'Fast' },
  { id: 'deepseek-v4-pro', nameKey: 'model.deepseekV4Pro.name', descKey: 'model.deepseekV4Pro.desc', category: 'agent', speedLabel: 'Value' },
];

export function getImageModels(): ModelInfo[] {
  return MODEL_REGISTRY.filter(m => m.category === 'image');
}

export function getVideoModels(): ModelInfo[] {
  return MODEL_REGISTRY.filter(m => m.category === 'video');
}

export function getAgentModels(): ModelInfo[] {
  return MODEL_REGISTRY.filter(m => m.category === 'agent');
}

export function getModelInfo(id: string): ModelInfo | undefined {
  return MODEL_REGISTRY.find(m => m.id === id);
}
