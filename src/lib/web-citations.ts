import type { WebSearchSource } from '@/types'

const OPENAI_CITATION_MARKER = /\uE200cite((?:\uE202turn\d+search\d+)+)\uE201/g
const OPENAI_CITATION_REFERENCE = /\uE202(turn\d+search(\d+))/g

export interface ResolvedWebCitation {
  citationKey: string
  sourceIndex: number
  number: number
  source?: WebSearchSource
}

export function resolveOpenAIWebCitations(
  text: string,
  sources?: WebSearchSource[],
): { text: string; citations: ResolvedWebCitation[] } {
  const citationNumberBySource = new Map<string, number>()
  const citations: ResolvedWebCitation[] = []
  const normalized = text.replace(OPENAI_CITATION_MARKER, (_marker, body: string) => {
    const tokens: string[] = []
    for (const match of body.matchAll(OPENAI_CITATION_REFERENCE)) {
      const citationKey = match[1]
      const sourceIndex = Number.parseInt(match[2], 10)
      if (!Number.isFinite(sourceIndex)) continue
      let number = citationNumberBySource.get(citationKey)
      if (!number) {
        number = citationNumberBySource.size + 1
        citationNumberBySource.set(citationKey, number)
        const source = sources?.find(item => item.id === citationKey)
          ?? (citationKey.startsWith('turn0search') ? sources?.[sourceIndex] : undefined)
        citations.push({ citationKey, sourceIndex, number, source })
      }
      tokens.push(`\`CITATION_REF_${citationKey}_${number}\``)
    }
    return tokens.join('\u2009')
  })

  return { text: normalized, citations }
}

/** Extract URL sources from an AI SDK provider-executed web_search result. */
export function extractWebSearchSources(
  output: unknown,
  searchTurn: number,
): WebSearchSource[] {
  if (!output || typeof output !== 'object') return []
  const sources = (output as { sources?: unknown }).sources
  if (!Array.isArray(sources)) return []

  const extracted: WebSearchSource[] = []
  sources.forEach((value, sourceIndex) => {
    if (!value || typeof value !== 'object') return
    const source = value as Record<string, unknown>
    const url = typeof source.url === 'string' ? source.url : ''
    if (source.type !== 'url' || !/^https?:\/\//i.test(url)) return
    extracted.push({
      id: `turn${searchTurn}search${sourceIndex}`,
      url,
      ...(typeof source.title === 'string' && source.title ? { title: source.title } : {}),
    })
  })
  return extracted
}

export function groupWebSearchSourcesByMessage(
  events: Array<{ data?: unknown }>,
): Map<string, WebSearchSource[]> {
  const grouped = new Map<string, WebSearchSource[]>()
  for (const event of events) {
    const data = event.data && typeof event.data === 'object'
      ? event.data as Record<string, unknown>
      : undefined
    const messageId = typeof data?.messageId === 'string' ? data.messageId : ''
    const url = typeof data?.url === 'string' ? data.url : ''
    if (!messageId || !/^https?:\/\//i.test(url)) continue
    const existing = grouped.get(messageId) ?? []
    const id = typeof data?.id === 'string' && data.id ? data.id : url
    if (existing.some(source => source.id === id)) continue
    existing.push({
      id,
      url,
      ...(typeof data?.title === 'string' && data.title ? { title: data.title } : {}),
    })
    grouped.set(messageId, existing)
  }
  return grouped
}
