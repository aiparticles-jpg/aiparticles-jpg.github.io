-- Introduce a durable, independent sequence for every recipient inbox.
-- message_id remains temporarily for compatibility with already-open clients;
-- the new client no longer uses it. A later cleanup migration can remove it
-- after the recipient_seq client has been deployed and verified.

create table if not exists public.recipient_counters (
  recipient_id uuid primary key references auth.users(id) on delete cascade,
  last_seq bigint not null default 0 check (last_seq >= 0)
);

alter table public.recipient_counters enable row level security;
revoke all on table public.recipient_counters from public, anon, authenticated;

alter table public.messages
  add column if not exists recipient_seq bigint;

do $recipient_seq_backfill$
begin
  if exists (
    select 1 from public.messages where recipient_seq is null
  ) then
    if not exists (
      select 1 from information_schema.columns
      where table_schema = 'public'
        and table_name = 'messages'
        and column_name = 'message_id'
    ) then
      raise exception 'Cannot backfill recipient_seq: legacy message_id is missing';
    end if;

    -- Preserve the exact historical order used by the previous inbox cursor.
    with numbered as (
      select ctid,
             row_number() over (
               partition by recipient_id
               order by message_id
             )::bigint as recipient_seq
      from public.messages
    )
    update public.messages m
       set recipient_seq = n.recipient_seq
      from numbered n
     where m.ctid = n.ctid;
  end if;
end;
$recipient_seq_backfill$;

insert into public.recipient_counters (recipient_id, last_seq)
select recipient_id, coalesce(max(recipient_seq), 0)
from public.messages
group by recipient_id
on conflict (recipient_id) do update
set last_seq = greatest(public.recipient_counters.last_seq, excluded.last_seq);

alter table public.messages
  alter column recipient_seq set not null;

create unique index if not exists messages_recipient_seq_uidx
  on public.messages (recipient_id, recipient_seq);

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
  v_recipient_seq bigint;
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

  -- The counter row is the serialization lock for this recipient. The row
  -- update and message INSERT share this transaction, so seq N+1 cannot
  -- commit before seq N. Different recipients have independent counters.
  insert into public.recipient_counters (recipient_id, last_seq)
  values (v_recipient_id, 1)
  on conflict (recipient_id) do update
    set last_seq = public.recipient_counters.last_seq + 1
  returning last_seq into v_recipient_seq;

  insert into public.messages (recipient_seq, sender_id, recipient_id, payload, created_at)
  values (v_recipient_seq, v_sender_id, v_recipient_id, p_payload, clock_timestamp())
  returning created_at into v_created_at;

  return v_created_at;
end;
$function$;

revoke all on function public.submit_message(jsonb, uuid, text) from public, anon;
grant execute on function public.submit_message(jsonb, uuid, text) to authenticated;

comment on column public.messages.recipient_seq is
  'Monotonic sequence within one recipient inbox. Assigned transactionally through recipient_counters.';
comment on table public.recipient_counters is
  'One transactional sequence allocator per recipient inbox.';
comment on table public.messages is
  'Durable recipient inbox. recipient_seq is the recipient-scoped delivery cursor; encrypted per-direction seq remains the sender-order and deduplication check. Legacy message_id is retained only during client rollout.';
comment on function public.submit_message(jsonb, uuid, text) is
  'Atomically validates the route, allocates the next recipient_seq under the recipient counter row lock, inserts the inbox message, and broadcasts it to the recipient private topic.';
