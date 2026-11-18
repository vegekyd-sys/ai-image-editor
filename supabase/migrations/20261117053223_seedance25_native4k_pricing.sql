-- Candidate only: do not apply to shared Preview/Production without release approval.
-- EvoLink actual product/API/changelog read2026-11-17; https://evolink.ai/seedance-2-5
-- Native generation, not Eco. USD rates use published rounded rate card.
-- Video references bill output+max(total input,output); audio included; relaxed filter+10%.
-- Additive rows preserve all existing/operator tariffs and default policies.
INSERT INTO public.media_pricing
(id,kind,model_id,resolution,operation,output_usd_per_second,video_reference_usd_per_second,unfiltered_multiplier)
VALUES
('video:seedance-2.5:1080p:generate','video','seedance-2.5','1080p','generate',0.739,0.450,1.1),
('video:seedance-2.5:1080p:edit','video','seedance-2.5','1080p','edit',0.739,0.450,1.1),
('video:seedance-2.5:1080p:extend','video','seedance-2.5','1080p','extend',0.739,0.450,1.1),
('video:seedance-2.5:4k:generate','video','seedance-2.5','4k','generate',1.182,0.724,1.1),
('video:seedance-2.5:4k:edit','video','seedance-2.5','4k','edit',1.182,0.724,1.1),
('video:seedance-2.5:4k:extend','video','seedance-2.5','4k','extend',1.182,0.724,1.1)
ON CONFLICT (id) DO NOTHING;
