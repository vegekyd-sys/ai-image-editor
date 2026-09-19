-- Effective media tariffs. App/Agent/MCP and Admin read the same table.
-- Seed only: later migrations must not overwrite operator edits.
CREATE TABLE public.media_pricing (
  id text PRIMARY KEY,
  kind text NOT NULL CHECK (kind IN ('video', 'audio')),
  model_id text NOT NULL,
  resolution text NOT NULL,
  operation text NOT NULL CHECK (operation IN ('generate', 'edit', 'extend')),
  output_usd_per_second numeric NOT NULL CHECK (output_usd_per_second > 0),
  input_usd_per_second numeric NOT NULL DEFAULT 0 CHECK (input_usd_per_second >= 0),
  input_usd_per_image numeric NOT NULL DEFAULT 0 CHECK (input_usd_per_image >= 0),
  free_image_references integer NOT NULL DEFAULT 0 CHECK (free_image_references >= 0),
  markup numeric(10,4) NOT NULL DEFAULT 2 CHECK (markup > 0),
  unfiltered_multiplier numeric(10,4) NOT NULL DEFAULT 1 CHECK (unfiltered_multiplier >= 1),
  is_active boolean NOT NULL DEFAULT true,
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (kind, model_id, resolution, operation)
);
ALTER TABLE public.media_pricing ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.media_pricing FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.media_pricing TO service_role;

INSERT INTO public.media_pricing
(id, kind, model_id, resolution, operation, output_usd_per_second, input_usd_per_second, input_usd_per_image, free_image_references, markup, unfiltered_multiplier)
VALUES
('video:kling:720p:generate', 'video', 'kling', '720p', 'generate', 0.112, 0, 0, 0, 2, 1),
('video:kling:720p:edit', 'video', 'kling', '720p', 'edit', 0.112, 0, 0, 0, 2, 1),
('video:kling:1080p:generate', 'video', 'kling', '1080p', 'generate', 0.14, 0, 0, 0, 2, 1),
('video:kling:1080p:edit', 'video', 'kling', '1080p', 'edit', 0.14, 0, 0, 0, 2, 1),
('video:kling:4k:generate', 'video', 'kling', '4k', 'generate', 0.42, 0, 0, 0, 2, 1),
('video:kling:4k:edit', 'video', 'kling', '4k', 'edit', 0.42, 0, 0, 0, 2, 1),
('video:seedance-fast:480p:generate', 'video', 'seedance-fast', '480p', 'generate', 0.074, 0, 0, 0, 2, 1),
('video:seedance-fast:720p:generate', 'video', 'seedance-fast', '720p', 'generate', 0.161, 0, 0, 0, 2, 1),
('video:seedance-mini:480p:generate', 'video', 'seedance-mini', '480p', 'generate', 0.056, 0, 0, 0, 2, 1),
('video:seedance-mini:720p:generate', 'video', 'seedance-mini', '720p', 'generate', 0.12, 0, 0, 0, 2, 1),
('video:seedance:480p:generate', 'video', 'seedance', '480p', 'generate', 0.092, 0, 0, 0, 2, 1),
('video:seedance:720p:generate', 'video', 'seedance', '720p', 'generate', 0.199, 0, 0, 0, 2, 1),
('video:seedance:1080p:generate', 'video', 'seedance', '1080p', 'generate', 0.496, 0, 0, 0, 2, 1),
('video:seedance-2.5:480p:generate', 'video', 'seedance-2.5', '480p', 'generate', 0.275, 0, 0, 0, 2, 1.1),
('video:seedance-2.5:480p:edit', 'video', 'seedance-2.5', '480p', 'edit', 0.275, 0, 0, 0, 2, 1.1),
('video:seedance-2.5:480p:extend', 'video', 'seedance-2.5', '480p', 'extend', 0.275, 0, 0, 0, 2, 1.1),
('video:seedance-2.5:720p:generate', 'video', 'seedance-2.5', '720p', 'generate', 0.325, 0, 0, 0, 2, 1.1),
('video:seedance-2.5:720p:edit', 'video', 'seedance-2.5', '720p', 'edit', 0.325, 0, 0, 0, 2, 1.1),
('video:seedance-2.5:720p:extend', 'video', 'seedance-2.5', '720p', 'extend', 0.325, 0, 0, 0, 2, 1.1),
('video:wan-3.0:480p:generate', 'video', 'wan-3.0', '480p', 'generate', 0.03, 0, 0, 0, 2, 1),
('video:wan-3.0:720p:generate', 'video', 'wan-3.0', '720p', 'generate', 0.06, 0, 0, 0, 2, 1),
('video:wan-3.0:1080p:generate', 'video', 'wan-3.0', '1080p', 'generate', 0.12, 0, 0, 0, 2, 1),
('video:wan-3.0:2k:generate', 'video', 'wan-3.0', '2k', 'generate', 0.12, 0, 0, 0, 2, 1),
('video:wan-3.0:4k:generate', 'video', 'wan-3.0', '4k', 'generate', 0.138, 0, 0, 0, 2, 1),
('video:wan-3.0-prime:480p:generate', 'video', 'wan-3.0-prime', '480p', 'generate', 0.0476, 0, 0, 0, 2, 1),
('video:wan-3.0-prime:720p:generate', 'video', 'wan-3.0-prime', '720p', 'generate', 0.098, 0, 0, 0, 2, 1),
('video:wan-3.0-prime:1080p:generate', 'video', 'wan-3.0-prime', '1080p', 'generate', 0.196, 0, 0, 0, 2, 1),
('video:wan-3.0-prime:2k:generate', 'video', 'wan-3.0-prime', '2k', 'generate', 0.196, 0, 0, 0, 2, 1),
('video:wan-3.0-prime:4k:generate', 'video', 'wan-3.0-prime', '4k', 'generate', 0.217, 0, 0, 0, 2, 1),
('video:sync-lipsync-v3:720p:generate', 'video', 'sync-lipsync-v3', '720p', 'generate', 0.13333333333333333, 0, 0, 0, 2, 1),
('video:sync-lipsync-v3:720p:edit', 'video', 'sync-lipsync-v3', '720p', 'edit', 0.13333333333333333, 0, 0, 0, 2, 1),
('video:sync-lipsync-v3:1080p:generate', 'video', 'sync-lipsync-v3', '1080p', 'generate', 0.13333333333333333, 0, 0, 0, 2, 1),
('video:sync-lipsync-v3:1080p:edit', 'video', 'sync-lipsync-v3', '1080p', 'edit', 0.13333333333333333, 0, 0, 0, 2, 1),
('video:sync-lipsync-v3:2k:generate', 'video', 'sync-lipsync-v3', '2k', 'generate', 0.13333333333333333, 0, 0, 0, 2, 1),
('video:sync-lipsync-v3:2k:edit', 'video', 'sync-lipsync-v3', '2k', 'edit', 0.13333333333333333, 0, 0, 0, 2, 1),
('video:sync-lipsync-v3:4k:generate', 'video', 'sync-lipsync-v3', '4k', 'generate', 0.13333333333333333, 0, 0, 0, 2, 1),
('video:sync-lipsync-v3:4k:edit', 'video', 'sync-lipsync-v3', '4k', 'edit', 0.13333333333333333, 0, 0, 0, 2, 1),
('video:grok:480p:generate', 'video', 'grok', '480p', 'generate', 0.08, 0, 0.01, 0, 2, 1),
('video:grok:480p:edit', 'video', 'grok', '480p', 'edit', 0.07, 0.01, 0.01, 0, 2, 1),
('video:grok:480p:extend', 'video', 'grok', '480p', 'extend', 0.07, 0.01, 0.01, 0, 2, 1),
('video:grok:720p:generate', 'video', 'grok', '720p', 'generate', 0.14, 0, 0.01, 0, 2, 1),
('video:grok:720p:edit', 'video', 'grok', '720p', 'edit', 0.07, 0.01, 0.01, 0, 2, 1),
('video:grok:720p:extend', 'video', 'grok', '720p', 'extend', 0.07, 0.01, 0.01, 0, 2, 1),
('video:grok:1080p:generate', 'video', 'grok', '1080p', 'generate', 0.25, 0, 0.01, 0, 2, 1),
('video:grok:1080p:edit', 'video', 'grok', '1080p', 'edit', 0.07, 0.01, 0.01, 0, 2, 1),
('video:grok:1080p:extend', 'video', 'grok', '1080p', 'extend', 0.07, 0.01, 0.01, 0, 2, 1),
('video:google-omni:360p:generate', 'video', 'google-omni', '360p', 'generate', 0.0337925, 0.0083303411, 0, 0, 2, 1),
('video:google-omni:360p:edit', 'video', 'google-omni', '360p', 'edit', 0.0337925, 0.0083303411, 0, 0, 2, 1),
('video:google-omni:360p:extend', 'video', 'google-omni', '360p', 'extend', 0.0337925, 0.0083303411, 0, 0, 2, 1),
('video:google-omni:720p:generate', 'video', 'google-omni', '720p', 'generate', 0.10136, 0.0083303411, 0, 0, 2, 1),
('video:google-omni:720p:edit', 'video', 'google-omni', '720p', 'edit', 0.10136, 0.0083303411, 0, 0, 2, 1),
('video:google-omni:720p:extend', 'video', 'google-omni', '720p', 'extend', 0.10136, 0.0083303411, 0, 0, 2, 1),
('video:google-omni:1080p:generate', 'video', 'google-omni', '1080p', 'generate', 0.15204, 0.0083303411, 0, 0, 2, 1),
('video:google-omni:1080p:edit', 'video', 'google-omni', '1080p', 'edit', 0.15204, 0.0083303411, 0, 0, 2, 1),
('video:google-omni:1080p:extend', 'video', 'google-omni', '1080p', 'extend', 0.15204, 0.0083303411, 0, 0, 2, 1),
('video:google-omni:4k:generate', 'video', 'google-omni', '4k', 'generate', 0.30408, 0.0083303411, 0, 0, 2, 1),
('video:google-omni:4k:edit', 'video', 'google-omni', '4k', 'edit', 0.30408, 0.0083303411, 0, 0, 2, 1),
('video:google-omni:4k:extend', 'video', 'google-omni', '4k', 'extend', 0.30408, 0.0083303411, 0, 0, 2, 1),
('video:minimax-h3:768p:generate', 'video', 'minimax-h3', '768p', 'generate', 0.07, 0.07, 0.028, 5, 2, 1),
('video:minimax-h3:2k:generate', 'video', 'minimax-h3', '2k', 'generate', 0.112, 0.112, 0.028, 5, 2, 1),
('video:minimax-h3-max:480p:generate', 'video', 'minimax-h3-max', '480p', 'generate', 0.025, 0, 0, 0, 2, 1),
('video:minimax-h3-max:768p:generate', 'video', 'minimax-h3-max', '768p', 'generate', 0.04, 0, 0, 0, 2, 1),
('video:piapi:720p:generate', 'video', 'piapi', '720p', 'generate', 0.112, 0, 0, 0, 2, 1),
('video:piapi:1080p:generate', 'video', 'piapi', '1080p', 'generate', 0.112, 0, 0, 0, 2, 1),
('audio:evolink-seed-audio:default:generate', 'audio', 'evolink-seed-audio', 'default', 'generate', 0.0025, 0, 0, 0, 2, 1)
ON CONFLICT (id) DO NOTHING;

COMMENT ON TABLE public.media_pricing IS 'Authoritative runtime video/audio prices; service-only access via authenticated APIs. Wan Standard 60% / Prime 70% list price, confirmed 2026-09-03.';

-- MCP-only reservations; existing snapshot billing remains separate.
CREATE TABLE public.mcp_video_reservations (
  id uuid PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES auth.users(id),
  api_key_id uuid,
  tool_name text NOT NULL,
  model_id text NOT NULL,
  fingerprint text NOT NULL,
  quote jsonb NOT NULL,
  credits integer NOT NULL CHECK (credits > 0),
  task_id text UNIQUE,
  status text NOT NULL DEFAULT 'reserved' CHECK (status IN ('reserved','submitted','completed','refunded','uncertain')),
  last_checked_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.mcp_video_reservations ENABLE ROW LEVEL SECURITY;
CREATE INDEX mcp_video_reservations_poll_idx ON public.mcp_video_reservations(last_checked_at) WHERE status='submitted';
REVOKE ALL ON public.mcp_video_reservations FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE ON public.mcp_video_reservations TO service_role;

CREATE FUNCTION public.reserve_mcp_video(p_id uuid, p_user_id uuid, p_api_key_id uuid, p_tool text, p_model text, p_fingerprint text, p_quote jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path = public, pg_temp AS $$
DECLARE r public.mcp_video_reservations; created boolean;
BEGIN
  INSERT INTO public.mcp_video_reservations (id,user_id,api_key_id,tool_name,model_id,fingerprint,quote,credits)
  VALUES (p_id,p_user_id,p_api_key_id,p_tool,p_model,p_fingerprint,p_quote,(p_quote->>'credits')::integer)
  ON CONFLICT (id) DO NOTHING;
  created := FOUND;
  SELECT * INTO STRICT r FROM public.mcp_video_reservations WHERE id=p_id FOR UPDATE;
  IF r.user_id <> p_user_id OR r.fingerprint <> p_fingerprint THEN RAISE EXCEPTION 'Billing request conflict'; END IF;
  IF created THEN
    PERFORM public.deduct_and_log(p_user_id,r.credits,p_tool,p_model,NULL,NULL,NULL,'mcp',p_api_key_id);
  END IF;
  RETURN jsonb_build_object('created',created,'task_id',r.task_id,'status',r.status);
END;
$$;

CREATE FUNCTION public.finish_mcp_video_submission(p_id uuid, p_user_id uuid, p_task_id text, p_state text)
RETURNS void LANGUAGE plpgsql SECURITY INVOKER SET search_path = public, pg_temp AS $$
DECLARE r public.mcp_video_reservations;
BEGIN
  IF p_state NOT IN ('submitted','completed','uncertain','refunded') THEN RAISE EXCEPTION 'Invalid submission state'; END IF;
  SELECT * INTO STRICT r FROM public.mcp_video_reservations WHERE id=p_id AND user_id=p_user_id FOR UPDATE;
  IF r.status NOT IN ('reserved','uncertain') THEN RETURN; END IF;
  IF p_state IN ('submitted','completed') AND p_task_id IS NULL THEN RAISE EXCEPTION 'Missing provider task'; END IF;
  IF p_state='refunded' THEN
    PERFORM public.refund_credits_and_log(p_user_id,r.credits,r.tool_name,'mcp');
  END IF;
  UPDATE public.mcp_video_reservations SET status=p_state, task_id=p_task_id, updated_at=now() WHERE id=p_id;
END;
$$;

CREATE FUNCTION public.settle_mcp_video(p_user_id uuid, p_task_id text, p_failed boolean)
RETURNS void LANGUAGE plpgsql SECURITY INVOKER SET search_path = public, pg_temp AS $$
DECLARE r public.mcp_video_reservations;
BEGIN
  SELECT * INTO r FROM public.mcp_video_reservations WHERE user_id=p_user_id AND task_id=p_task_id FOR UPDATE;
  IF NOT FOUND OR r.status <> 'submitted' THEN RETURN; END IF;
  IF p_failed THEN
    PERFORM public.refund_credits_and_log(p_user_id,r.credits,r.tool_name,'mcp');
  END IF;
  UPDATE public.mcp_video_reservations SET status=CASE WHEN p_failed THEN 'refunded' ELSE 'completed' END, updated_at=now() WHERE id=r.id;
END;
$$;

REVOKE ALL ON FUNCTION public.reserve_mcp_video(uuid,uuid,uuid,text,text,text,jsonb) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.finish_mcp_video_submission(uuid,uuid,text,text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.settle_mcp_video(uuid,text,boolean) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.reserve_mcp_video(uuid,uuid,uuid,text,text,text,jsonb) TO service_role;
GRANT EXECUTE ON FUNCTION public.finish_mcp_video_submission(uuid,uuid,text,text) TO service_role;
GRANT EXECUTE ON FUNCTION public.settle_mcp_video(uuid,text,boolean) TO service_role;

-- Materialize the former code-only token defaults without changing configured prices.
INSERT INTO public.token_rates (model_id,display_name,input_per_1m,output_per_1m,cache_read_per_1m,cache_write_per_1m,markup,is_active) VALUES
('openai/gpt-image-2','GPT Image 2 (OpenRouter)',8,30,2,8,2,true),
('openai/gpt-5.6-terra','GPT-5.6 Terra (OpenRouter)',1,6,0.1,1.25,2,true),
('openai/gpt-5.6-sol','GPT-5.6 Sol (OpenRouter)',5,30,0.5,6.25,2,true),
('openai/gpt-5.6-luna','GPT-5.6 Luna (OpenRouter)',0.1,0.6,0.01,0.125,2,true),
('gpt-5.6-terra','GPT-5.6 Terra',2.5,15,0.25,3.125,2,true),
('gpt-5.6-sol','GPT-5.6 Sol',5,30,0.5,6.25,2,true),
('gpt-5.6-luna','GPT-5.6 Luna',1,6,0.1,1.25,2,true),
('x-ai/grok-4.6','Grok 4.6',2,6,0.5,0,2,true),
('deepseek/deepseek-v4-pro','DeepSeek V4 Pro',0.435,0.87,0.003625,0,2,true),
('gemini-3-flash-preview','Gemini 3 Flash Preview',0.5,3,0.05,0.5,2,true)
ON CONFLICT (model_id) DO NOTHING;

-- Only the still-active image fallback needs an action price. Existing Admin
-- edits (including the older 20-credit price) are preserved for explicit review.
INSERT INTO public.credit_pricing(tool_name,supplier_cost,credits,is_free)
VALUES ('edit_image_openai',0.02,4,false)
ON CONFLICT (tool_name) DO NOTHING;
