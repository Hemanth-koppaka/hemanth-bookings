# Hosting: Supabase + Cloudflare (free tiers)

The site is a Cloudflare Worker (the build already targets Cloudflare). The data
lives in your own Supabase project.

| Part | Service | Where it's set up |
|---|---|---|
| Database, photos | Supabase project `hair-by-kiran` (`YOUR-PROJECT`, Mumbai) | supabase.com |
| Website + server | Cloudflare Workers (free plan) | dash.cloudflare.com |
| Scheduled jobs | Supabase `pg_cron` + `pg_net` (free) | Supabase SQL editor |
| Domain | `salon.example.com` | DNS points to Cloudflare |

## 1. Deploy the site on Cloudflare (once)

1. Cloudflare dashboard → **Workers & Pages → Create → Import a repository** →
   pick your fork of this repository, branch `main`.
2. Build settings:
   - Build command: `npm ci && npm run build`
   - Deploy command: `npx wrangler deploy --config .output/server/wrangler.json`
3. **Settings → Variables and secrets** (type *Secret* for every one):

   | Name | Value |
   |---|---|
   | `SUPABASE_URL` | `https://YOUR-PROJECT.supabase.co` |
   | `SUPABASE_SERVICE_ROLE_KEY` | Supabase → Project Settings → API keys → **secret** key |
   | `ADMIN_SESSION_SECRET` | a long random string (any 40+ characters) |
   | `LOVABLE_CRON_SECRET` | a second long random string (the scheduled jobs send it) |

   Optional, only if used: `MSG91_AUTH_KEY`, `MSG91_WEBHOOK_SECRET`, `BREVO_API_KEY` / `RESEND_API_KEY`.
4. **Settings → Domains & Routes → Add custom domain**: `salon.example.com`
   and `salon.example.com` (the domain's DNS must be on Cloudflare).

Every push to `main` redeploys automatically.

Changing `ADMIN_SESSION_SECRET` signs everyone out; the admin code itself is in
the database and doesn't change.

## 2. Scheduled jobs (Supabase SQL editor, once)

Already set up on the `hair-by-kiran` project (jobs `hb-notifications`,
`hb-waitlist`, `hb-photo-sweep`; secret `hb_cron_secret` in Vault). The SQL
below is kept for reference, e.g. to rebuild a project. The secret must equal
`LOVABLE_CRON_SECRET` on Cloudflare.

```sql
create extension if not exists pg_cron;
create extension if not exists pg_net;
select vault.create_secret('<CRON SECRET>', 'hb_cron_secret');

create or replace function public.hb_call(path text) returns bigint
language sql security definer set search_path = public as $$
  select net.http_post(
    url := 'https://salon.example.com' || path,
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'hb_cron_secret')),
    body := '{}'::jsonb);
$$;
revoke execute on function public.hb_call(text) from public, anon, authenticated;

select cron.schedule('hb-notifications', '*/10 * * * *', $$ select public.hb_call('/api/notifications/dispatch') $$);
select cron.schedule('hb-waitlist',      '*/5 * * * *',  $$ select public.hb_call('/api/public/waitlist-dispatch') $$);
select cron.schedule('hb-photo-sweep',   '17 * * * *',   $$ select public.hb_call('/api/photo-sweep') $$);
```

## Free-plan limits to know

- Cloudflare Workers free: 100,000 requests a day and 10 ms of CPU per request.
  If pages or the admin sign-in hit the CPU limit (error 1102), switch the
  Worker to the $5/month plan; nothing else changes.
- Supabase free: 500 MB database, 1 GB files. No automatic backups; export the
  database from the Supabase dashboard (Database → Backups / `pg_dump`) now and then.
  Projects pause after 7 days without any requests (daily bookings keep it awake).
