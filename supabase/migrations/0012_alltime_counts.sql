-- Fix: vote_count / comment_count were windowed to the last 14 days along with
-- the decay math, so a place upvoted 2+ weeks ago showed 0 votes. Counts must
-- be all-time; only the *decayed* trending component keeps the 14-day window
-- (via FILTER). View shape (column list/order) is unchanged from 0010.

drop view if exists public.places_with_stats;

create view public.places_with_stats
with (security_invoker = on) as
select
  p.*,
  coalesce(v.score, 0)::int         as vote_count,   -- net = upvotes − downvotes, all-time
  coalesce(c.comment_count, 0)::int as comment_count, -- all-time
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
         sum(value * exp(-extract(epoch from now() - created_at) / (86400.0 * 7)))
           filter (where created_at > now() - interval '14 days') as decayed
  from public.votes where place_id = p.id
) v on true
left join lateral (
  select count(*) as comment_count,
         sum(exp(-extract(epoch from now() - created_at) / (86400.0 * 7)))
           filter (where created_at > now() - interval '14 days') as decayed
  from public.comments where place_id = p.id
) c on true
left join lateral (
  select sum(engagement_score * exp(-extract(epoch from now() - mentioned_at) / (86400.0 * 7))) as decayed
  from public.mentions where place_id = p.id and mentioned_at > now() - interval '14 days'
) m on true;
