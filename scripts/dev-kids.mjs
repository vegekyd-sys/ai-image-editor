import { execFileSync, spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'

function readMacProxy() {
  if (process.platform !== 'darwin') return null

  try {
    const output = execFileSync('scutil', ['--proxy'], { encoding: 'utf8' })
    const enabled = /^\s*HTTPSEnable\s*:\s*1\s*$/m.test(output)
    const host = output.match(/^\s*HTTPSProxy\s*:\s*(\S+)\s*$/m)?.[1]
    const port = output.match(/^\s*HTTPSPort\s*:\s*(\d+)\s*$/m)?.[1]
    if (!enabled || !host || !port) return null
    return `http://${host}:${port}`
  } catch {
    return null
  }
}

const systemProxy = readMacProxy()
const proxy = process.env.HTTPS_PROXY || process.env.https_proxy || systemProxy
const env = { ...process.env }

if (proxy) {
  env.HTTPS_PROXY = proxy
  env.HTTP_PROXY ||= proxy
  env.NODE_USE_ENV_PROXY = '1'
  console.log(`[Makaron Kids] Google Live will use ${proxy}`)
} else {
  console.log('[Makaron Kids] No HTTPS proxy detected; Google Live will use the direct network.')
}

const nextBin = fileURLToPath(new URL('../node_modules/next/dist/bin/next', import.meta.url))
const child = spawn(process.execPath, [nextBin, 'dev', '--webpack', ...process.argv.slice(2)], {
  env,
  stdio: 'inherit',
})

child.on('exit', (code, signal) => {
  if (signal) process.kill(process.pid, signal)
  else process.exit(code ?? 1)
})
