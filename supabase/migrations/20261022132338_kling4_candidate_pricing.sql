-- Apply with the authorized Kling 4 release; additive and backward compatible.
-- EvoLink rate card checked 2026-10-22: https://evolink.ai/kling-4
-- Flash intentionally has no price row until its own callable contract is verified.
INSERT INTO public.media_pricing
(id,kind,model_id,resolution,operation,output_usd_per_second,video_reference_usd_per_second)
VALUES
('video:kling-4:720p:generate','video','kling-4','720p','generate',0.157,0.094),
('video:kling-4:1080p:generate','video','kling-4','1080p','generate',0.235,0.141),
('video:kling-4:720p:edit','video','kling-4','720p','edit',0.157,0.094),
('video:kling-4:1080p:edit','video','kling-4','1080p','edit',0.235,0.141)
ON CONFLICT (id) DO NOTHING;
