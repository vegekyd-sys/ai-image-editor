import { noIndexMetadata } from '@/lib/seo'

export const metadata = noIndexMetadata

export default function ActivateLayout({ children }: { children: React.ReactNode }) {
  return children
}
