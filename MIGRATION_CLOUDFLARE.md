# CrûshFree — migration indépendante de Supabase

Fondateur : Lauris Coucaud.

## État
Branche de travail : `migration/cloudflare-free`.
Aucune donnée ni aucun service Supabase n'a été supprimé ou modifié. Le site publié continue donc de fonctionner comme avant.

## Audit initial du frontend
Le fichier `index.html` charge encore le SDK Supabase et `app.js` crée un client Supabase avec une clé publishable.
Fonctions actuellement dépendantes de Supabase repérées dans `app.js` :
- Authentification : inscription, connexion, réinitialisation du mot de passe, session.
- Profils : `profiles`.
- Photos privées : table `media` et bucket `crushlib-private-media`.
- Partage de photos : `search_shareable_media`, `request_media_access`, `list_media_share_requests`, `respond_media_share_request`.
- Administration et modération : `is_crushlibre_super_admin`, `list_pending_profile_media`, `moderate_profile_media`, `admin_list_members`, `admin_list_member_media`, `admin_list_reported_messages`, `admin_resolve_message_report`.
- Messagerie : `chat_list_conversations`, `chat_list_messages`, `chat_report_message`, `chat_start_conversation`, `chat_send_message`.
- Carte : table `member_locations` et RPC `map_visible_members`.

## Architecture cible sans Supabase
- Cloudflare Pages : fichiers du site.
- Cloudflare Workers : API et logique serveur.
- Cloudflare D1 : comptes applicatifs, profils, conversations, messages, signalements, demandes de partage et positions à durée limitée.
- Stockage privé : à choisir après vérification des quotas gratuits et des règles d'accès. Les photos ne doivent jamais devenir publiques par défaut.
- Authentification : sessions sécurisées côté serveur, mots de passe hachés, limitation des tentatives, réinitialisation d'accès et vérification d'adresse email à concevoir.

## Conditions de sécurité non négociables
- Ne jamais faire confiance à une simple case « j'ai 18 ans » côté navigateur pour autoriser l'espace adulte.
- Contrôler l'âge et les autorisations côté serveur.
- Ne pas créer d'espace mineurs dans cette application de rencontres adultes ; maintenir une séparation stricte et aucune visibilité croisée si un espace jeunesse distinct est un jour développé.
- La position est facultative, visible uniquement selon le consentement explicite, limitée dans le temps et supprimable immédiatement.
- Photos privées par défaut ; accès temporaire uniquement après consentement vérifié côté serveur.
- Les actions du Super-Admin sont protégées côté serveur et journalisées.
- Prévoir blocage, signalement, suppression de compte, export et suppression RGPD.

## Étapes avant bascule
1. Obtenir l'inventaire complet du schéma SQL et des politiques RLS Supabase.
2. Créer le projet Cloudflare en offre gratuite et vérifier les limites/quota.
3. Construire les tables D1 et les API Worker sur cette branche.
4. Migrer les comptes et données avec une procédure sécurisée ; les mots de passe ne sont pas exportables en clair et peuvent nécessiter une réinitialisation.
5. Tester chaque parcours, les permissions entre deux comptes, le Super-Admin, les photos privées, la messagerie et la carte.
6. Basculer le site uniquement après validation complète.

## Règle de déploiement
Ne pas supprimer, mettre en pause ni désactiver Supabase avant la fin des tests et la confirmation explicite du propriétaire.
