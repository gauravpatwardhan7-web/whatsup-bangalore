# Backlog

Ideas parked for later. Newest ideas at the top of "Feature ideas". Roughly ordered within each section; not committed scope.

## Feature ideas

### Account / activity hub — "my contributions" + been-there / collectibles
A personal page collecting everything a signed-in user has done, so activity isn't scattered across individual places. (Prompted by: hard to find your own comment when you don't remember which place it's under.)
- **My activity**: every comment I've posted, every place I've upvoted, every spot I've submitted — each linking back to its place on the map. One place to see "what have I said / done".
- **Been-there / collectibles**: a "Been here ✓" toggle on the detail sheet (separate from the "Worth it?" upvote — vouching ≠ visited).
  - **On the map**: visited spots get a distinct marker (checkmark badge / muted style) so the map doubles as a personal travel log.
  - **In the account**: a "My Bengaluru" grid (12 spots visited, categories covered, streaks).
  - Gamify later: badges for "visited 5 breweries", "all of Indiranagar", etc. → the "collectibles" angle.
- Data: new `visits` table (place_id, user_id, visited_at) mirrors `votes` shape + RLS; the "my activity" view is just filtered queries on existing comments/votes/places by created_by/user_id. Cheap.
- UX nudge that surfaced this: in the submit form, the "Why is it cool?" description field and the comment box are easy to confuse — consider clearer labels/help text.

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
