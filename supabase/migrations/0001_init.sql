-- Whatsup Bangalore — initial schema
-- Run in the Supabase SQL editor (or `supabase db push`).

-- ── profiles ────────────────────────────────────────────────────────────────
create table public.profiles (
  id          uuid primary key references auth.users (id) on delete cascade,
  display_name text,
  avatar_url  text,
  is_admin    boolean not null default false,
  created_at  timestamptz not null default now()
);

-- Auto-create a profile row on signup, pulling name/avatar from Google.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  insert into public.profiles (id, display_name, avatar_url)
  values (
    new.id,
    coalesce(new.raw_user_meta_data ->> 'full_name', new.raw_user_meta_data ->> 'name', split_part(new.email, '@', 1)),
    new.raw_user_meta_data ->> 'avatar_url'
  );
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- Helper used by RLS policies.
create or replace function public.is_admin()
returns boolean
language sql
security definer set search_path = public
stable
as $$
  select coalesce((select is_admin from public.profiles where id = auth.uid()), false);
$$;

-- ── places ──────────────────────────────────────────────────────────────────
create table public.places (
  id          uuid primary key default gen_random_uuid(),
  title       text not null,
  description text not null default '',
  category    text not null check (category in
    ('food','drinks','outdoors','art_culture','shopping','nightlife','experience','event')),
  lat         double precision not null,
  lng         double precision not null,
  address     text,
  area        text,
  image_url   text,
  source_url  text,
  event_start timestamptz,
  event_end   timestamptz,
  status      text not null default 'pending' check (status in ('pending','approved','rejected')),
  source      text not null default 'user' check (source in ('curated','user','reddit','events_feed')),
  created_by  uuid references public.profiles (id) on delete set null,
  created_at  timestamptz not null default now()
);

-- ── votes / comments ─────────────────────────────────────────────────────────
create table public.votes (
  place_id   uuid not null references public.places (id) on delete cascade,
  user_id    uuid not null references public.profiles (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (place_id, user_id)
);

create table public.comments (
  id         uuid primary key default gen_random_uuid(),
  place_id   uuid not null references public.places (id) on delete cascade,
  user_id    uuid not null references public.profiles (id) on delete cascade,
  body       text not null check (char_length(body) between 1 and 2000),
  created_at timestamptz not null default now()
);

-- ── mentions (Phase 2 ingestion writes here via service role) ────────────────
create table public.mentions (
  id               uuid primary key default gen_random_uuid(),
  place_id         uuid not null references public.places (id) on delete cascade,
  platform         text not null check (platform in ('reddit','instagram','x','news')),
  url              text,
  title            text,
  engagement_score double precision not null default 0,
  mentioned_at     timestamptz not null default now()
);

create index places_status_idx on public.places (status);
create index votes_place_idx on public.votes (place_id);
create index comments_place_idx on public.comments (place_id);
create index mentions_place_idx on public.mentions (place_id);

-- ── places_with_stats ────────────────────────────────────────────────────────
-- trending_score: exponentially time-decayed activity over the last 14 days.
-- A vote today ≈ 1.0, a vote 7 days ago ≈ 0.37; comments count 1.5x (more effort);
-- external mention engagement is normalized in by the pipeline.
create or replace view public.places_with_stats
with (security_invoker = on) as
select
  p.*,
  coalesce(v.vote_count, 0)::int    as vote_count,
  coalesce(c.comment_count, 0)::int as comment_count,
  exists (
    select 1 from public.votes me
    where me.place_id = p.id and me.user_id = auth.uid()
  ) as voted_by_me,
  round((
    coalesce(v.decayed, 0) + 1.5 * coalesce(c.decayed, 0) + coalesce(m.decayed, 0)
  )::numeric, 3)::double precision  as trending_score
from public.places p
left join lateral (
  select count(*) as vote_count,
         sum(exp(-extract(epoch from now() - created_at) / (86400.0 * 7))) as decayed
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

-- comment_count above only counts the last 14 days for scoring; expose total separately
-- via the comments query on the detail sheet, which fetches actual rows.

-- ── Row Level Security ───────────────────────────────────────────────────────
alter table public.profiles enable row level security;
alter table public.places   enable row level security;
alter table public.votes    enable row level security;
alter table public.comments enable row level security;
alter table public.mentions enable row level security;

create policy "profiles are readable by everyone"
  on public.profiles for select using (true);
create policy "users update own profile"
  on public.profiles for update using (auth.uid() = id);

create policy "approved places readable by everyone"
  on public.places for select
  using (status = 'approved' or created_by = auth.uid() or public.is_admin());
create policy "authed users submit places"
  on public.places for insert to authenticated
  with check (created_by = auth.uid() and (status = 'pending' or public.is_admin()));
create policy "admins update places"
  on public.places for update using (public.is_admin());
create policy "admins delete places"
  on public.places for delete using (public.is_admin());

create policy "votes readable by everyone"
  on public.votes for select using (true);
create policy "users vote as themselves"
  on public.votes for insert to authenticated with check (user_id = auth.uid());
create policy "users remove own vote"
  on public.votes for delete using (user_id = auth.uid());

create policy "comments readable by everyone"
  on public.comments for select using (true);
create policy "users comment as themselves"
  on public.comments for insert to authenticated with check (user_id = auth.uid());
create policy "users delete own comments, admins any"
  on public.comments for delete using (user_id = auth.uid() or public.is_admin());

create policy "mentions readable by everyone"
  on public.mentions for select using (true);
-- No insert/update policies on mentions: only the service-role key (ingestion
-- pipeline) can write, since service role bypasses RLS.
