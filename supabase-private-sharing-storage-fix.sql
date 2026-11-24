CREATE OR REPLACE FUNCTION public.can_read_shared_media(p_object_name text)
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.media m
    JOIN public.media_share_requests r ON r.media_id = m.id
    WHERE m.storage_path = p_object_name
      AND m.owner_id = r.owner_id
      AND r.requester_id = auth.uid()
      AND r.status = 'approved'
      AND m.visibility = 'selected_people'
      AND m.moderation_status = 'approved'
      AND m.deleted_at IS NULL
  );
$$;

REVOKE ALL ON FUNCTION public.can_read_shared_media(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.can_read_shared_media(text) TO authenticated;

DROP POLICY IF EXISTS "crushlib_read_approved_shared_media" ON storage.objects;
CREATE POLICY "crushlib_read_approved_shared_media"
ON storage.objects
FOR SELECT TO authenticated
USING (
  bucket_id = 'crushlib-private-media'
  AND public.can_read_shared_media(name)
);
