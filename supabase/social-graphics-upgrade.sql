-- LK Newsroom branded social graphics.
-- Run after schema.sql, live-news.sql, and social-media-automation.sql.

create table if not exists public.social_templates (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique,
  name text not null,
  category_slug text not null default 'latest',
  accent_color text not null default '#E31E24',
  background_color text not null default '#003366',
  font_family text not null default 'Arial, Helvetica, sans-serif',
  background_url text,
  text_position jsonb not null default '{}'::jsonb,
  enabled boolean not null default true,
  is_default boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.social_graphics (
  id uuid primary key default gen_random_uuid(),
  article_id uuid not null unique references public.articles(id) on delete cascade,
  template_id uuid references public.social_templates(id) on delete set null,
  source_image_url text,
  assets jsonb not null default '{}'::jsonb,
  generated_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists social_templates_category_idx on public.social_templates(category_slug, enabled, is_default);
create index if not exists social_graphics_generated_idx on public.social_graphics(generated_at desc);

insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values ('social-graphics','social-graphics',true,5242880,array['image/svg+xml'])
on conflict(id) do update set public=true, file_size_limit=excluded.file_size_limit, allowed_mime_types=excluded.allowed_mime_types;

drop trigger if exists set_social_templates_updated_at on public.social_templates;
create trigger set_social_templates_updated_at before update on public.social_templates for each row execute function public.set_updated_at();
drop trigger if exists set_social_graphics_updated_at on public.social_graphics;
create trigger set_social_graphics_updated_at before update on public.social_graphics for each row execute function public.set_updated_at();

alter table public.social_templates enable row level security;
alter table public.social_graphics enable row level security;
drop policy if exists "staff manage social templates" on public.social_templates;
create policy "staff manage social templates" on public.social_templates for all using(public.is_staff()) with check(public.is_staff());
drop policy if exists "staff view social graphics" on public.social_graphics;
create policy "staff view social graphics" on public.social_graphics for select using(public.is_staff());

drop policy if exists "public social graphics read" on storage.objects;
create policy "public social graphics read" on storage.objects for select using(bucket_id='social-graphics');

insert into public.social_templates(slug,name,category_slug,accent_color,background_color,font_family) values
 ('breaking-news','Breaking News','breaking','#E31E24','#003366','Arial, Helvetica, sans-serif'),
 ('latest-news','Latest News','latest','#E31E24','#003366','Arial, Helvetica, sans-serif'),
 ('sports','Sports','sports','#0B8A5A','#003366','Arial, Helvetica, sans-serif'),
 ('politics','Politics','politics','#0057B8','#003366','Arial, Helvetica, sans-serif'),
 ('business','Business','business','#7B3F61','#003366','Arial, Helvetica, sans-serif'),
 ('technology','Technology','technology','#008CA8','#003366','Arial, Helvetica, sans-serif'),
 ('entertainment','Entertainment','entertainment','#A54278','#003366','Arial, Helvetica, sans-serif'),
 ('health','Health','health','#008A6A','#003366','Arial, Helvetica, sans-serif'),
 ('education','Education','education','#B56A12','#003366','Arial, Helvetica, sans-serif'),
 ('world','World','world','#4A6DDC','#003366','Arial, Helvetica, sans-serif'),
 ('africa','Africa','africa','#C99022','#003366','Arial, Helvetica, sans-serif'),
 ('ghana','Ghana','ghana','#CE1126','#003366','Arial, Helvetica, sans-serif')
on conflict(slug) do nothing;

-- Optional live updates in the Social Media Templates page:
-- alter publication supabase_realtime add table public.social_templates, public.social_graphics;
