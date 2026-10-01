// @vitest-environment node
import { readFileSync } from 'node:fs'
import { runInNewContext } from 'node:vm'
import { describe, expect, it, vi } from 'vitest'

const nativeSource = readFileSync(new URL('../ios/App/App/MakaronBridgeViewController.swift', import.meta.url), 'utf8')
const script = nativeSource.match(/let script = """\n([\s\S]*?)\n\s*"""/)?.[1]
if (!script) throw new Error('Native Capacitor configuration script is missing')

function install() {
  const original = vi.fn<(message?: string, defaultText?: string) => string>(() => 'normal prompt')
  const window = { prompt: original }
  runInNewContext(script!.replace('\\(config)', JSON.stringify({
    'CapacitorCookies.isEnabled': true,
    CapacitorHttp: false,
  })), { window })
  return { window, original }
}

describe('iOS 27 Capacitor startup configuration', () => {
  it('returns the native flags and restores the original prompt after both reads', () => {
    const { window, original } = install()
    expect(window.prompt(JSON.stringify({ type: 'CapacitorHttp' }))).toBe('false')
    expect(window.prompt(JSON.stringify({ type: 'CapacitorCookies.isEnabled' }))).toBe('true')
    expect(original).not.toHaveBeenCalled()
    expect(window.prompt).toBe(original)
  })

  it('delegates ordinary and unknown prompts with their arguments and receiver', () => {
    const { window, original } = install()
    expect(window.prompt('Your name?', 'Default')).toBe('normal prompt')
    expect(window.prompt(JSON.stringify({ type: 'OtherPlugin' }))).toBe('normal prompt')
    expect(original).toHaveBeenCalledWith('Your name?', 'Default')
    expect(original.mock.contexts[0]).toBe(window)
  })

  it('does not restore early when the same flag is read twice', () => {
    const { window, original } = install()
    for (let index = 0; index < 2; index++) {
      expect(window.prompt(JSON.stringify({ type: 'CapacitorHttp' }))).toBe('false')
    }
    expect(window.prompt).not.toBe(original)
    window.prompt(JSON.stringify({ type: 'CapacitorCookies.isEnabled' }))
    expect(window.prompt).toBe(original)
  })

  it('limits native installation to iOS 27 and reads actual plugin configuration', () => {
    expect(nativeSource).toContain('if #available(iOS 27.0, *)')
    expect(nativeSource).toContain('getPluginConfig("CapacitorCookies").getBoolean("enabled", false)')
    expect(nativeSource).toContain('getPluginConfig("CapacitorHttp").getBoolean("enabled", false)')
  })
})
