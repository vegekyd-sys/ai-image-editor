'use client';
import { useLocale } from '@/lib/i18n';

export default function LayerLoadingHint() {
  const { t } = useLocale();
  return (
    <div role="status" className="pointer-events-none absolute inset-x-0 bottom-5 z-20 flex justify-center">
      <span className="flex items-center gap-2 rounded-full bg-black/60 px-3 py-1.5 text-xs text-white/85 backdrop-blur-md">
        <span aria-hidden="true" className="h-1.5 w-1.5 rounded-full bg-pink-300 motion-safe:animate-pulse" />
        {t('canvas.loadingLayers')}
      </span>
    </div>
  );
}
