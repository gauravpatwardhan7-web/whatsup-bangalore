-- Multiple photos per place. image_url stays as the cover (first photo) so
-- existing rows and the map cards keep working; image_urls holds the full set.

alter table public.places
  add column if not exists image_urls text[] not null default '{}';

-- Backfill: single-photo rows get their photo in the array too.
update public.places
  set image_urls = array[image_url]
  where image_url is not null and image_urls = '{}';

-- Recreate the stats view so p.* picks up the new column.
drop view if exists public.places_with_stats;
create view public.places_with_stats
with (security_invoker = on) as
select
  p.*,
  coalesce(v.score, 0)::int         as vote_count,
  coalesce(c.comment_count, 0)::int as comment_count,
  coalesce((
    select value from public.votes me
    where me.place_id = p.id and me.user_id = auth.uid()
  ), 0)::int                        as my_vote,
  round((
    coalesce(v.decayed, 0) + 1.5 * coalesce(c.decayed, 0) + coalesce(m.decayed, 0)
  )::numeric, 3)::double precision   as trending_score
from public.places p
left join lateral (
  select sum(value) as score,
         sum(value * exp(-extract(epoch from now() - created_at) / (86400.0 * 7))) as decayed
  from public.votes where place_id = p.id and created_at > now() - interval '14 days'
) v on true
left join lateral (
  select count(*) as comment_count,
         sum(exp(-extract(epoch from now() - created_at) / (86400.0 * 7))) as decayed
  from public.comments where place_id = p.id and created_at > now() - interval '14 days'
) c on true
left join lateral (
  select sum(engagement_score * exp(-extract(epoch from now() - mentioned_at) / (86400.0 * 7))) as decayed
  from public.mentions where place_id = p.id and mentioned_at > now() - interval '14 days'
) m on true;
