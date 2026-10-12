-- LK Newsroom Company Hub: private enquiry inbox.
-- Run once in Supabase SQL Editor. Does not modify existing tables or records.

create table if not exists public.company_enquiries (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  email text not null,
  topic text not null default 'General enquiry',
  message text not null,
  status text not null default 'new'
    check (status in ('new','in_progress','resolved','spam')),
  admin_notes text,
  handled_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists company_enquiries_status_created_idx
  on public.company_enquiries(status, created_at desc);

alter table public.company_enquiries enable row level security;

-- Intentionally no anon/authenticated table policies: all access goes through
-- the server using the service role, and admin endpoints require newsroom staff.
revoke all on public.company_enquiries from anon, authenticated;
grant all on public.company_enquiries to service_role;
