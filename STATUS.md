# STATUS — session-to-session source of truth

The one file to read when starting a session and update before ending one. If this
disagrees with memory or chat, **this file wins**. Keep it short and current.

**Last updated:** 2026-07-04 · **Phase:** MVP live; Phase 2 (Reddit ingestion) built, needs secrets

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
- ⏳ **PENDING:** `0005_mentions_dedupe.sql` — run in the SQL Editor before the Reddit job goes live (dedupe index for `mentions`).
- ✅ Google OAuth configured (Supabase Google provider + redirect URI).
- ✅ Admin: `gauravpatwardhan7@gmail.com` has `profiles.is_admin = true`.
- ✅ Photo uploads working (Storage bucket `place-images`).
- Basemap: free OpenFreeMap tiles (no key). Optional `NEXT_PUBLIC_MAPTILER_KEY` for MapTiler.
- Secrets are gitignored (`.env.local`, `client_secret_*.json`) — never committed.

## Done (working & verified)
- Map feed (MapLibre) with category pins, list panel, sort (Trending/Newest/Most loved), filters (category + "This weekend"), mobile bottom sheet.
- Google sign-in; avatar in header (referrer-safe).
- Voting (optimistic, up + down) + comments, both live to Supabase; comment failures surface an error instead of vanishing.
- Ranked Top 10 list per active filter (e.g. "Top 10 trending drinks").
- Submit flow: Nominatim search / drop-pin / **use my current location**, photo upload, event dates. Non-admin → pending.
- Admin moderation page `/admin` (approve/reject/delete).
- Locate-me button on map (geolocate + dot).
- Live "buzz" tiers (Quiet→Warming up→Trending→Buzzing→On fire) computed from live counts; drives badge + pin glow + sort.
- Supabase Realtime wiring (code done; needs `0003_realtime.sql` run to activate).
- Submit guardrails, first slice: duplicate warning (~75m + fuzzy title, warn-and-allow), Bengaluru bounding-box check, event-date validation, clearer description label. (`lib/guardrails.ts`, unit-sanity-checked; UI flow needs a signed-in manual pass.)
- **Phase 2 — Reddit ingestion pipeline (code complete):** `scripts/ingest-reddit.ts` + daily GitHub Action. Fetches r/bangalore hot posts → Claude (`claude-opus-4-8`) extracts named places → geocodes in BLR → matches existing or creates `pending` (`source='reddit'`) → upserts `mentions` (feeds `trending_score`). Pure helpers unit-tested; live dry-run reaches the Reddit call. **Not yet running** — needs repo secrets + `0005` migration (see below). Docs: `scripts/README.md`.

## Current focus
- **Verify live buzz tiers + realtime end to end.** After `0003_realtime.sql` is run: open the app in two tabs, vote in one, confirm the other's count/badge/glow update with no refresh. Confirm removing a vote downgrades the tier instantly.

## Next up (candidates — see BACKLOG.md for detail)
1. **Guardrails, next slice:** "report" button (duplicate / wrong location / closed) → admin queue; needs a `reports` table migration. (`BACKLOG.md` → Guardrails)
2. **Account / activity hub:** my comments/votes/submissions + "been there" collectibles. (`BACKLOG.md`)
3. **Activate Phase 2 — Reddit ingestion:** run `0005_mentions_dedupe.sql`; add repo secrets (`SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `ANTHROPIC_API_KEY`, and ideally `REDDIT_CLIENT_ID`/`REDDIT_CLIENT_SECRET`); trigger the workflow (dry-run first) and review the pending queue in `/admin`. (`scripts/README.md`)
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
- 2026-07-03 (later) — Guardrails slice 1: dup-detection warning on submit, BLR bounding-box check, event-date validation, description-label clarity. Pending: signed-in manual pass of the dup-warning flow.
- 2026-07-04 — Dev-env fixes: pinned `turbopack.root` (stray `~/package-lock.json` broke workspace-root inference), launch.json `autoPort` so preview servers don't fight over port 3000. Verified app serves clean after a `.next` cache wipe. No product changes.
- 2026-07-04 (later) — Visual pass: softened all radii off full pills (5/6/8/10 scale, avatar stays round), theme accent terracotta→sage green, fixed a crash where a negative net vote score (downvotes) found no buzz tier. Built Phase 2 Reddit ingestion (script + Action + `0005` migration + `@anthropic-ai/sdk`/`tsx` deps); not yet activated (needs secrets + migration).
