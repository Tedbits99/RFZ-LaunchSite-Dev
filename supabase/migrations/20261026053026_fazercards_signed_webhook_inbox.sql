-- Already applied to development Supabase project ketdhcmwowzztcdlmris.
create table if not exists public.fazercards_webhook_events (
 id uuid primary key default gen_random_uuid(),
 event_id text not null unique check (length(event_id) between 8 and 128),
 event_type text not null check (length(event_type) between 3 and 80),
 supplier_reference text check (length(supplier_reference) <= 160),
 supplier_status text check (length(supplier_status) <= 64),
 previous_status text check (length(previous_status) <= 64),
 occurred_at timestamptz,
 received_at timestamptz not null default now(),
 linked_order_id uuid references public.orders(id) on delete set null,
 processing_status text not null default 'received'
   check (processing_status in ('received','not_linked','observed','reconciled','error')),
 last_error_code text check (length(last_error_code) <= 100)
);
create index if not exists fazercards_webhook_events_received_idx
  on public.fazercards_webhook_events (received_at desc);
create index if not exists fazercards_webhook_events_reference_idx
  on public.fazercards_webhook_events (supplier_reference, received_at desc);

alter table public.fazercards_webhook_events enable row level security;
revoke all on public.fazercards_webhook_events from anon, authenticated;
grant select on public.fazercards_webhook_events to authenticated;
grant select, insert, update on public.fazercards_webhook_events to service_role;

create policy "Active authorized admins can view FazerCards event summaries"
 on public.fazercards_webhook_events for select to authenticated
 using (exists (
  select 1 from public.admins a
  where a.id = (select auth.uid())
    and a.is_active is true
    and a.role in ('ADMIN', 'SUPER_ADMIN')
    and lower(a.email) = lower(coalesce((select auth.jwt() ->> 'email'), ''))
 ));

create or replace function public.fazercards_webhook_notify_admins()
returns trigger
language plpgsql security definer
set search_path = pg_catalog, public
as $$
begin
 insert into public.notifications (email, type, title, body, is_read)
 select a.email, 'supplier_order',
   case
    when new.event_type = 'webhook.test' then 'FazerCards webhook test'
    when new.event_type like 'manual_service.chat.%' then 'FazerCards supplier message'
    when new.event_type = 'order.created' then 'FazerCards order created'
    else 'FazerCards order updated'
   end,
   left(
     'Supplier order ' || coalesce(new.supplier_reference, 'unknown') ||
     ' · ' || coalesce(new.supplier_status, new.event_type), 350
   ), false
 from public.admins a where a.is_active is true and a.role in ('ADMIN','SUPER_ADMIN');
 return new;
end
$$;
revoke all on function public.fazercards_webhook_notify_admins() from public, anon, authenticated;

create trigger fazercards_webhook_notify_admins_after_insert
 after insert on public.fazercards_webhook_events
 for each row execute function public.fazercards_webhook_notify_admins();

do $$
begin
 if exists(select 1 from pg_publication where pubname = 'supabase_realtime')
 and not exists (
   select 1 from pg_publication_tables
   where pubname='supabase_realtime' and schemaname='public'
   and tablename='fazercards_webhook_events'
 ) then
   alter publication supabase_realtime add table public.fazercards_webhook_events;
 end if;
end
$$;
