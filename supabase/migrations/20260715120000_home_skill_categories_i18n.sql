-- Add localized home-skill prompts and a DB-driven category taxonomy.
-- This migration is intentionally non-destructive: legacy prompt data remains
-- the fallback, and category assignments outside the retired experiment are
-- preserved alongside the checked-in marketplace taxonomy.

ALTER TABLE public.home_skills
  ADD COLUMN IF NOT EXISTS prompts jsonb NOT NULL DEFAULT '{}'::jsonb;

ALTER TABLE public.home_skills
  ADD COLUMN IF NOT EXISTS categories jsonb NOT NULL DEFAULT '[]'::jsonb;

CREATE TABLE IF NOT EXISTS public.skill_categories (
  id text PRIMARY KEY,
  labels jsonb NOT NULL DEFAULT '{}'::jsonb,
  descriptions jsonb NOT NULL DEFAULT '{}'::jsonb,
  sort_order integer NOT NULL DEFAULT 0,
  icon text,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Complete the shape if an earlier experimental version of the table exists.
ALTER TABLE public.skill_categories
  ADD COLUMN IF NOT EXISTS descriptions jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS icon text,
  ADD COLUMN IF NOT EXISTS is_active boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS created_at timestamptz NOT NULL DEFAULT now(),
  ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();

INSERT INTO public.skill_categories AS existing (id, labels, descriptions, sort_order)
VALUES
  (
    'video',
    '{"zh":"动态影像","zh-Hant":"動態影像","ja":"動画制作","en":"Motion"}'::jsonb,
    '{"zh":"照片动画、转场与短片叙事","zh-Hant":"照片動畫、轉場與短片敘事","ja":"写真アニメーション、トランジション、ショートストーリー","en":"Photo animation, transitions, and short-form stories"}'::jsonb,
    0
  ),
  (
    'idol-social',
    '{"zh":"追星与社交","zh-Hant":"追星與社交","ja":"推し活・ソーシャル","en":"Idol & Social"}'::jsonb,
    '{"zh":"与偶像合照，制作社交内容","zh-Hant":"與偶像合照，製作社交內容","ja":"推しとの写真やシェア向け作品","en":"Fan moments and social-ready looks"}'::jsonb,
    1
  ),
  (
    'visual',
    '{"zh":"视觉创作","zh-Hant":"視覺創作","ja":"ビジュアル","en":"Visual"}'::jsonb,
    '{"zh":"强烈风格与视觉特效","zh-Hant":"強烈風格與視覺特效","ja":"大胆なスタイルと視覚効果","en":"Bold styles and visual effects"}'::jsonb,
    2
  ),
  (
    'utility',
    '{"zh":"创意实验","zh-Hant":"創意實驗","ja":"クリエイティブ実験","en":"Creative Lab"}'::jsonb,
    '{"zh":"奇想场景、商业视觉与分析卡片","zh-Hant":"奇想場景、商業視覺與分析卡片","ja":"空想シーン、商用ビジュアル、分析カード","en":"Imaginative scenes, commercial visuals, and analysis cards"}'::jsonb,
    3
  ),
  (
    'ip-fantasy',
    '{"zh":"影视动漫","zh-Hant":"影視動漫","ja":"映画・アニメ","en":"Movies & Anime"}'::jsonb,
    '{"zh":"进入经典影视动漫场景","zh-Hant":"進入經典影視動漫場景","ja":"映画やアニメの世界へ","en":"Step into iconic screen and anime worlds"}'::jsonb,
    4
  ),
  (
    'pet',
    '{"zh":"萌宠","zh-Hant":"萌寵","ja":"ペット","en":"Pets"}'::jsonb,
    '{"zh":"和宠物一起玩创意","zh-Hant":"和寵物一起玩創意","ja":"ペットと楽しむクリエイティブ","en":"Playful creations with pets"}'::jsonb,
    5
  ),
  (
    'travel',
    '{"zh":"旅行","zh-Hant":"旅行","ja":"旅行","en":"Travel"}'::jsonb,
    '{"zh":"把旅行回忆变成作品","zh-Hant":"把旅行回憶變成作品","ja":"旅の思い出を作品に","en":"Turn travel memories into keepsakes"}'::jsonb,
    6
  )
ON CONFLICT (id) DO UPDATE SET
  labels = EXCLUDED.labels || existing.labels,
  descriptions = EXCLUDED.descriptions || existing.descriptions,
  updated_at = now();

-- An unmerged 2026-05 experiment seeded a second, overlapping taxonomy in the
-- shared database. Keep those definitions for rollback/history, but hide them
-- so the public rail cannot expose two competing sets after this migration.
UPDATE public.skill_categories
SET is_active = false,
    updated_at = now()
WHERE id IN ('trending', 'anime', 'fandom', 'portrait', 'creative', 'idol', 'pets');

ALTER TABLE public.skill_categories ENABLE ROW LEVEL SECURITY;

-- Supabase projects created after the 2026-04 Data API privilege change do not
-- automatically grant newly-created tables. RLS still limits public access to
-- the SELECT policy below; admin writes continue through the service role.
GRANT SELECT ON TABLE public.skill_categories TO anon, authenticated;
GRANT ALL ON TABLE public.skill_categories TO service_role;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'skill_categories'
      AND policyname = 'Public read skill categories'
  ) THEN
    CREATE POLICY "Public read skill categories"
      ON public.skill_categories
      FOR SELECT
      USING (true);
  END IF;
END
$$;

-- Backfill only IDs captured in the repository's historical marketplace
-- export plus currently active rows verified on 2026-07-15. Rows added later
-- or unknown to the export stay in All. Existing current/custom assignments
-- are retained; only category IDs from the retired experiment are removed.
UPDATE public.home_skills AS skill
SET categories = (
  SELECT COALESCE(jsonb_agg(normalized.category_id ORDER BY normalized.category_id), '[]'::jsonb)
  FROM (
    SELECT DISTINCT candidate.category_id
    FROM (
      SELECT jsonb_array_elements_text(COALESCE(skill.categories, '[]'::jsonb)) AS category_id
      UNION ALL
      SELECT mapping.category_id
    ) AS candidate
    WHERE candidate.category_id NOT IN (
      'trending', 'anime', 'fandom', 'portrait', 'creative', 'idol', 'pets'
    )
  ) AS normalized
)
FROM (VALUES
  ('73b1ed94-84b1-4e24-964e-720bd4c60308'::uuid, 'video'),
  ('a0f78216-8dbc-472a-83b2-9fb6a8a213c9'::uuid, 'idol-social'),
  ('c69a4dc8-d597-4ccc-961a-7831fb7d238b'::uuid, 'visual'),
  ('9d50248c-9b4c-4f16-a24e-143172bfab03'::uuid, 'video'),
  ('34bd54e7-8b2e-49f6-a746-d8658ab63fd5'::uuid, 'visual'),
  ('d14f24cc-6438-4dac-be89-da3ff58d0e49'::uuid, 'idol-social'),
  ('64d7e442-7d6e-4882-9479-47bf526a88e7'::uuid, 'video'),
  ('5aeca716-9d76-47d9-9c01-0a81308639f9'::uuid, 'utility'),
  ('a25030c8-5ecb-45fc-846e-ee929475b806'::uuid, 'idol-social'),
  ('c44b1d23-a164-40e7-811c-90255f5b3dc6'::uuid, 'idol-social'),
  ('3ec57b33-ad55-46b6-a1b4-136083de149a'::uuid, 'idol-social'),
  ('2d8de8a4-9341-45da-9c79-657e4e743180'::uuid, 'idol-social'),
  ('5c15e64d-0eef-4ed4-b106-841eea3264f5'::uuid, 'idol-social'),
  ('a1cadab3-3577-42fb-b199-1703b4cbc9d7'::uuid, 'idol-social'),
  ('6240ac32-711c-46e6-bf02-4971376e394c'::uuid, 'idol-social'),
  ('1b1a5f12-af8a-4c29-a147-ad736899ef90'::uuid, 'idol-social'),
  ('94fbd5d6-0243-4edc-a043-01b0dcb684c1'::uuid, 'idol-social'),
  ('967f2709-6df2-41f2-932a-f6168ef9a073'::uuid, 'idol-social'),
  ('15fcca29-91b6-42da-bcef-117ab2b21ba6'::uuid, 'idol-social'),
  ('90e6567c-1027-4a4b-a956-4c90cf4ecbf5'::uuid, 'ip-fantasy'),
  ('d7ab5487-a8b4-49d5-b870-e1e038512ed6'::uuid, 'pet'),
  ('a78124e3-8fb9-47a2-8dcc-31a29b589296'::uuid, 'ip-fantasy'),
  ('3e38bcc5-c1b2-4623-a573-6075a68d0184'::uuid, 'utility'),
  ('1efc97cb-b73a-4a3b-91f9-b6f40ca8747d'::uuid, 'ip-fantasy'),
  ('ff26fdd9-acdd-4d41-8b20-f13a61e1502d'::uuid, 'utility'),
  ('c113f49a-c0d2-4d3d-8f51-7404fd3e6b06'::uuid, 'utility'),
  ('9d2880bd-558a-4567-b712-09e9a44bdaf0'::uuid, 'ip-fantasy'),
  ('a95872a7-a125-43eb-9ae2-b9415fdb9cce'::uuid, 'pet'),
  ('3f3184bb-635c-4597-88d1-a6c2b9f2c051'::uuid, 'ip-fantasy'),
  ('5ec0e3b8-39d0-452f-a6d5-b5b0e0df49aa'::uuid, 'ip-fantasy'),
  ('b57ebb51-b5c5-4ab5-8216-26765da5518a'::uuid, 'pet'),
  ('a340de47-60cf-4655-80f4-0a6005137fac'::uuid, 'utility'),
  ('2910c7d7-9d77-431e-98a7-1340d1d173c2'::uuid, 'visual'),
  ('4229a385-25f1-4d32-bbda-f8b4b0ed0e6b'::uuid, 'utility'),
  ('45f9be3c-6eb2-4772-ac4c-ea7ec951a4ab'::uuid, 'idol-social'),
  ('7ec3ad34-7c4c-438c-8252-7bc257720296'::uuid, 'ip-fantasy'),
  ('b57ac0c9-ab69-4c0f-8310-a2f5badc5c8a'::uuid, 'pet'),
  ('3d5393dd-6e67-48b4-abd1-b9072978fded'::uuid, 'ip-fantasy'),
  ('12ee4b60-d042-422a-aac5-ebbb0314c655'::uuid, 'pet'),
  ('9cbefea5-1893-4239-be59-b2df15e570df'::uuid, 'utility'),
  ('8c1a4daf-e13c-454e-8398-2ff237507dfe'::uuid, 'video'),
  ('01eeb369-0ed1-4b71-a718-97c885bb2d9c'::uuid, 'visual'),
  ('af67d941-c73a-4bd5-8217-ba42a8bfebb7'::uuid, 'visual'),
  ('4842d420-4810-470a-a537-8758dcc730a3'::uuid, 'visual'),
  ('2c2addf3-68fb-4b77-b41b-dfd78fba6bd1'::uuid, 'utility'),
  ('5cacdbf3-babe-4d12-9b2f-eaf53aff7858'::uuid, 'visual'),
  ('950f1ac1-c7bf-4077-839e-d7520e47d8f3'::uuid, 'pet'),
  ('c7e5f56e-ae44-430f-8083-ab4695f13de8'::uuid, 'visual'),
  ('e77d88b9-cdf4-4c7f-a0c7-f25a6eabf14b'::uuid, 'idol-social'),
  ('80e1a7f6-ad0c-4a62-8a01-335ab6c6f8bc'::uuid, 'idol-social'),
  ('abf3d190-c724-4cb7-9183-06696ed4ba09'::uuid, 'utility'),
  ('2d0a2655-c8c6-4dd9-a2a7-7a1e46f72189'::uuid, 'pet'),
  ('b9f79f91-ae53-4b34-8eee-abe9e89d344d'::uuid, 'utility'),
  ('2115ffe1-8105-4c26-b4c9-24b2ef2a7ee7'::uuid, 'utility'),
  ('f6d81444-1cfd-4c61-93a7-044dabef73df'::uuid, 'pet'),
  ('306f0212-4162-4009-91ef-7c6c9f6f3c1f'::uuid, 'pet'),
  ('32a6f58d-b06e-4aff-a373-21fb74220adc'::uuid, 'pet'),
  ('363d5a1a-a0f4-4339-9a52-1dba6a512a97'::uuid, 'pet'),
  ('0f2a12c1-8e9b-4f1e-86fb-152fd8168869'::uuid, 'pet'),
  ('d1085012-fc11-4597-9630-f85591a18469'::uuid, 'travel'),
  ('ed0e81b0-05af-46e9-8520-5aee3979203e'::uuid, 'pet'),
  ('1609fd25-aa1d-42f5-b1b7-bea39fa8745e'::uuid, 'idol-social'),
  ('d507f8c4-fddb-4873-ab6f-3635ac47c06e'::uuid, 'pet'),
  ('0e51aea2-1119-4a74-b0aa-0819012c2465'::uuid, 'travel'),
  ('30d405c9-82e2-4728-8921-d248b897a3db'::uuid, 'travel'),
  ('4f2c0638-38e3-41c7-8f9a-4408af5305ee'::uuid, 'pet'),
  ('88384a4b-e81e-4a96-b98a-2a7e7e0c3305'::uuid, 'visual'),
  ('809e5825-a476-44c0-8200-7b5902698ef8'::uuid, 'pet'),
  ('ad7e037b-06b4-4154-a7f4-477243ab61fe'::uuid, 'visual'),
  ('22d34123-3cde-40cf-8bfe-7ca3c45fd4f7'::uuid, 'video'),
  ('75457f73-f29f-451e-83b3-d6ec709a850e'::uuid, 'pet'),
  ('a4739aaf-d7cc-49bd-b5d4-580f2f900ecd'::uuid, 'pet'),
  ('71836fc7-affe-4082-85c9-6c730cd8f7c6'::uuid, 'video'),
  ('7ef2c391-a7e4-4519-ac06-62ec3acff2ac'::uuid, 'idol-social'),
  ('9db4bfb9-2e52-46e0-a59d-500f12e9f262'::uuid, 'idol-social'),
  ('7e0d0a2e-769b-442c-8b76-0c49dd34222c'::uuid, 'video'),
  ('2b9885b1-3a25-43ed-a54b-de80298d01e1'::uuid, 'video'),
  ('dfb57a41-6827-4ca5-b94f-477645b1c103'::uuid, 'visual'),

  -- Active marketplace rows added after the checked-in historical export.
  ('00f126ac-7451-4ee6-8025-e67dcc7b0169'::uuid, 'video'),
  ('32dcbd79-c35d-459a-a609-c78c4f0566ba'::uuid, 'visual'),
  ('e573113a-6afc-4054-b8db-c0d9f1c4efbd'::uuid, 'video'),
  ('e1cca386-b71e-4aea-81c1-894782841b2f'::uuid, 'visual'),
  ('e7a1e2f2-e3bb-4c31-90cc-7b8a919d7c81'::uuid, 'idol-social'),
  ('50ce086d-cfa9-4dbf-9b79-204c91945fcf'::uuid, 'idol-social'),
  ('4a569b11-4a6d-4191-9a00-4375bf90c501'::uuid, 'video'),
  ('c4dede02-70fd-42d5-85ea-83f6aec5e0f4'::uuid, 'idol-social'),
  ('5ae407d0-2b1c-4f1f-870d-8109b9a6e87c'::uuid, 'visual'),
  ('e0b60223-480d-4428-8f8e-853b71aba6e0'::uuid, 'ip-fantasy'),
  ('3b405f5d-deac-428b-a8c5-2b459104012f'::uuid, 'idol-social'),
  ('fe06677e-b112-451c-a0c1-b7a83b1cb8c2'::uuid, 'visual'),
  ('4c711043-a8bc-4e46-9d2e-acc573a7e585'::uuid, 'travel'),
  ('0eb165bf-c407-432c-8e55-2b9081bc1022'::uuid, 'video'),
  ('3efd5636-0650-4ef7-9b48-5e6dda55989a'::uuid, 'ip-fantasy'),
  ('8c29c7fd-efed-44ce-8cc8-27e222deb100'::uuid, 'idol-social'),
  ('1094df13-6ba9-476b-b6b5-b22e483baa96'::uuid, 'idol-social'),
  ('159e113d-c1c4-45d9-8c6a-93ba45e73203'::uuid, 'ip-fantasy'),
  ('dada27b1-9234-4d30-9a00-0785954833f8'::uuid, 'ip-fantasy'),
  ('dae88473-de10-40ca-815d-0473a8898eef'::uuid, 'idol-social'),
  ('7daee2f9-afff-49d1-8d0c-c802f9bdf171'::uuid, 'ip-fantasy'),
  ('2a47e6df-6009-4a10-b227-0fd4f774361a'::uuid, 'ip-fantasy'),
  ('496d3778-94fa-461f-86e0-7b53ab97ab69'::uuid, 'video'),
  ('d79d927c-88bc-42fa-a67b-eeb504f4d2ef'::uuid, 'ip-fantasy'),
  ('e387dc1d-22c1-493a-8521-dc3c66be96de'::uuid, 'visual'),
  ('2ed2ae4c-13ee-49d0-a83e-d73cd51098a7'::uuid, 'utility'),
  ('ce0f035f-3a3c-4106-a916-6c04720b30f1'::uuid, 'visual'),
  ('b1699762-5207-480a-91e2-dd5eb6909bb3'::uuid, 'ip-fantasy'),
  ('f2ebb07b-d1b4-473a-b2f8-17a410ab5f7d'::uuid, 'visual'),
  ('91f20e1d-04b9-4ebf-a763-5ceb009a1360'::uuid, 'idol-social'),
  ('a4565b24-065b-49ee-aeca-97b53ca9452c'::uuid, 'utility'),
  ('305a710d-ac7f-41b1-8fd8-840d091cb78b'::uuid, 'ip-fantasy'),
  ('f5628b6b-0478-4b28-8ff8-01f9555a8f44'::uuid, 'visual'),
  ('a634b26f-77b2-468e-ab17-3289aa5f6f03'::uuid, 'idol-social'),
  ('f064dde3-b09d-4ee5-8366-e0a127fe8fd7'::uuid, 'ip-fantasy'),
  ('3d44d7ca-0685-4e9c-bcb6-2567acfdc970'::uuid, 'visual'),
  ('ec0ad58c-86e4-488e-8b4b-a12836fa035b'::uuid, 'idol-social'),
  ('42659a9a-9187-4c66-8d46-ea8efb8f82d5'::uuid, 'ip-fantasy'),
  ('fc61968f-5bd1-45b4-9477-7141323b2d44'::uuid, 'travel'),
  ('c27fa786-a2f5-4414-acd9-f14a87c4e040'::uuid, 'idol-social'),
  ('2a02ff39-efe2-4c46-8845-2a45a20a0426'::uuid, 'ip-fantasy'),
  ('a5dbd66e-4a87-4495-b225-c679947df465'::uuid, 'video'),
  ('7e66aa8e-2c0e-49a9-806e-4596835cef69'::uuid, 'visual'),
  ('82659d64-78ae-49c8-b137-3a25a5ad7175'::uuid, 'visual'),
  ('9fcb697c-3ee3-4601-906f-b130a47432b3'::uuid, 'ip-fantasy'),
  ('1c8edce2-c6a9-468e-9014-38fb3ce4af85'::uuid, 'ip-fantasy'),
  ('6b4216dc-dbb1-4490-ba00-e9b815bc61a5'::uuid, 'visual'),
  ('9993a6c8-17be-424a-90be-beb94d717c67'::uuid, 'visual'),
  ('e3bdc6a9-5e50-403f-8053-89674856b64e'::uuid, 'idol-social'),
  ('515043b6-2897-4eb7-b27d-9f880ab2103b'::uuid, 'idol-social'),
  ('842147c7-7ba6-4aa5-913b-95eaf246261c'::uuid, 'idol-social'),
  ('af0a5bfb-8d8e-4a83-8081-7a152395f034'::uuid, 'ip-fantasy'),
  ('4867d402-ff1a-4076-8b32-ac4da06cac2f'::uuid, 'travel'),
  ('0454d0a9-7ad8-447c-8737-b9017e81ea5c'::uuid, 'idol-social'),
  ('3926abd2-6c74-475a-a735-2f933c5850f0'::uuid, 'visual'),
  ('a9d37f73-6928-4a13-b185-283bd5788ba1'::uuid, 'ip-fantasy'),
  ('0d8a6286-782f-465c-9135-d9d277ce568a'::uuid, 'visual'),
  ('40480414-072d-4848-a659-681ef089dfd3'::uuid, 'visual'),
  ('623ce920-566d-4616-9cae-4112995deee4'::uuid, 'visual'),
  ('29fbd6f2-c3f1-40b6-92df-f3094e0bbb33'::uuid, 'ip-fantasy'),
  ('912fe012-0371-4401-bea2-d9bf93052d00'::uuid, 'ip-fantasy'),
  ('4e63ccd3-30e0-4ee9-99ed-dc787bb17e2f'::uuid, 'idol-social'),
  ('c96c9633-117d-4f62-ac0a-286fff2b531f'::uuid, 'idol-social'),
  ('88adcd41-0546-42bb-87ab-5b409f855ab8'::uuid, 'visual')
) AS mapping(skill_id, category_id)
WHERE skill.id = mapping.skill_id;
