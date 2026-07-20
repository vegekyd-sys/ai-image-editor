import { createHash } from 'node:crypto'

import { ListObjectsV2Command, PutObjectCommand, S3Client } from '@aws-sdk/client-s3'

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

const cachedKeysByBucket = new Map<string, Promise<Set<string>>>()

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
  client: S3Client,
  bucketName: string,
  sourceUrl: string,
  existingKeys: Set<string>,
): Promise<{ hit: boolean }> {
  const source = new URL(sourceUrl)
  if (source.protocol !== 'https:' || source.hostname !== 'fonts.gstatic.com') {
    throw new Error(`Unsupported Google Font asset URL: ${sourceUrl}`)
  }

  const key = fontCacheKey(sourceUrl)
  if (existingKeys.has(key)) return { hit: true }

  const response = await fetch(sourceUrl)
  if (!response.ok) throw new Error(`Google Font download failed: ${response.status}`)
  const body = Buffer.from(await response.arrayBuffer())
  if (body.length === 0 || body.length > 20 * 1024 * 1024) {
    throw new Error(`Unexpected Google Font size: ${body.length}`)
  }

  await client.send(new PutObjectCommand({
    Bucket: bucketName,
    Key: key,
    Body: body,
    ACL: 'public-read',
    ContentType: 'font/woff2',
    CacheControl: 'public, max-age=31536000, immutable',
  }))
  existingKeys.add(key)
  return { hit: false }
}

async function listCachedFontKeys(client: S3Client, bucketName: string): Promise<Set<string>> {
  const cached = cachedKeysByBucket.get(bucketName)
  if (cached) return cached

  const pending = listCachedFontKeysUncached(client, bucketName)
  cachedKeysByBucket.set(bucketName, pending)
  try {
    return await pending
  } catch (error) {
    cachedKeysByBucket.delete(bucketName)
    throw error
  }
}

async function listCachedFontKeysUncached(client: S3Client, bucketName: string): Promise<Set<string>> {
  const prefix = 'sites/_font-cache-v2/'
  const keys = new Set<string>()
  let continuationToken: string | undefined
  do {
    const response = await client.send(new ListObjectsV2Command({
      Bucket: bucketName,
      Prefix: prefix,
      ContinuationToken: continuationToken,
    }))
    for (const object of response.Contents || []) {
      if (object.Key) keys.add(object.Key)
    }
    continuationToken = response.IsTruncated ? response.NextContinuationToken : undefined
  } while (continuationToken)
  return keys
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
  const client = new S3Client({ region, credentials: readCredentials() })
  const existingKeys = await listCachedFontKeys(client, bucketName)
  let cacheHits = 0
  let cacheMisses = 0

  const results = await Promise.all(sourceUrls.map((sourceUrl) =>
    ensureCachedFont(client, bucketName, sourceUrl, existingKeys),
  ))
  for (const cached of results) {
    if (cached.hit) cacheHits++
    else cacheMisses++
  }

  const stylesheet = fontFaceCss(assets, publicOrigin)
  const stylesheetHash = createHash('sha256').update(stylesheet).digest('hex')
  const stylesheetKey = `sites/_font-cache-v2/manifests/${stylesheetHash}.css`
  if (!existingKeys.has(stylesheetKey)) {
    await client.send(new PutObjectCommand({
      Bucket: bucketName,
      Key: stylesheetKey,
      Body: stylesheet,
      ACL: 'public-read',
      ContentType: 'text/css; charset=utf-8',
      CacheControl: 'public, max-age=31536000, immutable',
    }))
    existingKeys.add(stylesheetKey)
  }

  const result = {
    stylesheetUrl: `${publicOrigin}/${stylesheetKey}`,
    assets: sourceUrls.length,
    cacheHits,
    cacheMisses,
    seconds: (Date.now() - startedAt) / 1000,
  }
  console.log(JSON.stringify({ event: 'remotion_font_cache_ready', ...result }))
  return result
}
