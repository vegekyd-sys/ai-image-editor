ALTER TABLE user_profiles ADD COLUMN IF NOT EXISTS is_admin boolean DEFAULT false;

-- Set current owner as admin
UPDATE user_profiles SET is_admin = true WHERE id = '5955d413-cad2-4814-b094-7fdf62d20400';
