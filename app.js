const SUPABASE_URL='https://rlzunpnwtnkxmnygnkvv.supabase.co';const SUPABASE_KEY='sb_publishable_3eXxDChcMApOgp6TmKQ0QA_1z2VKhOE';const sb=window.supabase.createClient(SUPABASE_URL,SUPABASE_KEY);const $=id=>document.getElementById(id);const status=(m,ok=false)=>{$('status').textContent=m;$('status').className=ok?'success':'error';};function isAdult(dateString){if(!dateString)return false;const d=new Date(dateString+'T00:00:00');if(Number.isNaN(d.getTime()))return false;const today=new Date();let age=today.getFullYear()-d.getFullYear();const beforeBirthday=today.getMonth()<d.getMonth()||(today.getMonth()===d.getMonth()&&today.getDate()<d.getDate());if(beforeBirthday)age--;return age>=18&&d<=today;}function showSession(s){$('auth').classList.toggle('hidden',!!s);$('dashboard').classList.toggle('hidden',!s);if(s){$('userline').textContent=s.user.email;loadProfile(s.user.id);loadMyPhotos();}}async function loadProfile(id){const{data,error}=await sb.from('profiles').select('username,bio,birth_date').eq('id',id).maybeSingle();if(error){status('Connecté. Profil à initialiser : '+error.message);return;}if(data){$('username').value=data.username||'';$('bio').value=data.bio||'';$('birthdate').value=data.birth_date||'';}}$('signup').onclick=async()=>{if(!$('adult').checked){status('Confirmation 18+ obligatoire.');return;}const email=$('email').value.trim(),password=$('password').value;if(!email||password.length<8){status('Email et mot de passe de 8 caractères minimum requis.');return;}const{data,error}=await sb.auth.signUp({email,password,options:{data:{adult_confirmed:true}}});if(error){status(error.message);return;}status(data.session?'Compte créé et connecté.':'Compte créé. Vérifie ton email.',true);if(data.session)showSession(data.session);};$('login').onclick=async()=>{const{data,error}=await sb.auth.signInWithPassword({email:$('email').value.trim(),password:$('password').value});if(error){status(error.message);return;}status('Connexion réussie.',true);showSession(data.session);};$('forgot').onclick=async()=>{const email=$('email').value.trim();if(!email){status('Entre ton email dans le champ Email.');return;}const{error}=await sb.auth.resetPasswordForEmail(email,{redirectTo:window.location.origin+window.location.pathname});if(error){status(error.message);return;}status('Demande envoyée. Vérifie ta boîte email et tes spams.',true);};$('resetpassword').onclick=async()=>{const p=$('newpassword').value,c=$('confirmpassword').value;if(p.length<8){status('8 caractères minimum.');return;}if(p!==c){status('Les mots de passe ne correspondent pas.');return;}const{error}=await sb.auth.updateUser({password:p});if(error){status(error.message);return;}$('reset-card').classList.add('hidden');status('Mot de passe changé. Connecte-toi.',true);await sb.auth.signOut();showSession(null);};$('logout').onclick=async()=>{await sb.auth.signOut();showSession(null);status('Déconnexion effectuée.',true);};$('saveprofile').onclick=async()=>{const{data:{user}}=await sb.auth.getUser();if(!user){status('Reconnecte-toi.');return;}const birthDate=$('birthdate').value;if(!birthDate){status('Indique ta date de naissance pour enregistrer ton profil.');return;}if(!isAdult(birthDate)){status('CrushLibre est réservé aux personnes de 18 ans et plus.');return;}const{error}=await sb.from('profiles').upsert({id:user.id,username:$('username').value.trim(),bio:$('bio').value.trim(),birth_date:birthDate});if(error)status('Erreur profil : '+error.message);else status('Profil enregistré.',true);};sb.auth.getSession().then(({data})=>showSession(data.session));sb.auth.onAuthStateChange((event,session)=>{showSession(session);if(event==='PASSWORD_RECOVERY'){$('reset-card').classList.remove('hidden');$('auth').classList.add('hidden');status('Choisis ton nouveau mot de passe.',true);}});
const MEDIA_BUCKET='crushlib-private-media';
const MAX_PHOTO_BYTES=50*1024*1024;
async function loadMyPhotos(){
  const gallery=$('photo-gallery');
  if(!gallery)return;
  gallery.replaceChildren();
  const{data:{user}}=await sb.auth.getUser();
  if(!user)return;
  const{data:rows,error}=await sb.from('media')
    .select('id,storage_path,caption,created_at,moderation_status')
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
    card.append(img,meta,del);gallery.append(card);
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
