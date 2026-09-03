import React from 'react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import MediaPricingPanel from '@/components/admin/MediaPricingPanel'
import { seededMediaPrices } from './helpers/media-prices'

vi.mock('@/lib/i18n', () => ({ useLocale: () => ({ t: (key: string) => key === 'mediaPricing.quoteCredits' ? '{credits} Credits' : key }) }))
beforeEach(() => { vi.stubGlobal('React', React) })
afterEach(() => { cleanup(); vi.unstubAllGlobals() })

it('loads authoritative prices and sends a versioned edit with all dimensions', async () => {
  const price = seededMediaPrices().find(p => p.id === 'video:wan-3.0:480p:generate')!
  const other = seededMediaPrices().find(p => p.model_id === 'grok')!
  const fetcher = vi.fn(async (_url: unknown, init?: RequestInit) => new Response(JSON.stringify(init?.method === 'PUT' ? { ...price, output_usd_per_second: 0.04, updated_at: 'v2' } : [price, other])))
  vi.stubGlobal('fetch', fetcher)
  render(<MediaPricingPanel />)
  fireEvent.click(await screen.findByRole('button', { name: 'mediaPricing.editPrice' }))
  const input = await screen.findByLabelText(`${price.id} mediaPricing.output_usd_per_second`)
  fireEvent.change(input, { target: { value: '0.04' } })
  fireEvent.click(screen.getByRole('button', { name: 'project.save' }))
  await screen.findByText('mediaPricing.saved')
  const request = fetcher.mock.calls.find(call => call[1]?.method === 'PUT')!
  expect(JSON.parse(String(request[1]?.body))).toMatchObject({ id: price.id, updated_at: price.updated_at, output_usd_per_second: 0.04, markup: 2, input_usd_per_second: 0 })
  fireEvent.click(screen.getByRole('button', { name: 'Grok Imagine Video' }))
  fireEvent.click(screen.getByRole('button', { name: 'Wan 3.0 Standard' }))
  fireEvent.click(screen.getByRole('button', { name: 'mediaPricing.editPrice' }))
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
  fireEvent.click(await screen.findByRole('button', { name: 'mediaPricing.editPrice' }))
  fireEvent.change(screen.getByLabelText(`${row.id} mediaPricing.markup`), { target: { value: '3' } })
  await screen.findByRole('button', { name: 'project.save' })
  fireEvent.click(screen.getByRole('button', { name: 'project.save' }))
  await waitFor(() => expect(screen.getByText('mediaPricing.conflict')).toBeTruthy())
  expect((screen.getByLabelText(`${row.id} mediaPricing.markup`) as HTMLInputElement).value).toBe('3')
})

it('shows all video models as readable buttons, even when audio is first in the response', async () => {
  const prices = seededMediaPrices()
  const audio = prices.filter(price => price.kind === 'audio')
  const video = prices.filter(price => price.kind === 'video')
  const fetcher = vi.fn(async () => Response.json([...audio, ...video]))
  vi.stubGlobal('fetch', fetcher)
  render(<MediaPricingPanel />)
  const nav = await screen.findByRole('navigation', { name: 'mediaPricing.model' })
  expect(within(nav).getAllByRole('button')).toHaveLength(13)
  expect(screen.queryByRole('combobox')).toBeNull()
  expect(screen.getByRole('button', { name: 'mediaPricing.video 13' }).getAttribute('aria-pressed')).toBe('true')
  fireEvent.click(screen.getByRole('button', { name: 'Wan 3.0 Prime' }))
  expect(screen.getByRole('heading', { name: 'Wan 3.0 Prime' })).toBeTruthy()
  expect(within(screen.getByTestId('media-price-video:wan-3.0-prime:480p:generate')).getByText('48 Credits')).toBeTruthy()
  expect(screen.queryByRole('spinbutton')).toBeNull()
  fireEvent.click(screen.getByRole('button', { name: 'mediaPricing.audio 1' }))
  expect(screen.getByRole('button', { name: 'Seed Audio' })).toBeTruthy()
  expect(screen.getByRole('heading', { name: 'Seed Audio' })).toBeTruthy()
  expect(fetcher).toHaveBeenCalledTimes(1)
})

it('searches by display name or ID and cancels drafts without writing shared prices', async () => {
  const prices = seededMediaPrices().filter(row => ['wan-3.0', 'wan-3.0-prime'].includes(row.model_id))
  const fetcher = vi.fn(async () => Response.json(prices))
  vi.stubGlobal('fetch', fetcher)
  render(<MediaPricingPanel />)
  await screen.findByRole('button', { name: 'Wan 3.0 Standard' })
  fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'prime' } })
  expect(screen.queryByRole('button', { name: 'Wan 3.0 Standard' })).toBeNull()
  fireEvent.click(screen.getByRole('button', { name: 'Wan 3.0 Prime' }))
  const row = within(screen.getByTestId('media-price-video:wan-3.0-prime:480p:generate'))
  fireEvent.click(row.getByRole('button', { name: 'mediaPricing.editPrice' }))
  expect((row.getByRole('button', { name: 'project.save' }) as HTMLButtonElement).disabled).toBe(true)
  fireEvent.change(row.getByLabelText('video:wan-3.0-prime:480p:generate mediaPricing.output_usd_per_second'), { target: { value: '0.2' } })
  expect((screen.getByRole('button', { name: 'mediaPricing.refresh' }) as HTMLButtonElement).disabled).toBe(true)
  fireEvent.click(row.getByRole('button', { name: 'mediaPricing.cancel' }))
  expect(row.getByText('48 Credits')).toBeTruthy()
  expect(fetcher).toHaveBeenCalledTimes(1)
})
