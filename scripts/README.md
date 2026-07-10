# Ingestion scripts

## Reddit ingestion (`ingest-reddit.ts`)

Phase 2 of the plan — "the map lights up on its own." Pulls recent posts from
r/bangalore, uses Gemini (`gemini-2.5-flash`, free tier) to extract specific
named places/events, geocodes them inside Bengaluru (Nominatim), and records
rows in the `mentions` table. Those feed `trending_score` via the time-decayed
view in `supabase/migrations/0001_init.sql`, so mentioned spots climb the
ranking on their own.

Posts come from **Arctic Shift** (`arctic-shift.photon-reddit.com`), a free,
keyless public Reddit archive (Pushshift's successor). It needs no OAuth app,
no API key, and no approval, and — unlike Reddit's own API — isn't IP-blocked
from CI/data-center runners. Arctic Shift has no "hot" listing and a just-posted
item still shows ~1 upvote, so we pull a window of posts that are **1–4 days old**
(matured enough to have real vote/comment counts, still recent) and rank them by
engagement ourselves, keeping the top ~40.

### What it does, step by step

1. Fetch r/bangalore posts 1–4 days old from Arctic Shift; rank by engagement, keep ~40.
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

Reddit posts require **no credentials** — Arctic Shift is keyless.

Without the two Supabase vars **or** the Gemini key, the script auto-forces
dry-run mode instead of erroring.

### Automation

`.github/workflows/ingest-reddit.yml` runs it daily (03:15 UTC ≈ 08:45 IST) and
on demand from the Actions tab (with a dry-run toggle). Add the vars above as
repository secrets first.

### Prerequisite

Run `supabase/migrations/0005_mentions_dedupe.sql` in the SQL editor once (adds
the dedupe index the upsert relies on).

## YouTube ingestion (`ingest-youtube.ts`)

Same pipeline shape as Reddit, sourced from the YouTube Data API v3: search a
handful of Bengaluru queries (override with a comma-separated `YOUTUBE_QUERIES`
env var) for videos from the last 7 days, rank by views/likes/comments, then
Gemini-extract → geocode → match-or-create pending place (`source='youtube'`)
→ upsert mention (`platform='youtube'`). Runs as a second step in
`.github/workflows/ingest-reddit.yml` and no-ops until the `YOUTUBE_API_KEY`
secret exists (free tier: 10,000 units/day; a run costs ~100/query).
Requires migration `0008` (adds `youtube` to the platform/source checks).

## Weekly newsletter (`send-newsletter.ts`)

Every Thursday (`.github/workflows/newsletter.yml`, 03:30 UTC ≈ 09:00 IST):
builds a top-10 trending digest (past events excluded) and emails every
Supabase auth user. Delivery goes through a single `sendEmail()` function,
currently backed by Resend (free tier: 100/day) — swap the provider by editing
that one function. Needs the `RESEND_API_KEY` secret; `NEWSLETTER_FROM` is
optional until a sending domain is verified in Resend. Dry run:
`npm run newsletter -- --dry-run`.

## Google Places photos (`refresh-place-photos.ts`)

Replaces placeholder images (picsum/loremflickr) with the venue's real photo
from Google Places: Text Search → download top photo → upload to the Supabase
`place-images` bucket → point `image_url` at it (the image becomes ours; no
Google URL or key in the client). Key is swappable via `lib/places-api.ts`:
`GOOGLE_PLACES_API_KEY` (real) wins over `PLACES_API_DEMO_KEY` (placeholder in
`.env.local`; requests with it fail gracefully per place). Run manually when a
real key lands: `npm run photos:refresh` (or `-- --dry-run`; `-- --limit 5` caps the batch).

## LLM extraction + Mistral fallback (`llm-extract.ts`)

Shared by both ingestion scripts: calls Gemini (`gemini-flash-latest` — an
alias, not a pinned snapshot, so Google sunsetting a dated model ID like
`gemini-2.5-flash` — as happened 2026-07-10 — doesn't break the pipeline
again) with strict JSON-schema output. If Gemini's daily free-tier quota is
exhausted, the model itself gets sunset, or a chunk's calls keep failing, it
falls back to Mistral (`mistral-large-latest`, also an alias) using Mistral's
own strict `json_schema` structured output — same reliability guarantee,
different provider. Falls back per chunk, so a partial Gemini outage doesn't
lose an entire run.

Requires `MISTRAL_API_KEY` for the fallback to activate; without it, a failed
Gemini chunk is just skipped (previous behavior — no regression). Mistral's
free tier is rate-limited to 2 requests/minute, so fallback calls are
throttled to respect that; fine for a background job. Override the fallback
model with `MISTRAL_MODEL`.
