// @vitest-environment node
import { afterEach, expect, it, vi } from 'vitest';
import sharp from 'sharp';
import { editImage } from '@/lib/skills/edit-image';
vi.mock('@/lib/model-router', async () => {
  const { wanImageBackend } = await import('@/lib/models/wan-image');
  return { generateImage: wanImageBackend.generate };
});

afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });
it('returns an actionable persisted tool result for small Wan input without a paid call', async () => {
  vi.stubEnv('DASHSCOPE_API_KEY', 'test');
  vi.stubEnv('DASHSCOPE_API_HOST', 'ws-test.ap-southeast-1.maas.aliyuncs.com');
  const submit = vi.fn(); vi.stubGlobal('fetch', submit);
  const bytes = await sharp({ create: { width: 384, height: 215, channels: 3, background: 'red' } }).png().toBuffer();
  const result = await editImage({ editPrompt: 'Keep the person.', preferredModel: 'wan2.7-image' }, { currentImage: `data:image/png;base64,${bytes.toString('base64')}` });
  expect(result).toMatchObject({ success: false, message: expect.stringContaining('384x215') });
  expect(submit).not.toHaveBeenCalled();
});
