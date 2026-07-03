# Backlog

Ideas parked for later. Newest ideas at the top of "Feature ideas". Roughly ordered within each section; not committed scope.

## Feature ideas

### Been-there / collectibles ("places I've visited")
Let a signed-in user mark places they've been to, and see that history as a personal collection.
- A "Been here ✓" toggle on the place detail sheet (separate from the "Worth it?" upvote — vouching ≠ visited).
- View the collection two ways:
  - **On the map**: visited spots get a distinct marker (e.g. a checkmark badge / muted style) so the map doubles as a personal travel log.
  - **In the account**: a list/grid ("My Bengaluru" — 12 spots visited, streaks, categories covered).
- Gamify later: badges for "visited 5 breweries", "all of Indiranagar", etc. → the "collectibles" angle.
- Data: new `visits` table (place_id, user_id, visited_at), mirrors the `votes` table shape + RLS. Cheap to add.

## Already-planned phases (from the original plan)

### Phase 2 — Trending ingestion ("the map lights up on its own")
- Daily GitHub Action pulls r/bangalore hot posts → LLM extracts place/event names → geocode → upsert into `mentions` (schema already exists) → feeds `trending_score`.
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
