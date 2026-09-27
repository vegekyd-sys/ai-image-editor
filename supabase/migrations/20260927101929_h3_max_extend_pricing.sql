-- H3 Max Extend bills new footage plus reference-video tokens. Seed only;
-- retain any operator-edited rows. The 1080p route stays disabled until its
-- reference token rate is verified with a provider invoice.
INSERT INTO public.media_pricing
(id,kind,model_id,resolution,operation,output_usd_per_second,input_usd_per_1k_tokens,free_input_tokens,input_tokens_per_video_second)
VALUES
('video:fal-h3-max:480p:extend','video','fal-h3-max','480p','extend',0.05,0.02,4096,2886),
('video:fal-h3-max:768p:extend','video','fal-h3-max','768p','extend',0.08,0.02,4096,7459.2)
ON CONFLICT (id) DO NOTHING;
