// StorageApiError discards response headers, including the identifiers needed
// to correlate a rejected upload with gateway or CDN logs.
export const fetchWithWorkspaceReceipt: typeof fetch = async (input, init) => {
  const response = await fetch(input, init)
  if (response.ok || init?.method !== 'POST') return response

  const url = input instanceof Request ? input.url : input.toString()
  if (!/\/storage\/v1\/object\/images\/[^/]+\/workspace\//.test(url)) {
    return response
  }

  const requestId = response.headers.get('sb-request-id') || ''
  const ray = response.headers.get('cf-ray') || ''
  const mime = response.headers.get('content-type')?.split(';')[0].trim().toLowerCase()
  console.warn('[workspace] upload response', {
    kind: /\/drafts\/streamed-[^/]+\.partial\.js$/.test(url) ? 'checkpoint' : 'file',
    status: response.status,
    format: mime === 'application/json' ? 'json' : mime === 'text/html' ? 'html' : 'other',
    requestId: /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(requestId) ? requestId : null,
    cfRay: /^[0-9a-f]{16}(?:-[a-z]{3})?$/i.test(ray) ? ray : null,
  })
  return response
}
