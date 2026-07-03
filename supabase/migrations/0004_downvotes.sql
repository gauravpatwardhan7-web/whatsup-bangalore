-- Downvotes: each user's vote carries a direction (+1 up / -1 down).
-- Net score = sum(value) = upvotes − downvotes. Run in the SQL Editor.

-- 1. Add the direction to votes (existing rows were upvotes → default 1).
alter table public.votes
  add column if not exists value smallint not null default 1 check (value in (-1, 1));

-- 2. Allow flipping a vote's direction (upsert's UPDATE half needs this policy).
drop policy if exists "users change own vote" on public.votes;
create policy "users change own vote"
  on public.votes for update
  using (user_id = auth.uid()) with check (user_id = auth.uid());

-- 3. Recreate the stats view: vote_count is now the NET score, plus my_vote
--    (this user's direction), and downvotes pull the trending score down.
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
