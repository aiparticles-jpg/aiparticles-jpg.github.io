import { WebRtcAudio } from "./webrtc.js?v=17";
import { NtfySecureSignaling } from "./ntfy-signaling.js?v=25";
import { getCurrentSignalingIdentity, getNtfyTopic } from "./ntfy-identity.js";
import { listContacts, getContact, saveContact, updateContact, deleteContact, signWithIdentity, saveMyInvitation, getMyInvitation } from "./local-store.js?v=2";
import { verifyContactPackage } from "./contact-exchange.js?v=2";
import { initializeOneSignal, enableOneSignalPush } from "./onesignal.js?v=2";
import { sendPushEventToContact } from "./push-api.js";

const $=id=>document.getElementById(id);
const els={
 contactList:$("contacts-list"),contactListItems:$("contacts-list-items"),contactSearch:$("contact-search"),contactListEmpty:$("contacts-list-empty"),contactsCount:$("contacts-count"),contactScreen:$("contact-screen"),contactScreenBack:$("contact-screen-back"),contactScreenAvatar:$("contact-screen-avatar"),contactScreenName:$("contact-screen-name"),contactScreenCall:$("contact-screen-call"),contactScreenMenu:$("contact-screen-menu"),openContactEdit:$("open-contact-edit"),openContactDelete:$("open-contact-delete"),contactEditScreen:$("contact-edit-screen"),contactEditScreenBack:$("contact-edit-screen-back"),contactDeleteScreen:$("contact-delete-screen"),contactDeleteScreenBack:$("contact-delete-screen-back"),contactDeleteName:$("contact-delete-name"),confirmDeleteContact:$("confirm-delete-contact"),cancelDeleteContact:$("cancel-delete-contact"),privacyHelp:$("privacy-help"),headerMenu:$("header-menu"),peer:$("peer-contact"),connect:$("connect"),dismissIncoming:$("dismiss-incoming"),rejectIncoming:$("reject-incoming"),deletePeer:$("delete-peer"),contactEditTools:$("contact-edit-tools"),editContactName:$("edit-contact-name"),saveContactName:$("save-contact-name"),verify:$("verify-panel"),
 verifyCode:$("verify-code"),confirm:$("confirm-peer"),indicator:$("connection-indicator"),
 statusIcon:$("status-icon"),statusTitle:$("status-title"),statusText:$("status-text"),
 transport:$("transport-label"),tcp:$("tcp-fallback"),hangup:$("hangup"),
 audio:$("remote-audio"),pilot:$("diagnostic-pilot"),error:$("error-message"),debugLog:$("debug-log"),
 debugUrl:$("debug-url"),debugState:$("debug-state"),
  contactTools:$("contact-tools"),contactPackage:$("contact-package"),pasteContact:$("paste-contact"),pasteContactInline:$("paste-contact-inline"),contactName:$("contact-name"),importContact:$("import-contact"),scanQr:$("scan-qr"),qrVideo:$("qr-video"),qrStatus:$("qr-status"),inviteTools:$("invite-tools"),invitePermission:$("invite-permission"),inviteContent:$("invite-content"),inviteStatus:$("invite-status"),createInvite:$("create-invite"),inviteUrl:$("invite-url"),copyInvite:$("copy-invite"),copyInviteInline:$("copy-invite-inline"),inviteQr:$("invite-qr"),replyInvite:$("reply-contact-invite"),replyInviteStatus:$("reply-contact-invite-status"),contactRequestPanel:$("contact-request-panel"),contactRequestText:$("contact-request-text"),contactRequestName:$("contact-request-name"),acceptContactRequest:$("accept-contact-request"),declineContactRequest:$("decline-contact-request")
};
let qrStream=null,qrScanActive=false;
let originalEditContactName="";
const CONTACT_REQUESTS_KEY="vl.contactRequestsSent.v1";
const CONTACT_REQUESTS_CONFIRMED_KEY="vl.contactRequestsConfirmed.v1";
function loadConfirmedContactRequests(){
 try{const value=JSON.parse(localStorage.getItem(CONTACT_REQUESTS_CONFIRMED_KEY)||"[]");return Array.isArray(value)?value.filter(id=>NtfySecureSignaling.validUserId(id)):[]}
 catch{return []}
}
const completedContactRequests=new Set(loadConfirmedContactRequests());
function persistConfirmedContactRequests(){
 try{localStorage.setItem(CONTACT_REQUESTS_CONFIRMED_KEY,JSON.stringify([...completedContactRequests]))}
 catch(error){debug("Не удалось сохранить подтверждение обмена приглашениями: "+(error.message||String(error)))}
}
function markContactRequestReceived(userId){
 if(!NtfySecureSignaling.validUserId(userId)||completedContactRequests.has(userId))return;
 completedContactRequests.add(userId);
 persistConfirmedContactRequests();
 if(els.peer.value===userId)updateCallButtons();
 debug("Получено корректно подписанное сообщение от контакта; обмен приглашениями подтверждён.");
}
function loadSentContactRequests(){
 try{const value=JSON.parse(localStorage.getItem(CONTACT_REQUESTS_KEY)||"{}");return value&&typeof value==="object"&&!Array.isArray(value)?value:{}}
 catch{return {}}
}
const sentContactRequests=loadSentContactRequests();
let trustedContactIds=new Set();
function persistSentContactRequests(){
 try{localStorage.setItem(CONTACT_REQUESTS_KEY,JSON.stringify(sentContactRequests))}
 catch(error){debug("Не удалось сохранить историю отправки приглашения: "+(error.message||String(error)))}
}
function markContactRequestSent(userId){
 sentContactRequests[userId]=Date.now();
 persistSentContactRequests();
}
function clearSentContactRequest(userId){
 let changed=false;
 if(Object.prototype.hasOwnProperty.call(sentContactRequests,userId)){delete sentContactRequests[userId];changed=true}
 if(completedContactRequests.delete(userId)){persistConfirmedContactRequests();changed=true}
 if(changed)persistSentContactRequests();
}
function updateReplyInviteStatus(){
 const peer=els.peer.value;
 setInlineStatus(els.replyInviteStatus,sentContactRequests[peer]?"Ответное приглашение этому контакту уже отправлялось. При необходимости его можно послать ещё раз.":"");
}
const state={secure:null,webrtc:null,role:null,peerPresent:false,connecting:false,hangingUp:false,disconnectTimer:null,callStarted:false,answeringCall:false,editingName:false,prewarmNames:null,prewarmTargetNames:null,prewarmTimer:null,prewarmPromise:null,prewarmPending:null,incomingCall:false,incomingTimer:null,callTimer:null,outgoingCall:false,ringingKind:null,ringContext:null,ringPulseTimer:null,ringOscillators:[],pendingContactRequests:[]};
function debug(message){
 const time=new Date().toLocaleTimeString("ru-RU",{hour12:false});
 els.debugLog.textContent=(els.debugLog.textContent+"\n["+time+"] "+message).trim();
 els.debugLog.scrollTop=els.debugLog.scrollHeight;
}
function setStatus(title,text,kind="idle"){
 els.statusTitle.textContent=title;els.statusText.textContent=text;
 els.indicator.className="status-pill status-"+kind;
 els.indicator.textContent=({idle:"Не подключено",wait:"Ожидание",live:"На связи",error:"Проблема"})[kind]||kind;
 els.statusIcon.textContent=kind==="live"?"♫":kind==="error"?"!":"⌁";
}
function showError(message){els.error.textContent=message;els.error.classList.remove("hidden");debug("ОШИБКА: "+message)}
function clearError(){els.error.textContent="";els.error.classList.add("hidden")}
function setInlineStatus(element,message,isError=false){element.textContent=message;element.classList.toggle("hint-error",isError)}
function updateCallButtons(){
 const active=!!(state.peerPresent||state.outgoingCall||state.secure?.active);
 els.connect.classList.toggle("hidden",active);
 els.connect.disabled=active||state.connecting;
 els.connect.textContent=state.connecting?"Подключаемся…":state.incomingCall?"Ответить":"Подключиться";
 els.hangup.classList.toggle("hidden",!active);
 els.hangup.disabled=!active||state.hangingUp;
 els.dismissIncoming.disabled=state.connecting;
 const selectedPeer=NtfySecureSignaling.validUserId(els.peer.value)&&els.peer.value!==state.me;
 els.contactEditTools.classList.toggle("hidden",!selectedPeer);
 els.openContactEdit.classList.toggle("hidden",!selectedPeer);
 els.openContactDelete.classList.toggle("hidden",!selectedPeer);
 els.confirmDeleteContact.disabled=!selectedPeer||state.connecting||state.callStarted||state.peerPresent||state.outgoingCall||state.incomingCall;
 els.saveContactName.disabled=!selectedPeer||state.connecting||state.callStarted||state.peerPresent||state.outgoingCall||state.incomingCall||!els.editContactName.value.trim()||els.editContactName.value.trim()===originalEditContactName;
 const trustedPeer=selectedPeer&&trustedContactIds.has(els.peer.value);
 const exchangeCompleted=selectedPeer&&completedContactRequests.has(els.peer.value);
 els.replyInvite.classList.toggle("hidden",!selectedPeer||trustedPeer||exchangeCompleted);
 els.replyInvite.textContent=sentContactRequests[els.peer.value]?"Послать ответное приглашение ещё раз":"Послать ответное приглашение";
 els.replyInvite.disabled=!selectedPeer||trustedPeer||state.connecting||state.callStarted||state.peerPresent||state.outgoingCall||state.incomingCall;
}
function setBusy(value){state.connecting=value;updateCallButtons();els.peer.disabled=value}
function stopRinging(){
 state.ringingKind=null;
 if(state.ringPulseTimer){clearTimeout(state.ringPulseTimer);state.ringPulseTimer=null}
 for(const oscillator of state.ringOscillators){try{oscillator.stop()}catch{}}
 state.ringOscillators=[];
}
function unlockRingingAudio(){
 try{
  const AudioContextClass=window.AudioContext||window.webkitAudioContext;
  if(!AudioContextClass)return;
  if(!state.ringContext)state.ringContext=new AudioContextClass();
  if(state.ringContext.state==="suspended")state.ringContext.resume().catch(error=>debug("Браузер не разрешил звук: "+error.message));
 }catch(error){debug("Не удалось подготовить звук звонка: "+error.message)}
}
async function startRinging(kind){
 stopRinging();state.ringingKind=kind;
 try{
  const AudioContextClass=window.AudioContext||window.webkitAudioContext;
  if(!AudioContextClass)throw Error("Web Audio API недоступен");
  if(!state.ringContext)state.ringContext=new AudioContextClass();
  if(state.ringContext.state==="suspended")await state.ringContext.resume();
  if(state.ringingKind!==kind)return;
  if(state.ringContext.state!=="running"){debug("Звук звонка заблокирован браузером; используйте экранные кнопки.");return}
  const duration=2,cycle=6;
  const pulse=()=>{
   if(state.ringingKind!==kind)return;
   const now=state.ringContext.currentTime,nodes=[];
   if(kind==="incoming"){
    // Короткая мелодия вместо телефонного гудка: четыре мягкие восходящие/нисходящие ноты.
    const notes=[880,1175,988,784],step=0.28,noteDuration=0.22;
    notes.forEach((frequency,index)=>{
     const start=now+index*step,oscillator=state.ringContext.createOscillator(),gain=state.ringContext.createGain();
     oscillator.type="triangle";oscillator.frequency.value=frequency;
     gain.gain.setValueAtTime(0.0001,start);gain.gain.linearRampToValueAtTime(0.045,start+0.025);
     gain.gain.setValueAtTime(0.045,start+noteDuration-0.04);gain.gain.linearRampToValueAtTime(0.0001,start+noteDuration);
     oscillator.connect(gain);gain.connect(state.ringContext.destination);
     oscillator.start(start);oscillator.stop(start+noteDuration);nodes.push(oscillator);
    });
    state.ringPulseTimer=setTimeout(pulse,3.2*1000);
   }else{
    for(const frequency of [440,480]){
     const oscillator=state.ringContext.createOscillator(),gain=state.ringContext.createGain();
     oscillator.type="sine";oscillator.frequency.value=frequency;
     gain.gain.setValueAtTime(0.0001,now);gain.gain.linearRampToValueAtTime(0.035,now+0.025);
     gain.gain.setValueAtTime(0.035,now+duration-0.04);gain.gain.linearRampToValueAtTime(0.0001,now+duration);
     oscillator.connect(gain);gain.connect(state.ringContext.destination);
     oscillator.start(now);oscillator.stop(now+duration);nodes.push(oscillator);
    }
    state.ringPulseTimer=setTimeout(pulse,cycle*1000);
   }
   state.ringOscillators=nodes;
  };
  pulse();
 }catch(error){debug("Не удалось включить звук звонка: "+(error.message||String(error)));}
}
function clearIncomingUi(){
 if(state.incomingTimer){clearTimeout(state.incomingTimer);state.incomingTimer=null}
 state.incomingCall=false;els.dismissIncoming.classList.add("hidden");els.rejectIncoming.classList.add("hidden");updateCallButtons();
}
function showIncomingCall({peer,peerId,expiresAt,trusted=true}){
 if(state.connecting||state.callStarted||state.incomingCall)return;
 if(peerId&&NtfySecureSignaling.validUserId(peerId))els.peer.value=peerId;
 if(state.outgoingCall){
  if(state.secure?.role!=="A"||state.secure?.hello)return;
  stopOutgoingCall();
  debug("Одновременный вызов: роль A принимает входящий запрос; исходящий запрос отменён локально.");
 }
 const remaining=Math.max(0,expiresAt-Date.now());
 if(!remaining)return;
 state.incomingCall=true;els.dismissIncoming.classList.remove("hidden");els.rejectIncoming.classList.remove("hidden");updateCallButtons();
 const peerLabel=els.peer.selectedOptions[0]?.textContent||"сохранённый контакт";
 const description=trusted
  ?"Вам звонит "+peerLabel+". Нажмите «Ответить», «Отклонить» или «Скрыть вызов».":"Запрос от "+peerLabel+". Устройство ещё не сопряжено: после ответа обязательно сверьте проверочный код.";
 setStatus(trusted?"Входящий вызов":"Новый запрос на сопряжение",description,"wait");
 debug((trusted?"Входящий вызов от подтверждённого устройства ":"Новый запрос от непроверенного устройства ")+peerLabel+".");
 if(trusted)startRinging("incoming");
 state.incomingTimer=setTimeout(()=>dismissIncoming(true),remaining);
}
function stopOutgoingCall(){
 if(state.callTimer){clearTimeout(state.callTimer);state.callTimer=null}
 state.outgoingCall=false;stopRinging();
}
function startOutgoingCall({peer,expiresAt}){
 if(state.outgoingCall||state.incomingCall||state.secure?.ready||state.peerPresent)return;
 const remaining=Math.max(0,expiresAt-Date.now());
 if(!remaining)return;
 state.outgoingCall=true;updateCallButtons();const peerLabel=els.peer.selectedOptions[0]?.textContent||"контакт";setStatus("Вызываем "+peerLabel,"Ожидаем ответа. Вызов завершится автоматически через 45 секунд.","wait");
 startRinging("outgoing");
 state.callTimer=setTimeout(()=>finishNoAnswer(),remaining);
}
async function rejectIncoming(){
 if(!state.incomingCall)return;
 try{
  await state.secure?.rejectIncoming();
  clearIncomingUi();stopRinging();
  setStatus("Вызов отклонён","Вызывающий получил подписанное уведомление об отказе.","idle");
  debug("Входящий вызов явно отклонён; подписанное сообщение отправлено через ntfy.");
 }catch(error){showError("Не удалось отправить отказ: "+(error.message||String(error)));}
}
async function dismissIncoming(timedOut=false){
 if(!state.incomingCall)return;
 clearIncomingUi();stopRinging();state.secure?.dismissIncoming();
 if(timedOut){
  setStatus("Вызов скрыт","Время ожидания истекло. Вызывающий не получил уведомление об отклонении.","idle");
  debug("Входящий вызов локально завершён по тайм-ауту; POST не отправлялся.");
 }else{
  setStatus("Вызов скрыт","Вызывающий не уведомлён и продолжит ожидать до своего тайм-аута.","idle");
  debug("Пользователь скрыл входящий вызов локально; POST не отправлялся.");
 }
}
async function finishRejectedCall(info){
 if(!state.outgoingCall)return;
 stopOutgoingCall();clearIncomingUi();state.secure?.resetSession();
 if(state.webrtc){await state.webrtc.close({stopTracks:true});state.webrtc=null}
 els.audio.srcObject=null;els.hangup.disabled=true;els.pilot.disabled=false;els.transport.textContent="Не выбран";els.verify.classList.add("hidden");
 state.callStarted=false;state.peerPresent=false;updateCallButtons();
 setStatus("Вызов отклонён",(info.peer||"Контакт")+" отклонил входящий вызов.","idle");
 debug("Получен подписанный отказ от вызова "+info.sid+".");
}
async function finishNoAnswer(){
 if(!state.outgoingCall)return;
 stopOutgoingCall();clearIncomingUi();state.secure?.resetSession();
 if(state.webrtc){await state.webrtc.close({stopTracks:true});state.webrtc=null}
 els.audio.srcObject=null;els.hangup.disabled=true;els.pilot.disabled=false;els.transport.textContent="Не выбран";els.verify.classList.add("hidden");
 state.callStarted=false;state.peerPresent=false;updateCallButtons();
 setStatus("Нет ответа","Время ожидания истекло. Вызов завершён только на этом устройстве; уведомление об отмене не отправлялось.","idle");
 debug("Исходящий вызов истёк через 45 секунд; отменяющий POST не отправлялся.");
}
function createWebRtcInstance(diagnosticPilot=els.pilot.checked){
 const me=state.me,peer=els.peer.value;
 return new WebRtcAudio({
  diagnosticPilot,
  initiator:NtfySecureSignaling.validUserId(me)&&NtfySecureSignaling.validUserId(peer)&&me<peer,
  onRemoteHangup:()=>handleRemoteHangup(),
  sendSignal:payload=>state.secure.sendSignal(payload),
  onRemoteStream:stream=>{els.audio.srcObject=stream;els.audio.play().catch(e=>debug("Не удалось включить удалённый звук: "+e.message))},
  onError:error=>showError(error.message||String(error)),
  onState:value=>{
   debug("WebRTC: "+value);
   if(value==="connection-connected"){
    if(state.disconnectTimer){clearTimeout(state.disconnectTimer);state.disconnectTimer=null}
    updateCallButtons();els.transport.textContent="Прямой WebRTC / P2P";setStatus("WebRTC соединение установлено","Проверяем передачу аудио между устройствами.","live")
   }
   else if(value==="connection-failed"||value==="ice-failed"){
    if(state.disconnectTimer){clearTimeout(state.disconnectTimer);state.disconnectTimer=null}
    els.transport.textContent="WebRTC: соединение не установлено";setStatus("P2P не получилось","Сигнализация работает, но прямой аудиоканал не установился. TURN-сервер пока не настроен.","error");
    if(state.peerPresent&&!state.hangingUp)hangup({notifyPeer:false,failure:true})
   }
   else if(value==="connection-connecting"||value==="ice-checking"||value==="ice-connected"||value==="ice-completed"){
    if((value==="ice-connected"||value==="ice-completed")&&state.disconnectTimer){clearTimeout(state.disconnectTimer);state.disconnectTimer=null}
    setStatus("Устанавливаем аудиосоединение","Проверяем сетевые маршруты между устройствами.","wait")
   }
   else if(value==="connection-disconnected"||value==="ice-disconnected"){
    setStatus("Связь прервалась","Даём WebRTC время восстановить соединение (15 секунд).","wait");
    if(!state.disconnectTimer)state.disconnectTimer=setTimeout(()=>{
     state.disconnectTimer=null;
     if(state.webrtc?.pc?.connectionState==="disconnected"&&!state.hangingUp)hangup({notifyPeer:false,failure:true});
    },15000)
   }
   else if(value==="control-open"){debug("P2P управляющий канал готов (RTCDataChannel).")}
   else if(value==="control-closed"){debug("P2P управляющий канал закрыт.")}
  }
 });
}
async function ensureWebRtc(){
 if(!state.webrtc)state.webrtc=createWebRtcInstance();
}
function createSecureSignaling(me,peer=""){
 return new NtfySecureSignaling({
  me,peer,
  onSignal:handleSignal,
  onStatus:m=>{els.statusText.textContent=m;debug(m)},
  onIncoming:showIncomingCall,
  onContactRequest:handleIncomingContactRequest,
  onPeerMessage:markContactRequestReceived,
  onCancelIncoming:info=>{
   if(state.incomingCall){clearIncomingUi();stopRinging();state.secure?.dismissIncoming();setStatus("Вызов отменён",info.peer+" отменил вызов до ответа.","idle");debug("Входящий вызов "+info.sid+" отменён вызывающим через ntfy.");}
  },
  onRejectOutgoing:info=>{finishRejectedCall(info).catch(error=>showError(error.message||String(error)))},
  onDialing:info=>{if(!state.answeringCall){startOutgoingCall(info);sendPushEventToContact(els.peer.value,"incoming_call",info.callId,info.expiresAt).then(()=>debug("OneSignal принял push входящего вызова.")).catch(error=>debug("Push не отправлен (звонок через ntfy продолжается): "+error.message))}},
  onVerify:({sas,peer:name})=>{stopOutgoingCall();clearIncomingUi();stopRinging();els.verifyCode.textContent=sas;els.verify.classList.remove("hidden");els.confirm.disabled=false;setStatus("Нужно подтвердить собеседника","Сверьте короткий код с "+(els.peer.selectedOptions[0]?.textContent||"контактом")+" по независимому каналу.","wait");debug("Код проверки: "+sas)},
  onReady:info=>{stopOutgoingCall();clearIncomingUi();stopRinging();return onSecureReady(info).catch(showError)},
  onError:e=>showError(e.message||String(e)),
  onDebug:debug
 });
}
async function subscribeForUser(me){
 if(!NtfySecureSignaling.validUserId(me))return;
 if(state.secure&&state.secure.me===me&&state.secure.es)return;
 if(state.secure){state.secure.close();state.secure=null}
 const peer=els.peer.value;
 const subscription=createSecureSignaling(me,NtfySecureSignaling.validUserId(peer)&&peer!==me?peer:"");
 state.secure=subscription;
 els.debugUrl.textContent="https://ntfy.sh/ · "+me.slice(0,12)+"…";
 setStatus("Подписываемся на ntfy","Открываем постоянный канал входящих сообщений для "+me+".","wait");
 try{
  await subscription.subscribe();
  debug("Фоновая подписка активна для локальной анонимной идентичности. POST hello пока не отправлялся.");
 }catch(error){
  if(state.secure===subscription){
   showError(error.message||String(error));
   setStatus("Подписка не установлена","При подключении попробуем открыть канал ещё раз.","error");
  }
 }
}
function scheduleIcePrewarm(reason="input",force=false){
 if(state.prewarmTimer)clearTimeout(state.prewarmTimer);
 state.prewarmTimer=setTimeout(async()=>{
  state.prewarmTimer=null;
  const me=state.me,peer=els.peer.value;
  const names=me+"|"+peer;
  const eligible=NtfySecureSignaling.validUserId(me)&&NtfySecureSignaling.validUserId(peer)&&
   me!==peer&&me<peer&&!els.pilot.checked&&navigator.onLine;
  if(state.connecting||state.secure?.active||state.callStarted)return;
  if(!eligible){
   if(state.webrtc?.prewarmed){
    const old=state.webrtc;state.webrtc=null;state.prewarmNames=null;
    await old.close({stopTracks:true});
   }
   return;
  }
  if(state.prewarmPromise){
   state.prewarmPending={reason,force};
   return;
  }
  const currentFresh=!!(state.webrtc&&state.webrtc.isPrewarmed()&&state.prewarmNames===names);
  const currentAge=currentFresh?Date.now()-state.webrtc.prewarmStartedAt:Infinity;
  if(currentFresh&&(!force||currentAge<30000))return;

  const candidate=createWebRtcInstance(false);
  const task=(async()=>{
   try{
    debug("Предварительная подготовка ICE начата (причина: "+reason+"; без микрофона и без ntfy).");
    const count=await candidate.prepareIce();
    const latestMe=state.me,latestPeer=els.peer.value;
    const stillEligible=!state.secure?.active&&!state.callStarted&&!els.pilot.checked&&navigator.onLine&&
     latestMe+"|"+latestPeer===names&&latestMe<latestPeer;
    if(!stillEligible){
     await candidate.close({stopTracks:true});
     debug("Новая ICE-подготовка отброшена: параметры или состояние страницы изменились.");
     return null;
    }
    const previous=state.webrtc;
    state.webrtc=candidate;
    state.prewarmNames=names;
    if(previous&&previous!==candidate)await previous.close({stopTracks:true});
    debug("Предварительная подготовка ICE завершена; локально сохранено кандидатов: "+count+". Старый экземпляр заменён.");
    return candidate;
   }catch(error){
    await candidate.close({stopTracks:true});
    debug("Предварительная подготовка ICE не удалась: "+(error.message||String(error)));
    return null;
   }
  })();
  state.prewarmTargetNames=names;
  state.prewarmPromise=task;
  try{await task}
  finally{
   if(state.prewarmPromise===task){
    state.prewarmPromise=null;state.prewarmTargetNames=null;
    const pending=state.prewarmPending;state.prewarmPending=null;
    if(pending)scheduleIcePrewarm(pending.reason,pending.force);
   }
  }
 },700);
}
async function onSecureReady(info){
 state.answeringCall=false;
 state.peerPresent=true;state.role=state.secure.role==="A"?"initiator":"receiver";
 els.verify.classList.add("hidden");updateCallButtons();
 setStatus("Ключ собеседника подтверждён",info.trusted?"Сохранённый ключ совпадает. Запускаем голосовой канал.":"Первичная проверка пройдена. Запускаем голосовой канал.","wait");
 debug(info.trusted?"Сохраненная идентичность подтверждена.":"Новая идентичность собеседника сохранена.");
 const peerId=state.secure?.peer||els.peer.value;
 if(NtfySecureSignaling.validUserId(peerId)){
  try{
   await updateContact(peerId,{last_interaction_at:new Date().toISOString()});
   await refreshContactOptions(peerId);
  }catch(error){debug("Не удалось обновить время последнего взаимодействия: "+(error.message||String(error)))}
 }
 if(state.role==="initiator")await startWebRtcOffer();
}
async function handleSignal(payload){
 await ensureWebRtc();await state.webrtc.handleSignal(payload);
}
async function startWebRtcOffer(){
 if(state.callStarted)return;state.callStarted=true;
 try{
  await ensureWebRtc();
  const prepared=await state.webrtc.activatePreparedOffer();
  if(!prepared)await state.webrtc.createOffer();
  debug((prepared?"Предварительно подготовленный ":"")+"WebRTC offer передан в ntfy. Ожидаем answer от второго устройства и установления P2P.");
 }
 catch(e){state.callStarted=false;showError("Не удалось запустить WebRTC: "+e.message);setStatus("Не удалось начать звонок","Проверьте разрешение микрофона и повторите попытку.","error")}
}
async function connect(){
 const answering=state.incomingCall;
 state.answeringCall=answering;
 if(answering){state.secure?.acceptIncoming();clearIncomingUi();stopRinging()}
 clearError();els.verify.classList.add("hidden");setBusy(true);
 try{
  const me=state.me,peer=els.peer.value;
  if(state.prewarmPromise&&(state.prewarmTargetNames===me+"|"+peer||state.prewarmNames===me+"|"+peer)){try{await state.prewarmPromise}catch{}}
  const keepPrewarm=!!(state.webrtc&&state.webrtc.isPrewarmed()&&state.prewarmNames===me+"|"+peer&&me<peer&&!els.pilot.checked);
  if(state.webrtc&&!keepPrewarm){await state.webrtc.close({stopTracks:true});state.webrtc=null;state.prewarmNames=null}
  state.callStarted=false;state.peerPresent=false;
  if(!NtfySecureSignaling.validUserId(me)||!NtfySecureSignaling.validUserId(peer)||me===peer)throw Error("Выберите сохранённый контакт. Собеседник должен отличаться от вашей идентичности.");
  
  if(state.secure&&state.secure.me!==me){state.secure.close();state.secure=null}
  if(!state.secure)state.secure=createSecureSignaling(me,peer);
  else state.secure.setPeer(peer);
  els.debugUrl.textContent="https://ntfy.sh/ · "+me;

  // Request microphone while the user-initiated Connect click is still active.
  // Do not wait for the asynchronous secure handshake before asking permission.
  await ensureWebRtc();
  // The answerer opens its microphone after the user's Answer click.
  // The caller remains muted until ACCEPTED arrives over the P2P DataChannel.
  state.webrtc.setMicEnabled(answering);
  state.webrtc.setCallAccepted(answering);
  try {
   await state.webrtc.ensureMedia();
  } catch(e) {
   throw new Error("Не удалось получить доступ к микрофону: "+e.message);
  }

  await state.secure.start();
  els.hangup.disabled=false;
 }catch(e){
  stopOutgoingCall();
  showError(e.message||String(e));
  setStatus("Не удалось подключиться","Проверьте разрешения и попробуйте снова.","error");
  if(state.secure){if(answering)state.secure.dismissIncoming();state.secure.resetSession()}
  if(state.webrtc){await state.webrtc.close({stopTracks:true});state.webrtc=null}
  state.peerPresent=false;state.answeringCall=false;updateCallButtons();
  if(answering){clearIncomingUi();stopRinging()}
 }
 finally{setBusy(false);els.pilot.disabled=!!state.webrtc}
}
async function hangup({notifyPeer=true,remote=false,failure=false}={}){
 if(state.hangingUp)return;
 state.hangingUp=true;updateCallButtons();
 if(notifyPeer&&state.outgoingCall&&state.secure?.role==="B"){
  setStatus("Отменяем вызов","Уведомляем собеседника через ntfy.","wait");
  try{const sent=await state.secure.cancelCall();debug(sent?"Отмена исходящего вызова отправлена через ntfy.":"У исходящего вызова не найден активный запрос для отмены.");}
  catch(error){debug("Не удалось отправить отмену через ntfy: "+(error.message||String(error)));}
 }
 if(notifyPeer&&state.peerPresent&&state.webrtc?.isControlOpen()){
  setStatus("Завершаем звонок","Отправляем собеседнику P2P-уведомление и ждём подтверждение.","wait");
  const acknowledged=await state.webrtc.sendHangup(1200);
  debug(acknowledged?"P2P HANGUP подтверждён собеседником.":"Подтверждение HANGUP не получено за 1,2 секунды; закрываем локально.");
 }else if(notifyPeer&&state.peerPresent){
  debug("P2P DataChannel ещё не открыт; завершение выполняется локально без отдельного POST.");
 }
 stopOutgoingCall();if(state.incomingCall)state.secure?.dismissIncoming();clearIncomingUi();stopRinging();
 if(state.disconnectTimer){clearTimeout(state.disconnectTimer);state.disconnectTimer=null}
 state.secure?.resetSession();
 if(state.webrtc){await state.webrtc.close({stopTracks:true});state.webrtc=null}
 els.audio.srcObject=null;els.pilot.disabled=false;els.transport.textContent="Не выбран";
 els.verify.classList.add("hidden");state.callStarted=false;state.peerPresent=false;state.answeringCall=false;state.hangingUp=false;updateCallButtons();
 if(remote)setStatus("Собеседник завершил звонок","Удалённая сторона отправила P2P-сообщение HANGUP; звонок завершён.","idle");
 else if(failure)setStatus("Соединение потеряно","WebRTC не восстановил связь за отведённое время. Звонок завершён.","error");
 else setStatus("Звонок завершён","Подписка на ваше имя остаётся активной. Чтобы позвонить снова, нажмите «Подключиться».","idle");
 scheduleIcePrewarm("hangup",true);
}
function handleRemoteHangup(){
 if(state.hangingUp)return;
 debug("Собеседник завершил звонок: получено HANGUP по RTCDataChannel.");
 hangup({notifyPeer:false,remote:true});
}

function contactInitials(name){
 const words=String(name||"").trim().split(/\s+/u).filter(Boolean);
 return words.slice(0,2).map(word=>Array.from(word)[0]?.toLocaleUpperCase("ru-RU")||"").join("")||"?";
}
function contactAvatarColor(userId){
 let hash=2166136261;
 for(const char of String(userId||"")){hash^=char.charCodeAt(0);hash=Math.imul(hash,16777619)}
 return "hsl("+((hash>>>0)%360)+" 58% 48%)";
}
function formatLastInteraction(value){
 if(!value)return "Нет звонков";
 const timestamp=Date.parse(value);
 if(!Number.isFinite(timestamp))return "Нет звонков";
 const elapsed=Math.max(0,Date.now()-timestamp);
 if(elapsed<60000)return "сейчас";
 if(elapsed<3600000)return Math.floor(elapsed/60000)+" мин";
 if(elapsed<86400000)return Math.floor(elapsed/3600000)+" ч";
 const days=Math.floor(elapsed/86400000);
 if(days===1)return "вчера";
 if(days<7)return days+" дн.";
 return new Date(timestamp).toLocaleDateString("ru-RU",{day:"numeric",month:"short"});
}
let contactListInitialPositioned=false;
function renderContactList(contacts){
 els.contactListItems.replaceChildren();
 els.contactsCount.textContent=String(contacts.length);
 els.contactListEmpty.classList.toggle("hidden",contacts.length>0);
 els.privacyHelp.classList.toggle("hidden",contacts.length>0);
 for(const contact of contacts){
  const item=document.createElement("button");
  item.type="button";item.className="contact-list-item";item.dataset.peer=contact.user_id;item.setAttribute("role","listitem");
  item.setAttribute("aria-pressed",String(els.peer.value===contact.user_id));
  const avatar=document.createElement("span");
  avatar.className="contact-avatar";avatar.textContent=contactInitials(contact.name);
  avatar.style.backgroundColor=contactAvatarColor(contact.user_id);
  const details=document.createElement("span");details.className="contact-list-details";
  const name=document.createElement("span");name.className="contact-list-name";name.textContent=contact.name;
  const status=document.createElement("span");status.className="contact-list-status";
  status.textContent=contact.trusted===true?"Ключ подтверждён":"Проверка при первом звонке";
  details.append(name,status);
  const last=document.createElement("span");last.className="contact-list-last";last.textContent=formatLastInteraction(contact.last_interaction_at);
  item.append(avatar,details,last);
  els.contactListItems.append(item);
 }
 if(!contactListInitialPositioned&&contacts.length){
  requestAnimationFrame(()=>{els.contactList.scrollTop=42;});
  contactListInitialPositioned=true;
 }
}
async function refreshContactOptions(selectUserId=""){
 const contacts=await listContacts();
 contacts.sort((a,b)=>{
  const aTime=Date.parse(a.last_interaction_at||"")||0,bTime=Date.parse(b.last_interaction_at||"")||0;
  return bTime-aTime||a.name.localeCompare(b.name);
 });
 trustedContactIds=new Set(contacts.filter(contact=>contact.trusted===true).map(contact=>contact.user_id));
 els.peer.replaceChildren(new Option("Выберите контакт",""));
 for(const contact of contacts)els.peer.add(new Option(contact.name,contact.user_id));
 els.peer.disabled=contacts.length===0;
 if(selectUserId&&contacts.some(contact=>contact.user_id===selectUserId))els.peer.value=selectUserId;
 renderContactList(contacts);
 els.editContactName.value=els.peer.selectedOptions[0]?.textContent||"";
 originalEditContactName=els.editContactName.value.trim();
 updateReplyInviteStatus();
 updateCallButtons();
}

function toBase64UrlBytes(bytes){
 let binary="";
 for(const byte of bytes)binary+=String.fromCharCode(byte);
 return btoa(binary).replaceAll("+","-").replaceAll("/","_").replace(/=+$/g,"");
}
async function ensureQrCodeLibrary(){
 if(window.QRCode)return;
 await new Promise((resolve,reject)=>{
  const script=document.createElement("script");
  script.src="https://cdnjs.cloudflare.com/ajax/libs/qrcodejs/1.0.0/qrcode.min.js";
  script.onload=resolve;
  script.onerror=()=>reject(new Error("Не удалось загрузить библиотеку QR-кодов."));
  document.head.append(script);
 });
 if(!window.QRCode)throw new Error("Библиотека QR-кодов не инициализировалась.");
}
async function createContactInvitation(){
 els.createInvite.disabled=true;
 setInlineStatus(els.inviteStatus,"Проверяем разрешение на push-уведомления…");
 clearError();
 try{
  const subscriptionId=await enableOneSignalPush();
  const identity=await getCurrentSignalingIdentity();
  const unsigned={
   version:1,
   user_id:identity.user_id,
   public_key:identity.public_key,
   push_subscription_id:subscriptionId,
   created_at:Date.now()
  };
  const canonical=JSON.stringify(unsigned);
  const signature=await signWithIdentity(canonical);
  const contactPackage={...unsigned,signature};
  const encoded=toBase64UrlBytes(new TextEncoder().encode(JSON.stringify(contactPackage)));
  const url=window.location.origin+window.location.pathname+"#contact="+encoded;
  await saveMyInvitation(url);
  els.inviteUrl.value=url;
  updateInviteCopyButton();
  els.inviteQr.replaceChildren();
  try{
   await ensureQrCodeLibrary();
   new window.QRCode(els.inviteQr,{text:url,width:220,height:220,colorDark:"#101827",colorLight:"#ffffff",correctLevel:window.QRCode.CorrectLevel.M});
   setInlineStatus(els.inviteStatus,"");
  }catch(qrError){
   setInlineStatus(els.inviteStatus,"Ссылка создана. QR-код пока недоступен: "+(qrError.message||String(qrError)),true);
  }
  els.inviteUrl.focus();
  els.inviteUrl.select();
  debug("Создано подписанное приглашение с действующим OneSignal Subscription ID.");
  updateInvitationPanel();
 }catch(error){
  const message=error.message||String(error);
  setInlineStatus(els.inviteStatus,"Приглашение не создано. "+message,true);
  showError(message);
 }finally{els.createInvite.disabled=false}
}
function updateInviteCopyButton(){
 const disabled=!els.inviteUrl.value.trim();
 els.copyInvite.disabled=disabled;
 els.copyInviteInline.disabled=disabled;
}
async function copyContactInvitation(event){
 event?.preventDefault();
 event?.stopPropagation();
 const value=els.inviteUrl.value.trim();
 if(!value)return;
 try{
  await navigator.clipboard.writeText(value);
  const button=event?.currentTarget;
  if(button===els.copyInviteInline){
   const originalLabel=button.textContent;
   button.textContent="Скопировано";
   window.setTimeout(()=>{button.textContent=originalLabel},1600);
  }
  setInlineStatus(els.inviteStatus,"Ссылка скопирована.");
 }catch{
  els.inviteTools.open=true;
  els.inviteUrl.focus();els.inviteUrl.select();
  setInlineStatus(els.inviteStatus,"Выделите ссылку и скопируйте её вручную.");
 }
}

async function pasteContactInvitation(event){
 event?.preventDefault();
 event?.stopPropagation();
 els.contactTools.open=true;
 try{
  if(!navigator.clipboard?.readText)throw Error("Чтение буфера обмена не поддерживается этим браузером.");
  const value=await navigator.clipboard.readText();
  if(!value.trim()){
   setInlineStatus(els.qrStatus,"Буфер обмена пуст.");
   return;
  }
  const clipboardValue=value.trim();
  try{
   const pastedContact=await verifyContactPackage(clipboardValue);
   const ownIdentity=await getCurrentSignalingIdentity();
   if(pastedContact.user_id===ownIdentity.user_id){
    setInlineStatus(els.qrStatus,"Это ваше собственное приглашение. Его нельзя добавить как контакт.",true);
    return;
   }
  }catch{
   // Некорректные или неподдерживаемые данные останутся на обычной проверке при сохранении.
  }
  els.contactPackage.value=clipboardValue;
  els.contactPackage.dispatchEvent(new Event("input",{bubbles:true}));
  setInlineStatus(els.qrStatus,"Содержимое буфера вставлено. Укажите имя контакта.");
  els.contactName.focus();
 }catch(error){
  setInlineStatus(els.qrStatus,"Не удалось прочитать буфер обмена. Разрешите доступ браузеру или вставьте ссылку в поле вручную.",true);
  els.contactPackage.focus();
  debug("Не удалось вставить приглашение из буфера обмена: "+(error.message||String(error)));
 }
}

async function sendContactRequest(peerOverride=els.peer.value,statusElement=els.replyInviteStatus){
 const peer=peerOverride;
 if(!NtfySecureSignaling.validUserId(peer)||peer===state.me){showError("Сначала выберите контакт, от которого вы получили приглашение.");return false;}
 markContactRequestSent(peer);
 updateCallButtons();
 els.replyInvite.disabled=true;setInlineStatus(statusElement,"Подготавливаем подписанный запрос…");clearError();
 try{
  const contact=await getContact(peer);
  if(!contact?.push_subscription_id)throw Error("У контакта отсутствует OneSignal ID. Попросите его обновить приглашение.");
  const subscriptionId=await enableOneSignalPush();
  const identity=await getCurrentSignalingIdentity();
  const unsigned={version:1,user_id:identity.user_id,public_key:identity.public_key,push_subscription_id:subscriptionId,created_at:Date.now()};
  const contactPackage={...unsigned,signature:await signWithIdentity(JSON.stringify(unsigned))};
  if(!Number.isFinite(Number(contact.created_at)))throw Error("У сохранённого контакта нет даты исходного приглашения. Удалите его и импортируйте заново по новой ссылке.");
  const requestId=crypto.randomUUID(),expiresAt=Date.now()+120000;
  const payload={request_id:requestId,from:identity.user_id,to:peer,expires_at:expiresAt,invitation_created_at:Number(contact.created_at),identity:identity.publicJwk,contact_package:contactPackage};
  const message={v:1,type:"contact_request",payload,sig:await signWithIdentity({type:"contact_request",payload})};
  const topic=await getNtfyTopic(peer);
  const response=await fetch("https://ntfy.sh/"+topic,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(message),cache:"no-store"});
  if(!response.ok)throw Error("ntfy не принял запрос (HTTP "+response.status+").");
  try{
   await sendPushEventToContact(peer,"contact_request",requestId,expiresAt);
   setInlineStatus(statusElement,"Ответное приглашение отправлено. Push-уведомление передано в OneSignal.");
   debug("Подписанный запрос на добавление контакта опубликован в ntfy; OneSignal принял push.");
  }catch(pushError){
   setInlineStatus(statusElement,"Ответное приглашение передано через ntfy, но push не отправлен: "+(pushError.message||String(pushError)),true);
   debug("Запрос контакта отправлен через ntfy; push не отправлен: "+(pushError.message||String(pushError)));
  }
  return true;
 }catch(error){
  setInlineStatus(statusElement,"Не удалось отправить ответное приглашение: "+(error.message||String(error)),true);showError(error.message||String(error));
  return false;
 }finally{els.replyInvite.disabled=false;updateCallButtons()}
}

function formatInvitationAge(timestamp){
 const elapsed=Math.max(0,Date.now()-Number(timestamp));
 if(elapsed<30000)return "только что";
 const rtf=new Intl.RelativeTimeFormat("ru",{numeric:"always"});
 const minutes=elapsed/60000;
 if(minutes<60)return rtf.format(-Math.max(1,Math.round(minutes)),"minute");
 const hours=elapsed/3600000;
 if(hours<24)return rtf.format(-Math.max(1,Math.round(hours)),"hour");
 const days=elapsed/86400000;
 if(days<30)return rtf.format(-Math.max(1,Math.round(days)),"day");
 const months=days/30.4375;
 if(months<12)return rtf.format(-Math.max(1,Math.round(months)),"month");
 return rtf.format(-Math.max(1,Math.round(days/365.25)),"year");
}
function renderContactRequest(){
 const request=state.pendingContactRequests[0];
 els.contactRequestPanel.classList.toggle("hidden",!request);
 if(!request)return;
 els.contactRequestText.textContent=request.invitationCreatedAt
  ?"Это ответ на ваше приглашение, отправленное "+formatInvitationAge(request.invitationCreatedAt)+"."
  :"Это ответ на ранее отправленное вами приглашение.";
 if(!els.contactRequestName.value)els.contactRequestName.value="Новый контакт";
 els.acceptContactRequest.disabled=false;
}

function handleIncomingContactRequest(request){
 if(state.pendingContactRequests.some(item=>item.requestId===request.requestId))return;
 if(state.pendingContactRequests.some(item=>item.contact.user_id===request.contact.user_id))return;
 getContact(request.contact.user_id).then(existing=>{
  if(existing){debug("Запрос контакта пропущен: отправитель уже сохранён в адресной книге.");return;}
  state.pendingContactRequests.push(request);renderContactRequest();
  debug("Получен подписанный запрос на добавление контакта через ntfy.");
 }).catch(error=>debug("Не удалось проверить запрос контакта: "+(error.message||String(error))));
}

async function acceptContactRequest(){
 const request=state.pendingContactRequests[0];if(!request)return;
 const name=els.contactRequestName.value.trim();
 if(!name){showError("Укажите имя контакта.");return;}
 els.acceptContactRequest.disabled=true;
 try{
  const existing=await getContact(request.contact.user_id);
  await saveContact({...existing,...request.contact,name:existing?.name||name,trusted:true,verified_at:new Date().toISOString()});
  await refreshContactOptions(request.contact.user_id);
  state.pendingContactRequests.shift();els.contactRequestName.value="";renderContactRequest();
  setStatus("Контакт добавлен","Теперь можно звонить этому контакту.","idle");
  debug("Подписанный запрос принят; контакт "+name+" сохранён только в IndexedDB.");
 }catch(error){showError("Не удалось сохранить контакт: "+(error.message||String(error)));els.acceptContactRequest.disabled=false}
}

function declineContactRequest(){
 if(!state.pendingContactRequests.length)return;
 state.pendingContactRequests.shift();els.contactRequestName.value="";renderContactRequest();
 debug("Запрос на добавление контакта отклонён локально; отправитель не уведомляется.");
}
async function saveSelectedContactName(){
 const peer=els.peer.value;
 const name=els.editContactName.value.trim();
 if(!NtfySecureSignaling.validUserId(peer)||peer===state.me){showError("Сначала выберите сохранённый контакт.");return}
 if(!name){showError("Укажите имя контакта.");els.editContactName.focus();return}
 if(state.connecting||state.callStarted||state.peerPresent||state.outgoingCall||state.incomingCall){showError("Завершите текущий вызов, чтобы изменить имя контакта.");return}
 els.saveContactName.disabled=true;
 try{
  const contact=await getContact(peer);
  if(!contact)throw Error("Контакт не найден в локальной адресной книге.");
  await saveContact({...contact,name});
  await refreshContactOptions(peer);
  els.contactScreenName.textContent=name;
  const updatedItem=Array.from(els.contactList.querySelectorAll(".contact-list-item")).find(item=>item.dataset.peer===peer);
  if(updatedItem){
   const updatedAvatar=updatedItem.querySelector(".contact-avatar");
   if(updatedAvatar){
    els.contactScreenAvatar.textContent=updatedAvatar.textContent;
    els.contactScreenAvatar.style.backgroundColor=updatedAvatar.style.backgroundColor||"var(--accent)";
   }
  }
  clearError();
  setStatus("Имя контакта сохранено","Новое имя хранится только на этом устройстве.","idle");
  debug("Локальное имя контакта изменено на: "+name+".");
  closeContactEditScreen();
 }catch(error){
  showError("Не удалось сохранить имя контакта: "+(error.message||String(error)));
 }finally{updateCallButtons()}
}

async function deleteSelectedContact(){
 const peer=els.peer.value;
 if(!NtfySecureSignaling.validUserId(peer)){
  showError("Сначала выберите сохранённый контакт.");
  return;
 }
 if(state.connecting||state.callStarted||state.peerPresent||state.outgoingCall||state.incomingCall){
  showError("Сначала завершите текущий вызов, чтобы удалить контакт.");
  return;
 }
 const name=els.peer.selectedOptions[0]?.textContent||"контакт";
 els.confirmDeleteContact.disabled=true;
 try{
  await deleteContact(peer);
  clearSentContactRequest(peer);
  if(state.secure?.peer===peer)state.secure.setPeer("");
  await refreshContactOptions();
  closeContactScreen();
  clearError();
  debug("Контакт "+name+" и все его сохранённые данные удалены из локальной адресной книги.");
  setStatus("Контакт удалён","Чтобы снова связаться, нужно будет заново обменяться приглашениями.","idle");
 }catch(error){
  showError("Не удалось удалить контакт: "+(error.message||String(error)));
  closeContactDeleteScreen();
 }finally{updateCallButtons()}
}

let importingContact=false;
function updateImportContactButton(){
 els.importContact.disabled=importingContact||!els.contactPackage.value.trim()||!els.contactName.value.trim();
 els.pasteContactInline.textContent=els.contactPackage.value.trim()?"Заменить":"Вставить";
}
async function importContactFromInput(){
 importingContact=true;
 updateImportContactButton();
 try{
  const verified=await verifyContactPackage(els.contactPackage.value);
  const name=els.contactName.value.trim();
  if(!name)throw Error("Укажите имя, под которым контакт будет сохранён только на этом устройстве.");
  const existing=await getContact(verified.user_id);
  if(existing&&!window.confirm("Этот контакт уже сохранён как «"+existing.name+"». Обновить его данные и локальное имя?"))return;
  await saveContact({...verified,name,trusted:existing?.trusted===true,verified_at:existing?.verified_at||null});
  await refreshContactOptions(verified.user_id);
  if(state.secure&&!state.secure.active&&!state.connecting)state.secure.setPeer(verified.user_id);
  els.contactPackage.value="";
  els.contactName.value="";
  els.contactTools.open=false;
  setInlineStatus(els.qrStatus,"Контакт «"+name+"» успешно проверен и сохранён локально.");
  clearError();
  debug("Импортирован и криптографически проверен новый контакт: "+name+".");
  setStatus("Контакт добавлен","Теперь его можно выбрать для звонка.","idle");
  if(!existing){
   setInlineStatus(els.qrStatus,"Контакт сохранён. Отправляем ответное приглашение…");
   debug("Автоматически отправляем ответное приглашение новому контакту.");
   await sendContactRequest(verified.user_id,els.qrStatus);
  }
 }catch(error){
  showError(error.message||String(error));
  setInlineStatus(els.qrStatus,"Не удалось импортировать контакт.",true);
 }finally{importingContact=false;updateImportContactButton()}
}
async function stopQrScan(){
 qrScanActive=false;
 if(qrStream){for(const track of qrStream.getTracks())track.stop();qrStream=null}
 els.qrVideo.srcObject=null;
 els.qrVideo.classList.add("hidden");
 els.scanQr.textContent="Сканировать QR-код";
}
async function startQrScan(){
 if(qrScanActive){await stopQrScan();return}
 if(!("BarcodeDetector" in window)){
  els.qrStatus.textContent="В этом браузере нет встроенного сканера QR. Используйте ссылку или вставьте содержимое QR-кода в поле выше.";
  return;
 }
 try{
  const detector=new BarcodeDetector({formats:["qr_code"]});
  qrStream=await navigator.mediaDevices.getUserMedia({video:{facingMode:{ideal:"environment"}},audio:false});
  els.qrVideo.srcObject=qrStream;
  els.qrVideo.classList.remove("hidden");
  await els.qrVideo.play();
  qrScanActive=true;
  els.scanQr.textContent="Остановить сканирование";
  els.qrStatus.textContent="Наведите камеру на QR-код контакта.";
  const scan=async()=>{
   if(!qrScanActive)return;
   try{
    const codes=await detector.detect(els.qrVideo);
    if(codes.length&&codes[0].rawValue){
     els.contactPackage.value=codes[0].rawValue;
     els.contactPackage.dispatchEvent(new Event("input",{bubbles:true}));
     await stopQrScan();
     els.qrStatus.textContent="QR-код считан. Приглашение добавлено в поле. Укажите имя контакта.";
     els.contactName.focus();
     return;
    }
   }catch(error){debug("Ошибка чтения QR: "+(error.message||String(error)))}
   if(qrScanActive)setTimeout(scan,250);
  };
  scan();
 }catch(error){
  await stopQrScan();
  showError("Не удалось запустить камеру для QR-сканирования: "+(error.message||String(error)));
 }
}

els.contactPackage.addEventListener("input",updateImportContactButton);
els.pasteContact.addEventListener("click",pasteContactInvitation);
els.pasteContactInline.addEventListener("click",pasteContactInvitation);
els.contactName.addEventListener("input",updateImportContactButton);
els.importContact.addEventListener("click",importContactFromInput);
updateImportContactButton();
els.replyInvite.addEventListener("click",()=>sendContactRequest());
els.acceptContactRequest.addEventListener("click",acceptContactRequest);
els.declineContactRequest.addEventListener("click",declineContactRequest);
els.contactRequestName.addEventListener("focus",()=>{if(els.contactRequestName.value==="Новый контакт")els.contactRequestName.select()});
els.createInvite.addEventListener("click",createContactInvitation);
function updateInvitationPanel(){
 updateInviteCopyButton();
 const granted="Notification" in window&&Notification.permission==="granted";
 els.invitePermission.classList.toggle("hidden",granted);
 els.inviteContent.classList.toggle("hidden",!granted);
 if(granted&&!els.inviteUrl.value&&!els.createInvite.disabled)createContactInvitation();
 if(granted&&els.inviteUrl.value&&!els.inviteQr.childElementCount){
  (async()=>{
   try{
    await ensureQrCodeLibrary();
    if(!els.inviteQr.childElementCount)new window.QRCode(els.inviteQr,{text:els.inviteUrl.value,width:220,height:220,colorDark:"#101827",colorLight:"#ffffff",correctLevel:window.QRCode.CorrectLevel.M});
   }catch(error){setInlineStatus(els.inviteStatus,"Ссылка доступна, но QR-код пока не удалось восстановить.",true)}
  })();
 }
 if(!granted&&"Notification" in window&&Notification.permission==="denied"){
  setInlineStatus(els.inviteStatus,"Уведомления уже запрещены. Разрешите их для VoiceLink в настройках сайта вашего браузера, затем закройте и снова откройте этот раздел.",true);
 }
}
els.inviteTools.addEventListener("toggle",()=>{
 if(els.inviteTools.open)updateInvitationPanel();
});
els.copyInvite.addEventListener("click",copyContactInvitation);
els.copyInviteInline.addEventListener("click",copyContactInvitation);
els.scanQr.addEventListener("click",startQrScan);
window.addEventListener("pagehide",()=>{if(qrStream)for(const track of qrStream.getTracks())track.stop()});
els.connect.addEventListener("click",connect);
els.dismissIncoming.addEventListener("click",()=>dismissIncoming(false));
els.rejectIncoming.addEventListener("click",rejectIncoming);
document.addEventListener("pointerdown",unlockRingingAudio,{passive:true});
document.addEventListener("keydown",unlockRingingAudio);
els.pilot.addEventListener("change",async()=>{
 try{localStorage.setItem("vl.simulateMicrophone.v1",els.pilot.checked?"1":"0")}catch(error){debug("Не удалось сохранить настройку симуляции микрофона: "+error.message)}
 debug("Симуляция микрофона "+(els.pilot.checked?"включена":"выключена")+". Настройка применяется при следующем подключении.");
 if(!state.secure?.active&&!state.callStarted){if(state.webrtc?.prewarmed){await state.webrtc.close({stopTracks:true});state.webrtc=null;state.prewarmNames=null}scheduleIcePrewarm("pilot-change")}
});
document.addEventListener("pointerdown",event=>{
 if(els.headerMenu.open&&!els.headerMenu.contains(event.target))els.headerMenu.open=false;
});
document.addEventListener("keydown",event=>{
 if(event.key==="Escape"&&els.headerMenu.open){els.headerMenu.open=false;els.headerMenu.querySelector("summary").focus()}
});
function openContactScreen(item){
 const peer=item.dataset.peer;
 els.peer.value=peer;
 els.peer.dispatchEvent(new Event("change",{bubbles:true}));
 const avatar=item.querySelector(".contact-avatar");
 const name=item.querySelector(".contact-list-name");
 els.contactScreenAvatar.textContent=avatar?.textContent||"?";
 els.contactScreenAvatar.style.backgroundColor=avatar?.style.backgroundColor||"var(--accent)";
 els.contactScreenName.textContent=name?.textContent||"Контакт";
 els.contactScreen.classList.remove("hidden");
 document.body.classList.add("contact-screen-open");
 els.contactScreenBack.focus();
}
function closeContactEditScreen(){
 els.contactEditScreen.classList.add("hidden");
 els.contactScreenMenu.open=false;
 els.contactScreenBack.focus();
}
function openContactEditScreen(){
 if(els.openContactEdit.classList.contains("hidden"))return;
 els.contactScreenMenu.open=false;
 els.contactEditScreen.classList.remove("hidden");
 els.editContactName.focus();
}
function closeContactDeleteScreen(){
 els.contactDeleteScreen.classList.add("hidden");
 els.contactScreenMenu.open=false;
 els.contactScreenBack.focus();
}
function openContactDeleteScreen(){
 if(els.openContactDelete.classList.contains("hidden"))return;
 els.contactScreenMenu.open=false;
 els.contactDeleteName.textContent=els.contactScreenName.textContent||"Контакт";
 els.contactDeleteScreen.classList.remove("hidden");
 els.contactDeleteScreenBack.focus();
}
function closeContactScreen(){
 els.contactEditScreen.classList.add("hidden");
 els.contactDeleteScreen.classList.add("hidden");
 els.contactScreen.classList.add("hidden");
 document.body.classList.remove("contact-screen-open");
 els.contactScreenMenu.open=false;
}
els.contactList.addEventListener("click",event=>{
 const item=event.target.closest(".contact-list-item[data-peer]");
 if(!item||!els.contactList.contains(item))return;
 openContactScreen(item);
});
els.contactScreenBack.addEventListener("click",closeContactScreen);
els.contactScreenCall.addEventListener("click",()=>els.connect.click());
els.openContactEdit.addEventListener("click",openContactEditScreen);
els.openContactDelete.addEventListener("click",openContactDeleteScreen);
els.contactEditScreenBack.addEventListener("click",closeContactEditScreen);
els.contactDeleteScreenBack.addEventListener("click",closeContactDeleteScreen);
els.cancelDeleteContact.addEventListener("click",closeContactDeleteScreen);
document.addEventListener("keydown",event=>{
 if(event.key!=="Escape")return;
 if(!els.contactDeleteScreen.classList.contains("hidden"))closeContactDeleteScreen();
 else if(!els.contactEditScreen.classList.contains("hidden"))closeContactEditScreen();
 else if(!els.contactScreen.classList.contains("hidden"))closeContactScreen();
});
els.peer.addEventListener("change",()=>{
 els.editContactName.value=els.peer.selectedOptions[0]?.textContent||"";
 originalEditContactName=els.editContactName.value.trim();
 updateReplyInviteStatus();
 updateCallButtons();
 const peer=els.peer.value;
 for(const item of els.contactList.querySelectorAll(".contact-list-item"))item.setAttribute("aria-pressed",String(item.dataset.peer===peer));
 if(state.incomingCall&&peer!==state.secure?.peer)dismissIncoming(false);
 if(state.secure&&!state.secure.active&&!state.connecting){
  const me=state.me;
  state.secure.setPeer(NtfySecureSignaling.validUserId(peer)&&peer!==me?peer:"");
 }
 scheduleIcePrewarm("input");
});
setInterval(()=>scheduleIcePrewarm("periodic",true),30000);
document.addEventListener("visibilitychange",()=>{
 if(!document.hidden)scheduleIcePrewarm("visibility",true);
});
window.addEventListener("online",()=>scheduleIcePrewarm("online",true));
els.confirm.addEventListener("click",async()=>{
 els.confirm.disabled=true;
 try{await state.secure.confirmPeer();els.verify.classList.add("hidden");debug("Первичная проверка подтверждена пользователем.")}
 catch(e){showError(e.message);els.confirm.disabled=false}
});
els.hangup.addEventListener("click",hangup);
els.confirmDeleteContact.addEventListener("click",deleteSelectedContact);
els.saveContactName.addEventListener("click",saveSelectedContactName);
els.editContactName.addEventListener("input",updateCallButtons);
els.tcp.classList.add("hidden");
try{els.pilot.checked=localStorage.getItem("vl.simulateMicrophone.v1")==="1"}catch{els.pilot.checked=false}
els.dismissIncoming.classList.add("hidden");
async function initializeApp(){
 try{
  // Remove obsolete extractable legacy keys; the active identity and trust records live in IndexedDB.
  try{
   for(let i=localStorage.length-1;i>=0;i--){
    const key=localStorage.key(i);
    if(key?.startsWith("vl.identity.v1.")||key?.startsWith("vl.peer.v1."))localStorage.removeItem(key);
   }
  }catch(error){debug("Не удалось очистить устаревшие локальные ключи: "+(error.message||String(error)));}
  const identity=await getCurrentSignalingIdentity();
  state.me=identity.user_id;
  await refreshContactOptions();
  const savedInvitation=await getMyInvitation();
  if(savedInvitation){
   els.inviteUrl.value=savedInvitation;
   updateInviteCopyButton();
   if("Notification" in window&&Notification.permission==="granted"){
    try{
     await ensureQrCodeLibrary();
     new window.QRCode(els.inviteQr,{text:savedInvitation,width:220,height:220,colorDark:"#101827",colorLight:"#ffffff",correctLevel:window.QRCode.CorrectLevel.M});
     setInlineStatus(els.inviteStatus,"");
    }catch(qrError){
     setInlineStatus(els.inviteStatus,"Ссылка-приглашение восстановлена; QR-код пока недоступен.",true);
    }
   }
  }
  initializeOneSignal().then(async()=>{
   debug("OneSignal Web Push SDK инициализирован.");
   if("Notification" in window&&Notification.permission==="granted")await createContactInvitation();
  }).catch(error=>debug("OneSignal пока недоступен: "+(error.message||String(error))));
  const fragment=new URLSearchParams(window.location.hash.slice(1));
  if(fragment.has("contact")){els.contactPackage.value=window.location.hash;els.contactTools.open=true;els.qrStatus.textContent="Получена ссылка-приглашение. Укажите локальное имя контакта и проверьте пакет.";}
  const contacts=await listContacts();
  els.debugUrl.textContent="https://ntfy.sh/ · "+state.me.slice(0,12)+"…";
  setStatus("Локальная идентичность готова",contacts.length?"Выберите контакт для звонка.":"Сохранённых контактов пока нет.","idle");
  await subscribeForUser(state.me);
 }catch(error){
  showError("Не удалось инициализировать приложение: "+(error.message||String(error)));
  setStatus("Ошибка локального хранилища","Проверьте поддержку IndexedDB и Web Crypto.","error");
 }
}
els.tcp.classList.add("hidden");
try{els.pilot.checked=localStorage.getItem("vl.simulateMicrophone.v1")==="1"}catch{els.pilot.checked=false}
els.dismissIncoming.classList.add("hidden");
initializeApp();
scheduleIcePrewarm();
