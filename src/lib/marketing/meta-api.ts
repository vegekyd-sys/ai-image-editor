type MetaGraphValue = string | number | boolean | undefined

interface MetaGraphError {
  error?: {
    message?: string
    type?: string
    code?: number
    fbtrace_id?: string
  }
}

interface MetaPaging<T> {
  data?: T[]
}

export interface MetaAdAccountSummary {
  id: string
  name?: string
  account_status?: number
  amount_spent?: string
  balance?: string
  currency?: string
  timezone_name?: string
}

export interface MetaPixelSummary {
  id: string
  name?: string
  last_fired_time?: string
  is_unavailable?: boolean
}

export interface MetaCampaignSummary {
  id: string
  name?: string
  status?: string
  effective_status?: string
  objective?: string
  daily_budget?: string
  lifetime_budget?: string
  created_time?: string
  updated_time?: string
}

export interface MetaInsightsSummary {
  spend?: string
  impressions?: string
  clicks?: string
  cpc?: string
  ctr?: string
  actions?: { action_type: string; value: string }[]
}

export interface MetaAdsStatus {
  config: {
    apiVersion: string
    adAccountId?: string
    businessId?: string
    pageId?: string
    pixelId?: string
    appId?: string
    hasAccessToken: boolean
    hasCapiToken: boolean
    hasInstagramActorId: boolean
  }
  account: MetaAdAccountSummary | null
  pixels: MetaPixelSummary[]
  campaigns: MetaCampaignSummary[]
  insights: {
    yesterday: MetaInsightsSummary | null
    last7d: MetaInsightsSummary | null
  }
  fetchedAt: string
}

function graphVersion(): string {
  return process.env.META_API_VERSION || process.env.META_GRAPH_API_VERSION || 'v23.0'
}

function accessToken(): string | undefined {
  return process.env.META_ACCESS_TOKEN || process.env.META_CAPI_ACCESS_TOKEN
}

function adAccountId(): string | undefined {
  const id = process.env.META_AD_ACCOUNT_ID
  if (!id) return undefined
  return id.startsWith('act_') ? id : `act_${id}`
}

async function metaGet<T>(path: string, params: Record<string, MetaGraphValue> = {}): Promise<T> {
  const token = accessToken()
  if (!token) throw new Error('META_ACCESS_TOKEN is not configured')

  const url = new URL(`https://graph.facebook.com/${graphVersion()}${path}`)
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined) url.searchParams.set(key, String(value))
  }
  url.searchParams.set('access_token', token)

  const res = await fetch(url, { cache: 'no-store' })
  const json = await res.json() as T & MetaGraphError
  if (!res.ok || json.error) {
    throw new Error(json.error?.message || `Meta API request failed: ${res.status}`)
  }
  return json
}

async function getInsights(accountId: string, datePreset: 'yesterday' | 'last_7d'): Promise<MetaInsightsSummary | null> {
  const result = await metaGet<MetaPaging<MetaInsightsSummary>>(`/${accountId}/insights`, {
    fields: 'spend,impressions,clicks,cpc,ctr,actions',
    date_preset: datePreset,
    level: 'account',
  })
  return result.data?.[0] ?? null
}

export async function getMetaAdsStatus(): Promise<MetaAdsStatus> {
  const accountId = adAccountId()
  if (!accountId) throw new Error('META_AD_ACCOUNT_ID is not configured')

  const [account, pixels, campaigns, yesterday, last7d] = await Promise.all([
    metaGet<MetaAdAccountSummary>(`/${accountId}`, {
      fields: 'id,name,account_status,amount_spent,balance,currency,timezone_name',
    }),
    metaGet<MetaPaging<MetaPixelSummary>>(`/${accountId}/adspixels`, {
      fields: 'id,name,last_fired_time,is_unavailable',
      limit: 25,
    }),
    metaGet<MetaPaging<MetaCampaignSummary>>(`/${accountId}/campaigns`, {
      fields: 'id,name,status,effective_status,objective,daily_budget,lifetime_budget,created_time,updated_time',
      limit: 25,
    }),
    getInsights(accountId, 'yesterday'),
    getInsights(accountId, 'last_7d'),
  ])

  return {
    config: {
      apiVersion: graphVersion(),
      adAccountId: accountId,
      businessId: process.env.META_BUSINESS_ID,
      pageId: process.env.META_PAGE_ID,
      pixelId: process.env.META_PIXEL_ID || process.env.NEXT_PUBLIC_META_PIXEL_ID,
      appId: process.env.META_APP_ID,
      hasAccessToken: Boolean(process.env.META_ACCESS_TOKEN),
      hasCapiToken: Boolean(process.env.META_CAPI_ACCESS_TOKEN),
      hasInstagramActorId: Boolean(process.env.META_INSTAGRAM_ACTOR_ID),
    },
    account,
    pixels: pixels.data ?? [],
    campaigns: campaigns.data ?? [],
    insights: { yesterday, last7d },
    fetchedAt: new Date().toISOString(),
  }
}
