-- Google Places enrichment fields, populated at ingestion (scripts/ingest-*.ts)
-- or by scripts/refresh-place-photos.ts. All nullable — user/curated rows and
-- places Google doesn't know simply leave them null.
--
-- places_with_stats does `select p.*`, so these flow through the view with no
-- change needed there.

alter table public.places
  add column if not exists rating       real,       -- Google stars, 0–5
  add column if not exists rating_count  integer,    -- number of Google reviews
  add column if not exists price_level   smallint,   -- 0 (free) – 4 (very expensive)
  add column if not exists website       text;       -- official venue website
