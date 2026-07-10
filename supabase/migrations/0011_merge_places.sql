-- Admin place-merge: collapse a duplicate place into a canonical one.
-- Repoints votes / comments / mentions from the source onto the target, then
-- deletes the source place. Runs as SECURITY DEFINER but is admin-gated, so it
-- can move other users' rows past RLS while staying safe.
--
-- Conflicts are expected and skipped:
--   • votes  — a user may have voted on both (PK place_id,user_id)
--   • mentions — the same source URL may appear on both (unique place_id,url)
-- Their source rows are dropped by the place delete's ON DELETE CASCADE.

create or replace function public.merge_places(p_source uuid, p_target uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_admin() then
    raise exception 'not authorized';
  end if;
  if p_source = p_target then
    raise exception 'source and target must differ';
  end if;

  -- Votes: move only those whose (target, user) pair is free; the rest cascade.
  update public.votes v
     set place_id = p_target
   where v.place_id = p_source
     and not exists (
       select 1 from public.votes t
        where t.place_id = p_target and t.user_id = v.user_id
     );

  -- Comments: no unique constraint — move them all.
  update public.comments
     set place_id = p_target
   where place_id = p_source;

  -- Mentions: move only those whose (target, url) pair is free; the rest cascade.
  update public.mentions m
     set place_id = p_target
   where m.place_id = p_source
     and not exists (
       select 1 from public.mentions t
        where t.place_id = p_target
          and t.url is not distinct from m.url
     );

  -- Anything left on the source (conflicting votes/mentions) cascades away.
  delete from public.places where id = p_source;
end;
$$;

grant execute on function public.merge_places(uuid, uuid) to authenticated;
