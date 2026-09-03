import React from 'react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import MediaPricingPanel from '@/components/admin/MediaPricingPanel'
import { seededMediaPrices } from './helpers/media-prices'

vi.mock('@/lib/i18n', () => ({ useLocale: () => ({ t: (key: string) => key }) }))
beforeEach(() => { vi.stubGlobal('React', React) })
afterEach(() => { cleanup(); vi.unstubAllGlobals() })

it('loads authoritative prices and sends a versioned edit with all dimensions', async () => {
  const price = seededMediaPrices().find(p => p.id === 'video:wan-3.0:480p:generate')!
  const other = seededMediaPrices().find(p => p.model_id === 'grok')!
  const fetcher = vi.fn(async (_url: unknown, init?: RequestInit) => new Response(JSON.stringify(init?.method === 'PUT' ? { ...price, output_usd_per_second: 0.04, updated_at: 'v2' } : [price, other])))
  vi.stubGlobal('fetch', fetcher)
  render(<MediaPricingPanel />)
  const input = await screen.findByLabelText(`${price.id} mediaPricing.output_usd_per_second`)
  fireEvent.change(input, { target: { value: '0.04' } })
  fireEvent.click(screen.getByRole('button', { name: 'project.save' }))
  await screen.findByText('mediaPricing.saved')
  const request = fetcher.mock.calls.find(call => call[1]?.method === 'PUT')!
  expect(JSON.parse(String(request[1]?.body))).toMatchObject({ id: price.id, updated_at: price.updated_at, output_usd_per_second: 0.04, markup: 2, input_usd_per_second: 0 })
  fireEvent.change(screen.getByRole('combobox'), { target: { value: 'grok' } })
  fireEvent.change(screen.getByRole('combobox'), { target: { value: 'wan-3.0' } })
  expect((screen.getByLabelText(`${price.id} mediaPricing.output_usd_per_second`) as HTMLInputElement).value).toBe('0.04')
})
it('does not show a guessed tariff when database pricing fails', async () => {
  vi.stubGlobal('fetch', vi.fn(async () => new Response('{}', { status: 503 })))
  render(<MediaPricingPanel />)
  await screen.findByText('mediaPricing.error')
  expect(screen.queryByRole('spinbutton')).toBeNull()
})
it('keeps conflicting edits visible and asks the editor to refresh', async () => {
  const row = seededMediaPrices()[0]
  vi.stubGlobal('fetch', vi.fn(async (_url, init) => new Response(JSON.stringify(init?.method === 'PUT' ? {} : [row]), { status: init?.method === 'PUT' ? 409 : 200 })))
  render(<MediaPricingPanel />)
  await screen.findByRole('button', { name: 'project.save' })
  fireEvent.click(screen.getByRole('button', { name: 'project.save' }))
  await waitFor(() => expect(screen.getByText('mediaPricing.conflict')).toBeTruthy())
})
