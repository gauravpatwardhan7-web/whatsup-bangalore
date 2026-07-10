# STATUS — session-to-session source of truth

The one file to read when starting a session and update before ending one. If this
disagrees with memory or chat, **this file wins**. Keep it short and current.

**Last updated:** 2026-07-10 · **Phase:** Live on Netlify (prod). UX/scale batch built locally (clustering, share, newsletter page, coffee, admin full-info + merge, tighter dedup) — build/lint/tsc green, preview-verified. **Not yet committed/deployed** (user has ~2 Netlify prod runs left → one batched deploy). Pending: run migration `0011_merge_places.sql`; optionally set `NEXT_PUBLIC_BMC_URL`.

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
- ✅ Migrations `0003_realtime.sql` (realtime) and `0005_mentions_dedupe.sql` (mentions dedupe) run in the SQL Editor (2026-07-05).
- ✅ Google OAuth configured (Supabase Google provider + redirect URI).
- ✅ Admin: `gauravpatwardhan7@gmail.com` has `profiles.is_admin = true`.
- ✅ Photo uploads working (Storage bucket `place-images`).
- Basemap: free OpenFreeMap tiles (no key). Optional `NEXT_PUBLIC_MAPTILER_KEY` for MapTiler.
- Secrets are gitignored (`.env.local`, `client_secret_*.json`) — never committed.
- ✅ Reddit ingestion source switched to **Arctic Shift** (keyless) — no Reddit API app/creds needed. `REDDIT_CLIENT_ID`/`REDDIT_CLIENT_SECRET` secrets are now unused and can be deleted.
- ✅ **Deployed to Netlify** — prod URL https://whatsupbangalore.netlify.app (auto-deploys on push to `main`; `netlify.toml` + `@netlify/plugin-nextjs`, Node 22). Env vars set on Netlify: `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`. **Never put `SUPABASE_SERVICE_ROLE_KEY` on Netlify** — it's only for the ingestion GitHub Action. Supabase Auth URL config updated (Site URL + `/auth/callback` redirect for the Netlify domain; `localhost:3000` kept for dev). Google sign-in verified working in prod.

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
- **Phase 2 — Reddit ingestion pipeline (code complete, unblocked):** `scripts/ingest-reddit.ts` + daily GitHub Action. Fetches r/bangalore posts **via Arctic Shift** (keyless archive; 1–4-day-old window ranked by engagement) → Gemini (`gemini-2.5-flash`, free tier) extracts named places → geocodes in BLR → matches existing or creates `pending` (`source='reddit'`) → upserts `mentions` (feeds `trending_score`). Dry-run verified end to end from a data-center IP (no block). `0005` migration run; `SUPABASE_URL`/`SUPABASE_SERVICE_ROLE_KEY`/`GEMINI_API_KEY` secrets added. **No Reddit creds needed** (dropped the Reddit-API path entirely — approval gate + CI IP block made it a dead end). Docs: `scripts/README.md`.

## Current focus
- **Reddit ingestion — awaiting first live run.** CI dry-run GREEN end to end (Arctic Shift → Gemini → geocode). The live run works; it only hit **Gemini free-tier daily quota** (20 req/day for `gemini-2.5-flash`) spent by same-day testing — not a bug. Hardening merged (retries + fast bail on daily-quota + `CHUNK_SIZE` 8→20 = 2 calls/run). **Next:** the scheduled 03:15 UTC run (after quota reset) auto-fills the `/admin` pending queue; then do the first approval pass. NB: **rotate the Gemini key** (pasted in chat) + update the `GEMINI_API_KEY` secret.
- **Instagram source via Apify free tier** — user wants to try after Reddit is live. Add a second ingestion path (`source='instagram'`) reusing the same Gemini-extract → geocode → mentions pipeline. Needs an Apify token + a BLR-relevant actor (hashtag/location scraper). Watch the free-tier credit budget.
- **Verify live buzz tiers + realtime end to end** (0003 now run): open the app in two tabs, vote in one, confirm the other's count/badge/glow update with no refresh; removing a vote should downgrade the tier instantly.

## Next up (candidates — see BACKLOG.md for detail)
1. **Guardrails, next slice:** "report" button (duplicate / wrong location / closed) → admin queue; needs a `reports` table migration. (`BACKLOG.md` → Guardrails)
2. **Account / activity hub:** my comments/votes/submissions + "been there" collectibles. (`BACKLOG.md`)
3. ✅ ~~Deploy~~ — **done, live on Netlify** (https://whatsupbangalore.netlify.app).
4. **Instagram source via Apify free tier** — after first live Reddit ingestion run confirms quality.

## Key pointers
- **Backlog & edge cases:** `BACKLOG.md`
- **Principles:** `.specify/memory/constitution.md`
- **Specs (spec-kit):** `specs/` · skills: `/speckit-specify`, `/speckit-plan`, `/speckit-tasks`, `/speckit-implement`
- **Data layer:** `lib/data.ts` (Supabase + mock mode) · **design tokens/tiers:** `lib/ds.ts`
- **Migrations:** `supabase/migrations/` (run in order in the SQL Editor)
- **Repo:** https://github.com/gauravpatwardhan7-web/whatsup-bangalore

## Pending activation
- **Run `supabase/migrations/0011_merge_places.sql`** in the SQL Editor — adds the admin `merge_places(source, target)` RPC that the new `/admin` "⤵ Merge" button calls to collapse duplicate places (moves votes/comments/mentions, deletes the dup). Until it's run, Merge errors with a clear "did you run 0011?" alert; everything else works without it.
- **Optional: set `NEXT_PUBLIC_BMC_URL`** on Netlify (e.g. `https://buymeacoffee.com/yourhandle`) to show the "☕ Coffee" button in the header. No redeploy needed to change the URL later; the button is hidden while the var is unset.
- **Run `supabase/migrations/0009_place_enrichment.sql`** in the SQL Editor — adds `rating`/`rating_count`/`price_level`/`website` columns. Enrichment writes + the rating UI need it; ingestion still runs without it but place inserts with those fields will error until it's applied.
- **Add `GOOGLE_PLACES_API_KEY` GitHub secret** — the ingestion workflow now passes it for the geocode fallback + enrichment (already in `.env.local`; also add to the repo secrets).
- Run `npm run photos:refresh` to backfill photos **and** rating/price/website onto existing places (now enriches, not just photos; picks up anything with a placeholder image or null rating).
- `NEWSLETTER_FROM` secret once a sending domain is verified in Resend (until then Resend only delivers to the account owner's email).
- Verify GitHub secret name is `YOUTUBE_API_KEY` (local var is `YOUTUBE_DATA_API_KEY`).

## Session log
- 2026-07-10 (UX/scale batch, built not deployed) — Seven asks in one batch: (1) **pin-drop indicator** — draggable 📍 marker at the tapped point during submit (`MapView` `pickedPin`/`onPickedPinMove`, `.picked-pin` CSS bounce); (2) **share** — `?place=<id>` deep link (auto-opens the sheet on load, URL kept in sync) + ↗ Share button in `PlaceSheet` (native share / clipboard fallback); (3) **newsletter on site** — `/newsletter` page reusing shared curation (`lib/newsletter.ts`, now imported by both the email script and the page so they can't drift) with deep-links back to the map; (4) **Buy Me a Coffee** — header button gated on `NEXT_PUBLIC_BMC_URL`; (5) **admin full info** — `/admin` rows now show photos, votes/comments, rating/price/address, source-URL + website + Google-Maps links, view-on-map; (6) **duplicates** — ingestion match is now distance-tolerant for exact-name (600m) vs fuzzy (200m) via `findNearbyMatch` (kills geocode-drift dups without merging chain branches), plus an admin **Merge** tool (migration `0011` RPC); (7) **scale** — **supercluster** clustering (cluster bubbles + click-to-zoom, keeps the glow pins), viewport/hard-cap deferred ("cluster now, cap later"). Verified in preview: clustering (6 clusters→declusters on click), newsletter render, deep-link auto-open, no console errors. **Next: one batched Netlify deploy + run migration 0011.**
- 2026-07-10 (later) — **Newsletter MVP pass** (`scripts/send-newsletter.ts`): curated Eat/Drink/Do/See format finished + LLM editorial pass (Gemini `gemini-flash-latest`, Mistral fallback, graceful no-key fallback to stored descriptions) writes per-pick blurb, 2-3 "Know before you go" tips, and a "good for" occasion chip; added 1-2 "Also on the radar" runners-up per section; redesigned email (tips box, buzz quote, button-style Directions/Website, charset fix). Workflow now passes `GEMINI_API_KEY`/`MISTRAL_API_KEY`. Dry-run verified against live data + rendered HTML eyeballed in browser; tsc/lint green. NB: add `MISTRAL_API_KEY` as a GitHub secret if the fallback should work in CI.
- 2026-07-10 — Ingestion quality pass: **Places-as-geocoder fallback** (`scripts/resolve-place.ts` — Nominatim→Google Places; Shivaji Military Hotel & other small venues that failed OSM now resolve, verified 12/12 geocode vs 3/17 before); **trending floor** (`MIN_CREATE_ENGAGEMENT`, default 3.0 — a new place must clear a source-engagement bar; linking to existing places has no floor; verified the gate fires); **Places enrichment on new places** (Google editorial description used over LLM one-liner, + rating/review-count/price/website, skips permanently-closed) via extended `lib/places-api.ts` + migration `0009`; `refresh-place-photos.ts` now backfills enrichment too; richer 2-3-sentence description prompt; rating/price/website shown in `PlaceCard`+`PlaceSheet`. Also earlier today: fixed Gemini 404 (model sunset → `gemini-flash-latest` alias) and added **Mistral fallback** (`scripts/llm-extract.ts`). All shipped: build/lint/tsc green, enrichment + geocode + floor verified against live APIs.
- 2026-07-09 — Feature batch: renamed app to **What's Trending Bangalore**; search bar in the list panel (filters list + map pins); true pin-drop on the map from the submit sheet (tap anywhere, crosshair cursor); past events auto-hidden from the feed; weekly Thursday newsletter (`scripts/send-newsletter.ts` + workflow, Resend-backed, provider-swappable); Reddit ingestion broadened to 5 BLR subreddits (env-overridable); YouTube ingestion added (`scripts/ingest-youtube.ts`, needs `YOUTUBE_API_KEY`); fixed daily-changing seed images (loremflickr re-indexes → switched to deterministic picsum seeds; live DB rows patched via REST); Google Places API scaffolding (`lib/places-api.ts` + `npm run photos:refresh`, swappable demo→real key). Lint/build green; UI verified in preview. See "Pending activation".
- 2026-07-03 — MVP built; Supabase + Google auth connected live; photos on all spots; locate-me; live buzz tiers + realtime code; spec-kit + this tracker added. Pending: run `0003_realtime.sql`, verify realtime.
- 2026-07-03 (later) — Guardrails slice 1: dup-detection warning on submit, BLR bounding-box check, event-date validation, description-label clarity. Pending: signed-in manual pass of the dup-warning flow.
- 2026-07-04 — Dev-env fixes: pinned `turbopack.root` (stray `~/package-lock.json` broke workspace-root inference), launch.json `autoPort` so preview servers don't fight over port 3000. Verified app serves clean after a `.next` cache wipe. No product changes.
- 2026-07-04 (later) — Visual pass: softened all radii off full pills (5/6/8/10 scale, avatar stays round), theme accent terracotta→sage green, fixed a crash where a negative net vote score (downvotes) found no buzz tier. Built Phase 2 Reddit ingestion (script + Action + `0005` migration + `@google/genai`/`tsx` deps; extraction via Gemini free tier); not yet activated (needs secrets + migration).
- 2026-07-05 — Ran migrations `0003_realtime.sql` + `0005_mentions_dedupe.sql`. Added GitHub secrets `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` (new `sb_secret_` key), `GEMINI_API_KEY`. Pushed to GitHub `main`. Reddit ingestion is one step from live — blocked only on `REDDIT_CLIENT_ID`/`REDDIT_CLIENT_SECRET` (script app pending Reddit approval).
- 2026-07-05 (later) — **Unblocked Reddit ingestion by dropping the Reddit API entirely.** Reddit now gates API access behind an approval form (unlikely to pass) on top of the CI-IP block. Switched `fetchHotPosts()` to Arctic Shift (keyless public archive; sibling repo `blr-neighborhood-explorer` uses the same source). Adapted parser to the flat `{data:[…]}` shape; window = posts 1–4 days old (matured vote counts) ranked by engagement. Stripped Reddit-creds path from script, workflow, and README. **Verified the full pipeline end to end with a real Gemini key (no-write dry-run):** 40 posts → Gemini extracted 2 clean candidates (Panchavati, Cubbon Park) → both geocoded inside BLR. Along the way **fixed a geocode bug** — `lib/geocode.ts` sent no `User-Agent`, so Nominatim returned nothing under Node (Cubbon Park failed to geocode); added a UA (browsers ignore it, so submit flow unaffected). Next: run the Action live. Also queued: Instagram-via-Apify source after Reddit lands.
