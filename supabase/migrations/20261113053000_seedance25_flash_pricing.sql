-- Additive candidate setup, also safe on release; preserve existing admin prices.
-- EvoLink rate card observed2026-11-13: https://evolink.ai/seedance-2-5-flash
-- No video: output seconds x .12/.24. With video: (output+max(ceil(ref),output)) x .075/.15.
-- Edit:2*ceil(source) x .075/.15. Audio included; no relaxed-filter premium.
INSERT INTO public.media_pricing
(id,kind,model_id,resolution,operation,output_usd_per_second,video_reference_usd_per_second,unfiltered_multiplier)
VALUES
('video:seedance-2.5-flash:480p:generate','video','seedance-2.5-flash','480p','generate',.12,.075,1),
('video:seedance-2.5-flash:720p:generate','video','seedance-2.5-flash','720p','generate',.24,.15,1),
('video:seedance-2.5-flash:480p:edit','video','seedance-2.5-flash','480p','edit',.12,.075,1),
('video:seedance-2.5-flash:720p:edit','video','seedance-2.5-flash','720p','edit',.24,.15,1)
ON CONFLICT (id) DO NOTHING;
