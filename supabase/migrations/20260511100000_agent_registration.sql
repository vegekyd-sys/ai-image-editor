-- Agent self-registration: challenge-response anti-abuse
CREATE TABLE agent_challenges (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  challenge_text TEXT NOT NULL,
  expected_answer TEXT NOT NULL,
  ip_address TEXT,
  created_at TIMESTAMPTZ DEFAULT now(),
  verified_at TIMESTAMPTZ,
  user_id UUID REFERENCES auth.users(id)
);

CREATE INDEX idx_agent_challenges_ip_time ON agent_challenges(ip_address, created_at);

-- Mark agent accounts
ALTER TABLE user_profiles ADD COLUMN IF NOT EXISTS is_agent BOOLEAN DEFAULT false;

-- Agent registration toggle
INSERT INTO app_settings (key, value) VALUES ('agent_registration_enabled', 'true')
ON CONFLICT (key) DO NOTHING;
