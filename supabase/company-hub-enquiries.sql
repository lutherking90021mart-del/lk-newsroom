-- LK Newsroom Company Hub: private enquiries and public staff profiles.
-- Run once in Supabase SQL Editor. Does not alter existing newsroom data.

create table if not exists public.company_enquiries (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  email text not null,
  topic text not null default 'General enquiry',
  message text not null,
  status text not null default 'new' check (status in ('new','in_progress','resolved','spam')),
  admin_notes text,
  handled_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists company_enquiries_status_created_idx on public.company_enquiries(status,created_at desc);
alter table public.company_enquiries enable row level security;
revoke all on public.company_enquiries from anon,authenticated;
grant all on public.company_enquiries to service_role;

create table if not exists public.company_staff_profiles (
  id uuid primary key default gen_random_uuid(),
  full_name text not null,
  job_title text not null,
  work_email text,
  work_phone text,
  photo_url text,
  biography text,
  sort_order integer not null default 100,
  is_published boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists company_staff_profiles_public_order_idx on public.company_staff_profiles(is_published,sort_order,full_name);
alter table public.company_staff_profiles enable row level security;
revoke all on public.company_staff_profiles from anon,authenticated;
grant all on public.company_staff_profiles to service_role;
