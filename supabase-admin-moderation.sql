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


-- Console Super-Admin : membres, contenus et journal d'accès
CREATE TABLE IF NOT EXISTS public.crushlibre_admin_audit (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  admin_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  action text NOT NULL,
  target_user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  target_media_id uuid,
  details jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.crushlibre_admin_audit ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.crushlibre_admin_audit FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.admin_list_members()
RETURNS TABLE (
  member_id uuid,
  email text,
  username text,
  bio text,
  birth_date date,
  joined_at timestamptz,
  last_sign_in_at timestamptz
)
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, auth
AS $$
BEGIN
  IF NOT public.is_crushlibre_super_admin() THEN
    RAISE EXCEPTION 'Accès Super-Admin requis';
  END IF;
  INSERT INTO public.crushlibre_admin_audit(admin_id,action,details)
  VALUES(auth.uid(),'list_members','{"scope":"member_directory"}'::jsonb);
  RETURN QUERY
  SELECT u.id, u.email::text, p.username::text, p.bio::text, p.birth_date,
         u.created_at, u.last_sign_in_at
  FROM auth.users u
  LEFT JOIN public.profiles p ON p.id=u.id
  ORDER BY u.created_at DESC;
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_list_member_media(p_member_id uuid)
RETURNS TABLE (
  media_id uuid,
  media_type text,
  context text,
  caption text,
  storage_path text,
  visibility text,
  moderation_status text,
  created_at timestamptz
)
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.is_crushlib_super_admin() THEN
    RAISE EXCEPTION 'Accès Super-Admin requis';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM auth.users WHERE id=p_member_id) THEN
    RAISE EXCEPTION 'Membre introuvable';
  END IF;
  INSERT INTO public.crushlibre_admin_audit(admin_id,action,target_user_id,details)
  VALUES(auth.uid(),'view_member_media',p_member_id,'{"scope":"member_media"}'::jsonb);
  RETURN QUERY
  SELECT m.id, m.media_type::text, m.context::text, m.caption::text,
         m.storage_path::text, m.visibility::text, m.moderation_status::text,
         m.created_at
  FROM public.media m
  WHERE m.owner_id=p_member_id AND m.deleted_at IS NULL
  ORDER BY m.created_at DESC;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_list_members() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.admin_list_member_media(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_list_members() TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_list_member_media(uuid) TO authenticated;

-- Permet au Super-Admin d'obtenir des URL signées pour les médias
-- uniquement après appel des RPC de consultation journalisées.
DROP POLICY IF EXISTS "crushlib_super_admin_media_read" ON storage.objects;
CREATE POLICY "crushlib_super_admin_media_read"
ON storage.objects FOR SELECT TO authenticated
USING (
  bucket_id='crushlib-private-media'
  AND public.is_crushlib_super_admin()
);
