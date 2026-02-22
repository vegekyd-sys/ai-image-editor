export interface CategoryConfig {
  id: string;
  label: string;       // English label shown in toolbar
  activeBg: string;
  activeText: string;
  activeBorder: string;
}

export const CATEGORIES: CategoryConfig[] = [
  { id: 'enhance',  label: 'Enhance',  activeBg: 'rgba(217,70,239,0.18)',  activeText: '#f0abfc', activeBorder: 'rgba(217,70,239,0.45)' },
  { id: 'creative', label: 'Creative', activeBg: 'rgba(192,38,211,0.18)', activeText: '#d8b4fe', activeBorder: 'rgba(192,38,211,0.45)' },
  { id: 'wild',     label: 'Wild',     activeBg: 'rgba(239,68,68,0.18)',   activeText: '#fca5a5', activeBorder: 'rgba(239,68,68,0.45)' },
  { id: 'captions', label: 'Caption',  activeBg: 'rgba(245,158,11,0.18)',  activeText: '#fde68a', activeBorder: 'rgba(245,158,11,0.45)' },
];

export const CATEGORY_IDS = CATEGORIES.map(c => c.id);
