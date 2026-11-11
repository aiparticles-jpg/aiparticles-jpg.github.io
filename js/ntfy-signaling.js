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
  this.es=null;this.sseReadyPromise=null;this.subscribePromise=null;this.active=false;this.identity=null;this.hello=null;this.readyNotified=false;this.answer=null;this.lastAnswerAt=0;this.session=null;this.ready=false;this.seen=new Set();this.preAnswerMessageCount=0;this.messageQueue=Promise.resolve();this.publishQueue=Promise.resolve();this.lastPublishStartAt=0;this.publishStartTimes=[];this.closed=false;this.rateLimited=false;this.helloAttempts=0;this.helloRetryTimer=null;this.answerAttempts=0;this.answerRetryTimer=null;this.incomingSid=null;this.incomingEventId=null;this.incomingIdentity=null;this.incomingHello=null;this.outgoingRequest=null;this.helloDirection=null;this.answeringIncoming=false;this.cancelledSids=new Set();this.pendingCancels=new Map();this.acceptedSids=new Set();this.dataAssemblies=new Map();
 }
 static validUserId(s){return isUserId(s)}
 async deriveEnvelopeKey(secret,from,to){
  const raw=un64(secret);if(raw.length!==32)throw Error("Некорректный общий симметричный ключ.");
  const material=await crypto.subtle.importKey("raw",raw,"HKDF",false,["deriveKey"]),pair=[from,to].sort().join("|"),salt=await digest(enc.encode("voicelink-envelope-pair-v3|"+pair));
  return crypto.subtle.deriveKey({name:"HKDF",hash:"SHA-256",salt,info:enc.encode("voicelink-envelope-v3|"+from+"|"+to)},material,{name:"AES-GCM",length:256},false,["encrypt","decrypt"]);
 }
 envelopeAad(type,from,to,compression=null){return enc.encode(stable({v:3,type,from,to,...(compression?{compression}:{})}));}
 validDecryptedPayload(type,p){
  const uuid=v=>typeof v==="string"&&/^[0-9a-f-]{36}$/i.test(v);
  if(!p||p.from===undefined||p.to===undefined)return false;
  if(p.rotation_request&&(!uuid(p.rotation_request.rotation_id)||typeof p.rotation_request.public_key!=="string"||p.rotation_request.public_key.length>1000))return false;
  if(type==="text")return uuid(p.message_id)&&Number.isSafeInteger(Number(p.created_at))&&Number(p.created_at)>=0&&Number(p.created_at)<=Date.now()+300000&&typeof p.text==="string"&&p.text.trim().length>0&&p.text.length<=2000;
  if(type==="hello")return uuid(p.sid)&&Number.isFinite(Number(p.expiresAt));
  if(type==="answer")return uuid(p.sid);
  if(type==="cancel"||type==="reject")return uuid(p.sid)&&Number.isFinite(Number(p.expiresAt));
  if(type==="rotation_response")return uuid(p.rotation_id)&&typeof p.encrypted_key==="string";
  if(type==="data")return uuid(p.sid)&&p.signal&&typeof p.signal==="object"&&!Array.isArray(p.signal);
  return false;
 }
 async verifyPeerEnvelope(type,payload,auth){
  if(auth?.scheme!=="contact-aes-256-gcm"||typeof auth.iv!=="string"||typeof auth.ciphertext!=="string"){
   this.onDebug(`[e2ee] ${type} отклонён: некорректная структура auth (scheme/iv/ciphertext).`);return false;
  }
  const peer=payload?.from;
  if(!isUserId(peer)||peer===this.me||payload?.to!==this.me){
   this.onDebug(`[e2ee] ${type} отклонён до расшифровки: from/to не соответствуют локальной идентичности.`);return false;
  }
  const cipherBytes=un64(auth.ciphertext).byteLength;
  const contact=await getContact(peer);
  if(!contact?.invitation_secret){
   this.onDebug(`[e2ee] ${type} отклонён: для peer=${peer.slice(0,10)} нет сохранённого invitation_secret.`);return false;
  }
  const candidates=[{slot:"pending",secret:contact.pending_secret},{slot:"active",secret:contact.invitation_secret},{slot:"previous",secret:contact.previous_secret}].filter(x=>typeof x.secret==="string");
  let decoded=null,used=null,decryptFailures=0,payloadFailures=0,plainBytes=null;
  for(const candidate of candidates){try{
   const key=await this.deriveEnvelopeKey(candidate.secret,peer,this.me);
   const decrypted=await crypto.subtle.decrypt({name:"AES-GCM",iv:un64(auth.iv),additionalData:this.envelopeAad(type,peer,this.me,auth.compression||null)},key,un64(auth.ciphertext));
    plainBytes=decrypted.byteLength;
    if(auth.compression&&!(type==="data"&&auth.compression==="gzip"))throw Error("Unsupported envelope compression.");
    const plain=auth.compression==="gzip"
     ?await new Response(new Blob([decrypted]).stream().pipeThrough(new DecompressionStream("gzip"))).arrayBuffer()
     :decrypted;
    const value=JSON.parse(new TextDecoder().decode(plain));
   if(!value||typeof value!=="object"||value.from!==peer||value.to!==this.me||!this.validDecryptedPayload(type,value)){payloadFailures++;continue;}
   decoded=value;used=candidate;break;
  }catch{decryptFailures++;}}
  if(!decoded){
   this.onDebug(`[e2ee] ${type} не расшифрован: ciphertext=${cipherBytes} B; ключей проверено=${candidates.length}; AES-GCM failures=${decryptFailures}; payload validation failures=${payloadFailures}.`);
   return false;
  }
  if(type==="data")this.onDebug(`[e2ee] data расшифрован: ciphertext=${cipherBytes} B; decrypted=${plainBytes} B; compression=${auth.compression||"none"}; key-slot=${used.slot}; payload=valid.`);
  Object.assign(payload,decoded);
  const grant=await this.hasCallGrant(payload);
  if(!grant.ok){
   this.onDebug(`[reject] stage=CALL_GRANT; code=${grant.code}; type=${type}; peer=${peer.slice(0,10)}; sid=${String(payload.sid||"нет").slice(0,8)}; invitation_id=${String(payload.invitation_id||"нет").slice(0,12)}; details=${JSON.stringify(grant)}.`);return false;
  }
  this.onDebug(`[grant] code=GRANT_VALID; type=${type}; peer=${peer.slice(0,10)}; invitation_id=${grant.invitation_id}.`);
  if(used.slot==="pending"){
   await updateContact(peer,{invitation_secret:contact.pending_secret,pending_secret:null,pending_rotation_id:null,previous_secret:null,previous_secret_at:null,shared_secret_created_at:Date.now(),rotation_response_id:null,rotation_response_ciphertext:null});
   this.onDebug("[e2ee] получено первое сообщение под новым ключом; старый ключ удалён");
  }else if(used.slot==="active"&&contact.previous_secret){
   await updateContact(peer,{previous_secret:null,previous_secret_at:null});
   this.onDebug("[e2ee] собеседник перешёл на новый ключ; предыдущий ключ удалён");
  }else if(used.slot==="previous")this.onDebug("[e2ee] принято сообщение под предыдущим ключом; оба ключа пока сохраняются");
  await this.processIncomingKeyRotation(peer,payload,type);return true;
 }

 async waitForPublishSlot(){
  while(true){
   const now=Date.now();
   this.publishStartTimes=this.publishStartTimes.filter(start=>now-start<5000);
   const intervalWait=Math.max(0,this.lastPublishStartAt+250-now);
   const windowWait=this.publishStartTimes.length>=3?Math.max(0,this.publishStartTimes[0]+5000-now):0;
   const wait=Math.max(intervalWait,windowWait);
   if(wait>0){
    const reasons=[];
    if(intervalWait>0)reasons.push("минимальный интервал 250 мс");
    if(windowWait>0)reasons.push("лимит 3 POST за 5 секунд");
    this.onDebug(`[ntfy] POST отложен на ${Math.ceil(wait)} мс: ${reasons.join("; ")}`);
    await new Promise(resolve=>setTimeout(resolve,wait));
    continue;
   }
   const startedAt=Date.now();
   this.publishStartTimes=this.publishStartTimes.filter(start=>startedAt-start<5000);
   this.publishStartTimes.push(startedAt);
   this.lastPublishStartAt=startedAt;
   return;
  }
 }
async publish(to,msg){
   const task=async()=>{
    if(this.rateLimited)throw Error("ntfy ранее вернул HTTP 429; новые отправки остановлены.");
    const maxMessageBytes=4096,originalBody=JSON.stringify(msg),originalBytes=enc.encode(originalBody).byteLength,messages=[];
    if(msg.type==="data"&&originalBytes>maxMessageBytes){
     if([...originalBody].some(ch=>ch.charCodeAt(0)>127))throw Error("Нельзя безопасно фрагментировать не-ASCII data envelope.");
     const messageId=crypto.randomUUID(),template={v:3,type:"data_part",payload:{from:this.me,to,message_id:messageId,index:15,total:16,chunk:""}};
     const wrapperBytes=enc.encode(JSON.stringify(template)).byteLength,chunkSize=maxMessageBytes-wrapperBytes,total=Math.ceil(originalBody.length/chunkSize);
     if(chunkSize<1||total>16)throw Error("Зашифрованное data-сообщение слишком велико для ntfy.");
     for(let index=0;index<total;index++){
      const part={v:3,type:"data_part",payload:{from:this.me,to,message_id:messageId,index,total,chunk:originalBody.slice(index*chunkSize,(index+1)*chunkSize)}};
      const partBytes=enc.encode(JSON.stringify(part)).byteLength;
      if(partBytes>maxMessageBytes)throw Error(`ntfy body size ${partBytes} B exceeds ${maxMessageBytes} B.`);
      messages.push(part);
     }
     this.onDebug(`[ntfy] envelope=${originalBytes} B; parts=${total}; chunkCapacity=${chunkSize} chars; wrapper=${wrapperBytes} B; maxBody=${maxMessageBytes} B.`);
    }else messages.push(msg);
    for(let i=0;i<messages.length;i++){
     if(this.rateLimited)throw Error("ntfy ранее вернул HTTP 429; новые отправки остановлены.");
     const current=messages[i],body=JSON.stringify(current),bodyBytes=enc.encode(body).byteLength;
     if(bodyBytes>maxMessageBytes)throw Error(`ntfy message body ${bodyBytes} B exceeds ${maxMessageBytes} B.`);
     if(current.type==="data")this.onDebug(`[ntfy] data POST body=${bodyBytes} B; limit=${maxMessageBytes} B; headroom=${maxMessageBytes-bodyBytes} B.`);
     if(current.type==="data_part")this.onDebug(`[ntfy] data part POST ${i+1}/${messages.length}; body=${bodyBytes} B; limit=${maxMessageBytes} B; headroom=${maxMessageBytes-bodyBytes} B.`);
     const url=BASE+await getNtfyTopic(to);
     await this.waitForPublishSlot();
     this.onDebug(`[ntfy] POST → ${current.type} (одна попытка)`);
     let response;
     try{response=await fetch(url,{method:"POST",headers:{"Content-Type":"application/json"},body,cache:"no-store"});}
     catch(error){const failure=Error("Сетевая ошибка при POST в ntfy ("+current.type+"): "+(error.message||String(error)));failure.retryable=true;throw failure;}
     this.onDebug(`[ntfy] POST ← ${response.status} (${current.type})`);
     if(!response.ok){
      const retryAfter=response.headers.get("Retry-After");
      if(response.status===429){this.rateLimited=true;this.clearHelloRetry();this.clearAnswerRetry();}
      const failure=Error("ntfy HTTP "+response.status+(response.status===429?"; сервер ограничил частоту запросов"+(retryAfter?"; Retry-After: "+retryAfter:""):""));
      failure.retryable=response.status===408||response.status>=500;throw failure;
     }
    }
   };
   const result=this.publishQueue.then(task,task);this.publishQueue=result.catch(()=>{});return result;
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
   const plaintext=enc.encode(stable(body));
   let encryptionInput=plaintext,compression=null;
   if(type==="data"&&typeof CompressionStream==="function"){
    try{
     const compressed=await new Response(new Blob([plaintext]).stream().pipeThrough(new CompressionStream("gzip"))).arrayBuffer();
     if(compressed.byteLength<plaintext.byteLength){encryptionInput=compressed;compression="gzip";}
     const signal=payload.signal?.payload||{},sdpChars=signal.description?.sdp?.length||0,candidateCount=Array.isArray(signal.candidates)?signal.candidates.length:0;
     this.onDebug(`[compression] JSON=${plaintext.byteLength} B; gzip=${compressed.byteLength} B; saved=${plaintext.byteLength-compressed.byteLength} B; applied=${compression==="gzip"}; SDP=${sdpChars} chars; candidates=${candidateCount}; AES-GCM input=${encryptionInput.byteLength} B.`);
    }catch(error){this.onDebug(`[compression] gzip failed; fallback=plain; reason=${error.message||String(error)}.`);}
   }
   const ciphertext=await crypto.subtle.encrypt({name:"AES-GCM",iv,additionalData:this.envelopeAad(type,this.me,peer,compression)},key,encryptionInput);
   const ciphertextBytes=ciphertext.byteLength,ciphertextText=b64u(ciphertext);
   const envelope={v:3,type,payload:{from:this.me,to:peer},auth:{scheme:"contact-aes-256-gcm",iv:b64u(iv),...(compression?{compression}:{}),ciphertext:ciphertextText}};
   if(type==="data"){
    const envelopeBytes=enc.encode(JSON.stringify(envelope)).byteLength;
    this.onDebug(`[signaling] data actual: plaintext=${plaintext.byteLength} B; AES-GCM input=${encryptionInput.byteLength} B; compression=${compression||"none"}; ciphertext=${ciphertextBytes} B; base64url=${ciphertextText.length} chars; envelope JSON=${envelopeBytes} B; ntfy message limit=4096 B.`);
   }
   return envelope;
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
   es.onopen=event=>{
    // ntfy sends its own named SSE event "open" immediately after connecting.
    // It is a MessageEvent with data; it must not be mistaken for EventSource's
    // transport-level open event (a plain Event).
    if(typeof event?.data==="string"){
     let serverEvent=null;
     try{serverEvent=JSON.parse(event.data)?.event||null}catch{}
     if(serverEvent==="open"){
      this.onDebug(`[SSE ${this.debugId}] ntfy server event=open received; transport connection was already opened.`);
      return;
     }
    }
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
  // Finish background inspection before switching to active call mode.
  await this.messageQueue;
  this.active=true;
  if(this.preAnswerMessageCount){this.onDebug(`[signaling] до активации проверено ${this.preAnswerMessageCount} входящих событий; отложенная очередь не используется`);this.preAnswerMessageCount=0;}
  if(this.answeringIncoming&&this.helloDirection==="incoming"&&this.hello&&!this.answer){
   const p=this.hello;
   this.answer={sid:p.sid,from:this.me,to:this.peer,...(this.peerInvitationId?{invitation_id:this.peerInvitationId}:{})};
   this.activateSession(p.sid);
   this.onDebug("[signaling] принятое в фоне hello восстановлено; отправляем answer");
   try{await this.sendAnswer()}catch(err){this.onError(err);if(err.retryable)this.scheduleAnswerRetry(5000)}
  }
  if(!this.answeringIncoming&&!this.hello){
   try{await this.sendHello()}catch(err){this.onError(err);if(err.retryable)this.scheduleHelloRetry(5000)}
  }
  this.answeringIncoming=false;
 }
 setPeer(peer){
  if(peer!==""&&(!isUserId(peer)||peer===this.me))throw Error("Выберите корректный локальный контакт.");
  if(peer===this.peer)return;
  this.resetSession();this.peer=peer;this.peerName="";this.peerInvitationId=null;this.role=peer?(this.me<peer?"A":"B"):null;
 }
 acceptIncoming(){
  const sid=this.incomingSid;
  if(sid){this.acceptedSids.add(sid);if(this.acceptedSids.size>100)this.acceptedSids.delete(this.acceptedSids.values().next().value)}
  this.answeringIncoming=true;
  if(this.incomingHello&&this.incomingHello.sid===sid){this.hello=this.incomingHello;this.helloDirection="incoming"}
  this.incomingHello=null;
  this.incomingSid=null;this.incomingEventId=null;this.incomingIdentity=null;
 }
 dismissIncoming(){
  if(this.incomingEventId)this.rememberSeen(this.incomingEventId);
  this.incomingSid=null;this.incomingEventId=null;this.incomingIdentity=null;this.incomingHello=null;
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
  if(n?.id)this.rememberSeen(n.id);
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
  const eventId=String(n?.id||"нет").slice(0,14);
  if(!n?.message||!n?.id){this.onDebug(`[incoming] событие пропущено: нет message/id; ntfyId=${eventId}.`);return;}
  let m;try{m=JSON.parse(n.message)}catch(error){this.onDebug(`[incoming] событие пропущено: message не JSON; ntfyId=${eventId}; error=${error.message||String(error)}.`);return;}
  if(m.type==="contact_request"){await this.inspectContactRequest(n,m);return;}
  if(m.type==="text"){await this.inspectTextMessage(n,m);return;}
  if(m.v!==3||!m.payload){this.onDebug(`[incoming] ${m.type||"unknown"} пропущен: version=${m.v??"нет"}; payload=${!!m.payload}; ntfyId=${eventId}.`);return;}
  const p=m.payload;
  if(!isUserId(p.from)||p.from===this.me||p.to!==this.me){this.onDebug(`[incoming] ${m.type} пропущен: адресация не для этого устройства; from=${String(p.from||"нет").slice(0,10)}; to=${String(p.to||"нет").slice(0,10)}; me=${this.me.slice(0,10)}; ntfyId=${eventId}.`);return;}
  if(m.type==="rotation_response"){let ok=false;try{ok=await this.verifyPeerEnvelope(m.type,p,m.auth)}catch(error){this.onDebug(`[incoming] rotation_response verification error: ${error.message||String(error)}; ntfyId=${eventId}.`)}if(ok&&n?.id)this.rememberSeen(n.id);return;}
  if(m.type==="cancel"){
   try{const contact=await getPeerSignalingIdentity(p.from);this.peer=p.from;this.peerName=contact.name;this.peerInvitationId=contact.invitation_id;this.role=this.me<p.from?"A":"B";await this.processCancel(m);if(n?.id)this.rememberSeen(n.id)}
   catch(error){this.onDebug(`[incoming] cancel processing failed: ${error.message||String(error)}; peer=${p.from.slice(0,10)}; ntfyId=${eventId}.`)}return;
  }
  if(m.type!=="hello"){this.onDebug(`[incoming] неизвестный тип ${m.type||"нет"} пропущен; ntfyId=${eventId}.`);return;}
  const sid=String(p.sid||"нет").slice(0,8);
  if(this.active||this.ready||(this.incomingSid&&this.incomingSid!==p.sid)||this.outgoingRequest||this.hello){
   const reason=this.active?"уже активен звонок":this.ready?"secure-сессия уже ready":(this.incomingSid&&this.incomingSid!==p.sid)?"уже есть другой входящий sid":this.outgoingRequest?"есть исходящий запрос":"hello уже обрабатывается";
   this.onDebug(`[incoming] hello проигнорирован: ${reason}; peer=${p.from.slice(0,10)}; sid=${sid}; ntfyId=${eventId}.`);return;
  }
  let contact;try{contact=await getPeerSignalingIdentity(p.from)}catch(error){this.onDebug(`[incoming] hello не проверен: не удалось загрузить контакт; peer=${p.from.slice(0,10)}; error=${error.message||String(error)}; ntfyId=${eventId}.`);return;}
  this.peer=p.from;this.peerName=contact.name;this.peerInvitationId=contact.invitation_id;this.role=this.me<p.from?"A":"B";
  let verified=false;try{verified=await this.verifyPeerEnvelope(m.type,p,m.auth)}catch(error){this.onDebug(`[incoming] hello verification exception: ${error.message||String(error)}; peer=${p.from.slice(0,10)}; sid=${sid}; ntfyId=${eventId}.`);return;}
  if(!verified){this.onDebug(`[incoming] hello отклонён проверкой E2EE/приглашения; peer=${p.from.slice(0,10)}; sid=${sid}; invitation_id=${String(p.invitation_id||"нет").slice(0,12)}; ntfyId=${eventId}.`);return;}
  const expiresAt=Number(p.expiresAt||((Number(n.time)||0)*1000+45000));
  if(!Number.isFinite(expiresAt)||Date.now()>expiresAt||typeof p.sid!=="string"){this.onDebug(`[incoming] hello аутентифицирован, но устарел/невалиден: now=${Date.now()}; expiresAt=${expiresAt}; sidValid=${typeof p.sid==="string"}; ntfyId=${eventId}.`);return;}
  if(this.acceptedSids.has(p.sid)||this.cancelledSids.has(p.sid)||this.incomingSid===p.sid){
   const reason=this.acceptedSids.has(p.sid)?"sid уже принят":this.cancelledSids.has(p.sid)?"sid отменён":"этот входящий sid уже установлен";
   this.onDebug(`[incoming] hello-дубликат проигнорирован: ${reason}; sid=${sid}; ntfyId=${eventId}.`);return;
  }
  if(n?.id)this.rememberSeen(n.id);
  await this.recordConversationEvent("hello",p,"incoming",Number(n.time)*1000||Date.now());
  this.onPeerMessage(p.from);this.incomingSid=p.sid;this.incomingEventId=n.id;this.incomingIdentity=true;this.incomingHello=p;
  const pending=this.pendingCancels.get(p.sid);
  if(pending){this.pendingCancels.delete(p.sid);this.onDebug(`[incoming] для hello уже ожидала отмена; применяем cancel; sid=${sid}.`);await this.processCancel(pending);if(this.cancelledSids.has(p.sid))return;}
  this.onDebug(`[incoming] hello принят: peer=${p.from.slice(0,10)}; name=${this.peerName||"контакт"}; sid=${sid}; expiresIn=${Math.max(0,Math.round((expiresAt-Date.now())/1000))}s; ntfyId=${eventId}.`);
  this.onIncoming({peer:this.peerName||"контакт",peerId:this.peer, sid:p.sid,expiresAt});
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
  if(n?.id)this.rememberSeen(n.id);
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
 rememberSeen(id){
  if(!id)return;
  this.seen.add(id);
  if(this.seen.size>600)this.seen.delete(this.seen.values().next().value);
 }
 resetSession(){
  this.active=false;this.answeringIncoming=false;this.clearHelloRetry();this.clearAnswerRetry();this.dataAssemblies.clear();
  this.hello=null;this.helloDirection=null;this.readyNotified=false;this.answer=null;this.lastAnswerAt=0;this.session=null;this.ready=false;this.incomingHello=null;
  this.incomingSid=null;this.incomingEventId=null;this.incomingIdentity=null;this.outgoingRequest=null;this.pendingCancels.clear();this.acceptedSids.clear();this.rateLimited=false;this.helloAttempts=0;this.answerAttempts=0;
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
   this.hello={sid:crypto.randomUUID(),from:this.me,to:this.peer,...(this.peerInvitationId?{invitation_id:this.peerInvitationId}:{}),expiresAt:Date.now()+45000};
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
 acceptDataPart(payload){
  const now=Date.now();
  for(const [key,value] of this.dataAssemblies)if(now-value.createdAt>120000)this.dataAssemblies.delete(key);
  const validId=value=>typeof value==="string"&&/^[0-9a-f-]{36}$/i.test(value);
  if(!payload||payload.from!==this.peer||payload.to!==this.me||!validId(payload.message_id)||!Number.isInteger(payload.index)||!Number.isInteger(payload.total)||payload.total<2||payload.total>16||payload.index<0||payload.index>=payload.total||typeof payload.chunk!=="string"||payload.chunk.length<1||payload.chunk.length>4096){
   this.onDebug("[ntfy] data part отклонён: некорректные метаданные или размер.");return null;
  }
  const key=payload.from+":"+payload.message_id;let entry=this.dataAssemblies.get(key);
  if(!entry){if(this.dataAssemblies.size>=8)this.dataAssemblies.delete(this.dataAssemblies.keys().next().value);entry={createdAt:now,total:payload.total,parts:new Map(),size:0};this.dataAssemblies.set(key,entry);}
  if(entry.total!==payload.total){this.dataAssemblies.delete(key);this.onDebug("[ntfy] сборка data отменена: totalParts не совпадает.");return null;}
  const previous=entry.parts.get(payload.index);
  if(previous!==undefined){if(previous!==payload.chunk){this.dataAssemblies.delete(key);this.onDebug("[ntfy] сборка data отменена: повторный фрагмент содержит другие данные.");}return null;}
  entry.parts.set(payload.index,payload.chunk);entry.size+=payload.chunk.length;
  if(entry.size>65536){this.dataAssemblies.delete(key);this.onDebug("[ntfy] сборка data отменена: превышен максимальный размер.");return null;}
  this.onDebug(`[ntfy] data part получен: ${entry.parts.size}/${entry.total}; messageId=${payload.message_id.slice(0,8)}; index=${payload.index+1}`);
  if(entry.parts.size!==entry.total)return null;
  let body="";for(let index=0;index<entry.total;index++){const part=entry.parts.get(index);if(part===undefined)return null;body+=part;}
  this.dataAssemblies.delete(key);
  try{const envelope=JSON.parse(body);if(envelope?.v!==3||envelope?.type!=="data"||envelope?.payload?.from!==this.peer||envelope?.payload?.to!==this.me||typeof envelope?.auth?.ciphertext!=="string")throw Error("invalid envelope");}
  catch{this.onDebug("[ntfy] собранные data-фрагменты отклонены: исходный конверт некорректен.");return null;}
  this.onDebug(`[ntfy] data envelope собран полностью: ${entry.total} частей, ${entry.size} символов; messageId=${payload.message_id.slice(0,8)}`);return body;
 }
 async handle(event){
  if(!this.active){
   let q;try{q=JSON.parse(event.data)}catch{return;}
   if(!q.message||!q.id||this.seen.has(q.id))return;
   await this.inspectIncoming(q);
   this.rememberSeen(q.id);
   this.preAnswerMessageCount++;
   return;
  }
  const n=JSON.parse(event.data);if(!n.message||!n.id||this.seen.has(n.id))return;
  this.rememberSeen(n.id);
  let m;try{m=JSON.parse(n.message)}catch{return;}
  if(m.type==="data")this.onDebug("[signaling] ntfy data envelope: v="+m.v+"; from="+String(m.payload?.from||"нет").slice(0,10)+"; expectedFrom="+this.peer.slice(0,10)+"; to="+String(m.payload?.to||"нет").slice(0,10)+"; expectedTo="+this.me.slice(0,10)+"; ntfyId="+String(n.id).slice(0,12));
  if(m.v===3&&m.type==="data_part"){
    const assembled=this.acceptDataPart(m.payload);
    if(assembled)await this.handle({data:JSON.stringify({...n,id:"assembled:"+m.payload.message_id,message:assembled})});
    return;
   }
   if(m.type==="contact_request"){await this.inspectContactRequest(n,m);return;}
  if(m.type==="text"){if(m.v===3&&m.payload?.to===this.me)await this.inspectTextMessage(n,m);return;}
  if(m.v!==3||!m.payload||m.payload.from!==this.peer||m.payload.to!==this.me){
   if(m.type==="data")this.onDebug("[signaling] data отклонено до AES-GCM: неверная версия, payload, from или to.");
   return;
  }
  const p=m.payload;
  if(m.type==="cancel"){await this.processCancel(m);return;}
  if(!["rotation_response","reject","hello","answer","data"].includes(m.type))return;
  const sidShort=value=>typeof value==="string"?value.slice(0,8):"нет";
  if(m.type==="data"){
   this.onDebug("[signaling] получено data: sid="+sidShort(p.sid)+"; ready="+this.ready+"; session="+sidShort(this.session)+"; signal="+(p.signal?.type||"нет")+"; ntfyId="+String(n.id).slice(0,12));
  }
  const verified=await this.verifyPeerEnvelope(m.type,p,m.auth);
  if(!verified){
   if(m.type==="data")this.onDebug("[signaling] data отклонено: AES-GCM/аутентификация или проверка отправителя не пройдена.");
   return;
  }
  if(m.type==="data")this.onDebug("[signaling] data: аутентификация AES-GCM успешна.");
  if(m.type==="rotation_response")return;
  if(m.type==="data"){
   if(!this.ready||p.sid!==this.session){
    this.onDebug("[signaling] data отброшено: "+(!this.ready?"secure-сессия ещё не ready":"sid не совпадает")+"; incoming="+sidShort(p.sid)+"; current="+sidShort(this.session)+".");
    return;
   }
   this.onDebug("[signaling] data принято; вызываем onSignal.");
   this.onPeerMessage(this.peer);
   if(p.signal.type==="signal"){
    try{
     await this.onSignal(p.signal.payload);
     this.onDebug("[signaling] onSignal завершился успешно.");
    }catch(error){
     this.onDebug("[signaling] onSignal завершился ошибкой: "+(error?.message||String(error)));
     throw error;
    }
   }else this.onDebug("[signaling] data принято, но signal.type не равен signal.");
   return;
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
   const answer={sid:p.sid,from:this.me,to:this.peer,...(this.peerInvitationId?{invitation_id:this.peerInvitationId}:{})};
   this.answer=answer;this.activateSession(p.sid);this.onDebug("[signaling] answer prepared; sending initial response");
   try{await this.sendAnswer()}catch(err){this.onError(err);if(err.retryable)this.scheduleAnswerRetry(5000);}return;
  }
  if(m.type==="answer"&&!this.ready){
   if(!this.hello||this.helloDirection!=="outgoing"||p.sid!==this.hello.sid)return;
   await this.recordConversationEvent("answer",p,"incoming",Number(n.time)*1000||Date.now());this.onPeerMessage(this.peer);
   this.activateSession(p.sid);if(!this.readyNotified){this.readyNotified=true;this.onReady();}return;
  }
 }
 async hasCallGrant(payload){
  const peer=String(payload.from||"нет").slice(0,10);
  let contact;
  try{contact=await getPeerSignalingIdentity(payload.from)}
  catch(error){return {ok:false,code:"IDENTITY_NOT_FOUND",detail:error.message||String(error),peer};}
  const savedId=contact?.invitation_id||null;
  if(payload.invitation_id!==savedId)return {ok:false,code:"INVITATION_ID_MISMATCH",received:String(payload.invitation_id||"нет").slice(0,12),saved:String(savedId||"нет").slice(0,12),peer};
  let invitation;
  try{invitation=await getIssuedInvitation(savedId)}
  catch(error){return {ok:false,code:"INVITATION_READ_FAILED",detail:error.message||String(error),peer};}
  if(!invitation)return {ok:false,code:"INVITATION_RECORD_MISSING",invitation_id:String(savedId||"нет").slice(0,12),peer};
  if(invitation.revoked)return {ok:false,code:"INVITATION_REVOKED",invitation_id:String(savedId||"нет").slice(0,12),peer};
  const activations=Array.isArray(invitation.activations)?invitation.activations:[];
  if(!activations.some(item=>item.user_id===payload.from))return {ok:false,code:"SENDER_NOT_ACTIVATED",activation_count:activations.length,invitation_id:String(savedId||"нет").slice(0,12),peer};
  return {ok:true,code:"GRANT_VALID",invitation_id:String(savedId||"нет").slice(0,12),peer};
 }
 activateSession(sid){this.session=sid;this.ready=true;this.clearHelloRetry();}
 async sendSignal(payload){
  if(!this.ready)throw Error("Защищённый канал ещё не установлен.");
  await this.publish(this.peer,await this.authenticated("data",{sid:this.session,from:this.me,to:this.peer,signal:{type:"signal",payload}}));
 }
 close(){this.closed=true;this.active=false;this.clearHelloRetry();this.clearAnswerRetry();if(this.es){const before=this.es.readyState;this.onDebug(`[SSE ${this.debugId}] ${new Date().toISOString()} close() вызван; readyState(before)=${before}`);this.es.close();this.onDebug(`[SSE ${this.debugId}] ${new Date().toISOString()} close() завершён; readyState(after)=${this.es.readyState}`)}else this.onDebug(`[SSE ${this.debugId}] ${new Date().toISOString()} close() вызван без EventSource`);}
}
