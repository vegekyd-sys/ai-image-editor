import { authenticateRequest } from '@/lib/api-auth'
import { hasPaidMediaAccess } from '@/lib/free-media'

// Entitlement only. Media bytes and watermark encoding stay in the browser.
export async function GET(req: Request) {
  const auth = await authenticateRequest(req)
  if ('error' in auth) return auth.error
  try {
    return Response.json({ paid: await hasPaidMediaAccess(auth.auth.userId) }, {
      headers: { 'Cache-Control': 'private, no-store' },
    })
  } catch {
    return Response.json({ error: 'Could not verify download access' }, { status: 503 })
  }
}
