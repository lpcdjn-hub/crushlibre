-- CrushLibre: demandes de partage privé avec consentement explicite
-- À exécuter une seule fois dans Supabase SQL Editor.

CREATE TABLE IF NOT EXISTS public.media_share_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  media_id uuid NOT NULL REFERENCES public.media(id) ON DELETE CASCADE,
  owner_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  requester_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'approved', 'rejected')),
  created_at timestamptz NOT NULL DEFAULT now(),
  responded_at timestamptz,
  CONSTRAINT media_share_requests_no_self CHECK (owner_id <> requester_id),
  CONSTRAINT media_share_requests_unique UNIQUE (media_id, requester_id)
);

ALTER TABLE public.media_share_requests ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "media_share_requests_participant_read" ON public.media_share_requests;
CREATE POLICY "media_share_requests_participant_read"
ON public.media_share_requests
FOR SELECT TO authenticated
USING (requester_id = auth.uid() OR owner_id = auth.uid());

-- Les écritures passent par les fonctions SECURITY DEFINER ci-dessous.
REVOKE ALL ON public.media_share_requests FROM anon, authenticated;

CREATE OR REPLACE FUNCTION public.search_shareable_media(p_username text)
RETURNS TABLE (
  media_id uuid,
  owner_username text,
  caption text,
  request_status text,
  storage_path text
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    m.id,
    p.username::text,
    m.caption,
    COALESCE(r.status, 'none')::text,
    CASE WHEN r.status = 'approved' THEN m.storage_path ELSE NULL END
  FROM public.media AS m
  JOIN public.profiles AS p ON p.id = m.owner_id
  LEFT JOIN public.media_share_requests AS r
    ON r.media_id = m.id AND r.requester_id = auth.uid()
  WHERE auth.uid() IS NOT NULL
    AND lower(p.username) = lower(trim(p_username))
    AND p.birth_date <= current_date - interval '18 years'
    AND EXISTS (
      SELECT 1 FROM public.profiles me
      WHERE me.id = auth.uid()
        AND me.birth_date <= current_date - interval '18 years'
    )
    AND m.owner_id <> auth.uid()
    AND m.context = 'profile'
    AND m.media_type = 'image'
    AND m.visibility = 'selected_people'
    AND m.moderation_status = 'approved'
    AND m.deleted_at IS NULL
  ORDER BY m.created_at DESC;
$$;

CREATE OR REPLACE FUNCTION public.request_media_access(p_media_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_owner uuid;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Connexion requise';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.profiles me
    WHERE me.id = auth.uid()
      AND me.birth_date <= current_date - interval '18 years'
  ) THEN
    RAISE EXCEPTION 'Profil adulte vérifié requis';
  END IF;

  SELECT owner_id INTO v_owner
  FROM public.media
  WHERE id = p_media_id
    AND context = 'profile'
    AND media_type = 'image'
    AND visibility = 'selected_people'
    AND moderation_status = 'approved'
    AND deleted_at IS NULL;

  IF v_owner IS NULL OR v_owner = auth.uid() THEN
    RAISE EXCEPTION 'Cette photo ne peut pas faire l’objet d’une demande';
  END IF;

  INSERT INTO public.media_share_requests(media_id, owner_id, requester_id)
  VALUES (p_media_id, v_owner, auth.uid())
  ON CONFLICT (media_id, requester_id)
  DO UPDATE SET status = 'pending', created_at = now(), responded_at = NULL
  WHERE public.media_share_requests.status = 'rejected';
END;
$$;

CREATE OR REPLACE FUNCTION public.list_media_share_requests()
RETURNS TABLE (
  request_id uuid,
  media_id uuid,
  other_username text,
  status text,
  direction text,
  caption text,
  created_at timestamptz
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT r.id, r.media_id, p.username::text, r.status, 'incoming'::text,
         m.caption, r.created_at
  FROM public.media_share_requests r
  JOIN public.profiles p ON p.id = r.requester_id
  JOIN public.media m ON m.id = r.media_id
  WHERE r.owner_id = auth.uid()
  UNION ALL
  SELECT r.id, r.media_id, p.username::text, r.status, 'outgoing'::text,
         m.caption, r.created_at
  FROM public.media_share_requests r
  JOIN public.profiles p ON p.id = r.owner_id
  JOIN public.media m ON m.id = r.media_id
  WHERE r.requester_id = auth.uid()
  ORDER BY created_at DESC;
$$;

CREATE OR REPLACE FUNCTION public.respond_media_share_request(
  p_request_id uuid,
  p_approve boolean
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE public.media_share_requests
  SET status = CASE WHEN p_approve THEN 'approved' ELSE 'rejected' END,
      responded_at = now()
  WHERE id = p_request_id
    AND owner_id = auth.uid()
    AND status = 'pending';

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Demande introuvable ou déjà traitée';
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.search_shareable_media(text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.request_media_access(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.list_media_share_requests() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.respond_media_share_request(uuid, boolean) FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.search_shareable_media(text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.request_media_access(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.list_media_share_requests() TO authenticated;
GRANT EXECUTE ON FUNCTION public.respond_media_share_request(uuid, boolean) TO authenticated;

-- Fonction SECURITY DEFINER pour vérifier l'accès depuis Storage
-- sans être bloqué par la RLS de public.media.
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

-- Lecture Storage uniquement après accord explicite du propriétaire.
DROP POLICY IF EXISTS "crushlib_read_approved_shared_media" ON storage.objects;
CREATE POLICY "crushlib_read_approved_shared_media"
ON storage.objects
FOR SELECT TO authenticated
USING (
  bucket_id = 'crushlib-private-media'
  AND public.can_read_shared_media(name)
);
