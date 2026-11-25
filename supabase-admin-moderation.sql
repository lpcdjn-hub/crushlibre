-- CrushLibre — modération Super-Admin des photos
-- Remplacer l'adresse ci-dessous par l'email exact du compte Supabase Super-Admin avant exécution.
-- Le script ne rend aucune photo publique : les photos approuvées restent privées et nécessitent toujours le consentement du propriétaire.

CREATE TABLE IF NOT EXISTS public.crushlibre_super_admins (
  user_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.crushlibre_super_admins ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.crushlibre_super_admins FROM PUBLIC, anon, authenticated;

-- IMPORTANT : remplacer l'adresse d'exemple par l'adresse du compte Supabase du Super-Admin.
INSERT INTO public.crushlibre_super_admins(user_id)
SELECT id FROM auth.users
WHERE lower(email) = lower('lp.cdjn@gmail.com')
ON CONFLICT (user_id) DO NOTHING;

CREATE OR REPLACE FUNCTION public.is_crushlibre_super_admin()
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.crushlibre_super_admins a
    WHERE a.user_id = auth.uid()
  );
$$;
REVOKE ALL ON FUNCTION public.is_crushlibre_super_admin() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.is_crushlibre_super_admin() TO authenticated;

CREATE OR REPLACE FUNCTION public.list_pending_profile_media()
RETURNS TABLE (
  media_id uuid,
  owner_id uuid,
  owner_username text,
  storage_path text,
  caption text,
  created_at timestamptz
)
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.is_crushlibre_super_admin() THEN
    RAISE EXCEPTION 'Accès Super-Admin requis';
  END IF;
  RETURN QUERY
  SELECT m.id, m.owner_id, COALESCE(p.username::text, 'Membre'),
         m.storage_path, m.caption, m.created_at
  FROM public.media m
  LEFT JOIN public.profiles p ON p.id = m.owner_id
  WHERE m.context = 'profile'
    AND m.media_type = 'image'
    AND m.moderation_status = 'pending'
    AND m.deleted_at IS NULL
  ORDER BY m.created_at ASC;
END;
$$;

CREATE OR REPLACE FUNCTION public.moderate_profile_media(
  p_media_id uuid,
  p_approve boolean
)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.is_crushlibre_super_admin() THEN
    RAISE EXCEPTION 'Accès Super-Admin requis';
  END IF;
  UPDATE public.media
  SET moderation_status = CASE WHEN p_approve THEN 'approved' ELSE 'rejected' END
  WHERE id = p_media_id
    AND context = 'profile'
    AND media_type = 'image'
    AND moderation_status = 'pending'
    AND deleted_at IS NULL;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Photo introuvable ou déjà modérée';
  END IF;
END;
$$;
REVOKE ALL ON FUNCTION public.list_pending_profile_media() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.moderate_profile_media(uuid, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.list_pending_profile_media() TO authenticated;
GRANT EXECUTE ON FUNCTION public.moderate_profile_media(uuid, boolean) TO authenticated;
