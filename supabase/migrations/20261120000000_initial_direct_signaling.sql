-- VoiceLink direct Supabase signaling: initial isolated schema.
-- TEST ONLY: review and apply manually to the Supabase project after checking the SQL.
-- This migration does not modify the existing ntfy, OneSignal, WebRTC, or frontend paths.

create extension if not exists pgcrypto with schema extensions;

create table if not exists public.invitations (
  token_hash bytea primary key
    check (octet_length(token_hash) = 32),
  owner_id uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now()
);

create table if not exists public.links (
  user_a uuid not null references auth.users(id) on delete cascade,
  user_b uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  constraint links_distinct_users check (user_a < user_b),
  constraint links_pair_pk primary key (user_a, user_b)
);

create table if not exists public.messages (
  sender_id uuid not null references auth.users(id) on delete cascade,
  recipient_id uuid not null references auth.users(id) on delete cascade,
  payload jsonb not null
    check (jsonb_typeof(payload) = 'object'),
  created_at timestamptz not null default now(),
  constraint messages_distinct_users check (sender_id <> recipient_id)
);

alter table public.messages replica identity full;

create index if not exists messages_recipient_created_idx
  on public.messages (recipient_id, created_at desc);

alter table public.invitations enable row level security;
alter table public.links enable row level security;
alter table public.messages enable row level security;

-- Clients can read only their own inbox. All writes go through RPC functions.
drop policy if exists messages_read_own_inbox on public.messages;
create policy messages_read_own_inbox
  on public.messages
  for select
  to authenticated
  using (recipient_id = (select auth.uid()));

revoke all on table public.invitations from anon, authenticated;
revoke all on table public.links from anon, authenticated;
revoke all on table public.messages from anon, authenticated;
grant select on table public.messages to authenticated;

create or replace function public.create_invitation(p_invitation_id text)
returns void
language plpgsql
security definer
set search_path = pg_catalog, public, extensions
as $function$
declare
  v_owner_id uuid := auth.uid();
begin
  if v_owner_id is null then
    raise exception 'Authentication required' using errcode = '28000';
  end if;

  -- 32 random bytes encoded as unpadded base64url = 43 characters.
  if p_invitation_id is null
     or length(p_invitation_id) <> 43
     or p_invitation_id !~ '^[A-Za-z0-9_-]{43}$' then
    raise exception 'Invalid invitation ID' using errcode = '22023';
  end if;

  insert into public.invitations (token_hash, owner_id)
  values (
    extensions.digest(convert_to(p_invitation_id, 'UTF8'), 'sha256'),
    v_owner_id
  );
end;
$function$;

create or replace function public.submit_message(
  p_payload jsonb,
  p_recipient_id uuid default null,
  p_invitation_id text default null
)
returns timestamptz
language plpgsql
security definer
set search_path = pg_catalog, public, extensions
as $function$
declare
  v_sender_id uuid := auth.uid();
  v_recipient_id uuid;
  v_invitation_owner_id uuid;
  v_created_at timestamptz;
  v_user_a uuid;
  v_user_b uuid;
begin
  if v_sender_id is null then
    raise exception 'Authentication required' using errcode = '28000';
  end if;

  if p_payload is null or jsonb_typeof(p_payload) <> 'object' then
    raise exception 'Invalid message payload' using errcode = '22023';
  end if;

  -- Exactly one route must be supplied: a one-time invitation or an existing recipient.
  if (p_invitation_id is null) = (p_recipient_id is null) then
    raise exception 'Specify exactly one message route' using errcode = '22023';
  end if;

  if p_invitation_id is not null then
    if length(p_invitation_id) <> 43
       or p_invitation_id !~ '^[A-Za-z0-9_-]{43}$' then
      raise exception 'Invalid invitation' using errcode = '22023';
    end if;

    -- DELETE ... RETURNING is the atomic one-time claim.
    -- Concurrent attempts serialize on the row; at most one obtains its owner.
    delete from public.invitations
      where token_hash = extensions.digest(convert_to(p_invitation_id, 'UTF8'), 'sha256')
      returning owner_id into v_invitation_owner_id;

    if v_invitation_owner_id is null then
      raise exception 'Invitation is invalid or already used' using errcode = 'P0001';
    end if;

    if v_invitation_owner_id = v_sender_id then
      raise exception 'Cannot redeem your own invitation' using errcode = '22023';
    end if;

    v_recipient_id := v_invitation_owner_id;
    v_user_a := least(v_sender_id, v_recipient_id);
    v_user_b := greatest(v_sender_id, v_recipient_id);

    insert into public.links (user_a, user_b)
    values (v_user_a, v_user_b)
    on conflict (user_a, user_b) do nothing;
  else
    v_recipient_id := p_recipient_id;

    if v_recipient_id = v_sender_id then
      raise exception 'Cannot message yourself' using errcode = '22023';
    end if;

    v_user_a := least(v_sender_id, v_recipient_id);
    v_user_b := greatest(v_sender_id, v_recipient_id);

    if not exists (
      select 1
      from public.links l
      where l.user_a = v_user_a
        and l.user_b = v_user_b
    ) then
      raise exception 'Recipient is not a contact' using errcode = '42501';
    end if;
  end if;

  insert into public.messages (sender_id, recipient_id, payload)
  values (v_sender_id, v_recipient_id, p_payload)
  returning created_at into v_created_at;

  return v_created_at;
end;
$function$;

revoke all on function public.create_invitation(text) from public, anon;
revoke all on function public.submit_message(jsonb, uuid, text) from public, anon;
grant execute on function public.create_invitation(text) to authenticated;
grant execute on function public.submit_message(jsonb, uuid, text) to authenticated;

-- Enable Postgres Changes notifications for the durable inbox.
do $publication$
begin
  if not exists (
    select 1
    from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'messages'
  ) then
    alter publication supabase_realtime add table public.messages;
  end if;
end;
$publication$;

comment on table public.invitations is
  'One-time invitations; only SHA-256 hashes are stored. Successful redemption deletes the row.';
comment on table public.links is
  'Bidirectional contact authorization, keyed directly by Supabase Auth UUIDs.';
comment on table public.messages is
  'Durable recipient inbox. created_at is retained; encrypted per-direction seq defines order and deduplication.';
comment on function public.create_invitation(text) is
  'Stores only the SHA-256 hash of a 32-byte base64url invitation ID.';
comment on function public.submit_message(jsonb, uuid, text) is
  'Atomically redeems an invitation or validates an existing link, inserts into the recipient inbox, and returns created_at.';
