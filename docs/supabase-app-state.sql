create table if not exists public.app_state (
  key text primary key,
  value jsonb not null default '[]'::jsonb,
  updated_at timestamp with time zone not null default now()
);

alter table public.app_state enable row level security;

revoke all on table public.app_state from anon, authenticated;
grant select, insert, update, delete on table public.app_state to service_role;

drop policy if exists "Service role can manage NeuroProof app state" on public.app_state;
create policy "Service role can manage NeuroProof app state"
on public.app_state
for all
to service_role
using (true)
with check (true);

comment on table public.app_state is 'Server-only JSONB state store for NeuroProof prototype metadata.';
comment on column public.app_state.key is 'Logical state document name, e.g. records, ledger, audit-log.';
comment on column public.app_state.value is 'JSON document replacing the prior data/*.json files.';
