import { createHash, createHmac } from 'node:crypto'

import type { DesignPayload } from '@/types'
import {
  normalizeRemotionFontFamilies,
  remotionFontSearchText,
  resolveRemotionFontAssets,
} from '@/remotion/font-runtime'

export interface RemotionFontCacheResult {
  stylesheetUrl: string
  assets: number
  cacheHits: number
  cacheMisses: number
  seconds: number
}

const objectExistsByUrl = new Map<string, Promise<boolean>>()

async function fetchWithRetry(
  input: string | URL,
  init?: RequestInit,
  attempts = 3,
): Promise<Response> {
  let lastError: unknown
  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      const response = await fetch(input, init)
      if (response.status !== 429 && response.status < 500) return response
      lastError = new Error(`HTTP ${response.status}`)
    } catch (error) {
      lastError = error
    }
    if (attempt < attempts) {
      await new Promise((resolve) => setTimeout(resolve, 200 * 2 ** (attempt - 1)))
    }
  }
  throw lastError instanceof Error ? lastError : new Error(String(lastError))
}

async function mapWithConcurrency<T, R>(
  values: T[],
  concurrency: number,
  mapper: (value: T) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(values.length)
  let nextIndex = 0
  await Promise.all(Array.from({ length: Math.min(concurrency, values.length) }, async () => {
    while (nextIndex < values.length) {
      const index = nextIndex++
      results[index] = await mapper(values[index])
    }
  }))
  return results
}

function readEnv(name: string): string | undefined {
  const value = process.env[name]?.replace(/\\[rn]|[\u0000-\u001F\u007F]/g, '').trim()
  return value || undefined
}

function readCredentials(): { accessKeyId: string; secretAccessKey: string; sessionToken?: string } {
  const accessKeyId = readEnv('REMOTION_AWS_ACCESS_KEY_ID') || readEnv('AWS_ACCESS_KEY_ID')
  const secretAccessKey = readEnv('REMOTION_AWS_SECRET_ACCESS_KEY') || readEnv('AWS_SECRET_ACCESS_KEY')
  const sessionToken = readEnv('REMOTION_AWS_SESSION_TOKEN') || readEnv('AWS_SESSION_TOKEN')
  if (!accessKeyId || !secretAccessKey) throw new Error('Remotion AWS credentials are required for the font cache')
  return sessionToken ? { accessKeyId, secretAccessKey, sessionToken } : { accessKeyId, secretAccessKey }
}

function bucketFromServeUrl(serveUrl: string): string {
  const hostname = new URL(serveUrl).hostname
  const bucketName = hostname.split('.s3.')[0]
  if (!bucketName || bucketName === hostname) throw new Error('Could not infer Remotion bucket from serve URL')
  return bucketName
}

function fontCacheKey(sourceUrl: string): string {
  const hash = createHash('sha256').update(sourceUrl).digest('hex')
  return `sites/_font-cache-v2/google/${hash}.woff2`
}

function sha256(value: string | Buffer): string {
  return createHash('sha256').update(value).digest('hex')
}

function hmac(key: string | Buffer, value: string): Buffer {
  return createHmac('sha256', key).update(value).digest()
}

function encodeS3Key(key: string): string {
  return key.split('/').map(encodeURIComponent).join('/')
}

async function objectExists(url: string): Promise<boolean> {
  const cached = objectExistsByUrl.get(url)
  if (cached) return cached
  const pending = fetchWithRetry(url, { method: 'HEAD' }).then((response) => response.ok)
  objectExistsByUrl.set(url, pending)
  try {
    return await pending
  } catch (error) {
    objectExistsByUrl.delete(url)
    throw error
  }
}

async function putS3Object(input: {
  bucketName: string
  region: string
  key: string
  body: Buffer | string
  contentType: string
  cacheControl: string
  credentials: ReturnType<typeof readCredentials>
}): Promise<void> {
  const body = Buffer.isBuffer(input.body) ? input.body : Buffer.from(input.body)
  const host = `${input.bucketName}.s3.${input.region}.amazonaws.com`
  const canonicalUri = `/${encodeS3Key(input.key)}`
  const now = new Date()
  const amzDate = now.toISOString().replace(/[:-]|\.\d{3}/g, '')
  const dateStamp = amzDate.slice(0, 8)
  const payloadHash = sha256(body)
  const headerEntries: Array<[string, string]> = [
    ['host', host],
    ['x-amz-acl', 'public-read'],
    ['x-amz-content-sha256', payloadHash],
    ['x-amz-date', amzDate],
  ]
  if (input.credentials.sessionToken) {
    headerEntries.push(['x-amz-security-token', input.credentials.sessionToken])
  }
  headerEntries.sort(([a], [b]) => a.localeCompare(b))
  const canonicalHeaders = `${headerEntries.map(([name, value]) => `${name}:${value.trim()}\n`).join('')}`
  const signedHeaders = headerEntries.map(([name]) => name).join(';')
  const canonicalRequest = [
    'PUT',
    canonicalUri,
    '',
    canonicalHeaders,
    signedHeaders,
    payloadHash,
  ].join('\n')
  const credentialScope = `${dateStamp}/${input.region}/s3/aws4_request`
  const stringToSign = [
    'AWS4-HMAC-SHA256',
    amzDate,
    credentialScope,
    sha256(canonicalRequest),
  ].join('\n')
  const dateKey = hmac(`AWS4${input.credentials.secretAccessKey}`, dateStamp)
  const regionKey = hmac(dateKey, input.region)
  const serviceKey = hmac(regionKey, 's3')
  const signingKey = hmac(serviceKey, 'aws4_request')
  const signature = createHmac('sha256', signingKey).update(stringToSign).digest('hex')
  const response = await fetchWithRetry(`https://${host}${canonicalUri}`, {
    method: 'PUT',
    headers: {
      Authorization: `AWS4-HMAC-SHA256 Credential=${input.credentials.accessKeyId}/${credentialScope}, SignedHeaders=${signedHeaders}, Signature=${signature}`,
      'Cache-Control': input.cacheControl,
      'Content-Type': input.contentType,
      'x-amz-acl': 'public-read',
      'x-amz-content-sha256': payloadHash,
      'x-amz-date': amzDate,
      ...(input.credentials.sessionToken ? { 'x-amz-security-token': input.credentials.sessionToken } : {}),
    },
    body: new Uint8Array(body),
  })
  if (!response.ok) {
    throw new Error(`S3 font cache upload failed: ${response.status} ${await response.text()}`)
  }
}

function fontFaceCss(
  assets: Awaited<ReturnType<typeof resolveRemotionFontAssets>>,
  publicOrigin: string,
): string {
  return [...assets]
    .sort((a, b) => `${a.family}:${a.style}:${a.weight}:${a.subset}`.localeCompare(`${b.family}:${b.style}:${b.weight}:${b.subset}`))
    .map((asset) => [
      '@font-face {',
      `font-family: ${JSON.stringify(asset.family)};`,
      `font-style: ${asset.style};`,
      `font-weight: ${asset.weight};`,
      'font-display: block;',
      `src: url(${JSON.stringify(`${publicOrigin}/${fontCacheKey(asset.sourceUrl)}`)}) format('woff2');`,
      `unicode-range: ${asset.unicodeRange};`,
      '}',
    ].join(''))
    .join('\n')
}

async function ensureCachedFont(
  bucketName: string,
  region: string,
  credentials: ReturnType<typeof readCredentials>,
  publicOrigin: string,
  sourceUrl: string,
): Promise<{ hit: boolean }> {
  const source = new URL(sourceUrl)
  if (source.protocol !== 'https:' || source.hostname !== 'fonts.gstatic.com') {
    throw new Error(`Unsupported Google Font asset URL: ${sourceUrl}`)
  }

  const key = fontCacheKey(sourceUrl)
  const publicUrl = `${publicOrigin}/${key}`
  if (await objectExists(publicUrl)) return { hit: true }

  const response = await fetchWithRetry(sourceUrl)
  if (!response.ok) throw new Error(`Google Font download failed: ${response.status}`)
  const body = Buffer.from(await response.arrayBuffer())
  if (body.length === 0 || body.length > 20 * 1024 * 1024) {
    throw new Error(`Unexpected Google Font size: ${body.length}`)
  }

  await putS3Object({
    bucketName,
    region,
    credentials,
    key,
    body,
    contentType: 'font/woff2',
    cacheControl: 'public, max-age=31536000, immutable',
  })
  objectExistsByUrl.set(publicUrl, Promise.resolve(true))
  return { hit: false }
}

/** Mirror the exact Google Font shards needed by a design into the Remotion S3 bucket. */
export async function cacheRemotionFontsForLambda(
  design: DesignPayload,
  serveUrl: string,
  region: string,
): Promise<RemotionFontCacheResult> {
  const startedAt = Date.now()
  const code = normalizeRemotionFontFamilies(design.code)
  const text = remotionFontSearchText(code, design.props || {})
  const assets = await resolveRemotionFontAssets(text)
  const sourceUrls = [...new Set(assets.map((asset) => asset.sourceUrl))]
  const bucketName = bucketFromServeUrl(serveUrl)
  const publicOrigin = new URL(serveUrl).origin
  const credentials = readCredentials()
  const stylesheet = fontFaceCss(assets, publicOrigin)
  const stylesheetHash = createHash('sha256').update(stylesheet).digest('hex')
  const stylesheetKey = `sites/_font-cache-v2/manifests/${stylesheetHash}.css`
  const stylesheetUrl = `${publicOrigin}/${stylesheetKey}`

  // A manifest is only uploaded after every referenced font shard succeeds.
  // Therefore one HEAD is enough for the common hit path; avoid N font HEADs.
  if (await objectExists(stylesheetUrl)) {
    const result = {
      stylesheetUrl,
      assets: sourceUrls.length,
      cacheHits: sourceUrls.length,
      cacheMisses: 0,
      seconds: (Date.now() - startedAt) / 1000,
    }
    console.log(JSON.stringify({ event: 'remotion_font_cache_ready', ...result }))
    return result
  }

  let cacheHits = 0
  let cacheMisses = 0

  const results = await mapWithConcurrency(sourceUrls, 6, (sourceUrl) =>
    ensureCachedFont(bucketName, region, credentials, publicOrigin, sourceUrl))
  for (const cached of results) {
    if (cached.hit) cacheHits++
    else cacheMisses++
  }

  await putS3Object({
    bucketName,
    region,
    credentials,
    key: stylesheetKey,
    body: stylesheet,
    contentType: 'text/css; charset=utf-8',
    cacheControl: 'public, max-age=31536000, immutable',
  })
  objectExistsByUrl.set(stylesheetUrl, Promise.resolve(true))

  const result = {
    stylesheetUrl,
    assets: sourceUrls.length,
    cacheHits,
    cacheMisses,
    seconds: (Date.now() - startedAt) / 1000,
  }
  console.log(JSON.stringify({ event: 'remotion_font_cache_ready', ...result }))
  return result
}
