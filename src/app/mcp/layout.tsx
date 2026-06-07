import { noIndexMetadata } from '@/lib/seo'

export const metadata = noIndexMetadata

export default function McpLayout({ children }: { children: React.ReactNode }) {
  return children
}
