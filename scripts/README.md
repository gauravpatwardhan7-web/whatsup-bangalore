# Ingestion scripts

## Reddit ingestion (`ingest-reddit.ts`)

Phase 2 of the plan — "the map lights up on its own." Pulls hot posts from
r/bangalore, uses Gemini (`gemini-2.5-flash`, free tier) to extract specific
named places/events, geocodes them inside Bengaluru (Nominatim), and records
rows in the `mentions` table. Those feed `trending_score` via the time-decayed
view in `supabase/migrations/0001_init.sql`, so mentioned spots climb the
ranking on their own.

### What it does, step by step

1. Fetch ~40 hot posts (authenticated Reddit API if configured, else public).
2. Skip posts already processed (any post whose permalink already has a mention).
3. Gemini extracts specific, visitable places/events — skipping civic rants,
   questions, memes, real-estate, and bare neighborhood names.
4. Geocode each candidate; reject anything outside the Bengaluru bounding box.
5. Match against existing places (≤200 m + fuzzy title). Match → link a mention
   to it. No match → create a **pending** place (`source = 'reddit'`) so an admin
   approves it before it shows on the map, then link the mention.
6. Upsert the mention (idempotent on `(place_id, url)` — see migration `0005`).

Engagement is normalized (log-compressed, capped at 6) so one hot post can't
outweigh dozens of real votes.

### Run it

```bash
# Dry run — no writes. Exercises fetch/filter/normalize (and extraction/geocode
# if the keys below are set). Safe to run anytime.
npm run ingest:reddit -- --dry-run

# Live — requires the env vars below.
npm run ingest:reddit
```

Get a free Gemini API key at https://aistudio.google.com/apikey (no billing
required for the free tier — `gemini-2.5-flash` is plenty for this).

### Required environment / GitHub secrets

| Var | Purpose |
| --- | --- |
| `SUPABASE_URL` (or `NEXT_PUBLIC_SUPABASE_URL`) | Supabase project URL |
| `SUPABASE_SERVICE_ROLE_KEY` | **Service role** key — mentions/places RLS only allows service-role writes. Never commit or expose to the browser. |
| `GEMINI_API_KEY` (or `GOOGLE_API_KEY`) | Gemini extraction. Free key from https://aistudio.google.com/apikey. Optional `GEMINI_MODEL` overrides the default `gemini-2.5-flash`. |
| `REDDIT_CLIENT_ID` / `REDDIT_CLIENT_SECRET` | Optional but recommended. Reddit 403s anonymous reads from data-center/CI IPs; a free "script" app gives a userless read token. Create at https://www.reddit.com/prefs/apps (type: script). |

Without the two Supabase vars **or** the Gemini key, the script auto-forces
dry-run mode instead of erroring.

### Automation

`.github/workflows/ingest-reddit.yml` runs it daily (03:15 UTC ≈ 08:45 IST) and
on demand from the Actions tab (with a dry-run toggle). Add the vars above as
repository secrets first.

### Prerequisite

Run `supabase/migrations/0005_mentions_dedupe.sql` in the SQL editor once (adds
the dedupe index the upsert relies on).
