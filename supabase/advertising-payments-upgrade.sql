-- LK Newsroom advertiser payment workflow.
-- Run this once in Supabase SQL Editor after monetization-suite-upgrade.sql.
-- Safe to re-run: the constraint, column and index changes are idempotent.

alter table public.payment_transactions
  drop constraint if exists payment_transactions_kind_check;

alter table public.payment_transactions
  add constraint payment_transactions_kind_check
  check (kind in ('donation','subscription','advertising'));

alter table public.payment_transactions
  add column if not exists advertiser_request_id uuid
  references public.advertiser_requests(id) on delete set null;

create index if not exists payment_transactions_advertiser_request_idx
  on public.payment_transactions(advertiser_request_id, created_at desc);
