import { noIndexMetadata } from '@/lib/seo'

export const metadata = noIndexMetadata

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  return children
}
