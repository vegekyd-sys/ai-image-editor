import { notFound } from 'next/navigation';
import { noIndexMetadata } from '@/lib/seo';
import TimelinePrototype from './TimelinePrototype';

export const metadata = noIndexMetadata;

// Design prototype for docs/video-timeline-v2-plan.md §5. Dev only.
export default function TimelineV2PrototypePage() {
  if (process.env.NODE_ENV === 'production') notFound();
  return (
    <>
      <style>{`@keyframes breathe { 0%, 100% { transform: scale(1); opacity: 0.55; } 50% { transform: scale(1.9); opacity: 1; } }`}</style>
      <TimelinePrototype />
    </>
  );
}
