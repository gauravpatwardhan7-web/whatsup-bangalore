-- Let authors edit their own places (admins already can via an earlier policy).
-- A trigger prevents non-admins from changing moderation-sensitive columns, so
-- an author can fix content/photos but can't self-approve or reassign ownership.

create policy "authors update own places"
  on public.places for update to authenticated
  using (created_by = auth.uid())
  with check (created_by = auth.uid());

create or replace function public.lock_place_moderation()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  if not public.is_admin() then
    new.status     := old.status;      -- can't self-approve
    new.source     := old.source;
    new.created_by := old.created_by;  -- can't reassign ownership
  end if;
  return new;
end;
$$;

create trigger places_lock_moderation
  before update on public.places
  for each row execute function public.lock_place_moderation();
