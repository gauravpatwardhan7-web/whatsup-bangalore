-- 1) Allow YouTube as an ingestion source (mentions.platform + places.source).
-- 2) Repoint existing loremflickr images at stable picsum seeds — loremflickr
--    re-indexes its photo pool, so "locked" images still changed day to day.
--    Picsum /seed/<slug> URLs are deterministic forever.

alter table public.mentions drop constraint mentions_platform_check;
alter table public.mentions add constraint mentions_platform_check
  check (platform in ('reddit','instagram','x','news','youtube'));

alter table public.places drop constraint places_source_check;
alter table public.places add constraint places_source_check
  check (source in ('curated','user','reddit','events_feed','youtube'));

update public.places
  set image_url = 'https://picsum.photos/seed/'
    || regexp_replace(lower(title), '[^a-z0-9]+', '-', 'g')
    || '/600/400'
where image_url like 'https://loremflickr.com/%';

-- image_urls mirrors image_url for rows that only had the placeholder.
update public.places
  set image_urls = array[image_url]
where image_url like 'https://picsum.photos/%'
  and (image_urls = '{}' or image_urls[1] like 'https://loremflickr.com/%');
