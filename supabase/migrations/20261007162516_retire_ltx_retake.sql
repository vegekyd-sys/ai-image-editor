-- Retire the rejected candidate; historical completed receipts remain readable.
UPDATE public.media_pricing SET is_active = false
WHERE id = 'video:ltx-2.3-retake:720p:edit' AND model_id = 'ltx-2.3-retake';
