import { NextRequest } from 'next/server';
import { POST as signUpload } from '../../src/app/api/storage/upload-url/route';
import { validateApiKey } from '../../src/lib/billing/api-keys';
import { getSupabaseAdmin } from '../../src/lib/supabase/service';
import { createDirectorServer } from './server.mjs';

const allowed = new Set((process.env.MAKARON_DIRECTOR_PREVIEW_KEY_IDS || '').split(',').filter(Boolean));
const directory = process.env.MAKARON_DIRECTOR_STATE_DIR;
if (!directory || !allowed.size || !process.env.FAL_KEY || !process.env.DEEPSEEK_API_KEY)
  throw Error('Director private preview configuration is incomplete');
createDirectorServer({
  directory,
  providerKey: process.env.FAL_KEY,
  async authenticate(value?: string) {
    if (!value?.startsWith('Bearer mk_live_')) return null;
    const actor = await validateApiKey(value.slice(7));
    return actor && allowed.has(actor.keyId) ? actor : null;
  },
  async openingUpload(authorization: string, filename: string, contentType: string) {
    return signUpload(
      new NextRequest('http://localhost/api/storage/upload-url', {
        method: 'POST',
        headers: { authorization, 'content-type': 'application/json' },
        body: JSON.stringify({ filename, contentType }),
      }),
    );
  },
  async activeKey(keyId: string, userId: string) {
    if (!allowed.has(keyId)) return false;
    const { data } = await getSupabaseAdmin()
      .from('api_keys')
      .select('id')
      .eq('id', keyId)
      .eq('user_id', userId)
      .eq('is_active', true)
      .maybeSingle();
    return Boolean(data);
  },
}).listen(Number(process.env.MAKARON_DIRECTOR_PORT || 43936), '127.0.0.1');
