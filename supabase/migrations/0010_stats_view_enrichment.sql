-- Rebuild places_with_stats so the enrichment columns added in 0009
-- (rating/rating_count/price_level/website) actually flow through.
--
-- Why this is needed: the view was defined with `select p.*` in 0001. Postgres
-- expands `*` into a fixed column list AT VIEW-CREATION TIME, so columns added
-- to public.places afterwards are invisible to the view until it's recreated.
-- `create or replace view` can't reshape the middle of the column list, so drop
-- and recreate. (Definition is otherwise identical to 0001.)

drop view if exists public.places_with_stats;

create view public.places_with_stats
with (security_invoker = on) as
select
  p.*,
  coalesce(v.score, 0)::int         as vote_count,   -- net = upvotes − downvotes
  coalesce(c.comment_count, 0)::int as comment_count,
  coalesce((
    select value from public.votes me
    where me.place_id = p.id and me.user_id = auth.uid()
  ), 0)::int                        as my_vote,       -- this user's direction (0 = none)
  round((
    coalesce(v.decayed, 0) + 1.5 * coalesce(c.decayed, 0) + coalesce(m.decayed, 0)
  )::numeric, 3)::double precision  as trending_score
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
