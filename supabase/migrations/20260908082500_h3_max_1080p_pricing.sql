-- Add 1080p without changing existing resolution tariffs or operator overrides.
-- fal model page (2026-09-08): $0.16/output second, 768p latent refinement.
-- Request 01a08014-5cc7-73e3-a4b1-21c513a310cc: 5s output + 5.184s video
-- reference billed $0.80 total in fal Billing events; no video-reference surcharge.
-- Image/audio token terms follow the published rate card. Recheck on provider changes.
INSERT INTO public.media_pricing
(id,kind,model_id,resolution,operation,output_usd_per_second,input_usd_per_1k_tokens,free_input_tokens,input_tokens_per_image_pixel,input_tokens_per_video_second,input_tokens_per_audio_second)
VALUES
('video:fal-h3-max:1080p:generate','video','fal-h3-max','1080p','generate',0.16,0.02,4096,0.0009765625,0,80)
ON CONFLICT (id) DO NOTHING;
