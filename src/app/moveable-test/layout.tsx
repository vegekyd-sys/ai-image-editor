import { noIndexMetadata } from '@/lib/seo'

export const metadata = noIndexMetadata

export default function MoveableTestLayout({ children }: { children: React.ReactNode }) {
  return children
}
