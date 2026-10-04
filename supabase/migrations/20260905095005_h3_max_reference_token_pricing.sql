-- Additive reference-token tariffs. Old model IDs and operator prices remain unchanged.
ALTER TABLE public.media_pricing
  ADD COLUMN input_usd_per_1k_tokens numeric NOT NULL DEFAULT 0 CHECK (input_usd_per_1k_tokens >= 0),
  ADD COLUMN free_input_tokens numeric NOT NULL DEFAULT 0 CHECK (free_input_tokens >= 0),
  ADD COLUMN input_tokens_per_image_pixel numeric NOT NULL DEFAULT 0 CHECK (input_tokens_per_image_pixel >= 0),
  ADD COLUMN input_tokens_per_video_second numeric NOT NULL DEFAULT 0 CHECK (input_tokens_per_video_second >= 0),
  ADD COLUMN input_tokens_per_audio_second numeric NOT NULL DEFAULT 0 CHECK (input_tokens_per_audio_second >= 0);

INSERT INTO public.media_pricing
(id,kind,model_id,resolution,operation,output_usd_per_second,input_usd_per_1k_tokens,free_input_tokens,input_tokens_per_image_pixel,input_tokens_per_video_second,input_tokens_per_audio_second)
VALUES
('video:fal-h3-max:480p:generate','video','fal-h3-max','480p','generate',0.05,0.02,4096,0.0009765625,2886,80),
('video:fal-h3-max:768p:generate','video','fal-h3-max','768p','generate',0.08,0.02,4096,0.0009765625,7459.2,80)
ON CONFLICT (id) DO NOTHING;
