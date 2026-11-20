-- Remove the redundant message UUID. Ordering and duplicate detection belong
-- to the encrypted per-direction seq; created_at is the durable inbox cursor.
-- Safe to re-run: the old function is replaced and the column is dropped IF EXISTS.

drop function if exists public.submit_message(jsonb, uuid, text);

do $drop_message_pk$
declare
  v_constraint text;
begin
  select c.conname into v_constraint
  from pg_constraint c
  where c.conrelid = 'public.messages'::regclass
    and c.contype = 'p'
    and exists (
      select 1
      from unnest(c.conkey) as key(attnum)
      join pg_attribute a
        on a.attrelid = c.conrelid and a.attnum = key.attnum
      where a.attname = 'message_id'
    );

  if v_constraint is not null then
    execute format('alter table public.messages drop constraint %I', v_constraint);
  end if;
end;
$drop_message_pk$;

alter table public.messages drop column if exists message_id;

-- The inbox no longer uses Postgres Changes: it has no row ID/primary key.
-- Remove it from the WAL publication and use a trigger-backed private Broadcast.
do $drop_messages_publication$
begin
  if exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'messages'
  ) then
    execute 'alter publication supabase_realtime drop table public.messages';
  end if;
end;
$drop_messages_publication$;

alter table public.messages replica identity default;

create or replace function public.broadcast_message_to_inbox()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public, realtime
as $broadcast$
begin
  perform realtime.broadcast_changes(
    'inbox:' || new.recipient_id::text,
    'INSERT',
    'INSERT',
    'messages',
    'public',
    new,
    null
  );
  return new;
end;
$broadcast$;

drop trigger if exists messages_broadcast_insert on public.messages;
create trigger messages_broadcast_insert
  after insert on public.messages
  for each row
  execute function public.broadcast_message_to_inbox();

revoke all on function public.broadcast_message_to_inbox() from public, anon, authenticated;

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

  if (p_invitation_id is null) = (p_recipient_id is null) then
    raise exception 'Specify exactly one message route' using errcode = '22023';
  end if;

  if p_invitation_id is not null then
    if length(p_invitation_id) <> 43
       or p_invitation_id !~ '^[A-Za-z0-9_-]{43}$' then
      raise exception 'Invalid invitation' using errcode = '22023';
    end if;

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

revoke all on function public.submit_message(jsonb, uuid, text) from public, anon;
grant execute on function public.submit_message(jsonb, uuid, text) to authenticated;

comment on table public.messages is
  'Durable recipient inbox without a synthetic message ID. created_at is a retrieval timestamp; encrypted per-direction seq defines order and deduplication. Inserts notify private inbox topics through Broadcast.';
comment on function public.submit_message(jsonb, uuid, text) is
  'Atomically redeems an invitation or validates an existing link, then inserts into the recipient inbox and returns created_at. An AFTER INSERT trigger sends a private Broadcast to the recipient's inbox topic.';
