export async function connectKidsLiveWithTimeout<T extends { close: () => void }>(
  connection: Promise<T>,
  timeoutMs = 8_000,
) {
  let timedOut = false
  let timer: ReturnType<typeof setTimeout> | null = null
  connection.then(
    (session) => { if (timedOut) session.close() },
    () => undefined,
  )
  try {
    return await Promise.race([
      connection,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => {
          timedOut = true
          reject(new Error('Gemini Live connection timed out'))
        }, timeoutMs)
      }),
    ])
  } finally {
    if (timer) clearTimeout(timer)
  }
}
