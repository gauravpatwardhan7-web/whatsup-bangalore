-- Public bucket for place photos. Run after 0001_init.sql.

insert into storage.buckets (id, name, public)
values ('place-images', 'place-images', true)
on conflict (id) do nothing;

create policy "place images are publicly readable"
  on storage.objects for select
  using (bucket_id = 'place-images');

-- Users upload into a folder named after their uid (enforced below).
create policy "authed users upload place images to own folder"
  on storage.objects for insert to authenticated
  with check (
    bucket_id = 'place-images'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

create policy "users delete own place images, admins any"
  on storage.objects for delete to authenticated
  using (
    bucket_id = 'place-images'
    and ((storage.foldername(name))[1] = auth.uid()::text or public.is_admin())
  );
