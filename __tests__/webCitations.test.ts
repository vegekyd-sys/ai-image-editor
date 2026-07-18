import { describe, expect, it } from 'vitest'
import {
  extractWebSearchSources,
  groupWebSearchSourcesByMessage,
  resolveOpenAIWebCitations,
} from '@/lib/web-citations'

describe('web citations', () => {
  it('turns OpenAI private citation markers into ordered UI tokens', () => {
    const sources = [0, 1, 2, 3].map(index => ({
      id: `turn0search${index}`,
      url: `https://example.com/${index}`,
      title: `Source ${index}`,
    }))
    const result = resolveOpenAIWebCitations(
      `First \uE200cite\uE202turn0search3\uE201 then \uE200cite\uE202turn0search1\uE202turn0search2\uE201 and again \uE200cite\uE202turn0search3\uE201`,
      sources,
    )

    expect(result.text).toBe('First `CITATION_REF_turn0search3_1` then `CITATION_REF_turn0search1_2`\u2009`CITATION_REF_turn0search2_3` and again `CITATION_REF_turn0search3_1`')
    expect(result.citations).toEqual([
      { citationKey: 'turn0search3', sourceIndex: 3, number: 1, source: sources[3] },
      { citationKey: 'turn0search1', sourceIndex: 1, number: 2, source: sources[1] },
      { citationKey: 'turn0search2', sourceIndex: 2, number: 3, source: sources[2] },
    ])
  })

  it('keeps search turns distinct when resolving citations', () => {
    const sources = [
      { id: 'turn0search0', url: 'https://example.com/old' },
      { id: 'turn1search0', url: 'https://example.com/new' },
    ]
    const result = resolveOpenAIWebCitations(
      `Old \uE200cite\uE202turn0search0\uE201 new \uE200cite\uE202turn1search0\uE201`,
      sources,
    )

    expect(result.citations.map(citation => citation.source?.url)).toEqual([
      'https://example.com/old',
      'https://example.com/new',
    ])
  })

  it('extracts provider web search URLs with citation keys', () => {
    expect(extractWebSearchSources({
      action: { type: 'search' },
      sources: [
        { type: 'url', url: 'https://example.com/a' },
        { type: 'api', name: 'weather' },
        { type: 'url', url: 'https://example.com/b' },
      ],
    }, 2)).toEqual([
      { id: 'turn2search0', url: 'https://example.com/a' },
      { id: 'turn2search2', url: 'https://example.com/b' },
    ])
  })

  it('groups persisted sources by message and deduplicates URLs', () => {
    const grouped = groupWebSearchSourcesByMessage([
      { data: { messageId: 'msg-1', id: 'one', url: 'https://example.com/a', title: 'A' } },
      { data: { messageId: 'msg-1', id: 'one', url: 'https://example.com/a' } },
      { data: { messageId: 'msg-2', id: 'two', url: 'https://example.com/b' } },
      { data: { messageId: 'msg-1', id: 'unsafe', url: 'javascript:alert(1)' } },
    ])

    expect(grouped.get('msg-1')).toEqual([
      { id: 'one', url: 'https://example.com/a', title: 'A' },
    ])
    expect(grouped.get('msg-2')).toEqual([
      { id: 'two', url: 'https://example.com/b' },
    ])
  })
})
