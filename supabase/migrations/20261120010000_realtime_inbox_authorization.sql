-- Authorize each authenticated user to join only their own private inbox topic.
-- Postgres Changes row delivery remains additionally protected by public.messages RLS.

drop policy if exists realtime_read_own_inbox_topic on realtime.messages;

create policy realtime_read_own_inbox_topic
  on realtime.messages
  for select
  to authenticated
  using (
    (select realtime.topic()) = 'inbox:' || (select auth.uid())::text
  );

comment on policy realtime_read_own_inbox_topic on realtime.messages is
  'Allows an authenticated user to join only the private Realtime topic for their own inbox.';
