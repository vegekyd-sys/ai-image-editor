import { act } from 'react'
import { hydrateRoot, type Root } from 'react-dom/client'
import { renderToString } from 'react-dom/server'
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
import { useHydrated } from '@/hooks/useHydrated'

function AuthSensitiveAction({ authenticated }: { authenticated: boolean }) {
  const hydrated = useHydrated()
  const visibleAuthenticated = hydrated && authenticated

  return visibleAuthenticated
    ? <button type="button">Create</button>
    : <a href="/login">Try free</a>
}

describe('first-interaction hydration contract', () => {
  let root: Root | null = null
  const reactActEnvironment = globalThis as typeof globalThis & {
    IS_REACT_ACT_ENVIRONMENT?: boolean
  }

  beforeAll(() => {
    reactActEnvironment.IS_REACT_ACT_ENVIRONMENT = true
  })

  afterAll(() => {
    reactActEnvironment.IS_REACT_ACT_ENVIRONMENT = false
  })

  afterEach(() => {
    if (root) {
      act(() => root?.unmount())
      root = null
    }
    document.body.innerHTML = ''
  })

  it('keeps SSR guest markup stable when auth has already settled before child hydration', async () => {
    const serverHTML = renderToString(<AuthSensitiveAction authenticated={false} />)
    const container = document.createElement('div')
    container.innerHTML = serverHTML
    document.body.appendChild(container)
    const recoverableErrors: unknown[] = []

    await act(async () => {
      root = hydrateRoot(container, <AuthSensitiveAction authenticated />, {
        onRecoverableError: (error) => recoverableErrors.push(error),
      })
      await Promise.resolve()
    })

    expect(recoverableErrors).toEqual([])
    expect(container.querySelector('button')?.textContent).toBe('Create')
    expect(container.querySelector('a[href="/login"]')).toBeNull()
  })
})
