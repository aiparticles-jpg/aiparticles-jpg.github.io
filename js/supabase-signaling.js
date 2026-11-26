import { getCurrentSignalingIdentity, getPeerSignalingIdentity, isUserId } from "./local-identity.js?v=1";
import { hasActiveInvitationGrant, getContact, updateContact } from "./local-store.js?v=26";
import { sendSupabaseMessage } from "./supabase-client.js?v=10";
const bytes=b=>b instanceof Uint8Array?b:new Uint8Array(b);
const b64u=b=>{let s="";for(const x of bytes(b))s+=String.fromCharCode(x);return btoa(s).replaceAll("+","-").replaceAll("/","_").replace(/=+$/g,"")};
const un64=s=>{const x=atob(s.replace(/-/g,"+").replace(/_/g,"/")+"=".repeat((4-s.length%4)%4));return Uint8Array.from(x,c=>c.charCodeAt(0))};

export class SupabaseSecureSignaling {
 constructor({me,peer,onSignal,onStatus,onReady,onError,onDebug,onIncoming,onPeerMessage,onCancelIncoming,onDialing,onRejectOutgoing,onConversationEvent,onConversationDelivery,onConversationSent}) {
  this.me=me;this.peer=peer;this.peerName="";this.peerInvitationId=null;this.role=peer?(me<peer?"A":"B"):null;
  
  this.onSignal=onSignal;this.onStatus=onStatus||(()=>{});this.onReady=onReady||(()=>{});this.onError=onError||(()=>{});this.onDebug=onDebug||(()=>{});this.onIncoming=onIncoming||(()=>{});this.onPeerMessage=onPeerMessage||(()=>{});this.onCancelIncoming=onCancelIncoming||(()=>{});this.onDialing=onDialing||(()=>{});this.onRejectOutgoing=onRejectOutgoing||(()=>{});this.onConversationEvent=onConversationEvent||(()=>{});this.onConversationDelivery=onConversationDelivery||(()=>{});this.onConversationSent=onConversationSent||(()=>{});
  this.active=false;this.identity=null;this.hello=null;this.helloEnvelope=null;this.readyNotified=false;this.answer=null;this.answerEnvelope=null;this.lastAnswerAt=0;this.session=null;this.ready=false;this.seen=new Set();this.preAnswerMessageCount=0;this.publishQueue=Promise.resolve();this.closed=false;this.helloAttempts=0;this.helloRetryTimer=null;this.answerAttempts=0;this.answerRetryTimer=null;this.incomingSid=null;this.incomingEventId=null;this.incomingIdentity=null;this.incomingHello=null;this.outgoingRequest=null;this.helloDirection=null;this.answeringIncoming=false;this.cancelledSids=new Set();this.pendingCancels=new Map();this.acceptedSids=new Set();this.rateLimited=false;
 }
 static validUserId(s){return isUserId(s)}
 validDecryptedPayload(type,p){
  const uuid=v=>typeof v==="string"&&/^[0-9a-f-]{36}$/i.test(v);
  if(!p||p.from===undefined||p.to===undefined)return false;
  if(p.rotation_request&&(!uuid(p.rotation_request.rotation_id)||typeof p.rotation_request.public_key!=="string"||p.rotation_request.public_key.length>1000))return false;
  if(type==="text")return uuid(p.message_id)&&Number.isSafeInteger(Number(p.created_at))&&Number(p.created_at)>=0&&Number(p.created_at)<=Date.now()+300000&&typeof p.text==="string"&&p.text.trim().length>0&&p.text.length<=2000;
  if(type==="delivered")return uuid(p.message_id)&&Number.isSafeInteger(Number(p.created_at))&&Number(p.created_at)>=0&&Number(p.created_at)<=Date.now()+300000;
  if(type==="hello")return uuid(p.sid)&&Number.isFinite(Number(p.expiresAt));
  if(type==="answer")return uuid(p.sid);
  if(type==="cancel"||type==="reject")return uuid(p.sid)&&Number.isFinite(Number(p.expiresAt));
  if(type==="rotation_response")return uuid(p.rotation_id)&&typeof p.encrypted_key==="string";
  if(type==="data")return uuid(p.sid)&&p.signal&&typeof p.signal==="object"&&!Array.isArray(p.signal);
  return false;
 }
 async verifySupabasePayload(type,payload){
   const peer=payload?.from;
   if(!isUserId(peer)||peer===this.me||payload?.to!==this.me||!this.validDecryptedPayload(type,payload))return false;
   const grant=await this.hasCallGrant(payload);
   if(!grant.ok){
    this.onDebug("[Supabase v1] сообщение отклонено проверкой разрешения: "+JSON.stringify(grant));
    return false;
   }
   await this.processIncomingKeyRotation(peer,payload,type);
   return true;
  }

  async handleSupabaseEnvelope(record,message,contact){
   if(!record||typeof record.sender_id!=="string"||!contact||
      contact.supabase_user_id?.toLowerCase()!==record.sender_id.toLowerCase()||
      !message||message.seq==null||typeof message.type!=="string"||
      !message.body||typeof message.body!=="object"||Array.isArray(message.body)||
      Object.hasOwn(message.body,"from")||Object.hasOwn(message.body,"to")||
      typeof record.created_at!=="string"){
    throw Error("Некорректное сообщение протокола Supabase v1.");
   }
   const eventId="supabase:"+record.sender_id+":"+message.seq;
   const payload={...message.body,from:contact.user_id,to:this.me};
   const event={
    id:eventId,
    time:Date.parse(record.created_at)/1000,
    message:JSON.stringify({v:1,type:message.type,payload})
   };
   try{
    // Chat and receipts are independent of whichever peer currently owns the
    // single active WebRTC session. Process them through the common v1 validator.
    if(message.type==="text"||message.type==="delivered")await this.inspectIncoming(event);
    else await this.handle(event);
   }catch(error){this.seen.delete(eventId);throw error;}
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
  if(m.type==="data")this.onDebug("[signaling] Supabase v1 data envelope: v="+m.v+"; from="+String(m.payload?.from||"нет").slice(0,10)+"; expectedFrom="+this.peer.slice(0,10)+"; to="+String(m.payload?.to||"нет").slice(0,10)+"; expectedTo="+this.me.slice(0,10)+"; supabaseMessageId="+String(n.id).slice(0,12));
  if(m.type==="text"){if(m.v===1&&m.payload?.to===this.me)await this.inspectTextMessage(n,m);return;}
  if(m.type==="delivered"){if(m.v===1&&m.payload?.to===this.me)await this.inspectDeliveryReceipt(n,m);return;}
  if(m.v!==1||!m.payload||m.payload.from!==this.peer||m.payload.to!==this.me){
   if(m.type==="data")this.onDebug("[signaling] data отклонено до AES-GCM: неверная версия, payload, from или to.");
   return;
  }
  const p=m.payload;
  if(m.type==="cancel"){await this.processCancel(m);return;}
  if(!["rotation_response","reject","hello","answer","data"].includes(m.type))return;
  const sidShort=value=>typeof value==="string"?value.slice(0,8):"нет";
  if(m.type==="data"){
   this.onDebug("[signaling] получено data: sid="+sidShort(p.sid)+"; ready="+this.ready+"; session="+sidShort(this.session)+"; signal="+(p.signal?.type||"нет")+"; supabaseMessageId="+String(n.id).slice(0,12));
  }
  const verified=await this.verifySupabasePayload(m.type,p);
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
    this.cancelledSids.add(this.hello.sid);this.clearHelloRetry();this.hello=null;this.helloEnvelope=null;this.helloDirection=null;this.outgoingRequest=null;
    this.onDebug("[signaling] crossed call: уступаем hello участника с меньшим ID");
   }
   if(!p.sid||this.cancelledSids.has(p.sid))return;
   const expires=Number(p.expiresAt||((Number(n.time)||0)*1000+45000));if(!Number.isFinite(expires)||Date.now()>expires)return;
   await this.recordConversationEvent("hello",p,"incoming",Number(n.time)*1000||Date.now());this.onPeerMessage(this.peer);
   const pending=this.pendingCancels.get(p.sid);
   if(pending){this.pendingCancels.delete(p.sid);this.incomingSid=p.sid;this.incomingIdentity=true;await this.processCancel(pending);if(this.cancelledSids.has(p.sid))return;}
   this.hello=p;this.helloDirection="incoming";this.incomingSid=p.sid;this.incomingIdentity=true;
   const answer={sid:p.sid,from:this.me,to:this.peer,...(this.peerInvitationId?{invitation_id:this.peerInvitationId}:{})};
   this.answer=answer;this.answerEnvelope=null;this.activateSession(p.sid);this.onDebug("[signaling] answer prepared; sending initial response");
   try{await this.sendAnswer()}catch(err){this.onError(err);if(err.retryable)this.scheduleAnswerRetry(5000);}return;
  }
  if(m.type==="answer"&&!this.ready){
   if(!this.hello||this.helloDirection!=="outgoing"||p.sid!==this.hello.sid)return;
   await this.recordConversationEvent("answer",p,"incoming",Number(n.time)*1000||Date.now());this.onPeerMessage(this.peer);
   this.activateSession(p.sid);if(!this.readyNotified){this.readyNotified=true;this.onReady();}return;
  }
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
  const peer=payload?.to||this.peer;
  const contact=await getContact(peer);
  if(!contact?.invitation_secret)throw Error("Не найден общий ключ контакта. Попросите собеседника повторно обменяться приглашениями.");
  let current=contact;
  if(type!=="rotation_response"&&!current.rotation_id&&!current.pending_secret&&!current.previous_secret&&Date.now()-(Number(current.shared_secret_created_at)||Date.now())>=24*60*60*1000){
   current=await this.beginKeyRotation(peer,current)||current;
  }
  const body={...payload};
  delete body.from;delete body.to;
  body.invitation_id=body.invitation_id||current.invitation_id;
  if(type!=="rotation_response"&&current.rotation_id&&current.rotation_public_key){
   body.rotation_request={rotation_id:current.rotation_id,public_key:current.rotation_public_key};
  }
  return {type,...body};
 }
 async publish(to,message){
  const contact=await getContact(to);
  if(!contact)throw Error("Контакт не найден в локальном списке.");
  if(!contact.supabase_user_id||(!contact.supabase_invitation_redeemed_at&&!contact.supabase_contact_accepted_at)){
   throw Error("Контакт ещё не подключён к Supabase. Дождитесь подтверждения приглашения.");
  }
  if(!message||typeof message.type!=="string")throw Error("Некорректное сообщение Supabase.");
  const body={...message};delete body.type;delete body.from;delete body.to;
  const result=await sendSupabaseMessage({contact,type:message.type,body});
  this.onDebug("[Supabase v1] отправлено "+message.type+" контакту «"+(contact.name||to.slice(0,10))+"»; seq="+result.sequence+".");
  return result;
 }
 async subscribe(){
  if(this.closed)throw Error("Подписка Supabase закрыта.");
  if(!crypto?.subtle||!window.isSecureContext)throw Error("Для защищённого соединения нужен браузер с Web Crypto и HTTPS.");
  this.identity=await getCurrentSignalingIdentity();
  if(this.identity.user_id!==this.me)throw Error("Локальная идентичность изменилась. Перезапустите приложение.");
  this.onDebug("[Supabase v1] локальная идентичность проверена; входящие события принимает общий inbox.");
  return true;
 }
 async start(){
  if(!isUserId(this.me)||!isUserId(this.peer)||this.me===this.peer)throw Error("Выберите сохранённый контакт.");
  await this.subscribe();
  const peerContact=await getPeerSignalingIdentity(this.peer);
  this.peerName=peerContact.name;
  this.peerInvitationId=peerContact.invitation_id;
  this.active=true;
  if(this.answeringIncoming&&this.helloDirection==="incoming"&&this.hello&&!this.answer){
   const p=this.hello;
   this.answer={sid:p.sid,from:this.me,to:this.peer,...(this.peerInvitationId?{invitation_id:this.peerInvitationId}:{})};
   this.answerEnvelope=null;
   this.activateSession(p.sid);
   this.onDebug("[Supabase v1] принятое входящее hello восстановлено; отправляем answer.");
   try{await this.sendAnswer()}catch(error){this.onError(error);if(error.retryable)this.scheduleAnswerRetry(5000);}
  }
  if(!this.answeringIncoming&&!this.hello){
   try{await this.sendHello()}catch(error){this.onError(error);if(error.retryable)this.scheduleHelloRetry(5000);}
  }
  this.answeringIncoming=false;
 }
 setPeer(peer){
  if(peer!==""&&(!isUserId(peer)||peer===this.me))throw Error("Выберите корректный локальный контакт.");
  if(peer===this.peer)return;
  if(this.active)throw Error("Нельзя менять контакт во время активного вызова.");
  this.resetSession();this.peer=peer;this.peerName="";this.peerInvitationId=null;this.role=peer?(this.me<peer?"A":"B"):null;
 }
 acceptIncoming(){
  const sid=this.incomingSid;
  if(sid){this.acceptedSids.add(sid);if(this.acceptedSids.size>100)this.acceptedSids.delete(this.acceptedSids.values().next().value);}
  this.answeringIncoming=true;
  if(this.incomingHello&&this.incomingHello.sid===sid){this.hello=this.incomingHello;this.helloDirection="incoming";}
  this.incomingHello=null;this.incomingSid=null;this.incomingEventId=null;this.incomingIdentity=null;
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
   this.onDebug("[e2ee] ответ с новым симметричным ключом отправлен через Supabase v1.");
  }
  if(type==="rotation_response"){
   const contact=await getContact(peer);
   if(!contact?.rotation_private_key||contact.rotation_id!==payload.rotation_id)return;
   try{
    const raw=new Uint8Array(await crypto.subtle.decrypt({name:"RSA-OAEP"},contact.rotation_private_key,un64(payload.encrypted_key)));
    if(raw.length!==32)throw Error("Некорректная длина нового ключа.");
    const next=b64u(raw);raw.fill(0);
    await updateContact(peer,{previous_secret:contact.invitation_secret,previous_secret_at:Date.now(),invitation_secret:next,shared_secret_created_at:Date.now(),rotation_id:null,rotation_public_key:null,rotation_private_key:null,rotation_started_at:null});
    this.onDebug("[e2ee] новый ключ получен; исходящие сообщения переключены на него, старый ключ оставлен для приёма.");
   }catch(error){this.onDebug("[e2ee] не удалось обработать ответ ротации: "+(error.message||String(error)));}
  }
 }
 async recordConversationEvent(type,payload,direction,createdAt=Date.now(),deliveryStatus="sent"){
  const contactUserId=direction==="incoming"?payload.from:payload.to;
  if(!isUserId(contactUserId))return false;
  const id=type==="text"?payload.message_id:String(payload.sid||"")+":"+type+":"+direction;
  try{
   await this.onConversationEvent({id,contact_user_id:contactUserId,type,direction,text:type==="text"?payload.text:"",created_at:new Date(Number(createdAt)||Date.now()).toISOString(),...(type==="text"&&direction==="outgoing"?{delivery_status:deliveryStatus}:{})});
   return true;
  }catch(error){this.onError(error);return false;}
 }
 async inspectTextMessage(n,m){
  const p=m?.payload;
  if(m?.v!==1||m?.type!=="text"||!p||p.to!==this.me||!isUserId(p.from)||p.from===this.me){
   throw Error("Входящее text отклонено: неверная версия, тип, адресат или идентификатор отправителя.");
  }
  let valid=false;
  try{valid=await this.verifySupabasePayload("text",p)}
  catch(error){this.onDebug("[message] ошибка проверки текста: "+(error.message||String(error)));throw error;}
  if(!valid)throw Error("Входящее text не прошло проверку payload или разрешения контакта; recipient cursor не продвинут.");
  const saved=await this.recordConversationEvent("text",p,"incoming",Number(p.created_at));
  if(!saved)throw Error("Входящее text проверено, но не удалось сохранить его в локальную историю; подтверждение доставки не отправлено.");
  try{
   const receipt={message_id:p.message_id,from:this.me,to:p.from,created_at:Date.now()};
   await this.publish(p.from,await this.authenticated("delivered",receipt));
   this.onDebug("[message] отправлено подтверждение доставки через Supabase v1.");
  }catch(error){this.onDebug("[message] не удалось отправить подтверждение доставки: "+(error.message||String(error)));}
  if(n?.id)this.rememberSeen(n.id);
  this.onDebug("[Supabase v1] получено, сохранено и подтверждено аутентифицированное сообщение.");
 }
 async inspectDeliveryReceipt(n,m){
  const p=m?.payload;
  if(m?.v!==1||m?.type!=="delivered"||!p||p.to!==this.me||!isUserId(p.from)||p.from===this.me){
   throw Error("Подтверждение доставки отклонено: некорректный payload или адресат.");
  }
  let valid=false;
  try{valid=await this.verifySupabasePayload("delivered",p)}
  catch(error){this.onDebug("[message] ошибка проверки подтверждения доставки: "+(error.message||String(error)));throw error;}
  if(!valid)throw Error("Подтверждение доставки не прошло проверку payload или разрешения контакта; recipient cursor не продвинут.");
  try{await this.onConversationDelivery({contact_user_id:p.from,message_id:p.message_id,delivered_at:new Date(Number(p.created_at)||Date.now()).toISOString()});}
  catch(error){this.onDebug("[message] не удалось обновить статус доставки: "+(error.message||String(error)));throw error;}
  if(n?.id)this.rememberSeen(n.id);
 }
 async sendText(to,text){
  if(this.closed)throw Error("Защищённая подписка ещё не готова.");
  if(!isUserId(to)||to===this.me)throw Error("Выберите сохранённый контакт.");
  const body=String(text||"").trim();if(!body||body.length>2000)throw Error("Сообщение должно содержать от 1 до 2000 символов.");
  const contact=await getContact(to);
  if(!contact)throw Error("Выберите сохранённый контакт.");
  if(!contact.supabase_user_id||(!contact.supabase_invitation_redeemed_at&&!contact.supabase_contact_accepted_at))throw Error("Контакт ещё не подтвердил связь через Supabase.");
  if(!this.identity)await this.subscribe();
  const createdAt=Date.now(),payload={message_id:crypto.randomUUID(),from:this.me,to,created_at:createdAt,text:body};
  const saved=await this.recordConversationEvent("text",payload,"outgoing",createdAt,"sending");
  if(!saved)throw Error("Не удалось сохранить сообщение на устройстве.");
  await this.publish(to,await this.authenticated("text",payload));
  try{await this.onConversationSent({contact_user_id:to,message_id:payload.message_id});}
  catch(error){this.onError(error);this.onDebug("[message] сообщение отправлено, но локальный статус не удалось обновить: "+(error.message||String(error)));}
  return payload;
 }
 async inspectIncoming(n){
  if(!n?.message||!n?.id)return;
  let m;try{m=JSON.parse(n.message)}catch{return;}
  if(m.v!==1||!m.payload||typeof m.type!=="string")return;
  const p=m.payload;
  if(m.type==="text"){await this.inspectTextMessage(n,m);return;}
  if(m.type==="delivered"){await this.inspectDeliveryReceipt(n,m);return;}
  if(!isUserId(p.from)||p.from===this.me||p.to!==this.me)return;
  let peerContact;
  try{peerContact=await getPeerSignalingIdentity(p.from)}catch(error){this.onDebug("[incoming] контакт не найден: "+(error.message||String(error)));return;}
  if(m.type==="cancel"){
   this.peer=p.from;this.peerName=peerContact.name;this.peerInvitationId=peerContact.invitation_id;this.role=this.me<p.from?"A":"B";
   try{await this.processCancel(m);if(n?.id)this.rememberSeen(n.id)}catch(error){this.onDebug("[incoming] cancel processing failed: "+(error.message||String(error)));}
   return;
  }
  if(m.type==="rotation_response"){
   this.peer=p.from;this.peerName=peerContact.name;this.peerInvitationId=peerContact.invitation_id;this.role=this.me<p.from?"A":"B";
   try{await this.verifySupabasePayload(m.type,p);if(n?.id)this.rememberSeen(n.id)}catch(error){this.onDebug("[incoming] rotation response failed: "+(error.message||String(error)));}
   return;
  }
  if(m.type!=="hello")return;
  if(this.active||this.ready||(this.incomingSid&&this.incomingSid!==p.sid)||this.outgoingRequest||this.hello){
   this.onDebug("[incoming] hello проигнорирован: уже обрабатывается другой вызов.");return;
  }
  this.peer=p.from;this.peerName=peerContact.name;this.peerInvitationId=peerContact.invitation_id;this.role=this.me<p.from?"A":"B";
  let verified=false;try{verified=await this.verifySupabasePayload(m.type,p)}catch(error){this.onDebug("[incoming] hello verification exception: "+(error.message||String(error)));return;}
  if(!verified)return;
  const expiresAt=Number(p.expiresAt);
  if(!Number.isFinite(expiresAt)||typeof p.sid!=="string"||Date.now()>expiresAt)return;
  if(this.acceptedSids.has(p.sid)||this.cancelledSids.has(p.sid)||this.incomingSid===p.sid)return;
  if(n?.id)this.rememberSeen(n.id);
  await this.recordConversationEvent("hello",p,"incoming",Number(n.time)*1000||Date.now());
  this.onPeerMessage(p.from);this.incomingSid=p.sid;this.incomingEventId=n.id;this.incomingIdentity=true;this.incomingHello=p;
  const pending=this.pendingCancels.get(p.sid);
  if(pending){this.pendingCancels.delete(p.sid);await this.processCancel(pending);if(this.cancelledSids.has(p.sid))return;}
  this.onDebug("[incoming] Supabase hello принят: peer="+p.from.slice(0,10)+"; name="+(this.peerName||"контакт")+"; sid="+p.sid.slice(0,8)+".");
  this.onIncoming({peer:this.peerName||"контакт",peerId:this.peer,sid:p.sid,expiresAt,receivedAt:performance.now()});
 }
 async processCancel(m){
  const p=m?.payload;if(m?.v!==1||!p||p.from!==this.peer||p.to!==this.me)return;
  if(!await this.verifySupabasePayload("cancel",p))throw Error("Аутентификация отмены вызова или разрешение недействительны.");
  if(!p.sid||this.acceptedSids.has(p.sid)||!Number.isFinite(Number(p.expiresAt))||Date.now()>Number(p.expiresAt))return;
  this.onPeerMessage(this.peer);
  if(!this.incomingIdentity){this.pendingCancels.set(p.sid,m);if(this.pendingCancels.size>50)this.pendingCancels.delete(this.pendingCancels.keys().next().value);return;}
  this.cancelledSids.add(p.sid);if(this.cancelledSids.size>100)this.cancelledSids.delete(this.cancelledSids.values().next().value);
  if(this.incomingSid===p.sid&&!this.hello&&!this.ready){
   this.onDebug("[Supabase v1] получена аутентифицированная отмена входящего вызова до ответа.");
   this.incomingSid=null;this.incomingEventId=null;this.incomingIdentity=null;this.onCancelIncoming({peer:this.peerName||"контакт",sid:p.sid});
  }
 }
 rememberSeen(id){if(!id)return;this.seen.add(id);if(this.seen.size>600)this.seen.delete(this.seen.values().next().value);}
 resetSession(){
  this.active=false;this.answeringIncoming=false;this.clearHelloRetry();this.clearAnswerRetry();
  this.hello=null;this.helloEnvelope=null;this.helloDirection=null;this.readyNotified=false;this.answer=null;this.answerEnvelope=null;this.lastAnswerAt=0;this.session=null;this.ready=false;this.incomingHello=null;
  this.incomingSid=null;this.incomingEventId=null;this.incomingIdentity=null;this.outgoingRequest=null;this.pendingCancels.clear();this.acceptedSids.clear();this.helloAttempts=0;this.answerAttempts=0;
 }
 async rejectIncoming(){
  const sid=this.incomingSid;if(this.closed||!sid||!this.peer)return false;
  const payload={sid,from:this.me,to:this.peer,...(this.peerInvitationId?{invitation_id:this.peerInvitationId}:{}),expiresAt:Date.now()+15000};
  await this.publish(this.peer,await this.authenticated("reject",payload));
  await this.recordConversationEvent("reject",payload,"outgoing",Date.now());
  this.acceptedSids.add(sid);this.incomingSid=null;this.incomingEventId=null;this.incomingIdentity=null;
  this.onDebug("[Supabase v1] аутентифицированный отказ от входящего вызова отправлен.");return true;
 }
 async cancelCall(){
  const request=this.outgoingRequest||this.hello;
  if(this.closed||!request||!["A","B"].includes(this.role))return false;
  const payload={sid:request.sid,from:this.me,to:this.peer,...(this.peerInvitationId?{invitation_id:this.peerInvitationId}:{}),expiresAt:Date.now()+15000};
  await this.publish(this.peer,await this.authenticated("cancel",payload));
  this.outgoingRequest=null;this.onDebug("[Supabase v1] аутентифицированная отмена вызова отправлена.");return true;
 }
 async sendHello(){
  if(this.closed||this.ready||this.rateLimited||this.helloDirection==="incoming")return;
  if(!this.hello){this.hello={sid:crypto.randomUUID(),from:this.me,to:this.peer,...(this.peerInvitationId?{invitation_id:this.peerInvitationId}:{}),expiresAt:Date.now()+45000};this.helloEnvelope=null;this.helloDirection="outgoing";}
  this.helloAttempts++;this.onDebug("[Supabase v1] hello attempt "+this.helloAttempts+"/3");
  if(!this.helloEnvelope)this.helloEnvelope=await this.authenticated("hello",this.hello);
  await this.publish(this.peer,this.helloEnvelope);
  await this.recordConversationEvent("hello",this.hello,"outgoing",Date.now());
  this.onStatus("Запрос отправлен. Ожидаем "+(this.peerName||"контакт")+"…");
  if(!this.ready)this.onDialing({peer:this.peerName||"контакт",expiresAt:this.hello.expiresAt,callId:this.hello.sid});
 }
 scheduleHelloRetry(delay){
  this.clearHelloRetry();
  if(this.closed||this.ready||this.rateLimited||this.helloDirection!=="outgoing"||this.helloAttempts>=3)return;
  this.helloRetryTimer=setTimeout(async()=>{this.helloRetryTimer=null;if(this.closed||this.ready||this.rateLimited)return;try{await this.sendHello()}catch(error){this.onError(error);if(error.retryable)this.scheduleHelloRetry(this.helloAttempts===2?10000:5000);}},delay);
 }
 clearHelloRetry(){if(this.helloRetryTimer!==null){clearTimeout(this.helloRetryTimer);this.helloRetryTimer=null;}}
 clearAnswerRetry(){if(this.answerRetryTimer!==null){clearTimeout(this.answerRetryTimer);this.answerRetryTimer=null;}}
 async sendAnswer(){
  if(this.closed||this.rateLimited||!this.answer)return;
  this.answerAttempts++;this.onDebug("[Supabase v1] answer attempt "+this.answerAttempts+"/3");
  if(!this.answerEnvelope)this.answerEnvelope=await this.authenticated("answer",this.answer);
  await this.publish(this.peer,this.answerEnvelope);
  await this.recordConversationEvent("answer",this.answer,"outgoing",Date.now());
  this.lastAnswerAt=Date.now();this.clearAnswerRetry();
  if(!this.readyNotified){this.readyNotified=true;this.onReady();}
 }
 scheduleAnswerRetry(delay){
  this.clearAnswerRetry();if(this.closed||this.rateLimited||!this.answer||this.answerAttempts>=3)return;
  this.answerRetryTimer=setTimeout(async()=>{this.answerRetryTimer=null;try{await this.sendAnswer()}catch(error){this.onError(error);if(error.retryable)this.scheduleAnswerRetry(10000);}},delay);
 }

 async hasCallGrant(payload){
  const peer=String(payload.from||"нет").slice(0,10);
  let contact;
  try{contact=await getPeerSignalingIdentity(payload.from)}
  catch(error){return {ok:false,code:"IDENTITY_NOT_FOUND",detail:error.message||String(error),peer};}
  const savedId=contact?.invitation_id||null;
  if(payload.invitation_id!==savedId)return {ok:false,code:"INVITATION_ID_MISMATCH",received:String(payload.invitation_id||"нет").slice(0,12),saved:String(savedId||"нет").slice(0,12),peer};
  let active=false;
  try{active=await hasActiveInvitationGrant(savedId,payload.from)}
  catch(error){return {ok:false,code:"INVITATION_CHECK_FAILED",detail:error.message||String(error),peer};}
  if(!active)return {ok:false,code:"SENDER_NOT_ACTIVATED",invitation_id:String(savedId||"нет").slice(0,12),peer};
  return {ok:true,code:"GRANT_VALID",invitation_id:String(savedId||"нет").slice(0,12),peer};
 }
 activateSession(sid){this.session=sid;this.ready=true;this.clearHelloRetry();}
 async sendSignal(payload){
  if(!this.ready)throw Error("Защищённый канал ещё не установлен.");
  await this.publish(this.peer,await this.authenticated("data",{sid:this.session,from:this.me,to:this.peer,signal:{type:"signal",payload}}));
 }
 close(){this.closed=true;this.active=false;this.clearHelloRetry();this.clearAnswerRetry();this.onDebug("[Supabase] локальная сигнальная сессия закрыта.");}
}
