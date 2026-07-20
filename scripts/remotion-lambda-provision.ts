import path from 'node:path'

import { config as loadEnv } from 'dotenv'

loadEnv({ path: path.resolve(process.cwd(), '.env.local'), quiet: true })

function readArg(name: string): string | undefined {
  const prefix = `${name}=`
  const inline = process.argv.find((arg) => arg.startsWith(prefix))
  if (inline) return inline.slice(prefix.length)
  const index = process.argv.indexOf(name)
  return index >= 0 ? process.argv[index + 1] : undefined
}

function requiredEnv(name: string): string {
  const value = process.env[name]?.trim()
  if (!value) throw new Error(`${name} is required`)
  return value
}

function inferBucketName(serveUrl: string): string {
  const hostname = new URL(serveUrl).hostname
  const bucketName = hostname.split('.s3.')[0]
  if (!bucketName || bucketName === hostname) {
    throw new Error('Could not infer the Remotion bucket from REMOTION_LAMBDA_SERVE_URL')
  }
  return bucketName
}

async function main(): Promise<void> {
  const region = process.env.REMOTION_LAMBDA_REGION || process.env.AWS_REGION || 'us-east-1'
  const currentServeUrl = requiredEnv('REMOTION_LAMBDA_SERVE_URL')
  const bucketName = process.env.REMOTION_LAMBDA_BUCKET_NAME || inferBucketName(currentServeUrl)
  const siteName = readArg('--site-name') || 'makaron-remotion-runtime-next'
  const entryPoint = path.resolve(process.cwd(), 'src/remotion/index.tsx')

  const { deploySite } = await import('@remotion/lambda')
  let lastBundlePercent = -10
  let lastUploadPercent = -10
  const result = await deploySite({
    region: region as Parameters<typeof deploySite>[0]['region'],
    bucketName,
    siteName,
    entryPoint,
    privacy: 'public',
    options: {
      rootDir: process.cwd(),
      onBundleProgress: (progress) => {
        const percent = Math.floor(progress / 10) * 10
        if (percent > lastBundlePercent) {
          lastBundlePercent = percent
          console.log(`[remotion-site] bundle ${percent}%`)
        }
      },
      onDiffingProgress: (bytes, done) => {
        if (done) console.log(`[remotion-site] diffed ${(bytes / 1024 / 1024).toFixed(1)} MB`)
      },
      onUploadProgress: ({ filesUploaded, totalFiles, sizeUploaded, totalSize }) => {
        const percent = totalSize > 0 ? Math.floor((sizeUploaded / totalSize) * 10) * 10 : 100
        if (percent > lastUploadPercent || filesUploaded === totalFiles) {
          lastUploadPercent = percent
          console.log(`[remotion-site] upload ${percent}% (${filesUploaded}/${totalFiles})`)
        }
      },
      webpackOverride: (webpackConfig) => ({
        ...webpackConfig,
        resolve: {
          ...webpackConfig.resolve,
          alias: {
            ...webpackConfig.resolve?.alias,
            '@': path.resolve(process.cwd(), 'src'),
          },
        },
      }),
    },
  })

  console.log(JSON.stringify({
    siteName: result.siteName,
    serveUrl: result.serveUrl,
    bucketName,
    region,
    stats: result.stats,
  }, null, 2))
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error)
  process.exitCode = 1
})
