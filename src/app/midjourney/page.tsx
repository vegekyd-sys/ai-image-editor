import { notFound } from 'next/navigation';
import MidjourneyLab from '@/components/MidjourneyLab';
// i18n-ignore: Midjourney V8.2 is a model brand name.
export const metadata = { title: 'Midjourney V8.2', robots: { index: false, follow: false } };
export default function MidjourneyPage() {
  if (process.env.NODE_ENV !== 'development' || process.env.MIDJOURNEY_LOCAL_LAB !== '1') notFound();
  return <MidjourneyLab />;
}
