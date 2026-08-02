-- LK Newsroom CMS upgrade: run this once in Supabase SQL Editor.
-- It enables safe, public increment-only advertisement analytics.

create or replace function public.record_ad_impression(ad_uuid uuid)
returns void language plpgsql security definer set search_path=public as $$
begin
  update public.advertisements
  set impressions=impressions+1
  where id=ad_uuid
    and active=true
    and (starts_at is null or starts_at<=now())
    and (ends_at is null or ends_at>=now());
end;
$$;

create or replace function public.record_ad_click(ad_uuid uuid)
returns void language plpgsql security definer set search_path=public as $$
begin
  update public.advertisements
  set clicks=clicks+1
  where id=ad_uuid
    and active=true
    and (starts_at is null or starts_at<=now())
    and (ends_at is null or ends_at>=now());
end;
$$;

grant execute on function public.record_ad_impression(uuid) to anon, authenticated;
grant execute on function public.record_ad_click(uuid) to anon, authenticated;
