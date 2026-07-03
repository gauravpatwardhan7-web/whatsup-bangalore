# STATUS — session-to-session source of truth

The one file to read when starting a session and update before ending one. If this
disagrees with memory or chat, **this file wins**. Keep it short and current.

**Last updated:** 2026-07-03 · **Phase:** MVP live on Supabase

---

## How to resume (start-of-session checklist)
1. Read this file top to bottom.
2. Skim `git log --oneline -15` for what landed recently.
3. Check **Setup state** below — is anything still pending on the Supabase/Google side?
4. Pick up from **Current focus**, or grab the top of **Next up**.
5. Working spec-driven? See `specs/` and the `/speckit-*` skills (constitution in `.specify/memory/`).

## How to hand off (end-of-session checklist)
- Move finished items from **Current focus** → **Done**.
- Update **Current focus** and **Next up**.
- Add a one-line entry to **Session log**.
- Bump **Last updated**. Commit this file with your work.

---

## Setup state (live infra)
- ✅ Supabase project `whatsup-bangalore` (region ap-south-1) connected via `.env.local` (publishable key).
- ✅ Migrations run: `0001_init.sql`, `0002_storage.sql`, `seed.sql` (16 spots).
- ⏳ **PENDING:** `0003_realtime.sql` — must be run in the SQL Editor to enable live vote/comment updates.
- ✅ Google OAuth configured (Supabase Google provider + redirect URI).
- ✅ Admin: `gauravpatwardhan7@gmail.com` has `profiles.is_admin = true`.
- ✅ Photo uploads working (Storage bucket `place-images`).
- Basemap: free OpenFreeMap tiles (no key). Optional `NEXT_PUBLIC_MAPTILER_KEY` for MapTiler.
- Secrets are gitignored (`.env.local`, `client_secret_*.json`) — never committed.

## Done (working & verified)
- Map feed (MapLibre) with category pins, list panel, sort (Trending/Newest/Most loved), filters (category + "This weekend"), mobile bottom sheet.
- Google sign-in; avatar in header (referrer-safe).
- Voting (optimistic) + comments, both live to Supabase; comment failures surface an error instead of vanishing.
- Submit flow: Nominatim search / drop-pin / **use my current location**, photo upload, event dates. Non-admin → pending.
- Admin moderation page `/admin` (approve/reject/delete).
- Locate-me button on map (geolocate + dot).
- Live "buzz" tiers (Quiet→Warming up→Trending→Buzzing→On fire) computed from live counts; drives badge + pin glow + sort.
- Supabase Realtime wiring (code done; needs `0003_realtime.sql` run to activate).

## Current focus
- **Verify live buzz tiers + realtime end to end.** After `0003_realtime.sql` is run: open the app in two tabs, vote in one, confirm the other's count/badge/glow update with no refresh. Confirm removing a vote downgrades the tier instantly.

## Next up (candidates — see BACKLOG.md for detail)
1. **Guardrails, first slice:** duplicate-detection warning on submit (~75m + fuzzy title) + a "report" button. (`BACKLOG.md` → Guardrails)
2. **Account / activity hub:** my comments/votes/submissions + "been there" collectibles. (`BACKLOG.md`)
3. **Phase 2 — Reddit ingestion:** GitHub Action → r/bangalore → extract places → `mentions` table feeds trending.
4. Deploy to Vercel (add env vars + Supabase redirect URL for the prod domain).

## Key pointers
- **Backlog & edge cases:** `BACKLOG.md`
- **Principles:** `.specify/memory/constitution.md`
- **Specs (spec-kit):** `specs/` · skills: `/speckit-specify`, `/speckit-plan`, `/speckit-tasks`, `/speckit-implement`
- **Data layer:** `lib/data.ts` (Supabase + mock mode) · **design tokens/tiers:** `lib/ds.ts`
- **Migrations:** `supabase/migrations/` (run in order in the SQL Editor)
- **Repo:** https://github.com/gauravpatwardhan7-web/whatsup-bangalore

## Session log
- 2026-07-03 — MVP built; Supabase + Google auth connected live; photos on all spots; locate-me; live buzz tiers + realtime code; spec-kit + this tracker added. Pending: run `0003_realtime.sql`, verify realtime.
