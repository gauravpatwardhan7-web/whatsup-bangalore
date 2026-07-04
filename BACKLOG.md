# Backlog

Ideas parked for later. Newest ideas at the top of "Feature ideas". Roughly ordered within each section; not committed scope.

## Guardrails & edge cases (must-address before real users)

The MVP trusts users. A public, community-enriched map needs abuse handling or it degrades fast. Grouped by area; each needs a decision + implementation.

### Duplicate / conflicting spots
The one that prompted this. Two people add the same place (accidentally, or deliberately to spam/vandalize).
- ✅ **Detect on submit** (done 2026-07-03): checks for an existing place within ~75m with a fuzzy-matching title → warn-and-allow ("add anyway" to override). `lib/guardrails.ts` + `fetchNearbyPlaces` in `lib/data.ts`.
- **Merge tooling (admin)**: pick a canonical place, fold votes/comments/photos from the duplicate into it, redirect/delete the other. Needs a `merged_into` column or a merge RPC.
- **Community flag**: "Report as duplicate / wrong location / closed" on the detail sheet → goes to an admin queue.
- Decide: auto-block near-exact dupes vs. allow-with-warning vs. always-allow-then-merge. (Leaning: warn-and-allow, then admin merge.)

### Vote / trending manipulation
- One-vote-per-user is enforced by the PK, but a determined user makes multiple Google accounts to inflate/bury a spot.
- Rate-limit votes/submissions per user per hour. Consider velocity checks (20 votes in 10s = bot).
- Trending score should resist brigading: cap per-user influence, weight by account age, or dampen sudden spikes. Revisit when Phase 2 external signals join the score.

### Spam / abusive content
- Submissions and comments are free text + user image uploads → profanity, hate, spam links, NSFW/irrelevant photos.
- Text: basic profanity/link filter on submit; report button on comments; soft-delete + shadow-ban repeat offenders.
- Images: size/type limits exist (5MB), but need NSFW/format validation and EXIF stripping (uploads can leak location/personal data).
- Non-admin submissions already go to a `pending` queue — keep that as the backstop, but it doesn't scale without the above.

### Bad / malicious location data
- Pin dropped in the wrong place, offshore, or outside Bengaluru entirely (map-center drop makes this easy).
- ✅ Validate lat/lng is inside a Bengaluru bounding box on submit (done 2026-07-03, `isInBengaluru` in `lib/guardrails.ts`).
- Nominatim/geocoding can return nothing or wrong results — handle empty + let user adjust the pin.
- ✅ Events with past dates, end-before-start, or absurd future dates → validated on submit (done 2026-07-03, `validateEventDates`).

### Auth / account edge cases
- Google returns no email, or a user revokes access. `handle_new_user` assumes name/email exist — harden the trigger.
- Deleted auth user: `on delete cascade` wipes their places/votes/comments — is that desired, or should content persist anonymized?
- Admin bootstrapping is manual SQL — fine now, but document/secure it; don't ship a way to self-promote.

### Reliability / infra
- Free-tier Supabase pauses after ~1 week idle → app looks broken. Monitor + document un-pause.
- OpenFreeMap tiles are a free community service and can go down (already saw a blank map once) → consider a paid tile fallback (MapTiler key) for production.
- Realtime channel drops on flaky networks → ensure graceful reconnect and that optimistic UI reconciles with server truth.
- Storage/DB quota exhaustion on free tier as photos pile up → monitor, add cleanup for rejected submissions.

### Privacy / safety
- "Use my current location" and uploaded photo EXIF can expose where a user lives — be explicit, strip EXIF, never store precise user location.
- Someone adds a private residence / doxes a location as a "spot" → reporting + takedown flow.

## Feature ideas

### Account / activity hub — "my contributions" + been-there / collectibles
A personal page collecting everything a signed-in user has done, so activity isn't scattered across individual places. (Prompted by: hard to find your own comment when you don't remember which place it's under.)
- **My activity**: every comment I've posted, every place I've upvoted, every spot I've submitted — each linking back to its place on the map. One place to see "what have I said / done".
- **Been-there / collectibles**: a "Been here ✓" toggle on the detail sheet (separate from the "Worth it?" upvote — vouching ≠ visited).
  - **On the map**: visited spots get a distinct marker (checkmark badge / muted style) so the map doubles as a personal travel log.
  - **In the account**: a "My Bengaluru" grid (12 spots visited, categories covered, streaks).
  - Gamify later: badges for "visited 5 breweries", "all of Indiranagar", etc. → the "collectibles" angle.
- Data: new `visits` table (place_id, user_id, visited_at) mirrors `votes` shape + RLS; the "my activity" view is just filtered queries on existing comments/votes/places by created_by/user_id. Cheap.
- ✅ UX nudge that surfaced this: the "Why is it cool?" label now clarifies it becomes the spot's description, distinct from comments (done 2026-07-03).

## Already-planned phases (from the original plan)

### Phase 2 — Trending ingestion ("the map lights up on its own")
- ✅ **Reddit slice built (2026-07-04):** daily GitHub Action → r/bangalore hot posts → Claude extracts named places → geocode → match-or-create pending place → upsert `mentions` → feeds `trending_score`. `scripts/ingest-reddit.ts`, `.github/workflows/ingest-reddit.yml`, migration `0005`. Needs secrets + `0005` run to activate — see `scripts/README.md`. Remaining: tune extraction precision on real output; decide whether reddit-created places should auto-approve above an engagement threshold instead of always pending.
- Event feeds (BookMyShow / District / Insider) for weekend events.
- Instagram/X: no free official API — paste-a-link (oEmbed) now; paid scraper (Apify) only if wanted later.

### Phase 3 — Weekly digest
- Friday cron: top-trending + this-weekend events → `/weekly` page + email (Resend). "Plan your empty weekend."

## Nice-to-haves / polish
- Share link per place (OG image with the photo + trending badge).
- Photo uploads on comments ("here's what I ordered").
- Clustering when many pins overlap at low zoom.
- Save/bookmark ("want to go") — distinct from "been there".
- Filter by "open now" for venues with hours.
