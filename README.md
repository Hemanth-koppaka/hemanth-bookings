# Hemanth Bookings

A complete, mobile-first booking system for hair and beauty salons: guests book
online in under a minute, the owner runs the day from an admin dashboard, and
stylists see their own appointments on their phones. It runs entirely on free
tiers (Cloudflare Workers + Supabase).

The demo brand in this repository, **"Lumen Studio"**, is fictional. Replace
the name, menu, photos and contact details with your own salon's.

> Designed and built by **Hemanth Koppaka**, using AI coding tools (Claude, Lovable).

## Features

**For guests**
- Book in 5 steps: who (men / women) → services → time → details → confirm
- Real-time availability per stylist, with breaks, leave and salon closures respected
- Services that only one stylist performs (e.g. a signature cut) close automatically on that stylist's days off
- Manage a booking: change time, stylist or services, or cancel, with the same availability checks
- Waitlist alerts when a full day frees up (free web push notifications)
- Add to calendar, one-tap WhatsApp confirmation, reference photos ("my look")
- Works on every screen size, with an animated, theme-aware UI

**For the salon (admin dashboard)**
- Today view, calendar (day / week / month) with drag-to-reschedule, bookings and customers
- Staff: working hours, breaks, services per stylist, leave picked on a calendar
  (tap days, or first and last day), "also for" another stylist, "back at" time on the last day
- Salon closures (date ranges, separate dates, a few hours, until further notice)
- Services and categories, prices, durations, photos; booking rules (notice, how far ahead, cancellation)
- Clash warnings with one-tap WhatsApp messages to affected guests
- "Tomorrow's list" ready to send to the staff group
- Reports, activity log, system health, privacy-friendly visitor funnel
- Phone alerts for new bookings and guest changes

**For stylists**
- "My day" on their phone: own appointments only, arrived → in the chair → done
- "Running late / back at …", "off rest of today" and "I'm back now" from their phone

**Operations**
- Free hosting: Cloudflare Workers (site + server) and Supabase (Postgres, storage, cron)
- Scheduled jobs with `pg_cron` (reminders, waitlist, photo clean-up, daily backup)
- Daily in-database backups kept for 14 days, with one-command restore per table
- Kept under the free-plan limits (≤ ~30 database calls per request)

## Tech stack

- [TanStack Start](https://tanstack.com/start) (React 19, server functions, file-based routing)
- TypeScript, Tailwind CSS 4, Radix UI / shadcn components, Zod
- Supabase (Postgres, Storage, `pg_cron`, `pg_net`, Vault)
- Cloudflare Workers (deployment), Web Push (VAPID) for notifications

## Getting started

```bash
bun install            # or: npm install
cp .env.example .env   # fill in your Supabase URL and publishable key
bun run dev
```

Then:

1. **Database:** create a Supabase project and apply the SQL files in
   `drizzle/migrations/` in order (Supabase SQL editor, or `supabase db push`).
2. **Secrets** (server only, never in the code): `SUPABASE_SERVICE_ROLE_KEY`,
   `ADMIN_SESSION_SECRET` (a long random string) and `LOVABLE_CRON_SECRET`
   (a second long random string, used by the scheduled jobs).
3. **Your salon:** edit `src/lib/salon.ts` (name, phone, address, menu) and
   replace the placeholder images in `public/`. Most of it can also be changed
   later from the admin dashboard (services, hours, wording, staff).
4. **Admin:** the dashboard lives at `/admin` (protected by an admin code you
   set on first sign-in). You can rename the route to a path of your own.

Deployment to Cloudflare and the scheduled jobs are described in
[`docs/hosting.md`](docs/hosting.md); optional SMS / WhatsApp / email
notifications in [`docs/notifications.md`](docs/notifications.md).

## Scripts

| Command | What it does |
|---|---|
| `bun run dev` | Local development server |
| `bun run build` | Production build (Cloudflare Worker output in `.output/`) |
| `bun run lint` | ESLint |
| `npx tsx --test src/lib/*.test.ts` | Unit tests |

## Project layout

```
src/routes/            pages (guest flow, /admin dashboard, /stylist)
src/lib/               booking engine, availability, server functions, notifications
src/components/        UI components
drizzle/migrations/    database schema (SQL)
public/                images, icons, service worker
docs/                  hosting and notification guides
```

## Licence

Code: [MIT](LICENSE) © 2026 Hemanth Koppaka.

The images in `public/` are placeholders. Use photos you have the rights to,
and check the licence of any icon set before using it commercially.
