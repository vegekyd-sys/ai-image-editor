import { authenticateRequest } from '@/lib/api-auth';
import { modelPriceInputSchema, queryModelPrices } from '@/lib/model-price-tool';

const headers = { 'Cache-Control': 'no-store' };

/** Read-only pricing. POST carries the structured task parameters. */
export async function POST(req: Request): Promise<Response> {
  const auth = await authenticateRequest(req, { recordApiKeyUsage: false });
  if ('error' in auth) return auth.error;

  const input = modelPriceInputSchema.safeParse(await req.json().catch(() => null));
  if (!input.success) {
    return Response.json({
      error: 'Invalid pricing request.',
      invalidFields: [...new Set(input.error.issues.map(issue => issue.path.join('.') || 'body'))],
    }, { status: 400, headers });
  }

  return Response.json(await queryModelPrices(input.data), { headers });
}
