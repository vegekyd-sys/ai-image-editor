export type ModelCategory = 'image' | 'video';

export interface ModelInfo {
  id: string;
  nameKey: string;
  descKey: string;
  category: ModelCategory;
  speedLabel?: string;
}

export const MODEL_REGISTRY: ModelInfo[] = [
  // Image
  { id: 'gemini', nameKey: 'model.gemini.name', descKey: 'model.gemini.desc', category: 'image', speedLabel: '~15s' },
  { id: 'qwen', nameKey: 'model.qwen.name', descKey: 'model.qwen.desc', category: 'image', speedLabel: '~15s' },
  { id: 'openai', nameKey: 'model.openai.name', descKey: 'model.openai.desc', category: 'image', speedLabel: '~50s' },
  // Video
  { id: 'seedance-fast', nameKey: 'model.seedanceFast.name', descKey: 'model.seedanceFast.desc', category: 'video', speedLabel: '~180s' },
  { id: 'seedance', nameKey: 'model.seedance.name', descKey: 'model.seedance.desc', category: 'video', speedLabel: '1080p' },
  { id: 'kling', nameKey: 'model.kling.name', descKey: 'model.kling.desc', category: 'video', speedLabel: '4K' },
  { id: 'grok', nameKey: 'model.grok.name', descKey: 'model.grok.desc', category: 'video', speedLabel: '30-40s' },
];

export function getImageModels(): ModelInfo[] {
  return MODEL_REGISTRY.filter(m => m.category === 'image');
}

export function getVideoModels(): ModelInfo[] {
  return MODEL_REGISTRY.filter(m => m.category === 'video');
}

export function getModelInfo(id: string): ModelInfo | undefined {
  return MODEL_REGISTRY.find(m => m.id === id);
}
