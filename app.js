const SUPABASE_URL='https://rlzunpnwtnkxmnygnkvv.supabase.co';const SUPABASE_KEY='sb_publishable_3eXxDChcMApOgp6TmKQ0QA_1z2VKhOE';const sb=window.supabase.createClient(SUPABASE_URL,SUPABASE_KEY);const $=id=>document.getElementById(id);const status=(m,ok=false)=>{$('status').textContent=m;$('status').className=ok?'success':'error';};function isAdult(dateString){if(!dateString)return false;const d=new Date(dateString+'T00:00:00');if(Number.isNaN(d.getTime()))return false;const today=new Date();let age=today.getFullYear()-d.getFullYear();const beforeBirthday=today.getMonth()<d.getMonth()||(today.getMonth()===d.getMonth()&&today.getDate()<d.getDate());if(beforeBirthday)age--;return age>=18&&d<=today;}function showSession(s){$('auth').classList.toggle('hidden',!!s);$('dashboard').classList.toggle('hidden',!s);if(s){$('userline').textContent=s.user.email;loadProfile(s.user.id);loadMyPhotos();shareRequests();loadModerationQueue();loadAdminMembers();loadAdminReports();loadChatConversations();loadMemberMap();}}async function loadProfile(id){const{data,error}=await sb.from('profiles').select('username,bio,birth_date').eq('id',id).maybeSingle();if(error){status('Connecté. Profil à initialiser : '+error.message);return;}if(data){$('username').value=data.username||'';$('bio').value=data.bio||'';$('birthdate').value=data.birth_date||'';}}$('signup').onclick=async()=>{if(!$('adult').checked){status('Confirmation 18+ obligatoire.');return;}const email=$('email').value.trim(),password=$('password').value;if(!email||password.length<8){status('Email et mot de passe de 8 caractères minimum requis.');return;}const{data,error}=await sb.auth.signUp({email,password,options:{data:{adult_confirmed:true}}});if(error){status(error.message);return;}status(data.session?'Compte créé et connecté.':'Compte créé. Vérifie ton email.',true);if(data.session)showSession(data.session);};$('login').onclick=async()=>{const{data,error}=await sb.auth.signInWithPassword({email:$('email').value.trim(),password:$('password').value});if(error){status(error.message);return;}status('Connexion réussie.',true);showSession(data.session);};$('forgot').onclick=async()=>{const email=$('email').value.trim();if(!email){status('Entre ton email dans le champ Email.');return;}const{error}=await sb.auth.resetPasswordForEmail(email,{redirectTo:window.location.origin+window.location.pathname});if(error){status(error.message);return;}status('Demande envoyée. Vérifie ta boîte email et tes spams.',true);};$('resetpassword').onclick=async()=>{const p=$('newpassword').value,c=$('confirmpassword').value;if(p.length<8){status('8 caractères minimum.');return;}if(p!==c){status('Les mots de passe ne correspondent pas.');return;}const{error}=await sb.auth.updateUser({password:p});if(error){status(error.message);return;}$('reset-card').classList.add('hidden');status('Mot de passe changé. Connecte-toi.',true);await sb.auth.signOut();showSession(null);};$('logout').onclick=async()=>{await sb.auth.signOut();showSession(null);status('Déconnexion effectuée.',true);};$('saveprofile').onclick=async()=>{const{data:{user}}=await sb.auth.getUser();if(!user){status('Reconnecte-toi.');return;}const birthDate=$('birthdate').value;if(!birthDate){status('Indique ta date de naissance pour enregistrer ton profil.');return;}if(!isAdult(birthDate)){status('CrushLibre est réservé aux personnes de 18 ans et plus.');return;}const{error}=await sb.from('profiles').upsert({id:user.id,username:$('username').value.trim(),bio:$('bio').value.trim(),birth_date:birthDate});if(error)status('Erreur profil : '+error.message);else status('Profil enregistré.',true);};sb.auth.getSession().then(({data})=>showSession(data.session));sb.auth.onAuthStateChange((event,session)=>{showSession(session);if(event==='PASSWORD_RECOVERY'){$('reset-card').classList.remove('hidden');$('auth').classList.add('hidden');status('Choisis ton nouveau mot de passe.',true);}});
const MEDIA_BUCKET='crushlib-private-media';
const MAX_PHOTO_BYTES=50*1024*1024;
async function loadMyPhotos(){
  const gallery=$('photo-gallery');
  if(!gallery)return;
  gallery.replaceChildren();
  const{data:{user}}=await sb.auth.getUser();
  if(!user)return;
  const{data:rows,error}=await sb.from('media')
    .select('id,storage_path,caption,created_at,moderation_status,visibility')
    .eq('owner_id',user.id).eq('context','profile').is('deleted_at',null)
    .order('created_at',{ascending:false});
  if(error){$('media-status').textContent='Impossible de charger les photos : '+error.message;return;}
  if(!rows?.length){gallery.textContent='Aucune photo pour le moment.';return;}
  for(const row of rows){
    const{data:signed,error:signedError}=await sb.storage.from(MEDIA_BUCKET).createSignedUrl(row.storage_path,300);
    if(signedError)continue;
    const card=document.createElement('article');card.className='photo-card';
    const img=document.createElement('img');img.src=signed.signedUrl;img.alt='Ma photo privée';img.loading='lazy';
    const meta=document.createElement('p');meta.textContent='Modération : '+row.moderation_status;
    const del=document.createElement('button');del.type='button';del.className='secondary';del.textContent='Supprimer';
    del.onclick=()=>deleteMyPhoto(row.id,row.storage_path,del);
    const share=document.createElement('button');share.type='button';share.className='secondary';share.textContent=row.visibility==='selected_people'?'Retirer du partage':'Autoriser les demandes';share.disabled=row.moderation_status!=='approved';share.onclick=async()=>{const v=row.visibility==='selected_people'?'private':'selected_people';if(v==='selected_people'&&!confirm('Autoriser les demandes d’accès à cette photo ?'))return;const{error}=await sb.from('media').update({visibility:v}).eq('id',row.id);if(error){$('media-status').textContent=error.message;return;}await loadMyPhotos();};card.append(img,meta,share,del);gallery.append(card);
  }
}
async function deleteMyPhoto(id,path,button){
  if(!confirm('Supprimer définitivement cette photo ?'))return;
  button.disabled=true;
  const{error:storageError}=await sb.storage.from(MEDIA_BUCKET).remove([path]);
  if(storageError){button.disabled=false;$('media-status').textContent='Suppression du fichier refusée : '+storageError.message+'. Vérifie la règle Storage DELETE.';return;}
  const{error}=await sb.from('media').update({deleted_at:new Date().toISOString()}).eq('id',id);
  if(error){$('media-status').textContent='Fichier supprimé, mais mise à jour de la fiche impossible : '+error.message;return;}
  $('media-status').textContent='Photo supprimée.';
  await loadMyPhotos();
}
$('upload-photos')?.addEventListener('click',async()=>{
  const input=$('photo-files'),files=Array.from(input.files||[]);
  if(!files.length){$('media-status').textContent='Choisis au moins une photo.';return;}
  const{data:{user}}=await sb.auth.getUser();
  if(!user){$('media-status').textContent='Reconnecte-toi.';return;}
  const button=$('upload-photos');button.disabled=true;
  let uploaded=0;
  for(const file of files){
    if(!['image/jpeg','image/png','image/webp'].includes(file.type)){ $('media-status').textContent='Format refusé : '+file.name;continue; }
    if(file.size>MAX_PHOTO_BYTES){$('media-status').textContent='Photo trop volumineuse (maximum 50 Mo) : '+file.name;continue;}
    const ext=file.type==='image/jpeg'?'jpg':file.type==='image/png'?'png':'webp';
    const path=user.id+'/'+crypto.randomUUID()+'.'+ext;
    const{error:uploadError}=await sb.storage.from(MEDIA_BUCKET).upload(path,file,{contentType:file.type,upsert:false});
    if(uploadError){$('media-status').textContent='Envoi impossible : '+uploadError.message;continue;}
    const{error:rowError}=await sb.from('media').insert({
      owner_id:user.id,storage_path:path,media_type:'image',context:'profile',
      visibility:'private',caption:null
    });
    if(rowError){
      $('media-status').textContent='Photo envoyée mais fiche média refusée : '+rowError.message+'. Le fichier reste privé dans le stockage.';
      continue;
    }
    uploaded++;
  }
  input.value='';button.disabled=false;
  if(uploaded)$('media-status').textContent=uploaded+' photo(s) ajoutée(s) à ta galerie privée.';
  await loadMyPhotos();
});

async function shareSearch(){
 const q=$('share-search-username').value.trim(),box=$('share-search-results');box.replaceChildren();
 if(!q){box.textContent='Saisis le pseudo exact du membre.';return;}
 const{data,error}=await sb.rpc('search_shareable_media',{p_username:q});
 if(error){box.textContent='Recherche indisponible : '+error.message;return;}
 if(!data||!data.length){box.textContent='Aucune photo partageable trouvée.';return;}
 for(const item of data){
  const card=document.createElement('article');card.className='share-card';
  const name=document.createElement('strong');name.textContent=item.owner_username;card.append(name);
  if(item.caption){const p=document.createElement('p');p.textContent=item.caption;card.append(p);}
  if(item.request_status==='approved'&&item.storage_path){
   const{data:signed,error:signError}=await sb.storage.from(MEDIA_BUCKET).createSignedUrl(item.storage_path,180);
   if(!signError){const img=document.createElement('img');img.src=signed.signedUrl;img.alt='Photo partagée';card.append(img);}
   const p=document.createElement('p');p.textContent='Accès autorisé';card.append(p);
  }else if(item.request_status==='pending'){
   const p=document.createElement('p');p.textContent='Demande en attente';card.append(p);
  }else{
   const b=document.createElement('button');b.type='button';b.textContent='Demander l’accès';
   b.onclick=async()=>{b.disabled=true;const{error:e}=await sb.rpc('request_media_access',{p_media_id:item.media_id});b.disabled=false;if(e){alert(e.message);return;}await shareSearch();await shareRequests();};
   card.append(b);
  }
  box.append(card);
 }
}
async function shareRequests(){
 const box=$('share-requests');if(!box)return;box.replaceChildren();
 const{data,error}=await sb.rpc('list_media_share_requests');
 if(error){box.textContent='Demandes indisponibles : '+error.message;return;}
 if(!data||!data.length){box.textContent='Aucune demande pour le moment.';return;}
 for(const item of data){
  const card=document.createElement('article');card.className='share-card';
  const p=document.createElement('p');p.textContent=(item.direction==='incoming'?'Demande reçue de ':'Demande envoyée à ')+item.other_username+' — '+item.status;card.append(p);
  if(item.direction==='incoming'&&item.status==='pending'){
   const yes=document.createElement('button');yes.textContent='Autoriser';yes.type='button';
   yes.onclick=async()=>{yes.disabled=true;const{error:e}=await sb.rpc('respond_media_share_request',{p_request_id:item.request_id,p_approve:true});if(e)alert(e.message);await shareRequests();};
   const no=document.createElement('button');no.textContent='Refuser';no.type='button';no.className='secondary';
   no.onclick=async()=>{no.disabled=true;const{error:e}=await sb.rpc('respond_media_share_request',{p_request_id:item.request_id,p_approve:false});if(e)alert(e.message);await shareRequests();};
   card.append(yes,no);
  }
  box.append(card);
 }
}
$('share-search')?.addEventListener('click',shareSearch);
$('refresh-share-requests')?.addEventListener('click',shareRequests);


// Modération réservée au Super-Admin (autorisation vérifiée côté base de données).
async function loadModerationQueue(){
  const panel=$('admin-moderation'),queue=$('moderation-queue'),label=$('moderation-status');
  if(!panel||!queue||!label)return;
  const{data:admin,error:adminError}=await sb.rpc('is_crushlibre_super_admin');
  if(adminError||admin!==true){panel.classList.add('hidden');return;}
  panel.classList.remove('hidden');queue.replaceChildren();label.textContent='Chargement…';
  const{data,error}=await sb.rpc('list_pending_profile_media');
  if(error){label.textContent='Erreur de modération : '+error.message;return;}
  label.textContent=(data?.length||0)+' photo(s) en attente.';
  if(!data?.length){queue.textContent='Aucune photo à modérer.';return;}
  for(const item of data){
    const card=document.createElement('article');card.className='photo-card';
    const{data:signed,error:signError}=await sb.storage.from(MEDIA_BUCKET).createSignedUrl(item.storage_path,180);
    if(!signError){const img=document.createElement('img');img.src=signed.signedUrl;img.alt='Photo à modérer';img.loading='lazy';card.append(img);}
    const info=document.createElement('p');info.textContent='Membre : '+item.owner_username;card.append(info);
    const approve=document.createElement('button');approve.type='button';approve.textContent='Approuver';
    approve.onclick=()=>moderatePhoto(item.media_id,true,approve);
    const reject=document.createElement('button');reject.type='button';reject.className='secondary';reject.textContent='Refuser';
    reject.onclick=()=>moderatePhoto(item.media_id,false,reject);
    card.append(approve,reject);queue.append(card);
  }
}
async function moderatePhoto(id,approve,button){
  button.disabled=true;
  const{error}=await sb.rpc('moderate_profile_media',{p_media_id:id,p_approve:approve});
  if(error){$('moderation-status').textContent='Action refusée : '+error.message;button.disabled=false;return;}
  $('moderation-status').textContent=approve?'Photo approuvée. Elle reste privée jusqu’au consentement du propriétaire.':'Photo refusée.';
  await loadModerationQueue();
}
$('refresh-moderation')?.addEventListener('click',loadModerationQueue);


// Outils Super-Admin pour les membres et leurs médias.
// Chaque consultation passe par une RPC SECURITY DEFINER journalisée.
async function loadAdminMembers(){
 const panel=$('admin-members'),list=$('members-list'),detail=$('member-detail'),label=$('members-status');
 if(!panel||!list||!detail||!label)return;
 const{data:admin,error:ae}=await sb.rpc('is_crushlibre_super_admin');
 if(ae||admin!==true){panel.classList.add('hidden');return;}
 panel.classList.remove('hidden');list.replaceChildren();detail.replaceChildren();label.textContent='Chargement des membres…';
 const{data,error}=await sb.rpc('admin_list_members');
 if(error){label.textContent='Impossible de charger les membres : '+error.message;return;}
 label.textContent=(data?.length||0)+' membre(s) trouvé(s).';
 if(!data?.length){list.textContent='Aucun membre enregistré.';return;}
 for(const m of data){
  const card=document.createElement('article');card.className='share-card';
  const title=document.createElement('strong');title.textContent=m.username||'Profil sans pseudo';card.append(title);
  const email=document.createElement('p');email.textContent=m.email||'Email non disponible';card.append(email);
  const bio=document.createElement('p');bio.textContent=m.bio||'Aucune bio';card.append(bio);
  const joined=document.createElement('p');joined.textContent='Inscription : '+new Date(m.joined_at).toLocaleDateString('fr-FR');card.append(joined);
  const birth=document.createElement('p');birth.textContent='Date de naissance : '+(m.birth_date||'Non renseignée');card.append(birth);
  const view=document.createElement('button');view.type='button';view.textContent='Voir ses contenus';
  view.onclick=()=>loadAdminMemberMedia(m.member_id,m.username||m.email);
  card.append(view);list.append(card);
 }
}
async function loadAdminMemberMedia(memberId,labelText){
 const box=$('member-detail');box.replaceChildren();
 const heading=document.createElement('h4');heading.textContent='Contenus de '+labelText;box.append(heading);
 const{data,error}=await sb.rpc('admin_list_member_media',{p_member_id:memberId});
 if(error){const p=document.createElement('p');p.textContent='Erreur : '+error.message;box.append(p);return;}
 if(!data?.length){const p=document.createElement('p');p.textContent='Aucun contenu actif enregistré.';box.append(p);return;}
 for(const item of data){
  const card=document.createElement('article');card.className='photo-card';
  const meta=document.createElement('p');meta.textContent=[item.media_type,item.context,'Modération : '+item.moderation_status,'Visibilité : '+item.visibility,item.caption||''].filter(Boolean).join(' · ');card.append(meta);
  if(item.storage_path&&item.media_type==='image'){
   const{data:signed,error:signError}=await sb.storage.from(MEDIA_BUCKET).createSignedUrl(item.storage_path,180);
   if(!signError){const img=document.createElement('img');img.src=signed.signedUrl;img.alt='Média consulté par le Super-Admin';img.loading='lazy';card.append(img);}
   else {const p=document.createElement('p');p.textContent='Aperçu indisponible : '+signError.message;card.append(p);}
  }
  box.append(card);
 }
}
$('refresh-members')?.addEventListener('click',loadAdminMembers);

let activeChatConversation=null;
async function loadChatConversations(){const box=$('chat-conversations');if(!box)return;box.replaceChildren();const{data,error}=await sb.rpc('chat_list_conversations');if(error){$('chat-status').textContent='Messagerie indisponible : '+error.message;return;}if(!data?.length){box.textContent='Aucune conversation pour le moment.';return;}for(const c of data){const b=document.createElement('button');b.type='button';b.className='secondary';b.textContent=(c.other_username||'Membre')+(c.last_message?' — '+c.last_message.slice(0,70):'');b.onclick=()=>openChat(c.conversation_id,c.other_username);box.append(b);}}
async function openChat(id,name){activeChatConversation=id;const box=$('chat-thread');box.replaceChildren();const h=document.createElement('h4');h.textContent='Conversation avec '+name;box.append(h);const{data,error}=await sb.rpc('chat_list_messages',{p_conversation_id:id});if(error){$('chat-status').textContent=error.message;return;}for(const m of data||[]){const card=document.createElement('article');card.className='share-card';const p=document.createElement('p');p.textContent=(m.sender_username||'Membre')+' · '+new Date(m.created_at).toLocaleString('fr-FR')+'\n'+m.body;card.append(p);const report=document.createElement('button');report.type='button';report.className='secondary';report.textContent='Signaler ce message';report.onclick=async()=>{const reason=prompt('Motif du signalement');if(!reason)return;const{error:e}=await sb.rpc('chat_report_message',{p_message_id:m.message_id,p_reason:reason});$('chat-status').textContent=e?'Signalement impossible : '+e.message:'Message signalé.';};card.append(report);box.append(card);}}
$('chat-start')?.addEventListener('click',async()=>{const username=$('chat-username').value.trim();if(!username)return;const{data,error}=await sb.rpc('chat_start_conversation',{p_username:username});if(error){$('chat-status').textContent=error.message;return;}await loadChatConversations();await openChat(data,username);});
$('chat-send')?.addEventListener('click',async()=>{const body=$('chat-message').value.trim();if(!activeChatConversation||!body)return;const{error}=await sb.rpc('chat_send_message',{p_conversation_id:activeChatConversation,p_body:body});if(error){$('chat-status').textContent=error.message;return;}$('chat-message').value='';await loadChatConversations();const name=$('chat-thread').querySelector('h4')?.textContent.replace('Conversation avec ','')||'Membre';await openChat(activeChatConversation,name);});
async function loadAdminReports(){const panel=$('admin-reports'),box=$('reports-list'),label=$('reports-status');if(!panel||!box||!label)return;const{data:admin,error:ae}=await sb.rpc('is_crushlibre_super_admin');if(ae||admin!==true){panel.classList.add('hidden');return;}panel.classList.remove('hidden');box.replaceChildren();const{data,error}=await sb.rpc('admin_list_reported_messages');if(error){label.textContent=error.message;return;}label.textContent=(data?.length||0)+' signalement(s) en attente.';if(!data?.length){box.textContent='Aucun message signalé.';return;}for(const r of data){const card=document.createElement('article');card.className='share-card';const p=document.createElement('p');p.textContent='Expéditeur : '+(r.sender_email||'inconnu')+' · Signalé par : '+(r.reporter_email||'inconnu')+'\nMotif : '+r.reason+'\nMessage : '+r.message_body;card.append(p);for(const dismiss of [false,true]){const b=document.createElement('button');b.type='button';b.className=dismiss?'secondary':'';b.textContent=dismiss?'Classer sans suite':'Traiter le signalement';b.onclick=async()=>{const{error:e}=await sb.rpc('admin_resolve_message_report',{p_report_id:r.report_id,p_dismiss:dismiss});if(e){label.textContent=e.message;return;}await loadAdminReports();};card.append(b);}box.append(card);}}
$('refresh-reports')?.addEventListener('click',loadAdminReports);

let memberMap=null;
let memberMapLayer=null;
function ensureMemberMap(){
 const el=$('member-map-view');if(!el||!window.L)return null;
 if(!memberMap){
  memberMap=L.map(el).setView([46.5,2.5],5);
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',{maxZoom:18,attribution:'&copy; OpenStreetMap'}).addTo(memberMap);
  memberMapLayer=L.layerGroup().addTo(memberMap);
 }
 return memberMap;
}
async function loadMemberMap(){
 const map=ensureMemberMap();if(!map)return;
 const{data:{user}}=await sb.auth.getUser();if(!user)return;
 const{data:own,error:ownError}=await sb.from('member_locations').select('sharing_scope,updated_at,expires_at').eq('user_id',user.id).maybeSingle();
 if(ownError){$('map-status').textContent='Carte indisponible : '+ownError.message;return;}
 if(own&&new Date(own.expires_at)>new Date()){
  $('map-scope').value=own.sharing_scope;
  $('map-status').textContent='Ta position est partagée jusqu’à '+new Date(own.expires_at).toLocaleTimeString('fr-FR',{hour:'2-digit',minute:'2-digit'})+'.';
 }else{$('map-status').textContent='Ta position n’est pas partagée.';}
 await refreshMemberMap();
}
async function refreshMemberMap(){
 const map=ensureMemberMap();if(!map)return;
 memberMapLayer.clearLayers();
 const{data,error}=await sb.rpc('map_visible_members');
 if(error){$('map-status').textContent='Impossible de charger la carte : '+error.message;return;}
 const bounds=[];
 for(const person of data||[]){
  const popup=document.createElement('span');popup.textContent=person.username||'Membre';const marker=L.marker([person.latitude,person.longitude]).bindPopup(popup);
  marker.addTo(memberMapLayer);bounds.push([person.latitude,person.longitude]);
 }
 if(bounds.length){map.fitBounds(bounds,{padding:[28,28],maxZoom:12});}
 else{map.setView([46.5,2.5],5);}
 const{data:{user}}=await sb.auth.getUser();
 $('map-status').textContent=(data?.length||0)+' membre(s) visible(s) sur la carte. Ta position reste privée si tu ne l’actives pas.';
}
$('map-share')?.addEventListener('click',async()=>{
 const{data:{user}}=await sb.auth.getUser();
 if(!user){$('map-status').textContent='Reconnecte-toi.';return;}
 if(!navigator.geolocation){$('map-status').textContent='La géolocalisation n’est pas disponible sur cet appareil.';return;}
 const button=$('map-share');button.disabled=true;$('map-status').textContent='Récupération de ta position…';
 navigator.geolocation.getCurrentPosition(async pos=>{
  const now=new Date().toISOString(),expiry=new Date(Date.now()+15*60*1000).toISOString();
  const{error}=await sb.from('member_locations').upsert({
   user_id:user.id,latitude:pos.coords.latitude,longitude:pos.coords.longitude,
   sharing_scope:$('map-scope').value,updated_at:now,expires_at:expiry
  },{onConflict:'user_id'});
  button.disabled=false;
  if(error){$('map-status').textContent='Impossible de partager : '+error.message;return;}
  $('map-status').textContent='Position partagée pendant 15 minutes. Tu peux arrêter à tout moment.';
  await refreshMemberMap();
 },err=>{
  button.disabled=false;
  $('map-status').textContent=err.code===1?'Autorise la géolocalisation dans les réglages de ton téléphone si tu veux partager ta position.':'Position indisponible. Réessaie quand le GPS est activé.';
 },{enableHighAccuracy:true,timeout:15000,maximumAge:0});
});
$('map-stop')?.addEventListener('click',async()=>{
 const{data:{user}}=await sb.auth.getUser();if(!user)return;
 const{error}=await sb.from('member_locations').delete().eq('user_id',user.id);
 if(error){$('map-status').textContent='Impossible d’arrêter le partage : '+error.message;return;}
 $('map-status').textContent='Partage arrêté. Ta position ne figure plus sur la carte.';
 await refreshMemberMap();
});
$('map-refresh')?.addEventListener('click',refreshMemberMap);
