-- Purge the cdn.makaron.app R2/edge copy when a public media object is
-- overwritten (upsert) or deleted. NOT a migration: apply manually, once,
-- after the Worker is live on cdn.makaron.app and the secret is in Vault.
--
-- Prerequisites:
--   create extension if not exists pg_net;
--   select vault.create_secret('<same value as Worker PURGE_SECRET>', 'r2c_purge_secret');
--
-- Inserts of brand-new paths need nothing: the Worker caches on first read.
-- The Worker also re-checks every R2 copy against Supabase after 10 minutes,
-- so this trigger only shortens the overwrite window from minutes to seconds.

create or replace function public.r2c_purge_media_object()
returns trigger
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  obj record := coalesce(old, new);
  secret text;
begin
  if obj.bucket_id <> 'images'
     or obj.name !~* '\.(mp4|m4v|mov|webm|mp3|wav|m4a|aac|ogg|oga|opus|flac|jpe?g|png|webp|gif|avif)$' then
    return null;
  end if;
  -- An UPDATE that does not change the content version needs no purge.
  if tg_op = 'UPDATE' and new.metadata->>'eTag' is not distinct from old.metadata->>'eTag' then
    return null;
  end if;
  select decrypted_secret into secret from vault.decrypted_secrets where name = 'r2c_purge_secret' limit 1;
  if secret is null then
    return null;
  end if;
  perform net.http_post(
    url := 'https://cdn.makaron.app/__r2c/purge',
    headers := jsonb_build_object('authorization', 'Bearer ' || secret, 'content-type', 'application/json'),
    body := jsonb_build_object('paths', jsonb_build_array(obj.bucket_id || '/' || obj.name)),
    timeout_milliseconds := 5000
  );
  return null;
exception when others then
  -- Never block a Storage write because the cache purge failed.
  return null;
end;
$$;

drop trigger if exists r2c_purge_media_object on storage.objects;
create trigger r2c_purge_media_object
after update or delete on storage.objects
for each row execute function public.r2c_purge_media_object();

-- Rollback:
--   drop trigger if exists r2c_purge_media_object on storage.objects;
--   drop function if exists public.r2c_purge_media_object();
