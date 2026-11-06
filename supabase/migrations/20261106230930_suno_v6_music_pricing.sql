-- Suno V6 instrumental BGM through sunoapi.org.
-- Billed per generation, independent of duration: 12 sunoapi credits x $0.005 = $0.06,
-- and each generation returns 2 takes. For operation = 'generation',
-- output_usd_per_second stores USD per generation (quantity = generations).
-- Measured on 2026-11-06: the balance went from 830 to 806 over two V6 calls.
INSERT INTO public.media_pricing(id,kind,model_id,resolution,operation,output_usd_per_second,input_usd_per_second,input_usd_per_image,free_image_references,markup,unfiltered_multiplier)
VALUES
('audio:suno-v6:default:generation','audio','suno-v6','default','generation',0.06,0,0,0,2,1)
ON CONFLICT(id) DO NOTHING;
