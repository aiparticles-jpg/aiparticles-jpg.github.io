import { getNtfyTopic, getCurrentSignalingIdentity, getPeerSignalingIdentity, isUserId } from "./ntfy-identity.js?v=3";
import { decryptContactRequestEnvelope } from "./contact-exchange.js?v=11";
import { consumeIssuedInvitation, getIssuedInvitation, hasActiveInvitationGrant, getContact, updateContact } from "./local-store.js?v=12";
const BASE="https://ntfy.sh/";
const enc=new TextEncoder();
const stable=o=>JSON.stringify(o);
const bytes=b=>b instanceof Uint8Array?b:new Uint8Array(b);
const b64u=b=>{let s="";for(const x of bytes(b))s+=String.fromCharCode(x);return btoa(s).replaceAll("+","-").replaceAll("/","_").replace(/=+$/g,"")};
const un64=s=>{const x=atob(s.replace(/-/g,"+").replace(/_/g,"/")+"=".repeat((4-s.length%4)%4));return Uint8Array.from(x,c=>c.charCodeAt(0))};
const hex=b=>Array.from(bytes(b),x=>x.toString(16).padStart(2,"0")).join("");
const digest=async b=>new Uint8Array(await crypto.subtle.digest("SHA-256",b));

export class NtfySecureSignaling {
 constructor({me,peer,onSignal,onStatus,onReady,onError,onDebug,onIncoming,onContactRequest,onPeerMessage,onCancelIncoming,onDialing,onRejectOutgoing,onConversationEvent}) {
  this.me=me;this.peer=peer;this.peerName="";this.peerInvitationId=null;this.role=peer?(me<peer?"A":"B"):null;
  this.debugId=Array.from(crypto.getRandomValues(new Uint8Array(3)),x=>x.toString(16).padStart(2,"0")).join("");this.sseOpenCount=0;this.sseErrorCount=0;
  this.onSignal=onSignal;this.onStatus=onStatus||(()=>{});this.onReady=onReady||(()=>{});this.onError=onError||(()=>{});this.onDebug=onDebug||(()=>{});this.onIncoming=onIncoming||(()=>{});this.onContactRequest=onContactRequest||(()=>{});this.onPeerMessage=onPeerMessage||(()=>{});this.onCancelIncoming=onCancelIncoming||(()=>{});this.onDialing=onDialing||(()=>{});this.onRejectOutgoing=onRejectOutgoing||(()=>{});this.onConversationEvent=onConversationEvent||(()=>{});
  this.es=null;this.sseReadyPromise=null;this.subscribePromise=null;this.active=false;this.identity=null;this.hello=null;this.readyNotified=false;this.answer=null;this.lastAnswerAt=0;this.ecdh=null;this.session=null;this.sendKey=null;this.recvKey=null;this.ready=false;this.seen=new Set();this.pendingEvents=[];this.messageQueue=Promise.resolve();this.publishQueue=Promise.resolve();this.lastPublishAt=0;this.closed=false;this.rateLimited=false;this.helloAttempts=0;this.helloRetryTimer=null;this.answerAttempts=0;this.answerRetryTimer=null;this.incomingSid=null;this.incomingEventId=null;this.incomingIdentity=null;this.outgoingRequest=null;this.helloDirection=null;this.answeringIncoming=false;this.cancelledSids=new Set();this.pendingCancels=new Map();this.acceptedSids=new Set();
 }
 static validUserId(s){return isUserId(s)}
 async deriveEnvelopeKey(secret,from,to){
  const raw=un64(secret);if(raw.length!==32)throw Error("Некорректный общий симметричный ключ.");
  const material=await crypto.subtle.importKey("raw",raw,"HKDF",false,["deriveKey"]),pair=[from,to].sort().join("|"),salt=await digest(enc.encode("voicelink-envelope-pair-v3|"+pair));
  return crypto.subtle.deriveKey({name:"HKDF",hash:"SHA-256",salt,info:enc.encode("voicelink-envelope-v3|"+from+"|"+to)},material,{name:"AES-GCM",length:256},false,["encrypt","decrypt"]);
 }
 envelopeAad(type,from,to){return enc.encode(stable({v:3,type,from,to}));}
 validDecryptedPayload(type,p){
  const uuid=v=>typeof v==="string"&&/^[0-9a-f-]{36}$/i.test(v);
  if(!p||p.from===undefined||p.to===undefined)return false;
  if(p.rotation_request&&(!uuid(p.rotation_request.rotation_id)||typeof p.rotation_request.public_key!=="string"||p.rotation_request.public_key.length>1000))return false;
  if(type==="text")return uuid(p.message_id)&&Number.isSafeInteger(Number(p.created_at))&&Number(p.created_at)>=0&&Number(p.created_at)<=Date.now()+300000&&typeof p.text==="string"&&p.text.trim().length>0&&p.text.length<=2000;
  if(type==="hello")return uuid(p.sid)&&typeof p.eph==="string"&&typeof p.nonce==="string"&&Number.isFinite(Number(p.expiresAt));
  if(type==="answer")return uuid(p.sid)&&typeof p.eph==="string"&&typeof p.nonce==="string"&&typeof p.helloEph==="string"&&typeof p.helloNonce==="string";
  if(type==="cancel"||type==="reject")return uuid(p.sid)&&Number.isFinite(Number(p.expiresAt));
  if(type==="rotation_response")return uuid(p.rotation_id)&&typeof p.encrypted_key==="string";
  if(type==="data")return uuid(p.sid)&&typeof p.iv==="string"&&typeof p.data==="string";
  return false;
 }
 async verifyPeerEnvelope(type,payload,auth){
  if(auth?.scheme!=="contact-aes-256-gcm"||typeof auth.iv!=="string"||typeof auth.ciphertext!=="string")return false;
  const peer=payload?.from;if(!isUserId(peer)||peer===this.me||payload?.to!==this.me)return false;
  const contact=await getContact(peer);if(!contact?.invitation_secret)return false;
  const candidates=[{slot:"pending",secret:contact.pending_secret},{slot:"active",secret:contact.invitation_secret},{slot:"previous",secret:contact.previous_secret}].filter(x=>typeof x.secret==="string");
  let decoded=null,used=null;
  for(const candidate of candidates){try{
   const key=await this.deriveEnvelopeKey(candidate.secret,peer,this.me);
   const plain=await crypto.subtle.decrypt({name:"AES-GCM",iv:un64(auth.iv),additionalData:this.envelopeAad(type,peer,this.me)},key,un64(auth.ciphertext));
   const value=JSON.parse(new TextDecoder().decode(plain));
   if(!value||typeof value!=="object"||value.from!==peer||value.to!==this.me||!this.validDecryptedPayload(type,value))continue;
   decoded=value;used=candidate;break;
  }catch{}}
  if(!decoded)return false;Object.assign(payload,decoded);
  if(!await this.hasCallGrant(payload))return false;
  if(used.slot==="pending"){
   await updateContact(peer,{invitation_secret:contact.pending_secret,pending_secret:null,pending_rotation_id:null,previous_secret:null,previous_secret_at:null,shared_secret_created_at:Date.now(),rotation_response_id:null,rotation_response_ciphertext:null});
   this.onDebug("[e2ee] получено первое сообщение под новым ключом; старый ключ удалён");
  }else if(used.slot==="active"&&contact.previous_secret){
   await updateContact(peer,{previous_secret:null,previous_secret_at:null});
   this.onDebug("[e2ee] собеседник перешёл на новый ключ; предыдущий ключ удалён");
  }else if(used.slot==="previous")this.onDebug("[e2ee] принято сообщение под предыдущим ключом; оба ключа пока сохраняются");
  await this.processIncomingKeyRotation(peer,payload,type);return true;
 }

 async publish(to,msg){
  const task=async()=>{
   if(this.rateLimited)throw Error("ntfy ранее вернул HTTP 429; новые отправки остановлены.");
   const wait=Math.max(0,this.lastPublishAt+1100-Date.now());
   if(wait)await new Promise(resolve=>setTimeout(resolve,wait));
   this.onDebug(`[ntfy] POST → ${msg.type} (одна попытка)`);
   let r;
   try{
    r=await fetch(BASE+await getNtfyTopic(to),{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(msg),cache:"no-store"});
   }catch(error){
    this.lastPublishAt=Date.now();
    const failure=Error("Сетевая ошибка при POST в ntfy ("+msg.type+"): "+(error.message||String(error)));
    failure.retryable=true;
    throw failure;
   }
   this.onDebug(`[ntfy] POST ← ${r.status} (${msg.type})`);
   this.lastPublishAt=Date.now();
   if(r.ok)return;
   const retryAfter=r.headers.get("Retry-After");
   if(r.status===429){this.rateLimited=true;this.clearHelloRetry();this.clearAnswerRetry();}
   const failure=Error("ntfy HTTP "+r.status+(r.status===429?"; сервер ограничил частоту запросов"+(retryAfter?"; Retry-After: "+retryAfter:""):""));
   failure.retryable=r.status===408||r.status>=500;
   throw failure;
  };
  const result=this.publishQueue.then(task,task);
  this.publishQueue=result.catch(()=>{});
  return result;
 }
 async beginKeyRotation(peer,contact){
  if(contact.rotation_id&&contact.rotation_private_key)return contact;
  if(contact.pending_secret||contact.previous_secret)return contact;
  const pair=await crypto.subtle.generateKey({name:"RSA-OAEP",modulusLength:2048,publicExponent:new Uint8Array([1,0,1]),hash:"SHA-256"},true,["encrypt","decrypt"]);
  const pub=await crypto.subtle.exportKey("spki",pair.publicKey),priv=await crypto.subtle.exportKey("pkcs8",pair.privateKey);
  const privateKey=await crypto.subtle.importKey("pkcs8",priv,{name:"RSA-OAEP",hash:"SHA-256"},false,["decrypt"]);
  new Uint8Array(priv).fill(0);
  return updateContact(peer,{rotation_id:crypto.randomUUID(),rotation_public_key:b64u(pub),rotation_private_key:privateKey,rotation_started_at:Date.now()});
 }
 async authenticated(type,payload){
  const peer=payload?.to;let contact=await getContact(peer);
  if(!contact?.invitation_secret)throw Error("Не найден общий ключ контакта. Попросите собеседника повторно обменяться приглашениями.");
  if(type!=="rotation_response"&&!contact.rotation_id&&!contact.pending_secret&&!contact.previous_secret&&Date.now()-(Number(contact.shared_secret_created_at)||Date.now())>=24*60*60*1000)contact=await this.beginKeyRotation(peer,contact)||contact;
  const body={...payload,invitation_id:payload.invitation_id||contact.invitation_id};
  if(type!=="rotation_response"&&contact.rotation_id&&contact.rotation_public_key)body.rotation_request={rotation_id:contact.rotation_id,public_key:contact.rotation_public_key};
  const key=await this.deriveEnvelopeKey(contact.invitation_secret,this.me,peer),iv=crypto.getRandomValues(new Uint8Array(12));
  const ciphertext=await crypto.subtle.encrypt({name:"AES-GCM",iv,additionalData:this.envelopeAad(type,this.me,peer)},key,enc.encode(stable(body)));
  return {v:3,type,payload:{from:this.me,to:peer},auth:{scheme:"contact-aes-256-gcm",iv:b64u(iv),ciphertext:b64u(ciphertext)}};
 }

 async subscribe(){
  if(this.es&&this.es.readyState===EventSource.OPEN)return;
  if(this.subscribePromise)return this.subscribePromise;
  if(this.es&&this.es.readyState===EventSource.CONNECTING&&this.sseReadyPromise)return this.sseReadyPromise;
  if(this.es&&this.es.readyState===EventSource.CLOSED){this.es=null;this.sseReadyPromise=null}
  const task=this.openSubscription();
  this.subscribePromise=task;
  try{await task}
  finally{if(this.subscribePromise===task)this.subscribePromise=null}
 }
 async openSubscription(){
  this.onDebug(`[SSE ${this.debugId}] subscribe() вызван`);
  if(!isUserId(this.me))throw Error("Локальная анонимная идентичность не инициализирована.");
  if(!crypto.subtle||!window.isSecureContext)throw Error("Для защищённого соединения нужен браузер с Web Crypto и HTTPS.");
  if(this.es){
   if(this.es.readyState===EventSource.OPEN)return;
   if(this.sseReadyPromise)return this.sseReadyPromise;
  }
  this.identity=await getCurrentSignalingIdentity();
  if(this.identity.user_id!==this.me)throw Error("Локальная идентичность изменилась. Перезапустите подписку.");
  if(this.closed)throw Error("Открытие подписки отменено.");
  const url=BASE+await getNtfyTopic(this.me)+"/sse?since=all";
  if(this.closed)throw Error("Открытие подписки отменено.");
  const es=new EventSource(url);this.es=es;
  let settled=false;
  const createdAt=performance.now();let lastOpenAt=null;
  const elapsed=()=>Math.round(performance.now()-createdAt);
  const stateName=()=>es.readyState===EventSource.CONNECTING?"CONNECTING":es.readyState===EventSource.OPEN?"OPEN":es.readyState===EventSource.CLOSED?"CLOSED":String(es.readyState);
  this.onDebug(`[SSE ${this.debugId}] ${new Date().toISOString()} CREATED; t=+0ms; readyState=${es.readyState} (${stateName()})`);
  const ready=new Promise((resolve,reject)=>{
   const timeout=setTimeout(()=>{if(!settled){settled=true;reject(Error("Тайм-аут подключения к ntfy"))}},15000);
   es.onopen=()=>{
    const now=performance.now(),sincePrevious=lastOpenAt===null?"—":Math.round(now-lastOpenAt)+"ms";
    this.sseOpenCount++;
    this.onDebug(`[SSE ${this.debugId}] ${new Date().toISOString()} OPEN #${this.sseOpenCount}; since-create=+${elapsed()}ms; since-prev-open=${sincePrevious}; readyState(before)=${es.readyState} (${stateName()})`);
    lastOpenAt=now;
    if(!settled){settled=true;clearTimeout(timeout);resolve()}
    this.onStatus(this.active?"Канал ntfy подключён. Ищем собеседника…":"Подписка ntfy активна. Можно подключаться.");
    this.onDebug(`[SSE ${this.debugId}] OPEN #${this.sseOpenCount} handler завершён; readyState(after)=${es.readyState} (${stateName()})`);
   };
   es.onerror=event=>{
    this.sseErrorCount++;
    this.onDebug(`[SSE ${this.debugId}] ${new Date().toISOString()} ERROR #${this.sseErrorCount}; since-create=+${elapsed()}ms; readyState(before)=${es.readyState} (${stateName()}); event=${event.type}; trusted=${event.isTrusted}`);
    this.onStatus("Канал ntfy переподключается…");
    if(!settled){settled=true;clearTimeout(timeout);reject(Error("Не удалось подключиться к ntfy"))}
    this.onDebug(`[SSE ${this.debugId}] ERROR #${this.sseErrorCount} handler завершён; readyState(after)=${es.readyState} (${stateName()})`);
   };
   es.onmessage=e=>this.enqueueMessages([e]);
  });
  this.sseReadyPromise=ready;
  try{await ready}
  catch(error){if(this.es===es){es.close();this.es=null;this.sseReadyPromise=null}throw error}
 }
 async start(){
  this.onDebug(`[SSE ${this.debugId}] start() вызван`);
  if(!isUserId(this.me)||!isUserId(this.peer)||this.me===this.peer)throw Error("Выберите сохранённый контакт.");
  const peerContact=await getPeerSignalingIdentity(this.peer);
  this.peerName=peerContact.name;
  this.peerInvitationId=peerContact.invitation_id;
  await this.subscribe();
  this.active=true;
  if(!this.answeringIncoming&&!this.hello){
   try{await this.sendHello()}catch(err){this.onError(err);if(err.retryable)this.scheduleHelloRetry(5000)}
  }
  const pending=this.pendingEvents.splice(0);
  const pendingBatch=[];
  for(const n of pending)pendingBatch.push({data:JSON.stringify(n)});
  if(pendingBatch.length)await this.enqueueMessages(pendingBatch);
  this.answeringIncoming=false;
 }
 setPeer(peer){
  if(peer!==""&&(!isUserId(peer)||peer===this.me))throw Error("Выберите корректный локальный контакт.");
  if(peer===this.peer)return;
  this.resetSession({preservePending:true});this.peer=peer;this.peerName="";this.peerInvitationId=null;this.role=peer?(this.me<peer?"A":"B"):null;
  this.inspectPendingIncoming().catch(error=>this.onError(error));
 }
 acceptIncoming(){
  const sid=this.incomingSid;
  if(sid){this.acceptedSids.add(sid);if(this.acceptedSids.size>100)this.acceptedSids.delete(this.acceptedSids.values().next().value)}
  this.answeringIncoming=true;
  this.incomingSid=null;this.incomingEventId=null;this.incomingIdentity=null;
 }
 dismissIncoming(){
  if(this.incomingEventId){this.seen.add(this.incomingEventId);if(this.seen.size>600)this.seen.delete(this.seen.values().next().value)}
  const peer=this.peer;
  this.pendingEvents=this.pendingEvents.filter(n=>{
   try{const m=JSON.parse(n.message);return !(m.type==="hello"&&m.payload?.from===peer&&m.payload?.to===this.me)}catch{return true}
  });
  this.incomingSid=null;this.incomingEventId=null;this.incomingIdentity=null;
 }

 async processIncomingKeyRotation(peer,payload,type){
  const request=payload?.rotation_request;
  if(request){
   let contact=await getContact(peer);if(!contact)return;
   if(contact.rotation_id&&contact.rotation_private_key){
    if(this.me<peer)return;
    await updateContact(peer,{rotation_id:null,rotation_public_key:null,rotation_private_key:null,rotation_started_at:null});
    contact=await getContact(peer);
   }
   if(contact.pending_secret&&contact.pending_rotation_id!==request.rotation_id)return;
   let encryptedKey=contact.rotation_response_id===request.rotation_id?contact.rotation_response_ciphertext:null;
   if(typeof encryptedKey!=="string"){
    try{
     const publicKey=await crypto.subtle.importKey("spki",un64(request.public_key),{name:"RSA-OAEP",hash:"SHA-256"},false,["encrypt"]);
     const next=crypto.getRandomValues(new Uint8Array(32));
     encryptedKey=b64u(await crypto.subtle.encrypt({name:"RSA-OAEP"},publicKey,next));
     await updateContact(peer,{pending_secret:b64u(next),pending_rotation_id:request.rotation_id,rotation_response_id:request.rotation_id,rotation_response_ciphertext:encryptedKey});
     next.fill(0);
    }catch(error){this.onDebug("[e2ee] запрос ротации отклонён: "+(error.message||String(error)));return;}
   }
   await this.publish(peer,await this.authenticated("rotation_response",{from:this.me,to:peer,rotation_id:request.rotation_id,encrypted_key:encryptedKey}));
   this.onDebug("[e2ee] ответ с новым симметричным ключом отправлен под прежним ключом");
  }
  if(type==="rotation_response"){
   const contact=await getContact(peer);
   if(!contact?.rotation_private_key||contact.rotation_id!==payload.rotation_id)return;
   try{
    const raw=new Uint8Array(await crypto.subtle.decrypt({name:"RSA-OAEP"},contact.rotation_private_key,un64(payload.encrypted_key)));
    if(raw.length!==32)throw Error("Некорректная длина нового ключа.");
    const next=b64u(raw);raw.fill(0);
    await updateContact(peer,{previous_secret:contact.invitation_secret,previous_secret_at:Date.now(),invitation_secret:next,shared_secret_created_at:Date.now(),rotation_id:null,rotation_public_key:null,rotation_private_key:null,rotation_started_at:null});
    this.onDebug("[e2ee] новый ключ получен; исходящие сообщения переключены на него, старый ключ оставлен для приёма");
   }catch(error){this.onDebug("[e2ee] не удалось обработать ответ ротации: "+(error.message||String(error)));}
  }
 }
 async recordConversationEvent(type,payload,direction,createdAt=Date.now()){
  const contactUserId=direction==="incoming"?payload.from:payload.to;
  if(!isUserId(contactUserId))return;
  const id=type==="text"?payload.message_id:String(payload.sid||"")+":"+type+":"+direction;
  try{
   await this.onConversationEvent({
    id,contact_user_id:contactUserId,type,direction,
    text:type==="text"?payload.text:"",
    created_at:new Date(Number(createdAt)||Date.now()).toISOString()
   });
  }catch(error){this.onError(error)}
 }
 async inspectTextMessage(n,m){
  const p=m?.payload;if(m?.v!==3||m?.type!=="text"||!p||p.to!==this.me||!isUserId(p.from)||p.from===this.me)return;
  let valid=false;try{valid=await this.verifyPeerEnvelope("text",p,m.auth)}catch{return;}
  if(!valid)return;
  await this.recordConversationEvent("text",p,"incoming",Number(p.created_at));
  if(n?.id){this.seen.add(n.id);this.pendingEvents=this.pendingEvents.filter(item=>item.id!==n.id);}
  this.onDebug("[signaling] получено и сохранено аутентифицированное сообщение AES-GCM");
 }
 async sendText(to,text){
  if(this.closed||!this.identity)throw Error("Защищённая подписка ещё не готова.");
  if(!isUserId(to)||to===this.me)throw Error("Выберите сохранённый контакт.");
  const body=String(text||"").trim();if(!body||body.length>2000)throw Error("Сообщение должно содержать от 1 до 2000 символов.");
  if(!await getContact(to))throw Error("Выберите сохранённый контакт.");
  const createdAt=Date.now(),payload={message_id:crypto.randomUUID(),from:this.me,to,created_at:createdAt,text:body};
  await this.publish(to,await this.authenticated("text",payload));
  await this.recordConversationEvent("text",payload,"outgoing",createdAt);return payload;
 }
 async inspectIncoming(n){
  if(!n?.message||!n?.id)return;
  let m;try{m=JSON.parse(n.message)}catch{return;}
  if(m.type==="contact_request"){await this.inspectContactRequest(n,m);return;}
  if(m.type==="text"){await this.inspectTextMessage(n,m);return;}
  if(m.v!==3||!m.payload)return;
  const p=m.payload;if(!isUserId(p.from)||p.from===this.me||p.to!==this.me)return;
  if(m.type==="rotation_response"){let ok=false;try{ok=await this.verifyPeerEnvelope(m.type,p,m.auth)}catch{}if(ok&&n?.id){this.seen.add(n.id);this.pendingEvents=this.pendingEvents.filter(item=>item.id!==n.id);}return;}
  if(m.type==="cancel"){
   const c=await getPeerSignalingIdentity(p.from);this.peer=p.from;this.peerName=c.name;this.peerInvitationId=c.invitation_id;this.role=this.me<p.from?"A":"B";
   await this.processCancel(m);if(n?.id){this.seen.add(n.id);this.pendingEvents=this.pendingEvents.filter(item=>item.id!==n.id);}return;
  }
  if(m.type!=="hello")return;
  if(this.active||this.ready||(this.incomingSid&&this.incomingSid!==p.sid)||this.outgoingRequest||this.hello)return;
  let c;try{c=await getPeerSignalingIdentity(p.from)}catch{return;}
  this.peer=p.from;this.peerName=c.name;this.peerInvitationId=c.invitation_id;this.role=this.me<p.from?"A":"B";
  if(!await this.verifyPeerEnvelope(m.type,p,m.auth)){this.onDebug("[signaling] вызов отклонён: шифрование, контакт или разрешение недействительны");return;}
  if(n?.id){this.seen.add(n.id);this.pendingEvents=this.pendingEvents.filter(item=>item.id!==n.id);}
  const expiresAt=Number(p.expiresAt||((Number(n.time)||0)*1000+45000));
  if(!Number.isFinite(expiresAt)||Date.now()>expiresAt||typeof p.sid!=="string")return;
  if(this.acceptedSids.has(p.sid)||this.cancelledSids.has(p.sid)||this.incomingSid===p.sid)return;
  await this.recordConversationEvent("hello",p,"incoming",Number(n.time)*1000||Date.now());
  this.onPeerMessage(p.from);this.incomingSid=p.sid;this.incomingEventId=n.id;this.incomingIdentity=true;
  const pending=this.pendingCancels.get(p.sid);
  if(pending){this.pendingCancels.delete(p.sid);await this.processCancel(pending);if(this.cancelledSids.has(p.sid))return;}
  this.onIncoming({peer:this.peerName||"контакт",peerId:this.peer,sid:p.sid,expiresAt});
 }
 async inspectContactRequest(n,m){
  const p=m?.payload;
  if(m?.v!==3||m?.type!=="contact_request"||!p||p.to!==this.me||!isUserId(p.from)||p.from===this.me||typeof p.request_id!=="string"||!/^[0-9a-f-]{36}$/i.test(p.request_id)||!p.invitation_id)return;
  const expires=Number(p.expires_at);if(!Number.isFinite(expires)||Date.now()>expires)return;
  const issued=await getIssuedInvitation(p.invitation_id);if(!issued||issued.revoked||!issued.secret)return;
  const contact=await decryptContactRequestEnvelope(m,issued.secret);
  if(contact.user_id!==p.from)throw Error("Идентификатор отправителя не совпадает с аутентифицированным пакетом контакта.");
  const activation=await consumeIssuedInvitation({invitationId:p.invitation_id,userId:p.from,requestId:p.request_id});
  if(!activation.accepted){this.onDebug("[signaling] запрос контакта отклонён: приглашение неизвестно, отозвано или уже использовано");return;}
  if(n?.id){this.seen.add(n.id);this.pendingEvents=this.pendingEvents.filter(item=>item.id!==n.id);}
  this.onPeerMessage(this.peer);
  this.onContactRequest({requestId:p.request_id,contact,expiresAt:expires,invitationCreatedAt:activation.created_at,invitationId:p.invitation_id,sharedSecret:issued.secret});
 }
 async processCancel(m){
  const p=m?.payload;if(m?.v!==3||!p||p.from!==this.peer||p.to!==this.me)return;
  if(!await this.verifyPeerEnvelope("cancel",p,m.auth))throw Error("Аутентификация отмены вызова или разрешение недействительны.");
  if(!p.sid||this.acceptedSids.has(p.sid)||!Number.isFinite(Number(p.expiresAt))||Date.now()>Number(p.expiresAt))return;
  this.onPeerMessage(this.peer);
  if(!this.incomingIdentity){this.pendingCancels.set(p.sid,m);if(this.pendingCancels.size>50)this.pendingCancels.delete(this.pendingCancels.keys().next().value);return;}
  this.cancelledSids.add(p.sid);if(this.cancelledSids.size>100)this.cancelledSids.delete(this.cancelledSids.values().next().value);
  if(this.incomingSid===p.sid&&!this.hello&&!this.ready){
   this.onDebug("[signaling] получена аутентифицированная отмена входящего вызова до ответа");
   this.incomingSid=null;this.incomingEventId=null;this.incomingIdentity=null;this.onCancelIncoming({peer:this.peerName||"контакт",sid:p.sid});
  }
 }
 async inspectPendingIncoming(){
  for(const n of this.pendingEvents)await this.inspectIncoming(n);
 }
 resetSession({preservePending=false}={}){
  this.active=false;this.answeringIncoming=false;this.clearHelloRetry();this.clearAnswerRetry();
  this.hello=null;this.helloDirection=null;this.readyNotified=false;this.answer=null;this.lastAnswerAt=0;this.ecdh=null;this.session=null;
  this.sendKey=null;this.recvKey=null;this.ready=false;
  if(!preservePending)this.pendingEvents=[];this.incomingSid=null;this.incomingEventId=null;this.incomingIdentity=null;this.outgoingRequest=null;this.pendingCancels.clear();this.acceptedSids.clear();this.rateLimited=false;this.helloAttempts=0;this.answerAttempts=0;
 }
 async rejectIncoming(){
  const sid=this.incomingSid;
  if(this.closed||!sid||!this.peer)return false;
  const payload={sid,from:this.me,to:this.peer,...(this.peerInvitationId?{invitation_id:this.peerInvitationId}:{}),expiresAt:Date.now()+15000};
  await this.publish(this.peer,await this.authenticated("reject",payload));
  await this.recordConversationEvent("reject",payload,"outgoing",Date.now());
  this.acceptedSids.add(sid);
  this.onDebug("[signaling] аутентифицированный отказ от входящего вызова отправлен через ntfy");
  this.incomingSid=null;this.incomingEventId=null;this.incomingIdentity=null;
  return true;
 }
 async cancelCall(){
  const request=this.outgoingRequest||this.hello;
  if(this.closed||!request||!["A","B"].includes(this.role))return false;
  const payload={sid:request.sid,from:this.me,to:this.peer,...(this.peerInvitationId?{invitation_id:this.peerInvitationId}:{}),expiresAt:Date.now()+15000};
  await this.publish(this.peer,await this.authenticated("cancel",payload));
  this.outgoingRequest=null;
  this.onDebug("[signaling] аутентифицированная отмена вызова отправлена через ntfy");
  return true;
 }
 async sendHello(){
  if(this.closed||this.ready||this.rateLimited||this.helloDirection==="incoming")return;
  if(!this.hello){
   this.ecdh=await crypto.subtle.generateKey({name:"ECDH",namedCurve:"P-256"},true,["deriveBits"]);
   this.hello={sid:crypto.randomUUID(),from:this.me,to:this.peer,...(this.peerInvitationId?{invitation_id:this.peerInvitationId}:{}),eph:b64u(await crypto.subtle.exportKey("raw",this.ecdh.publicKey)),nonce:b64u(crypto.getRandomValues(new Uint8Array(16))),expiresAt:Date.now()+45000};
   this.helloDirection="outgoing";
  }
  this.helloAttempts++;
  this.onDebug(`[signaling] hello attempt ${this.helloAttempts}/3`);
  await this.publish(this.peer,await this.authenticated("hello",this.hello));
  await this.recordConversationEvent("hello",this.hello,"outgoing",Date.now());
  this.onStatus("Запрос отправлен. Ожидаем "+(this.peerName||"контакт")+"…");
  if(!this.ready)this.onDialing({peer:this.peerName||"контакт",expiresAt:this.hello.expiresAt,callId:this.hello.sid});
 }
 scheduleHelloRetry(delay){
  this.clearHelloRetry();
  if(this.closed||this.ready||this.rateLimited||this.helloDirection!=="outgoing"||this.helloAttempts>=3)return;
  this.helloRetryTimer=setTimeout(async()=>{
   this.helloRetryTimer=null;
   if(this.closed||this.ready||this.rateLimited)return;
   try{await this.sendHello()}catch(err){
    this.onError(err);
    if(err.retryable)this.scheduleHelloRetry(this.helloAttempts===2?10000:5000);
   }
  },delay);
 }
 clearHelloRetry(){if(this.helloRetryTimer!==null){clearTimeout(this.helloRetryTimer);this.helloRetryTimer=null}}
 clearAnswerRetry(){if(this.answerRetryTimer!==null){clearTimeout(this.answerRetryTimer);this.answerRetryTimer=null}}
 async sendAnswer(){
  if(this.closed||this.rateLimited||!this.answer)return;
  this.answerAttempts++;
  this.onDebug(`[signaling] answer POST attempt ${this.answerAttempts}/3`);
  await this.publish(this.peer,await this.authenticated("answer",this.answer));
  await this.recordConversationEvent("answer",this.answer,"outgoing",Date.now());
  this.lastAnswerAt=Date.now();
  this.clearAnswerRetry();
  if(!this.readyNotified){this.readyNotified=true;this.onReady();}
 }
 scheduleAnswerRetry(delay){
  this.clearAnswerRetry();
  if(this.closed||this.rateLimited||!this.answer||this.answerAttempts>=3)return;
  this.answerRetryTimer=setTimeout(async()=>{
   this.answerRetryTimer=null;
   try{await this.sendAnswer()}catch(err){
    this.onError(err);
    if(err.retryable)this.scheduleAnswerRetry(10000);
   }
  },delay);
 }
 enqueueMessages(events){
  const task=this.messageQueue.then(async()=>{for(const event of events)await this.handle(event)});
  this.messageQueue=task.catch(error=>this.onError(error));
  return this.messageQueue;
 }
 async handle(event){
  if(!this.active){
   let q;try{q=JSON.parse(event.data)}catch{return;}
   if(!q.message||!q.id||this.seen.has(q.id))return;
   if(!this.pendingEvents.some(x=>x.id===q.id)){this.pendingEvents.push(q);this.onDebug("[signaling] входящее сообщение сохранено до ответа пользователя");await this.inspectIncoming(q);}
   return;
  }
  const n=JSON.parse(event.data);if(!n.message||!n.id||this.seen.has(n.id))return;
  this.seen.add(n.id);if(this.seen.size>600)this.seen.delete(this.seen.values().next().value);
  let m;try{m=JSON.parse(n.message)}catch{return;}
  if(m.type==="contact_request"){await this.inspectContactRequest(n,m);return;}
  if(m.type==="text"){if(m.v===3&&m.payload?.to===this.me)await this.inspectTextMessage(n,m);return;}
  if(m.v!==3||!m.payload||m.payload.from!==this.peer||m.payload.to!==this.me)return;
  const p=m.payload;
  if(m.type==="cancel"){await this.processCancel(m);return;}
  if(!["rotation_response","reject","hello","answer","data"].includes(m.type))return;
  if(!await this.verifyPeerEnvelope(m.type,p,m.auth))return;
  if(m.type==="rotation_response")return;
  if(m.type==="data"){
   if(!this.ready||p.sid!==this.session)return;
   const dir=p.from<p.to?"A-to-B":"B-to-A";
   const plain=await crypto.subtle.decrypt({name:"AES-GCM",iv:un64(p.iv),additionalData:enc.encode(this.session+"|"+dir)},this.recvKey,un64(p.data));
   const msg=JSON.parse(new TextDecoder().decode(plain));this.onPeerMessage(this.peer);if(msg.type==="signal")await this.onSignal(msg.payload);return;
  }
  if(m.type==="reject"){
   const req=this.outgoingRequest||this.hello;if(!req||p.sid!==req.sid||!Number.isFinite(Number(p.expiresAt))||Date.now()>Number(p.expiresAt))return;
   await this.recordConversationEvent("reject",p,"incoming",Number(n.time)*1000||Date.now());
   this.onPeerMessage(this.peer);this.outgoingRequest=null;this.clearHelloRetry();this.onRejectOutgoing({peer:this.peerName||"контакт",sid:p.sid});return;
  }
  if(m.type==="hello"){
   if(this.hello&&this.helloDirection==="incoming"){
    if(p.sid===this.hello.sid&&this.answer&&Date.now()-this.lastAnswerAt>=10000){
     this.onDebug("[signaling] answer resend after repeated hello");
     try{await this.sendAnswer()}catch(err){this.onError(err);if(err.retryable)this.scheduleAnswerRetry(5000);}
    }
    return;
   }
   if(this.ready)return;
   if(this.hello&&this.helloDirection==="outgoing"){
    if(this.me<this.peer)return;
    this.cancelledSids.add(this.hello.sid);this.clearHelloRetry();this.hello=null;this.helloDirection=null;this.outgoingRequest=null;
    this.onDebug("[signaling] crossed call: уступаем hello участника с меньшим ID");
   }
   if(!p.sid||this.cancelledSids.has(p.sid))return;
   const expires=Number(p.expiresAt||((Number(n.time)||0)*1000+45000));if(!Number.isFinite(expires)||Date.now()>expires)return;
   await this.recordConversationEvent("hello",p,"incoming",Number(n.time)*1000||Date.now());this.onPeerMessage(this.peer);
   const pending=this.pendingCancels.get(p.sid);
   if(pending){this.pendingCancels.delete(p.sid);this.incomingSid=p.sid;this.incomingIdentity=true;await this.processCancel(pending);if(this.cancelledSids.has(p.sid))return;}
   this.hello=p;this.helloDirection="incoming";this.incomingSid=p.sid;this.incomingIdentity=true;
   this.ecdh=await crypto.subtle.generateKey({name:"ECDH",namedCurve:"P-256"},true,["deriveBits"]);
   const answer={sid:p.sid,from:this.me,to:this.peer,...(this.peerInvitationId?{invitation_id:this.peerInvitationId}:{}),eph:b64u(await crypto.subtle.exportKey("raw",this.ecdh.publicKey)),nonce:b64u(crypto.getRandomValues(new Uint8Array(16))),helloEph:p.eph,helloNonce:p.nonce};
   this.answer=answer;await this.derive(p,answer);this.onDebug("[signaling] answer prepared; sending initial response");
   try{await this.sendAnswer()}catch(err){this.onError(err);if(err.retryable)this.scheduleAnswerRetry(5000);}return;
  }
  if(m.type==="answer"&&!this.ready){
   if(!this.hello||this.helloDirection!=="outgoing"||p.sid!==this.hello.sid||p.helloEph!==this.hello.eph||p.helloNonce!==this.hello.nonce)return;
   await this.recordConversationEvent("answer",p,"incoming",Number(n.time)*1000||Date.now());this.onPeerMessage(this.peer);
   await this.derive(this.hello,p);if(!this.readyNotified){this.readyNotified=true;this.onReady();}return;
  }
 }
 async hasCallGrant(payload){
  const contact=await getPeerSignalingIdentity(payload.from);
  return payload.invitation_id===contact.invitation_id&&await hasActiveInvitationGrant(contact.invitation_id,payload.from);
 }
 async derive(hello,answer){
  const parties=new Map([[hello.from,{eph:hello.eph,nonce:hello.nonce}],[answer.from,{eph:answer.eph,nonce:answer.nonce}]]);
  const [a,b]=[hello.from,hello.to].sort();
  const tr={v:2,sid:hello.sid,a,b,aEph:parties.get(a).eph,bEph:parties.get(b).eph,aNonce:parties.get(a).nonce,bNonce:parties.get(b).nonce};
  const hash=await digest(enc.encode(stable(tr)));
  const remoteEph=hello.from===this.me?answer.eph:hello.eph;
  const pub=await crypto.subtle.importKey("raw",un64(remoteEph),{name:"ECDH",namedCurve:"P-256"},false,[]);
  const shared=await crypto.subtle.deriveBits({name:"ECDH",public:pub},this.ecdh.privateKey,256);
  const material=await crypto.subtle.importKey("raw",shared,"HKDF",false,["deriveKey"]);
  const mk=dir=>crypto.subtle.deriveKey({name:"HKDF",hash:"SHA-256",salt:hash,info:enc.encode("voice-link-v1|"+dir)},material,{name:"AES-GCM",length:256},false,["encrypt","decrypt"]);
  const [ab,ba]=await Promise.all([mk("A-to-B"),mk("B-to-A")]);
  this.sendKey=this.role==="A"?ab:ba;this.recvKey=this.role==="A"?ba:ab;this.session=hello.sid;this.ready=true;this.clearHelloRetry();
  }
 async sendSignal(payload){
  if(!this.ready)throw Error("Защищённый канал ещё не установлен.");
  const dir=this.role==="A"?"A-to-B":"B-to-A",iv=crypto.getRandomValues(new Uint8Array(12));
  const plain=enc.encode(JSON.stringify({type:"signal",payload}));
  const data=await crypto.subtle.encrypt({name:"AES-GCM",iv,additionalData:enc.encode(this.session+"|"+dir)},this.sendKey,plain);
  await this.publish(this.peer,await this.authenticated("data",{sid:this.session,from:this.me,to:this.peer,iv:b64u(iv),data:b64u(data)}));
 }
 close(){this.closed=true;this.active=false;this.clearHelloRetry();this.clearAnswerRetry();if(this.es){const before=this.es.readyState;this.onDebug(`[SSE ${this.debugId}] ${new Date().toISOString()} close() вызван; readyState(before)=${before}`);this.es.close();this.onDebug(`[SSE ${this.debugId}] ${new Date().toISOString()} close() завершён; readyState(after)=${this.es.readyState}`)}else this.onDebug(`[SSE ${this.debugId}] ${new Date().toISOString()} close() вызван без EventSource`);}
}
