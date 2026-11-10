import { getNtfyTopic, getCurrentSignalingIdentity, getPeerSignalingIdentity, isUserId } from "./ntfy-identity.js";
import { decryptContactRequestEnvelope } from "./contact-exchange.js?v=10";
import { consumeIssuedInvitation, getIssuedInvitation, hasActiveInvitationGrant, getMessageEncryptionKeyRing, createPendingMessageEncryptionIdentity, activatePendingMessageEncryptionIdentity, acknowledgePendingMessageEncryptionIdentity, markPreviousMessageEncryptionIdentityForDeletion, getContact, updateContact, listContacts } from "./local-store.js?v=10";
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
 async verifyPeerEnvelope(type,payload,auth){
  if(auth?.scheme!=="contact-hmac-sha256"||typeof auth.mac!=="string")return false;
  const peer=payload?.from;if(!isUserId(peer)||peer===this.me)return false;
  const contact=await getContact(peer);if(!contact?.invitation_secret)return false;
  const raw=un64(contact.invitation_secret);if(raw.length!==32)return false;
  const key=await crypto.subtle.importKey("raw",raw,{name:"HMAC",hash:"SHA-256"},false,["verify"]);
  const valid=await crypto.subtle.verify("HMAC",key,un64(auth.mac),enc.encode(stable({v:2,type,payload})));
  if(!valid||!await this.hasCallGrant(payload))return false;
  await this.processIncomingKeyRotation(peer,payload);return true;
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
 async signed(type,payload){
  let body=payload;
  if(type!=="contact_request"&&isUserId(payload?.to)&&payload.to!==this.me)body={...payload,...(await this.outgoingKeyRotationFields(payload.to))};
  const contact=await getContact(payload.to);
  if(!contact?.outbound_invitation_secret)throw Error("Не найден секрет подтверждения для этого контакта. Попросите собеседника повторно обменяться приглашениями.");
  const raw=un64(contact.outbound_invitation_secret);if(raw.length!==32)throw Error("Некорректный секрет подтверждения контакта.");
  const key=await crypto.subtle.importKey("raw",raw,{name:"HMAC",hash:"SHA-256"},false,["sign"]);
  const envelope={v:2,type,payload:body};
  const mac=await crypto.subtle.sign("HMAC",key,enc.encode(stable(envelope)));
  return {...envelope,auth:{scheme:"contact-hmac-sha256",mac:b64u(mac)}};
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

 async deriveMessageEncryptionKey(peer,from,to,localIdentity,peerPublicKey){
  if(!localIdentity?.privateKey||!peerPublicKey)throw new Error("Не найден ключ для шифрования сообщения.");
  const publicKey=await crypto.subtle.importKey("raw",un64(peerPublicKey),{name:"ECDH",namedCurve:"P-256"},false,[]);
  const shared=await crypto.subtle.deriveBits({name:"ECDH",public:publicKey},localIdentity.privateKey,256);
  const material=await crypto.subtle.importKey("raw",shared,"HKDF",false,["deriveKey"]);
  const salt=await digest(enc.encode("voicelink-message-pair-v1|"+[this.me,peer].sort().join("|")));
  return crypto.subtle.deriveKey({name:"HKDF",hash:"SHA-256",salt,info:enc.encode("voicelink-message-e2ee-v1|"+from+"|"+to)},material,{name:"AES-GCM",length:256},false,["encrypt","decrypt"]);
 }
 messageAad(p){return enc.encode(JSON.stringify({v:1,message_id:p.message_id,from:p.from,to:p.to,created_at:p.created_at,...(p.invitation_id?{invitation_id:p.invitation_id}:{}),...(p.sender_key_id?{sender_key_id:p.sender_key_id}:{}),...(p.recipient_key_id?{recipient_key_id:p.recipient_key_id}:{})}));}
 async promotePendingPeerEncryptionKey(peer,keyId){
  const contact=await getContact(peer);
  if(!contact||contact.message_encryption_pending_key_id!==keyId)return false;
  await updateContact(peer,{
   message_encryption_previous_public_key:contact.message_encryption_public_key,
   message_encryption_previous_key_id:contact.message_encryption_key_id,
   message_encryption_previous_generation:Number(contact.message_encryption_generation)||1,
   message_encryption_previous_at:Date.now(),
   message_encryption_public_key:contact.message_encryption_pending_public_key,
   message_encryption_key_id:contact.message_encryption_pending_key_id,
   message_encryption_generation:Number(contact.message_encryption_pending_generation),
   message_encryption_pending_public_key:null,
   message_encryption_pending_key_id:null,
   message_encryption_pending_generation:null
  });
  return true;
 }
 async acceptPeerEncryptionKeyUpdate(peer,update){
  if(!update||!Number.isSafeInteger(Number(update.generation))||Number(update.generation)<2||typeof update.public_key!=="string"||!/^[A-Za-z0-9_-]{80,100}$/.test(update.public_key)||typeof update.key_id!=="string"||!/^[a-f0-9]{64}$/.test(update.key_id))return false;
  const contact=await getContact(peer);
  if(!contact)return false;
  const generation=Number(update.generation),activeGeneration=Number(contact.message_encryption_generation)||1;
  if(generation<=activeGeneration)return update.key_id===contact.message_encryption_key_id;
  if(generation!==activeGeneration+1||update.key_id===contact.message_encryption_key_id)return false;
  if(contact.message_encryption_pending_key_id)return contact.message_encryption_pending_key_id===update.key_id&&Number(contact.message_encryption_pending_generation)===generation;
  if(contact.message_encryption_previous_key_id&&Date.now()-Number(contact.message_encryption_previous_at||0)<12*60*60*1000)return false;
  let raw;try{raw=un64(update.public_key)}catch{return false}
  if(raw.length!==65||raw[0]!==4)return false;
  try{await crypto.subtle.importKey("raw",raw,{name:"ECDH",namedCurve:"P-256"},false,[])}catch{return false}
  if(hex(await digest(raw))!==update.key_id)return false;
  await updateContact(peer,{message_encryption_pending_public_key:update.public_key,message_encryption_pending_key_id:update.key_id,message_encryption_pending_generation:generation});
  return true;
 }
 async outgoingKeyRotationFields(peer){
  let ring=await getMessageEncryptionKeyRing();
  const week=7*24*60*60*1000;
  const activeAge=Date.now()-Date.parse(ring.active.activated_at||ring.active.created_at||new Date().toISOString());
  if(!ring.pending&&!ring.previous&&Number.isFinite(activeAge)&&activeAge>=week){
   await createPendingMessageEncryptionIdentity();
   ring=await getMessageEncryptionKeyRing();
  }
  const contact=await getContact(peer);
  const fields={};
  if(ring.pending)fields.key_update={generation:Number(ring.pending.generation),key_id:ring.pending.key_id,public_key:ring.pending.public_key};
  if(contact?.message_encryption_pending_key_id)fields.key_update_ack={generation:Number(contact.message_encryption_pending_generation),key_id:contact.message_encryption_pending_key_id};
  return fields;
 }
 async processIncomingKeyRotation(peer,payload){
  let switchedByAck=false;
  if(payload?.key_update_ack&&typeof payload.key_update_ack.key_id==="string"&&Number.isSafeInteger(Number(payload.key_update_ack.generation))){
   const ring=await getMessageEncryptionKeyRing();
   if(ring.pending&&ring.pending.key_id===payload.key_update_ack.key_id&&Number(ring.pending.generation)===Number(payload.key_update_ack.generation)){
    const contacts=await listContacts();
    const requiredPeers=contacts.filter(item=>item.request_pending!==true&&item.message_encryption_key_id&&item.message_encryption_public_key).map(item=>item.user_id);
    const allAcknowledged=await acknowledgePendingMessageEncryptionIdentity(ring.pending.key_id,ring.pending.generation,peer,requiredPeers);
    if(allAcknowledged)switchedByAck=await activatePendingMessageEncryptionIdentity(ring.pending.key_id,ring.pending.generation);
    else this.onDebug("[e2ee] подтверждение ключа получено; ждём подтверждений остальных сохранённых контактов");
   }
  }
  if(payload?.key_update){
   const accepted=await this.acceptPeerEncryptionKeyUpdate(peer,payload.key_update);
   if(accepted)this.onDebug("[e2ee] получен новый ключ собеседника; подтверждение будет включено в следующее сообщение или сигнализацию звонка");
   else this.onDebug("[e2ee] предложение нового ключа отклонено или уже обработано");
  }
  return switchedByAck;
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
  const p=m?.payload,createdAt=Number(p?.created_at);
  if(m?.v!==2||!p||p.to!==this.me||!isUserId(p.from)||p.from===this.me||typeof p.message_id!=="string"||!/^[0-9a-f-]{36}$/i.test(p.message_id)||p.enc_v!==1||typeof p.iv!=="string"||typeof p.ciphertext!=="string"||p.ciphertext.length>9000||!Number.isSafeInteger(createdAt)||createdAt<0||createdAt>Date.now()+300000||(p.sender_key_id!==undefined&&!/^[a-f0-9]{64}$/.test(p.sender_key_id))||(p.recipient_key_id!==undefined&&!/^[a-f0-9]{64}$/.test(p.recipient_key_id)))return;
  let contactRecord;
  try{contactRecord=await getContact(p.from)}catch{return;}
  if(!contactRecord)return;
  let envelopeValid=false;try{envelopeValid=await this.verifyPeerEnvelope("text",p,m.auth)}catch{return;}
  if(!envelopeValid)return;

  const localRing=await getMessageEncryptionKeyRing();
  const localKeys=[{slot:"active",value:localRing.active},{slot:"pending",value:localRing.pending},{slot:"previous",value:localRing.previous}].filter(x=>x.value?.privateKey&&(!p.recipient_key_id||x.value.key_id===p.recipient_key_id));
  const peerKeys=[
   {slot:"active",key_id:contactRecord.message_encryption_key_id,public_key:contactRecord.message_encryption_public_key},
   {slot:"pending",key_id:contactRecord.message_encryption_pending_key_id,public_key:contactRecord.message_encryption_pending_public_key},
   {slot:"previous",key_id:contactRecord.message_encryption_previous_key_id,public_key:contactRecord.message_encryption_previous_public_key}
  ].filter(x=>x.key_id&&x.public_key&&(!p.sender_key_id||x.key_id===p.sender_key_id));
  let plaintext=null,usedLocal=null,usedPeer=null;
  for(const local of localKeys){
   for(const remote of peerKeys){
    try{
     const key=await this.deriveMessageEncryptionKey(p.from,p.from,this.me,local.value,remote.public_key);
     const decrypted=await crypto.subtle.decrypt({name:"AES-GCM",iv:un64(p.iv),additionalData:this.messageAad(p)},key,un64(p.ciphertext));
     const candidate=new TextDecoder().decode(decrypted);
     if(!candidate.trim()||candidate.length>2000)continue;
     plaintext=candidate;usedLocal=local;usedPeer=remote;break;
    }catch{}
   }
   if(plaintext!==null)break;
  }
  if(plaintext===null){this.onDebug("[e2ee] не удалось расшифровать сообщение ни одной из сохранённых версий ключей");return;}

  let switchedByUse=false;
  if(usedLocal.slot==="pending"){
   const contacts=await listContacts();
   const requiredPeers=contacts.filter(item=>item.request_pending!==true&&item.message_encryption_key_id&&item.message_encryption_public_key).map(item=>item.user_id);
   const allAcknowledged=await acknowledgePendingMessageEncryptionIdentity(usedLocal.value.key_id,usedLocal.value.generation,p.from,requiredPeers);
   if(allAcknowledged){
    switchedByUse=await activatePendingMessageEncryptionIdentity(usedLocal.value.key_id,usedLocal.value.generation);
    
   }else this.onDebug("[e2ee] собеседник уже использует новый ключ; ждём подтверждений остальных сохранённых контактов");
  }
  if(usedPeer.slot==="pending")await this.promotePendingPeerEncryptionKey(p.from,usedPeer.key_id);

  if(!switchedByUse&&usedLocal.slot==="active"&&p.recipient_key_id===localRing.active.key_id&&localRing.previous){
   await markPreviousMessageEncryptionIdentityForDeletion(localRing.previous.key_id);
  }
  await this.recordConversationEvent("text",{...p,text:plaintext},"incoming",createdAt);
  if(n?.id){this.seen.add(n.id);this.pendingEvents=this.pendingEvents.filter(item=>item.id!==n.id);}
  this.onDebug("[signaling] получено и сохранено подписанное зашифрованное сообщение от контакта");
 }
 async sendText(to,text){
  if(this.closed||!this.identity)throw Error("Защищённая подписка ещё не готова.");
  if(!isUserId(to)||to===this.me)throw Error("Выберите сохранённый контакт.");
  const body=String(text||"").trim();
  if(!body||body.length>2000)throw Error("Сообщение должно содержать от 1 до 2000 символов.");
  let contact=await getContact(to);
  if(!contact)throw Error("Выберите сохранённый контакт.");
  if(!contact.message_encryption_key_id||!contact.message_encryption_public_key)throw Error("У контакта нет ключа шифрования. Попросите его отправить новое приглашение и добавьте контакт заново.");

  const localRing=await getMessageEncryptionKeyRing();
  contact=await getContact(to);
  const createdAt=Date.now();
  const payload={
   message_id:crypto.randomUUID(),from:this.me,to,
   ...(contact.invitation_id?{invitation_id:contact.invitation_id}:{}),
   enc_v:1,created_at:createdAt,
   sender_key_id:localRing.active.key_id,recipient_key_id:contact.message_encryption_key_id
  };
  const key=await this.deriveMessageEncryptionKey(to,this.me,to,localRing.active,contact.message_encryption_public_key);
  const iv=crypto.getRandomValues(new Uint8Array(12));
  const ciphertext=await crypto.subtle.encrypt({name:"AES-GCM",iv,additionalData:this.messageAad(payload)},key,enc.encode(body));
  payload.iv=b64u(iv);payload.ciphertext=b64u(ciphertext);
  await this.publish(to,await this.signed("text",payload));
  await this.recordConversationEvent("text",{...payload,text:body},"outgoing",createdAt);
  return payload;
 }
 async inspectIncoming(n){
  if(!n?.message||!n?.id)return;
  let m;try{m=JSON.parse(n.message)}catch{return}
  if(m.v!==2||!m.payload)return;
  const p=m.payload;
  if(m.type==="contact_request"){await this.inspectContactRequest(n,m);return;}
  if(m.type==="text"){await this.inspectTextMessage(n,m);return;}
  if(m.type==="cancel"){if(this.peer&&p.from===this.peer)await this.processCancel(m);return;}
  if(m.type!=="hello"||p.to!==this.me||!isUserId(p.from)||p.from===this.me)return;
  // Older saved contacts predate invitation IDs; preserve their existing trust relationship.

  if(this.active||this.ready||(this.incomingSid&&this.incomingSid!==p.sid)||this.outgoingRequest||this.hello)return;
  let contact;
  try{contact=await getPeerSignalingIdentity(p.from)}catch{return;}
  const incomingRole=this.me<p.from?"A":"B";
  if(this.peer!==p.from){this.peer=p.from;this.peerName=contact.name;this.role=incomingRole;}
  else if(!this.peerName)this.peerName=contact.name;
  const expiresAt=Number(p.expiresAt||((Number(n.time)||0)*1000+45000));
  if(!Number.isFinite(expiresAt)||Date.now()>expiresAt)return;
  if(!await this.verifyPeerEnvelope(m.type,p,m.auth)){
   this.onDebug("[signaling] вызов отклонён: подпись, контакт или разрешение недействительны");
   return;
  }
  if(this.acceptedSids.has(p.sid)||this.cancelledSids.has(p.sid)||this.incomingSid===p.sid)return;
  await this.recordConversationEvent(m.type,p,"incoming",Number(n.time)*1000||Date.now());
  this.onPeerMessage(p.from);
  this.incomingSid=p.sid;this.incomingEventId=n.id;this.incomingIdentity=true;
  const pendingCancel=this.pendingCancels.get(p.sid);
  if(pendingCancel){this.pendingCancels.delete(p.sid);await this.processCancel(pendingCancel);if(this.cancelledSids.has(p.sid))return;}
  this.onIncoming({peer:this.peerName||"контакт",peerId:this.peer,sid:p.sid,expiresAt});
 }
 async inspectContactRequest(n,m){
  const p=m?.payload;
  if(m?.v!==2||!p||p.to!==this.me||!isUserId(p.from)||p.from===this.me||
     typeof p.request_id!=="string"||!/^[0-9a-f-]{36}$/i.test(p.request_id)||!p.invitation_id)return;
  const expiresAt=Number(p.expires_at);
  if(!Number.isFinite(expiresAt)||Date.now()>expiresAt)return;
  const issued=await getIssuedInvitation(p.invitation_id);
  if(!issued||issued.revoked||!issued.secret)return;
  const contact=await decryptContactRequestEnvelope(m,issued.secret,await getMessageEncryptionKeyRing());
  if(contact.user_id!==p.from)throw Error("Идентификатор отправителя не совпадает с аутентифицированным пакетом контакта.");
  const activation=await consumeIssuedInvitation({invitationId:p.invitation_id,userId:p.from,requestId:p.request_id});
  if(!activation.accepted){this.onDebug("[signaling] запрос контакта отклонён: приглашение неизвестно, отозвано или уже использовано");return;}
  this.onPeerMessage(this.peer);
  this.onContactRequest({requestId:p.request_id,contact,expiresAt,invitationCreatedAt:activation.created_at,invitationId:p.invitation_id,outboundInvitationSecret:issued.secret});
 }
 async processCancel(m){
  const p=m?.payload;
  if(m?.v!==2||!p||p.from!==this.peer||p.to!==this.me||!p.sid)return;
  if(this.acceptedSids.has(p.sid))return;
  if(!await this.verifyPeerEnvelope("cancel",p,m.auth))throw Error("Подпись отмены вызова, контакт или разрешение недействительны.");
  if(!Number.isFinite(Number(p.expiresAt))||Date.now()>Number(p.expiresAt))return;
  this.onPeerMessage(this.peer);
  if(!this.incomingIdentity){
   this.pendingCancels.set(p.sid,m);
   if(this.pendingCancels.size>50)this.pendingCancels.delete(this.pendingCancels.keys().next().value);
   return;
  }
  this.cancelledSids.add(p.sid);
  if(this.cancelledSids.size>100)this.cancelledSids.delete(this.cancelledSids.values().next().value);
  if(this.incomingSid===p.sid&&!this.hello&&!this.ready){
   this.onDebug("[signaling] получена подписанная отмена входящего вызова до ответа");
   this.incomingSid=null;this.incomingEventId=null;this.incomingIdentity=null;
   this.onCancelIncoming({peer:this.peerName||"контакт",sid:p.sid});
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
  await this.publish(this.peer,await this.signed("reject",payload));
  await this.recordConversationEvent("reject",payload,"outgoing",Date.now());
  this.acceptedSids.add(sid);
  this.onDebug("[signaling] подписанный отказ от входящего вызова отправлен через ntfy");
  this.incomingSid=null;this.incomingEventId=null;this.incomingIdentity=null;
  return true;
 }
 async cancelCall(){
  const request=this.outgoingRequest||this.hello;
  if(this.closed||!request||!["A","B"].includes(this.role))return false;
  const payload={sid:request.sid,from:this.me,to:this.peer,...(this.peerInvitationId?{invitation_id:this.peerInvitationId}:{}),expiresAt:Date.now()+15000};
  await this.publish(this.peer,await this.signed("cancel",payload));
  this.outgoingRequest=null;
  this.onDebug("[signaling] подписанная отмена вызова отправлена через ntfy");
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
  await this.publish(this.peer,await this.signed("hello",this.hello));
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
  await this.publish(this.peer,await this.signed("answer",this.answer));
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
   let queued;try{queued=JSON.parse(event.data)}catch{return}
   if(!queued.message||!queued.id||this.seen.has(queued.id))return;
   if(!this.pendingEvents.some(item=>item.id===queued.id)){
    this.pendingEvents.push(queued);
    this.onDebug("[signaling] входящее сообщение сохранено до ответа пользователя");
    await this.inspectIncoming(queued);
   }
   return;
  }
  const n=JSON.parse(event.data);if(!n.message||!n.id||this.seen.has(n.id))return;
  this.seen.add(n.id);if(this.seen.size>600)this.seen.delete(this.seen.values().next().value);
  let m;try{m=JSON.parse(n.message)}catch{return}
  if(m.type==="contact_request"){await this.inspectContactRequest(n,m);return;}
  if(m.v!==2||!m.payload)return;
  const p=m.payload;
  if(m.type==="text"){
   if(p.to===this.me)await this.inspectTextMessage(n,m);
   return;
  }
  if(p.from!==this.peer||p.to!==this.me)return;
  if(m.type==="hello"){
   const expiresAt=Number(p.expiresAt||((Number(n.time)||0)*1000+45000));
   if(!Number.isFinite(expiresAt)||Date.now()>expiresAt){this.onDebug("[signaling] просроченный hello пропущен");return}
  }
  if(m.type==="cancel"){await this.processCancel(m);return;}
  if(m.type==="reject"){
   const request=this.outgoingRequest||this.hello;
   if(!request||p.sid!==request.sid||!Number.isFinite(Number(p.expiresAt))||Date.now()>Number(p.expiresAt))return;
   if(!await this.verifyPeerEnvelope("reject",p,m.auth))throw Error("Подпись отказа от вызова, контакт или разрешение недействительны.");
   await this.recordConversationEvent("reject",p,"incoming",Number(n.time)*1000||Date.now());
   this.onPeerMessage(this.peer);
   this.outgoingRequest=null;this.clearHelloRetry();
   this.onRejectOutgoing({peer:this.peerName||"контакт",sid:p.sid});
   return;
  }
   if(m.type==="hello"){
    if(this.hello&&this.helloDirection==="incoming"){
     if(p.sid===this.hello.sid&&this.answer&&Date.now()-this.lastAnswerAt>=10000){
      this.onDebug("[signaling] answer resend after repeated hello");
      try{await this.sendAnswer()}catch(err){this.onError(err);if(err.retryable)this.scheduleAnswerRetry(5000)}
     }
     return;
    }
    if(this.ready)return;
    if(this.hello&&this.helloDirection==="outgoing"){
     if(this.me<p.from)return;
     this.cancelledSids.add(this.hello.sid);this.clearHelloRetry();
     this.hello=null;this.helloDirection=null;this.outgoingRequest=null;
     this.onDebug("[signaling] crossed call: уступаем hello участника с меньшим ID");
    }
    if(!await this.verifyPeerEnvelope(m.type,p,m.auth))throw Error("Подпись hello, контакт или разрешение недействительны.");
    if(this.cancelledSids.has(p.sid))return;
    await this.recordConversationEvent("hello",p,"incoming",Number(n.time)*1000||Date.now());this.onPeerMessage(this.peer);
    const pendingCancel=this.pendingCancels.get(p.sid);
    if(pendingCancel){this.pendingCancels.delete(p.sid);this.incomingSid=p.sid;this.incomingIdentity=p.identity;await this.processCancel(pendingCancel);if(this.cancelledSids.has(p.sid))return;}
    this.hello=p;this.helloDirection="incoming";this.incomingSid=p.sid;this.incomingIdentity=p.identity;
    this.ecdh=await crypto.subtle.generateKey({name:"ECDH",namedCurve:"P-256"},true,["deriveBits"]);
    const answer={sid:p.sid,from:this.me,to:this.peer,...(this.peerInvitationId?{invitation_id:this.peerInvitationId}:{}),eph:b64u(await crypto.subtle.exportKey("raw",this.ecdh.publicKey)),nonce:b64u(crypto.getRandomValues(new Uint8Array(16))),helloEph:p.eph,helloNonce:p.nonce};
    this.answer=answer;await this.derive(p,answer);
    this.onDebug("[signaling] answer prepared; sending initial response");
    try{await this.sendAnswer()}catch(err){this.onError(err);if(err.retryable)this.scheduleAnswerRetry(5000)}
    return;
   }
  if(m.type==="answer"&&!this.ready){
   if(!this.hello||this.helloDirection!=="outgoing"||p.sid!==this.hello.sid||p.helloEph!==this.hello.eph||p.helloNonce!==this.hello.nonce)return;
   if(!await this.verifyPeerEnvelope(m.type,p,m.auth))throw Error("Подпись ответа, контакт или разрешение недействительны.");
   await this.recordConversationEvent("answer",p,"incoming",Number(n.time)*1000||Date.now());
   this.onPeerMessage(this.peer);await this.derive(this.hello,p);if(!this.readyNotified){this.readyNotified=true;this.onReady()}return;
  }
  if(m.type==="data"&&this.ready&&p.sid===this.session){
   const dir=p.from<p.to?"A-to-B":"B-to-A";
   const plain=await crypto.subtle.decrypt({name:"AES-GCM",iv:un64(p.iv),additionalData:enc.encode(this.session+"|"+dir)},this.recvKey,un64(p.data));
   const msg=JSON.parse(new TextDecoder().decode(plain));
   this.onPeerMessage(this.peer);
   if(msg.type==="signal")await this.onSignal(msg.payload);
  }
 }
 async hasCallGrant(payload){
   const contact=await getPeerSignalingIdentity(payload.from);
   if(!contact.invitation_id)return true;
   return typeof payload.invitation_id==="string"&&await hasActiveInvitationGrant(payload.invitation_id,payload.from);
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
  await this.publish(this.peer,{v:2,type:"data",payload:{sid:this.session,from:this.me,to:this.peer,iv:b64u(iv),data:b64u(data)}});
 }
 close(){this.closed=true;this.active=false;this.clearHelloRetry();this.clearAnswerRetry();if(this.es){const before=this.es.readyState;this.onDebug(`[SSE ${this.debugId}] ${new Date().toISOString()} close() вызван; readyState(before)=${before}`);this.es.close();this.onDebug(`[SSE ${this.debugId}] ${new Date().toISOString()} close() завершён; readyState(after)=${this.es.readyState}`)}else this.onDebug(`[SSE ${this.debugId}] ${new Date().toISOString()} close() вызван без EventSource`);}
}
