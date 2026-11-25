-- Messagerie privée et modération des messages signalés.
CREATE TABLE IF NOT EXISTS public.chat_conversations(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),created_at timestamptz NOT NULL DEFAULT now(),created_by uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE);
CREATE TABLE IF NOT EXISTS public.chat_participants(conversation_id uuid NOT NULL REFERENCES public.chat_conversations(id) ON DELETE CASCADE,user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,joined_at timestamptz NOT NULL DEFAULT now(),PRIMARY KEY(conversation_id,user_id));
CREATE TABLE IF NOT EXISTS public.chat_messages(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),conversation_id uuid NOT NULL REFERENCES public.chat_conversations(id) ON DELETE CASCADE,sender_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,body text NOT NULL CHECK(length(trim(body)) BETWEEN 1 AND 5000),created_at timestamptz NOT NULL DEFAULT now(),deleted_at timestamptz);
CREATE INDEX IF NOT EXISTS chat_messages_conversation_created_idx ON public.chat_messages(conversation_id,created_at);
CREATE TABLE IF NOT EXISTS public.chat_message_reports(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),message_id uuid NOT NULL REFERENCES public.chat_messages(id) ON DELETE CASCADE,reporter_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,reason text NOT NULL CHECK(length(trim(reason)) BETWEEN 3 AND 1000),status text NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','reviewed','dismissed')),created_at timestamptz NOT NULL DEFAULT now(),reviewed_at timestamptz,reviewed_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,UNIQUE(message_id,reporter_id));
ALTER TABLE public.chat_conversations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.chat_participants ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.chat_messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.chat_message_reports ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.chat_conversations,public.chat_participants,public.chat_messages,public.chat_message_reports FROM PUBLIC,anon,authenticated;

CREATE OR REPLACE FUNCTION public.chat_start_conversation(p_username text) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v_other uuid; v_id uuid;
BEGIN
 IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Connexion requise'; END IF;
 IF NOT EXISTS(SELECT 1 FROM public.profiles WHERE id=auth.uid() AND birth_date <= current_date - interval '18 years') THEN
  RAISE EXCEPTION 'Profil adulte vérifié requis';
 END IF;
 SELECT id INTO v_other FROM public.profiles
 WHERE lower(username)=lower(trim(p_username))
   AND id<>auth.uid()
   AND birth_date <= current_date - interval '18 years'
 LIMIT 1;
 IF v_other IS NULL THEN RAISE EXCEPTION 'Membre introuvable ou profil adulte non vérifié'; END IF;
 SELECT c.id INTO v_id FROM public.chat_conversations c
 JOIN public.chat_participants a ON a.conversation_id=c.id AND a.user_id=auth.uid()
 JOIN public.chat_participants b ON b.conversation_id=c.id AND b.user_id=v_other
 WHERE (SELECT count(*) FROM public.chat_participants x WHERE x.conversation_id=c.id)=2 LIMIT 1;
 IF v_id IS NULL THEN
  INSERT INTO public.chat_conversations(created_by) VALUES(auth.uid()) RETURNING id INTO v_id;
  INSERT INTO public.chat_participants VALUES(v_id,auth.uid(),now()),(v_id,v_other,now());
 END IF;
 RETURN v_id;
END $$;

CREATE OR REPLACE FUNCTION public.chat_list_conversations()
RETURNS TABLE(conversation_id uuid,other_user_id uuid,other_username text,last_message text,last_message_at timestamptz)
LANGUAGE sql SECURITY DEFINER SET search_path=public AS $$
 SELECT c.id,o.user_id,p.username::text,
 (SELECT m.body FROM public.chat_messages m WHERE m.conversation_id=c.id AND m.deleted_at IS NULL ORDER BY m.created_at DESC LIMIT 1),
 (SELECT m.created_at FROM public.chat_messages m WHERE m.conversation_id=c.id AND m.deleted_at IS NULL ORDER BY m.created_at DESC LIMIT 1)
 FROM public.chat_conversations c
 JOIN public.chat_participants me ON me.conversation_id=c.id AND me.user_id=auth.uid()
 JOIN public.chat_participants o ON o.conversation_id=c.id AND o.user_id<>auth.uid()
 JOIN public.profiles p ON p.id=o.user_id
 ORDER BY last_message_at DESC NULLS LAST;
$$;
CREATE OR REPLACE FUNCTION public.chat_list_messages(p_conversation_id uuid)
RETURNS TABLE(message_id uuid,sender_id uuid,sender_username text,body text,created_at timestamptz)
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
BEGIN
 IF NOT EXISTS(SELECT 1 FROM public.chat_participants WHERE conversation_id=p_conversation_id AND user_id=auth.uid()) THEN RAISE EXCEPTION 'Conversation inaccessible'; END IF;
 RETURN QUERY SELECT m.id,m.sender_id,COALESCE(p.username::text,'Membre'),m.body,m.created_at FROM public.chat_messages m LEFT JOIN public.profiles p ON p.id=m.sender_id WHERE m.conversation_id=p_conversation_id AND m.deleted_at IS NULL ORDER BY m.created_at;
END $$;
CREATE OR REPLACE FUNCTION public.chat_send_message(p_conversation_id uuid,p_body text)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v_id uuid;
BEGIN
 IF NOT EXISTS(SELECT 1 FROM public.chat_participants WHERE conversation_id=p_conversation_id AND user_id=auth.uid()) THEN RAISE EXCEPTION 'Conversation inaccessible'; END IF;
 IF length(trim(p_body)) NOT BETWEEN 1 AND 5000 THEN RAISE EXCEPTION 'Message invalide'; END IF;
 INSERT INTO public.chat_messages(conversation_id,sender_id,body) VALUES(p_conversation_id,auth.uid(),trim(p_body)) RETURNING id INTO v_id; RETURN v_id;
END $$;
CREATE OR REPLACE FUNCTION public.chat_report_message(p_message_id uuid,p_reason text)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v_conv uuid; v_id uuid;
BEGIN
 SELECT conversation_id INTO v_conv FROM public.chat_messages WHERE id=p_message_id AND deleted_at IS NULL;
 IF v_conv IS NULL OR NOT EXISTS(SELECT 1 FROM public.chat_participants WHERE conversation_id=v_conv AND user_id=auth.uid()) THEN RAISE EXCEPTION 'Message introuvable'; END IF;
 INSERT INTO public.chat_message_reports(message_id,reporter_id,reason) VALUES(p_message_id,auth.uid(),trim(p_reason))
 ON CONFLICT(message_id,reporter_id) DO UPDATE SET reason=excluded.reason,status='pending',created_at=now() RETURNING id INTO v_id; RETURN v_id;
END $$;
CREATE OR REPLACE FUNCTION public.admin_list_reported_messages()
RETURNS TABLE(report_id uuid,message_id uuid,reporter_email text,sender_email text,message_body text,reason text,reported_at timestamptz)
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,auth AS $$
BEGIN
 IF NOT public.is_crushlibre_super_admin() THEN RAISE EXCEPTION 'Accès Super-Admin requis'; END IF;
 INSERT INTO public.crushlibre_admin_audit(admin_id,action,details) VALUES(auth.uid(),'view_reported_messages','{"scope":"reported_messages_only"}'::jsonb);
 RETURN QUERY SELECT r.id,m.id,ru.email::text,su.email::text,m.body,r.reason,r.created_at FROM public.chat_message_reports r JOIN public.chat_messages m ON m.id=r.message_id LEFT JOIN auth.users ru ON ru.id=r.reporter_id LEFT JOIN auth.users su ON su.id=m.sender_id WHERE r.status='pending' ORDER BY r.created_at DESC;
END $$;
CREATE OR REPLACE FUNCTION public.admin_resolve_message_report(p_report_id uuid,p_dismiss boolean)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
BEGIN
 IF NOT public.is_crushlib_super_admin() THEN RAISE EXCEPTION 'Accès Super-Admin requis'; END IF;
 UPDATE public.chat_message_reports SET status=CASE WHEN p_dismiss THEN 'dismissed' ELSE 'reviewed' END,reviewed_at=now(),reviewed_by=auth.uid() WHERE id=p_report_id AND status='pending';
 IF NOT FOUND THEN RAISE EXCEPTION 'Signalement introuvable ou déjà traité'; END IF;
 INSERT INTO public.crushlibre_admin_audit(admin_id,action,details) VALUES(auth.uid(),'resolve_message_report',jsonb_build_object('report_id',p_report_id,'dismissed',p_dismiss));
END $$;
REVOKE ALL ON FUNCTION public.chat_start_conversation(text),public.chat_list_conversations(),public.chat_list_messages(uuid),public.chat_send_message(uuid,text),public.chat_report_message(uuid,text),public.admin_list_reported_messages(),public.admin_resolve_message_report(uuid,boolean) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.chat_start_conversation(text),public.chat_list_conversations(),public.chat_list_messages(uuid),public.chat_send_message(uuid,text),public.chat_report_message(uuid,text),public.admin_list_reported_messages(),public.admin_resolve_message_report(uuid,boolean) TO authenticated;
