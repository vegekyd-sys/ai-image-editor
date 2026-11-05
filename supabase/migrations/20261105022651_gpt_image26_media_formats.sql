-- Preserve existing restrictions while allowing GPT Image 2.6 original animation/vector results.
-- Generated SVG is validated against static SVG content before storage; render it as <img>, never inline HTML.
UPDATE storage.buckets
SET allowed_mime_types = ARRAY(
  SELECT DISTINCT mime FROM unnest(allowed_mime_types || ARRAY['image/gif', 'image/svg+xml']) AS mime
)
WHERE id = 'images' AND allowed_mime_types IS NOT NULL;
