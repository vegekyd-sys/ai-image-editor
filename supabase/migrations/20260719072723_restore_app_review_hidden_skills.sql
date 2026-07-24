-- Restore the exact Skill set temporarily hidden for App Store review.
UPDATE home_skills
SET is_active = true,
    updated_at = now()
WHERE id IN (
  '00f126ac-7451-4ee6-8025-e67dcc7b0169', -- World Cup MVP
  '34bd54e7-8b2e-49f6-a746-d8658ab63fd5', -- Rainy Kiss
  'e573113a-6afc-4054-b8db-c0d9f1c4efbd', -- Football Captain
  '4a569b11-4a6d-4191-9a00-4375bf90c501', -- World Cup Live Candid
  '0eb165bf-c407-432c-8e55-2b9081bc1022', -- Bicycle Kick Hero
  '8c29c7fd-efed-44ce-8cc8-27e222deb100', -- Star Card Dressup
  '496d3778-94fa-461f-86e0-7b53ab97ab69', -- Curling free kick
  'a5dbd66e-4a87-4495-b225-c679947df465'  -- Keeper Moment
);
