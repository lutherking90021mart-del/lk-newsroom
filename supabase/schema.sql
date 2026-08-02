-- LK Newsroom: run this entire file in the Supabase SQL editor.
-- It creates the CMS data model, secure row-level policies and media buckets.
create extension if not exists pgcrypto;

do $$ begin
  create type public.app_role as enum ('super_admin','admin','editor','journalist','moderator');
exception when duplicate_object then null; end $$;

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  full_name text not null default '', avatar_url text, bio text,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create table if not exists public.users_roles (
  user_id uuid primary key references public.profiles(id) on delete cascade,
  role public.app_role not null default 'journalist', assigned_at timestamptz not null default now()
);
create table if not exists public.categories (
  id uuid primary key default gen_random_uuid(), name text not null unique, slug text not null unique,
  description text, colour text default '#0057B8', created_at timestamptz not null default now()
);
create table if not exists public.tags (
  id uuid primary key default gen_random_uuid(), name text not null unique, slug text not null unique,
  created_at timestamptz not null default now()
);
create table if not exists public.articles (
  id uuid primary key default gen_random_uuid(), author_id uuid references public.profiles(id) on delete set null,
  category_id uuid references public.categories(id) on delete set null, title text not null,
  slug text not null unique, excerpt text, content text, content_markdown text, featured_image_url text,
  status text not null default 'draft' check (status in ('draft','scheduled','published','archived')),
  featured boolean not null default false, breaking boolean not null default false,
  allow_comments boolean not null default true, scheduled_at timestamptz, published_at timestamptz,
  meta_title text, meta_description text, canonical_url text, view_count bigint not null default 0,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create index if not exists articles_status_published_idx on public.articles(status,published_at desc);
create index if not exists articles_category_published_idx on public.articles(category_id,published_at desc);
create table if not exists public.article_tags (
  article_id uuid references public.articles(id) on delete cascade,
  tag_id uuid references public.tags(id) on delete cascade, primary key(article_id,tag_id)
);
create table if not exists public.comments (
  id uuid primary key default gen_random_uuid(), article_id uuid not null references public.articles(id) on delete cascade,
  user_id uuid references auth.users(id) on delete set null, parent_id uuid references public.comments(id) on delete cascade,
  display_name text, body text not null check (char_length(body) between 1 and 5000),
  status text not null default 'pending' check(status in ('pending','approved','spam','rejected')),
  created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create index if not exists comments_article_status_idx on public.comments(article_id,status,created_at desc);
create table if not exists public.newsletter (
  id uuid primary key default gen_random_uuid(), email text not null unique,
  status text not null default 'subscribed' check(status in ('subscribed','unsubscribed')),
  source text default 'website', created_at timestamptz not null default now(), unsubscribed_at timestamptz
);
create table if not exists public.videos (
  id uuid primary key default gen_random_uuid(), title text not null, slug text not null unique,
  description text, video_url text, thumbnail_url text, youtube_url text, duration_seconds integer,
  article_id uuid references public.articles(id) on delete set null, status text not null default 'draft' check(status in ('draft','published','archived')),
  published_at timestamptz, created_by uuid references public.profiles(id) on delete set null, created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create table if not exists public.gallery (
  id uuid primary key default gen_random_uuid(), title text not null, caption text, image_url text not null,
  alt_text text, article_id uuid references public.articles(id) on delete set null, photographer_id uuid references public.profiles(id) on delete set null,
  status text not null default 'draft' check(status in ('draft','published','archived')), sort_order integer not null default 0,
  published_at timestamptz, created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create table if not exists public.advertisements (
  id uuid primary key default gen_random_uuid(), name text not null, placement text not null,
  image_url text, target_url text, html_content text, starts_at timestamptz, ends_at timestamptz,
  active boolean not null default true, impressions bigint not null default 0, clicks bigint not null default 0,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create table if not exists public.breaking_news (
  id uuid primary key default gen_random_uuid(), headline text not null, link_url text,
  active boolean not null default true, pinned boolean not null default false, starts_at timestamptz not null default now(),
  ends_at timestamptz, created_by uuid references public.profiles(id) on delete set null, created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create table if not exists public.settings (
  key text primary key, value jsonb not null default '{}'::jsonb, is_public boolean not null default false,
  updated_by uuid references public.profiles(id) on delete set null, updated_at timestamptz not null default now()
);
create table if not exists public.page_views (
  id bigint generated always as identity primary key, article_id uuid references public.articles(id) on delete cascade,
  path text not null, visitor_hash text, referrer text, viewed_at timestamptz not null default now()
);
create index if not exists page_views_article_viewed_idx on public.page_views(article_id,viewed_at desc);
create table if not exists public.bookmarks (
  user_id uuid references auth.users(id) on delete cascade, article_id uuid references public.articles(id) on delete cascade,
  created_at timestamptz not null default now(), primary key(user_id,article_id)
);
create table if not exists public.article_likes (
  user_id uuid references auth.users(id) on delete cascade, article_id uuid references public.articles(id) on delete cascade,
  created_at timestamptz not null default now(), primary key(user_id,article_id)
);

-- Keep profile and editorial timestamps accurate.
create or replace function public.set_updated_at() returns trigger language plpgsql as $$ begin new.updated_at=now(); return new; end; $$;
do $$ declare tbl text; begin
  foreach tbl in array array['profiles','articles','comments','videos','gallery','advertisements','breaking_news'] loop
    execute format('drop trigger if exists set_%I_updated_at on public.%I',tbl,tbl);
    execute format('create trigger set_%I_updated_at before update on public.%I for each row execute function public.set_updated_at()',tbl,tbl);
  end loop;
end $$;
create or replace function public.handle_new_user() returns trigger language plpgsql security definer set search_path=public as $$
begin insert into public.profiles(id,full_name,avatar_url) values(new.id,coalesce(new.raw_user_meta_data->>'full_name',''),new.raw_user_meta_data->>'avatar_url') on conflict(id) do nothing; return new; end; $$;
drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created after insert on auth.users for each row execute procedure public.handle_new_user();

-- Role helper keeps policy expressions compact. Do not expose service role credentials in the browser.
create or replace function public.is_staff() returns boolean language sql stable security definer set search_path=public as $$
  select exists(select 1 from public.users_roles where user_id=auth.uid())
$$;
create or replace function public.is_editorial_staff() returns boolean language sql stable security definer set search_path=public as $$
  select exists(select 1 from public.users_roles where user_id=auth.uid() and role in ('super_admin','admin','editor','journalist'))
$$;
create or replace function public.is_super_admin() returns boolean language sql stable security definer set search_path=public as $$
  select exists(select 1 from public.users_roles where user_id=auth.uid() and role='super_admin')
$$;
create or replace function public.increment_article_views(article_uuid uuid) returns void language sql security definer set search_path=public as $$
  update public.articles set view_count=view_count+1 where id=article_uuid and status='published'
$$;
grant execute on function public.increment_article_views(uuid) to anon, authenticated;
create or replace function public.record_ad_impression(ad_uuid uuid) returns void language plpgsql security definer set search_path=public as $$
begin
  update public.advertisements set impressions=impressions+1 where id=ad_uuid and active=true and (starts_at is null or starts_at<=now()) and (ends_at is null or ends_at>=now());
end;
$$;
create or replace function public.record_ad_click(ad_uuid uuid) returns void language plpgsql security definer set search_path=public as $$
begin
  update public.advertisements set clicks=clicks+1 where id=ad_uuid and active=true and (starts_at is null or starts_at<=now()) and (ends_at is null or ends_at>=now());
end;
$$;
grant execute on function public.record_ad_impression(uuid) to anon, authenticated;
grant execute on function public.record_ad_click(uuid) to anon, authenticated;

-- Enable RLS before adding policies.
alter table public.profiles enable row level security; alter table public.users_roles enable row level security;
alter table public.categories enable row level security; alter table public.tags enable row level security;
alter table public.articles enable row level security; alter table public.article_tags enable row level security;
alter table public.comments enable row level security; alter table public.newsletter enable row level security;
alter table public.videos enable row level security; alter table public.gallery enable row level security;
alter table public.advertisements enable row level security; alter table public.breaking_news enable row level security;
alter table public.settings enable row level security; alter table public.page_views enable row level security;
alter table public.bookmarks enable row level security; alter table public.article_likes enable row level security;

drop policy if exists "profiles public read" on public.profiles; create policy "profiles public read" on public.profiles for select using (true);
drop policy if exists "profiles update self" on public.profiles; create policy "profiles update self" on public.profiles for update using (id=auth.uid()) with check(id=auth.uid());
drop policy if exists "roles view own" on public.users_roles; create policy "roles view own" on public.users_roles for select using(user_id=auth.uid() or public.is_staff());
drop policy if exists "roles super admin manage" on public.users_roles; create policy "roles super admin manage" on public.users_roles for all using(public.is_super_admin()) with check(public.is_super_admin());
drop policy if exists "category public read" on public.categories; create policy "category public read" on public.categories for select using(true);
drop policy if exists "category staff write" on public.categories; create policy "category staff write" on public.categories for all using(public.is_staff()) with check(public.is_staff());
drop policy if exists "tag public read" on public.tags; create policy "tag public read" on public.tags for select using(true);
drop policy if exists "tag staff write" on public.tags; create policy "tag staff write" on public.tags for all using(public.is_staff()) with check(public.is_staff());
drop policy if exists "published articles read" on public.articles; create policy "published articles read" on public.articles for select using((status='published' and published_at<=now()) or public.is_staff());
drop policy if exists "authors create articles" on public.articles; create policy "authors create articles" on public.articles for insert with check(public.is_editorial_staff() and author_id=auth.uid());
drop policy if exists "authors update own articles" on public.articles; create policy "authors update own articles" on public.articles for update using(public.is_staff() or author_id=auth.uid()) with check(public.is_editorial_staff());
drop policy if exists "staff delete articles" on public.articles; create policy "staff delete articles" on public.articles for delete using(public.is_staff());
drop policy if exists "article tags public read" on public.article_tags; create policy "article tags public read" on public.article_tags for select using(true);
drop policy if exists "article tags staff write" on public.article_tags; create policy "article tags staff write" on public.article_tags for all using(public.is_editorial_staff()) with check(public.is_editorial_staff());
drop policy if exists "approved comments public read" on public.comments; create policy "approved comments public read" on public.comments for select using(status='approved' or public.is_staff() or user_id=auth.uid());
drop policy if exists "users add comments" on public.comments; create policy "users add comments" on public.comments for insert with check((auth.uid() is not null and user_id=auth.uid()) or (auth.uid() is null and display_name is not null));
drop policy if exists "staff moderate comments" on public.comments; create policy "staff moderate comments" on public.comments for update using(public.is_staff()) with check(public.is_staff());
drop policy if exists "staff delete comments" on public.comments; create policy "staff delete comments" on public.comments for delete using(public.is_staff());
drop policy if exists "subscribe newsletter" on public.newsletter; create policy "subscribe newsletter" on public.newsletter for insert with check(status='subscribed');
drop policy if exists "staff newsletter access" on public.newsletter; create policy "staff newsletter access" on public.newsletter for select using(public.is_staff());
drop policy if exists "staff newsletter update" on public.newsletter; create policy "staff newsletter update" on public.newsletter for update using(public.is_staff()) with check(public.is_staff());
drop policy if exists "public videos read" on public.videos; create policy "public videos read" on public.videos for select using(status='published' or public.is_staff());
drop policy if exists "staff video write" on public.videos; create policy "staff video write" on public.videos for all using(public.is_editorial_staff()) with check(public.is_editorial_staff());
drop policy if exists "public gallery read" on public.gallery; create policy "public gallery read" on public.gallery for select using(status='published' or public.is_staff());
drop policy if exists "staff gallery write" on public.gallery; create policy "staff gallery write" on public.gallery for all using(public.is_editorial_staff()) with check(public.is_editorial_staff());
drop policy if exists "public active ads read" on public.advertisements; create policy "public active ads read" on public.advertisements for select using(active and (starts_at is null or starts_at<=now()) and (ends_at is null or ends_at>=now()) or public.is_staff());
drop policy if exists "staff ads write" on public.advertisements; create policy "staff ads write" on public.advertisements for all using(public.is_staff()) with check(public.is_staff());
drop policy if exists "public active breaking read" on public.breaking_news; create policy "public active breaking read" on public.breaking_news for select using((active and (ends_at is null or ends_at>now())) or public.is_staff());
drop policy if exists "staff breaking write" on public.breaking_news; create policy "staff breaking write" on public.breaking_news for all using(public.is_editorial_staff()) with check(public.is_editorial_staff());
drop policy if exists "public settings read" on public.settings; create policy "public settings read" on public.settings for select using(is_public or public.is_staff());
drop policy if exists "staff settings write" on public.settings; create policy "staff settings write" on public.settings for all using(public.is_staff()) with check(public.is_staff());
drop policy if exists "insert page views" on public.page_views; create policy "insert page views" on public.page_views for insert with check(true);
drop policy if exists "staff view analytics" on public.page_views; create policy "staff view analytics" on public.page_views for select using(public.is_staff());
drop policy if exists "manage own bookmarks" on public.bookmarks; create policy "manage own bookmarks" on public.bookmarks for all using(user_id=auth.uid()) with check(user_id=auth.uid());
drop policy if exists "read own likes" on public.article_likes; create policy "read own likes" on public.article_likes for select using(user_id=auth.uid());
drop policy if exists "manage own likes" on public.article_likes; create policy "manage own likes" on public.article_likes for insert with check(user_id=auth.uid());
drop policy if exists "delete own likes" on public.article_likes; create policy "delete own likes" on public.article_likes for delete using(user_id=auth.uid());

-- Storage buckets and policies (make video bucket private; use signed URLs when serving restricted video).
insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types) values
 ('news-images','news-images',true,10485760,array['image/jpeg','image/png','image/webp']),
 ('videos','videos',false,524288000,array['video/mp4','video/webm']),
 ('gallery','gallery',true,10485760,array['image/jpeg','image/png','image/webp']),
 ('avatars','avatars',true,5242880,array['image/jpeg','image/png','image/webp']),
 ('documents','documents',false,20971520,array['application/pdf','application/msword','application/vnd.openxmlformats-officedocument.wordprocessingml.document'])
on conflict(id) do nothing;
drop policy if exists "public media read" on storage.objects; create policy "public media read" on storage.objects for select using(bucket_id in ('news-images','gallery','avatars'));
drop policy if exists "staff media insert" on storage.objects; create policy "staff media insert" on storage.objects for insert with check(bucket_id in ('news-images','videos','gallery','avatars','documents') and public.is_editorial_staff());
drop policy if exists "staff media update" on storage.objects; create policy "staff media update" on storage.objects for update using(public.is_editorial_staff()) with check(public.is_editorial_staff());
drop policy if exists "staff media delete" on storage.objects; create policy "staff media delete" on storage.objects for delete using(public.is_editorial_staff());

-- Seed the core newsroom sections.
insert into public.categories(name,slug,colour) values
 ('Politics','politics','#003366'),('Business','business','#0057B8'),('Technology','technology','#0057B8'),('Entertainment','entertainment','#8b3f5e'),('Sports','sports','#12607d'),('Health','health','#0d7c66'),('Education','education','#7a5210'),('Africa','africa','#0057B8'),('World','world','#003366'),('Opinion','opinion','#4d3d88')
on conflict(slug) do nothing;

-- Optional: add these tables to Supabase Realtime in Database > Replication:
-- articles, comments, breaking_news. (Run ALTER PUBLICATION there if required by your project.)
