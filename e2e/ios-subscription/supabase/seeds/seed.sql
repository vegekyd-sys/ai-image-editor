INSERT INTO public.app_settings (key, value)
VALUES
  ('billing_enabled', 'true'),
  ('welcome_credits', '500'),
  ('ios_trial_credits', '1500')
ON CONFLICT (key) DO UPDATE SET value = excluded.value, updated_at = now();

INSERT INTO public.home_skills (
  id,
  labels,
  prompts,
  image,
  before_images,
  prompt,
  skill_path,
  image_count,
  categories,
  sort_order,
  is_active
) VALUES (
  'e2e00000-0000-4000-8000-000000000001',
  '{"zh":"E2E 结尾精灵","zh-Hant":"E2E 結尾精靈","ja":"E2E エンディング","en":"E2E Ending Spirit"}'::jsonb,
  '{"zh":"把我的照片做成结尾精灵","zh-Hant":"把我的照片做成結尾精靈","ja":"写真をエンディングスピリットにする","en":"Turn my photo into an ending spirit"}'::jsonb,
  'http://127.0.0.1:3002/e2e/skill-cover.svg',
  ARRAY['http://127.0.0.1:3002/e2e/skill-cover.svg'],
  'Turn my photo into an ending spirit',
  'http://127.0.0.1:3002/api/e2e/skill-fixture',
  1,
  ARRAY['visual-creation'],
  0,
  true
)
ON CONFLICT (id) DO UPDATE SET
  labels = excluded.labels,
  prompts = excluded.prompts,
  image = excluded.image,
  before_images = excluded.before_images,
  prompt = excluded.prompt,
  skill_path = excluded.skill_path,
  image_count = excluded.image_count,
  categories = excluded.categories,
  is_active = true,
  updated_at = now();

INSERT INTO public.skill_categories (id, labels, descriptions, sort_order, icon, is_active)
VALUES (
  'visual-creation',
  '{"zh":"视觉创作","zh-Hant":"視覺創作","ja":"ビジュアル制作","en":"Visual Creation"}'::jsonb,
  '{}'::jsonb,
  0,
  'sparkles',
  true
)
ON CONFLICT (id) DO NOTHING;
