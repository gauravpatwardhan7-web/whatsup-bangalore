-- Enable Supabase Realtime for live vote/comment updates on the map.
-- Run in the SQL Editor after the earlier migrations.

-- Broadcast row changes on these tables to subscribed clients.
alter publication supabase_realtime add table public.votes;
alter publication supabase_realtime add table public.comments;

-- votes' primary key is (place_id, user_id), so DELETE events already carry
-- place_id. comments' PK is just id, so widen its replica identity to include
-- place_id in DELETE payloads (needed to know which place to refresh).
alter table public.comments replica identity full;
