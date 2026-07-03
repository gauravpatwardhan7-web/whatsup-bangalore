# Whatsup Bangalore 🔥

A living map of what's trending in Bengaluru — places, events, and experiences, upvoted by the people who actually went. Think "Instagram discovery page, but on a map, with memory."

- **Map-first feed**: trending spots glow and pulse — the hotter, the bigger the halo
- **Vouch & remark**: upvote places you loved, leave tips for the next person
- **Community-enriched**: anyone can add a spot; submissions go live after review
- **Coming next**: auto-ingestion of Reddit/event-feed buzz, weekly weekend digest

## Quick start (demo mode)

```bash
npm install
npm run dev
```

Open http://localhost:3000 — with no env vars set, the app runs in **demo mode** with 16 sample spots. Votes and comments work but reset on refresh.

## Going live with Supabase

1. **Create a project** at [supabase.com](https://supabase.com) (free tier is fine).
2. **Run the schema**: Supabase Dashboard → SQL Editor → paste and run, in order:
   `supabase/migrations/0001_init.sql`, `supabase/migrations/0002_storage.sql`
   (photo uploads), then `supabase/seed.sql`.
3. **Enable Google sign-in**: Dashboard → Authentication → Providers → Google.
   - Create OAuth credentials at [Google Cloud Console](https://console.cloud.google.com/apis/credentials)
     (OAuth client ID → Web application).
   - Authorized redirect URI: `https://<your-project-ref>.supabase.co/auth/v1/callback`
   - Paste the client ID + secret into the Supabase Google provider settings.
4. **Set env vars**: `cp .env.example .env.local`, fill in
   `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_ANON_KEY`
   (Dashboard → Project Settings → API).
5. **Make yourself admin** (after your first sign-in):
   ```sql
   update public.profiles set is_admin = true
   where id = (select id from auth.users where email = 'you@gmail.com');
   ```
6. Restart `npm run dev`. You can now approve submissions at `/admin`.

### Optional: nicer basemap

The app uses free [OpenFreeMap](https://openfreemap.org) tiles by default. For the MapTiler
streets style, set `NEXT_PUBLIC_MAPTILER_KEY` (free key at [maptiler.com](https://cloud.maptiler.com/account/keys)).

## How trending works

`places_with_stats` (see the migration) computes a **trending score**: votes, comments,
and external mentions from the last 14 days, exponentially decayed with a 7-day half-life-ish
curve. Comments weigh 1.5×. Pins with score ≥ 2 pulse terracotta ("Trending"); ≥ 6 pulse
red and grow ("Hot"). Phase-2 ingestion (Reddit r/bangalore, event feeds) will write into
the `mentions` table and feed the same score — the map heats up on its own.

## Project structure

```
app/                page (map), /admin (moderation), /auth/callback (OAuth)
components/         MapApp (shell), MapView (MapLibre), PlaceSheet, SubmitSheet, AdminPanel
lib/                ds.ts (design tokens), data.ts (Supabase + demo-mode data layer),
                    geocode.ts (Nominatim), format.ts, mock-data.ts
supabase/           migrations/0001_init.sql, seed.sql
```

## Deploying

Push to GitHub → import into [Vercel](https://vercel.com) → add the env vars → deploy.
Then add your Vercel URL to Supabase → Authentication → URL Configuration → Redirect URLs
(`https://your-app.vercel.app/auth/callback`).
