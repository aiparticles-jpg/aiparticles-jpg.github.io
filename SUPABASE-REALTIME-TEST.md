# Supabase Realtime — private channel test

This is a temporary security/transport experiment only. It does not alter VoiceLink's current ntfy signaling, OneSignal push flow, calls, identity, contacts, or invitations.

## What this stage verifies

- Browsers authenticate with separate temporary Supabase anonymous sessions.
- Each browser subscribes to the same private Realtime Broadcast topic.
- RLS permits reading only the dedicated test topic.
- A deliberately different private topic is rejected.
- Render publishes only dummy test text to the private topic.
- The browser never publishes Broadcast messages directly.

This is an authorization smoke test, not the final VoiceLink access-control model. The policy below intentionally lets any authenticated anonymous test user subscribe to this one fixed test topic. Production must use per-recipient authorization/membership, not this broad test-only rule.

## 1. Supabase Auth: enable anonymous sign-ins

In the Supabase Dashboard for project `Voice Link`:

1. Open **Authentication** settings.
2. Find the **Allow anonymous sign-ins** option under user sign-up settings.
3. Enable it and save.

The test page creates one anonymous Auth user per browser profile and keeps its session in that browser. Supabase stores these temporary users in its internal `auth.users` table. No application/public table is created. Do not clear browser site data between test runs unless you are happy to create another temporary test user.

## 2. Supabase Realtime: disable public channels

Open **Project Settings → Realtime Settings** and switch **Allow public access to channels** off.

This makes the project private-channel-only. The test page uses `config: { private: true }`.

## 3. Add the test-only RLS policy

Open **SQL Editor** and run this SQL:

```sql
drop policy if exists "vl_realtime_test_read" on realtime.messages;

create policy "vl_realtime_test_read"
on realtime.messages
for select
to authenticated
using (
  extension = 'broadcast'
  and (select realtime.topic()) = 'voicelink-realtime-test-9224dd59711e2e0aab5aed1572e4d6c0'
  and (select auth.jwt() ->> 'is_anonymous') = 'true'
);
```

This policy:
- grants read/subscribe permission only for Broadcast;
- grants it only for the exact temporary topic above;
- requires a Supabase anonymous-auth session;
- does not grant clients permission to publish messages.

Do not add a broad `USING (true)` policy. Review existing policies on `realtime.messages`; another permissive policy can broaden access because permissive policies are combined with OR.

No SQL table needs to be created. Supabase already provides `realtime.messages` and its RLS is enabled.

## 4. Render environment variables

Keep the existing variables in the same Render backend service:

- `SUPABASE_URL=https://lcmccpecmtnqknthtijl.supabase.co`
- `SUPABASE_SECRET_KEY` = the project's Secret key (`sb_secret_...`)

The Secret key stays only in Render. Do not put it in GitHub, the test HTML, or chat. The browser uses only the Publishable key.

The Render test endpoint now uses Supabase's documented single-message REST endpoint with `?private=true`. The existing `/v1/push` route is unchanged.

## 5. Test

1. Wait for the Render deployment and GitHub Pages deployment.
2. Open `https://aiparticles-jpg.github.io/supabase-realtime-test.html` in two different browser profiles or devices.
3. Both pages should create an anonymous test session and show `SUBSCRIBED — private channel разрешён RLS`.
4. Enter the existing Render backend URL in both pages.
5. Send a dummy message from one page. It should appear in the other page.
6. Press **Проверить запрет доступа** in either page. Expected result: Supabase rejects the subscription to the different topic.
7. Repeat in Android Chrome and Firefox, preferably on separate devices/networks.

A successful message delivery confirms Render private REST publish + authenticated private WebSocket subscription. A rejected probe confirms the exact-topic RLS rule is active.

## Important limitations

- Anonymous test users are stored in Supabase Auth. Supabase does not automatically clean up anonymous users; this is a temporary project, so remove test users later if desired.
- The policy is deliberately broad for this one test topic. It is not suitable for production.
- The test endpoint is rate-limited and accepts only short dummy text.
- Do not send real user IDs, recipient tokens, OneSignal IDs, SDP/ICE, contacts, or call data through this test.
- Current ntfy, OneSignal, and VoiceLink calls remain unchanged.
