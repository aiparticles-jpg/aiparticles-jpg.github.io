import { getCurrentSignalingIdentity, getPeerSignalingIdentity, isUserId } from "./local-identity.js?v=1";
import { hasActiveInvitationGrant, getContact, updateContact } from "./local-store.js?v=24";
import { sendSupabaseMessage } from "./supabase-client.js?v=8";
const bytes=b=>b instanceof Uint8Array?b:new Uint8Array(b);
const b64u=b=>{let s="";for(const x of bytes(b))s+=String.fromCharCode(x);return btoa(s).replaceAll("+","-").replaceAll("/","_").replace(/=+$/g,"")};
const un64=s=>{const x=atob(s.replace(/-/g,"+").replace(/_/g,"/")+"=".repeat((4-s.length%4)%4));return Uint8Array.from(x,c=>c.charCodeAt(0))};

export class SupabaseSecureSignaling {
 constructor({me,peer,onSignal,onStatus,onReady,onError,onDebug,onIncoming,onPeerMessage,onCancelIncoming,onDialing,onRejectOutgoing,onConversationEvent,onConversationDelivery,onConversationSent}) {
  this.me=me;this.peer=peer;this.peerName="";this.peerInvitationId=null;this.role=peer?(me<peer?"A":"B"):null;
  
  this.onSignal=onSignal;this.onStatus=onStatus||(()=>{});this.onReady=onReady||(()=>{});this.onError=onError||(()=>{});this.onDebug=onDebug||(()=>{});this.onIncoming=onIncoming||(()=>{});this.onPeerMessage=onPeerMessage||(()=>{});this.onCancelIncoming=onCancelIncoming||(()=>{});this.onDialing=onDialing||(()=>{});this.onRejectOutgoing=onRejectOutgoing||(()=>{});this.onConversationEvent=onConversationEvent||(()=>{});this.onConversationDelivery=onConversationDelivery||(()=>{});this.onConversationSent=onConversationSent||(()=>{});
  this.active=false;this.identity=null;this.hello=null;this.helloEnvelope=null;this.readyNotified=false;this.answer=null;this.answerEnvelope=null;this.lastAnswerAt=0;this.session=null;this.ready=false;this.seen=new Set();this.preAnswerMessageCount=0;this.publishQueue=Promise.resolve();this.closed=false;this.helloAttempts=0;this.helloRetryTimer=null;this.answerAttempts=0;this.answerRetryTimer=null;this.incomingSid=null;this.incomingEventId=null;this.incomingIdentity=null;this.incomingHello=null;this.outgoingRequest=null;this.helloDirection=null;this.answeringIncoming=false;this.cancelledSids=new Set();this.pendingCancels=new Map();this.acceptedSids=new Set();
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
   const event={data:JSON.stringify({
    id:eventId,
    time:Date.parse(record.created_at)/1000,
    message:JSON.stringify({v:1,type:message.type,payload})
   })};
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
  if(m.type==="text"){if((trustedSupabase?m.v===1:m.v===3)&&m.payload?.to===this.me)await this.inspectTextMessage(n,m);return;}
  if(m.type==="delivered"){if((trustedSupabase?m.v===1:m.v===3)&&m.payload?.to===this.me)await this.inspectDeliveryReceipt(n,m);return;}
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
 close(){this.closed=true;this.active=false;this.clearHelloRetry();this.clearAnswerRetry();this.onDebug("[Supabase] локальная сигнальная сессия закрыта.");}
}
