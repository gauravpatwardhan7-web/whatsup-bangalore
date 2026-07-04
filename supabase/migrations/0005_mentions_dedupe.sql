-- Phase 2 (Reddit ingestion): make mention writes idempotent.
-- The daily job may re-see the same Reddit post; one post can mention several
-- places, so the natural key is (place_id, url). A plain unique index is enough
-- because Postgres treats NULL urls as distinct (future non-URL mentions won't
-- collide). Lets the ingester upsert with onConflict = 'place_id,url'.

create unique index if not exists mentions_place_url_key
  on public.mentions (place_id, url);
