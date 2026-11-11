import { WebRtcAudio } from "./webrtc.js?v=28";
import { NtfySecureSignaling } from "./ntfy-signaling.js?v=49";
import { getCurrentSignalingIdentity, getNtfyTopic } from "./ntfy-identity.js?v=3";
import { listContacts, getContact, saveContact, updateContact, deleteContact, saveMyInvitation, getMyInvitation, createIssuedInvitation, getIssuedInvitation, listIssuedInvitations, consumeIssuedInvitation, addConversationEvent, listConversationEvents } from "./local-store.js?v=12";
import { INVITATION_FORMAT_VERSION, verifyContactPackage, createContactRequestEnvelope } from "./contact-exchange.js?v=12";
import { initializeOneSignal, enableOneSignalPush } from "./onesignal.js?v=5";
import { sendPushEventToContact } from "./push-api.js?v=3";

const $=id=>document.getElementById(id);
const els={
 contactList:$("contacts-list"),appNotice:$("app-notice"),ntfyStatus:$("ntfy-status"),renderStatus:$("render-status"),serviceWorkerStatus:$("service-worker-status"),webPushStatus:$("web-push-status"),profileDockButton:$("profile-dock-button"),profileDockLabel:$("profile-dock-label"),profileScreen:$("profile-screen"),profileScreenBack:$("profile-screen-back"),diagnosticDockButton:$("diagnostic-dock-button"),contactDiagnosticButton:$("contact-diagnostic-button"),contactDiagnosticsFooter:$("contact-diagnostics-footer"),debugMode:$("debug-mode"),diagnosticScreen:$("diagnostic-screen"),diagnosticScreenBack:$("diagnostic-screen-back"),addContactFab:$("add-contact-fab"),addContactScreen:$("add-contact-screen"),addContactScreenBack:$("add-contact-screen-back"),firstContactWelcome:$("first-contact-welcome"),contactListItems:$("contacts-list-items"),contactSearch:$("contact-search"),contactSearchClear:$("contact-search-clear"),contactListEmpty:$("contacts-list-empty"),contactsCount:$("contacts-count"),contactScreen:$("contact-screen"),contactScreenBack:$("contact-screen-back"),contactScreenHeader:$("contact-screen-header"),contactScreenHeaderPlaceholder:$("contact-screen-header-placeholder"),callScreen:$("call-screen"),callScreenHeaderSlot:$("call-screen-header-slot"),callScreenDiagnosticsSlot:$("call-screen-diagnostics-slot"),contactDiagnosticsPlaceholder:$("contact-diagnostics-placeholder"),contactScreenAvatar:$("contact-screen-avatar"),contactScreenName:$("contact-screen-name"),contactScreenCall:$("contact-screen-call"),callError:$("call-error-message"),answerIncoming:$("answer-incoming"),contactScreenMenu:$("contact-screen-menu"),openContactEdit:$("open-contact-edit"),openContactDelete:$("open-contact-delete"),contactEditScreen:$("contact-edit-screen"),contactEditScreenBack:$("contact-edit-screen-back"),contactDeleteScreen:$("contact-delete-screen"),contactDeleteScreenBack:$("contact-delete-screen-back"),contactDeleteName:$("contact-delete-name"),confirmDeleteContact:$("confirm-delete-contact"),cancelDeleteContact:$("cancel-delete-contact"),privacyHelp:$("privacy-help"),headerMenu:$("header-menu"),openAboutScreen:$("open-about-screen"),openSettingsScreen:$("open-settings-screen"),aboutScreen:$("about-screen"),aboutScreenBack:$("about-screen-back"),settingsScreen:$("settings-screen"),settingsScreenBack:$("settings-screen-back"),peer:$("peer-contact"),connect:$("connect"),dismissIncoming:$("dismiss-incoming"),rejectIncoming:$("reject-incoming"),deletePeer:$("delete-peer"),contactEditTools:$("contact-edit-tools"),editContactName:$("edit-contact-name"),saveContactName:$("save-contact-name"),indicator:$("connection-indicator"),
 statusIcon:$("status-icon"),statusTitle:$("status-title"),statusText:$("status-text"),
 transport:$("transport-label"),tcp:$("tcp-fallback"),hangup:$("hangup"),
 audio:$("remote-audio"),pilot:$("diagnostic-pilot"),error:$("error-message"),debugLog:$("debug-log"),swDebugLog:$("sw-debug-log"),
 copyDebugLog:$("copy-debug-log"),copySwDebugLog:$("copy-sw-debug-log"),debugUrl:$("debug-url"),debugState:$("debug-state"),oneSignalStatus:$("onesignal-status"),
  contactTools:$("contact-tools"),contactPackage:$("contact-package"),pasteContact:$("paste-contact"),contactName:$("contact-name"),responseDisplayName:$("response-display-name"),saveResponseDisplayName:$("save-response-display-name"),responseDisplayNameSection:$("response-display-name-section"),importContact:$("import-contact"),scanQr:$("scan-qr"),qrVideo:$("qr-video"),qrStatus:$("qr-status"),profileDisplayName:$("profile-display-name"),inviteTools:$("invite-tools"),invitePermission:$("invite-permission"),inviteContent:$("invite-content"),inviteStatus:$("invite-status"),createInvite:$("create-invite"),inviteUrl:$("invite-url"),copyInvite:$("copy-invite"),copyInviteInline:$("copy-invite-inline"),inviteQr:$("invite-qr"),replyInvite:$("reply-contact-invite"),replyInviteStatus:$("reply-contact-invite-status"),contactRequestText:$("contact-request-detail-text"),contactRequestReceivedAge:$("contact-request-received-age"),contactRequestAge:$("contact-request-age"),contactRequestActions:$("contact-request-actions"),acceptContactRequest:$("accept-contact-request"),declineContactRequest:$("decline-contact-request"),chatEvents:$("chat-events"),chatComposer:$("chat-composer"),chatMessage:$("chat-message"),sendChatMessage:$("send-chat-message")
};
window.voicelinkIsReadingChat=senderId=>
 document.visibilityState==="visible"&&
 !els.contactScreen.classList.contains("hidden")&&
 els.callScreen.classList.contains("hidden")&&
 els.profileScreen.classList.contains("hidden")&&
 els.diagnosticScreen.classList.contains("hidden")&&
 els.addContactScreen.classList.contains("hidden")&&
 els.aboutScreen.classList.contains("hidden")&&
 els.settingsScreen.classList.contains("hidden")&&
 els.contactEditScreen.classList.contains("hidden")&&
 els.contactDeleteScreen.classList.contains("hidden")&&
 els.peer.value===senderId;
const PROFILE_DISPLAY_NAME_KEY="vl.profileDisplayName.v1";
function getProfileDisplayName(){return String(els.profileDisplayName.value||"").trim().slice(0,60)}
let profileInviteRefreshTimer=null;
let profileInviteRevision=0;
let profileInviteDirty=false;
let profileInviteRefreshPromise=null;
async function refreshProfileInvitationIfNeeded(){
 if(!profileInviteDirty)return true;
 if(profileInviteRefreshTimer!==null){clearTimeout(profileInviteRefreshTimer);profileInviteRefreshTimer=null;}
 const revision=profileInviteRevision;
 if(profileInviteRefreshPromise){
  await profileInviteRefreshPromise;
  if(!profileInviteDirty)return true;
  if(revision!==profileInviteRevision)return refreshProfileInvitationIfNeeded();
 }
 if(!("Notification" in window)||Notification.permission!=="granted"){
  setInlineStatus(els.inviteStatus,"Чтобы обновить приглашение с новым именем, разрешите push-уведомления.",true);
  return false;
 }
 const displayName=getProfileDisplayName();
 const promise=createContactInvitation({focusResult:false,expectedRevision:revision}).then(updated=>{
  if(updated&&revision===profileInviteRevision&&displayName===getProfileDisplayName()){
   profileInviteDirty=false;
   setInlineStatus(els.inviteStatus,displayName?"Имя сохранено. Ссылка и QR-код приглашения обновлены.":"Имя удалено. Ссылка и QR-код приглашения обновлены.");
   return true;
  }
  return false;
 }).finally(()=>{if(profileInviteRefreshPromise===promise)profileInviteRefreshPromise=null;});
 profileInviteRefreshPromise=promise;
 const updated=await promise;
 if(!updated&&profileInviteDirty&&revision!==profileInviteRevision)return refreshProfileInvitationIfNeeded();
 return updated;
}
function handleProfileDisplayNameInput(){
 persistProfileDisplayName();
 profileInviteRevision++;
 profileInviteDirty=true;
 if(profileInviteRefreshTimer!==null)clearTimeout(profileInviteRefreshTimer);
 profileInviteRefreshTimer=null;
 if("Notification" in window&&Notification.permission==="granted"){
  profileInviteRefreshTimer=window.setTimeout(()=>{profileInviteRefreshTimer=null;refreshProfileInvitationIfNeeded();},500);
 }
}
function persistProfileDisplayName(){
 const value=getProfileDisplayName();
 try{if(value)localStorage.setItem(PROFILE_DISPLAY_NAME_KEY,value);else localStorage.removeItem(PROFILE_DISPLAY_NAME_KEY)}
 catch(error){debug("Не удалось сохранить имя профиля: "+(error.message||String(error)))}
 return value;
}
try{els.profileDisplayName.value=localStorage.getItem(PROFILE_DISPLAY_NAME_KEY)||""}catch{els.profileDisplayName.value=""}
let qrStream=null,qrScanActive=false;
let originalEditContactName="";
const CONTACT_REQUESTS_KEY="vl.contactRequestsSent.v1";
const CONTACT_RESPONSE_INVITATIONS_KEY="vl.contactResponseInvitations.v1";
function loadContactResponseInvitations(){
 try{
  const value=JSON.parse(localStorage.getItem(CONTACT_RESPONSE_INVITATIONS_KEY)||"{}");
  return value&&typeof value==="object"&&!Array.isArray(value)?value:{};
 }catch{return {}}
}
const contactResponseInvitations=loadContactResponseInvitations();
function persistContactResponseInvitations(){
 try{localStorage.setItem(CONTACT_RESPONSE_INVITATIONS_KEY,JSON.stringify(contactResponseInvitations))}
 catch(error){debug("Не удалось сохранить идентификатор ответного приглашения: "+(error.message||String(error)))}
}
function rememberContactResponseInvitation(userId,invitationId,createdAt){
 contactResponseInvitations[userId]={invitation_id:invitationId,created_at:Number(createdAt)||Date.now()};
 persistContactResponseInvitations();
}
async function findReusableContactResponseInvitation(userId){
 const remembered=contactResponseInvitations[userId];
 if(remembered?.invitation_id){
  const record=await getIssuedInvitation(remembered.invitation_id);
  if(record&&!record.revoked)return record;
  delete contactResponseInvitations[userId];
  persistContactResponseInvitations();
 }
 // Older versions stored only the successful-send timestamp. Match it to
 // the invitation record created immediately before that POST.
 const sentAt=Number(sentContactRequests[userId]);
 if(Number.isFinite(sentAt)&&sentAt>0){
  const records=await listIssuedInvitations();
  const candidates=records
   .filter(record=>!record.revoked&&Math.abs(Number(record.created_at)-sentAt)<=120000)
   .sort((a,b)=>Math.abs(Number(a.created_at)-sentAt)-Math.abs(Number(b.created_at)-sentAt));
  if(candidates.length&&
     (candidates.length===1||
      Math.abs(Number(candidates[0].created_at)-sentAt)<Math.abs(Number(candidates[1].created_at)-sentAt))){
   rememberContactResponseInvitation(userId,candidates[0].id,candidates[0].created_at);
   return candidates[0];
  }
 }
 throw Error("Не удалось однозначно найти ранее отправленное ответное приглашение на этом устройстве. Старое приглашение не заменено.");
}
const CONTACT_REPLY_FAILURES_KEY="vl.contactReplyFailures.v1";
function loadContactReplyFailures(){
 try{const value=JSON.parse(localStorage.getItem(CONTACT_REPLY_FAILURES_KEY)||"[]");return new Set(Array.isArray(value)?value.filter(id=>NtfySecureSignaling.validUserId(id)):[])}
 catch{return new Set()}
}
const contactReplyFailures=loadContactReplyFailures();
function setContactReplyFailure(userId,failed){
 if(!NtfySecureSignaling.validUserId(userId))return;
 if(failed)contactReplyFailures.add(userId);else contactReplyFailures.delete(userId);
 try{localStorage.setItem(CONTACT_REPLY_FAILURES_KEY,JSON.stringify([...contactReplyFailures]))}
 catch(error){debug("Не удалось сохранить статус ответного приглашения: "+(error.message||String(error)))}
 if(typeof allContacts!=="undefined"&&allContacts.length)renderContactList(allContacts);
 if(els.peer.value===userId)updateCallButtons();
}

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
 if(!NtfySecureSignaling.validUserId(userId))return;
 let changed=false;
 if(!completedContactRequests.has(userId)){
  completedContactRequests.add(userId);
  persistConfirmedContactRequests();
  changed=true;
 }
 if(Object.prototype.hasOwnProperty.call(sentContactRequests,userId)){
  delete sentContactRequests[userId];
  persistSentContactRequests();
  changed=true;
 }
 if(els.peer.value===userId){
  updateReplyInviteStatus();
  updateCallButtons();
 }
 if(changed)debug("Получено корректно аутентифицированное сообщение от контакта; обмен приглашениями подтверждён.");
}
function loadSentContactRequests(){
 try{const value=JSON.parse(localStorage.getItem(CONTACT_REQUESTS_KEY)||"{}");return value&&typeof value==="object"&&!Array.isArray(value)?value:{}}
 catch{return {}}
}
const sentContactRequests=loadSentContactRequests();
function persistSentContactRequests(){
 try{localStorage.setItem(CONTACT_REQUESTS_KEY,JSON.stringify(sentContactRequests))}
 catch(error){debug("Не удалось сохранить историю отправки приглашения: "+(error.message||String(error)))}
}
function markContactRequestSent(userId,invitationId,createdAt){
 sentContactRequests[userId]=Date.now();
 if(invitationId)rememberContactResponseInvitation(userId,invitationId,createdAt);
 persistSentContactRequests();
}
function clearSentContactRequest(userId){
 let changed=false;
 if(Object.prototype.hasOwnProperty.call(contactResponseInvitations,userId)){
  delete contactResponseInvitations[userId];
  persistContactResponseInvitations();
 }
 if(Object.prototype.hasOwnProperty.call(sentContactRequests,userId)){delete sentContactRequests[userId];changed=true}
 if(completedContactRequests.delete(userId)){persistConfirmedContactRequests();changed=true}
 if(changed)persistSentContactRequests();
}
function updateReplyInviteStatus(){
 const peer=els.peer.value;
 const wasSent=!!sentContactRequests[peer]&&!completedContactRequests.has(peer);
 setInlineStatus(els.replyInviteStatus,wasSent?"Ответное приглашение этому контакту уже отправлялось. При необходимости его можно послать ещё раз.":"");
}
const state={secure:null,webrtc:null,role:null,peerPresent:false,connecting:false,hangingUp:false,disconnectTimer:null,callStarted:false,answeringCall:false,editingName:false,incomingCall:false,incomingTimer:null,callTimer:null,outgoingCall:false,outgoingCallExpiresAt:null,ringingKind:null,ringContext:null,ringPulseTimer:null,ringOscillators:[],callReturnSnapshot:null};
let diagnosticReportStartedPerf=null;
const diagnosticLogAutoFollow={main:true,serviceWorker:true};
function scrollDiagnosticLogToBottom(element){
 if(element)element.scrollTop=element.scrollHeight;
}
function disableDiagnosticLogAutoFollow(){
 diagnosticLogAutoFollow.main=false;
 diagnosticLogAutoFollow.serviceWorker=false;
}
for(const logElement of [els.debugLog,els.swDebugLog]){
 if(!logElement)continue;
 for(const eventName of ["wheel","touchstart","pointerdown","keydown"]){
  logElement.addEventListener(eventName,disableDiagnosticLogAutoFollow,{passive:eventName!=="keydown"});
 }
}
function resetDiagnosticLogAutoFollow(){
 diagnosticLogAutoFollow.main=true;
 diagnosticLogAutoFollow.serviceWorker=true;
 requestAnimationFrame(()=>{
  scrollDiagnosticLogToBottom(els.debugLog);
  scrollDiagnosticLogToBottom(els.swDebugLog);
 });
}
function formatDiagnosticLogTimestamp(date,elapsedMs){
 const time=date.toLocaleTimeString("ru-RU",{hour12:false});
 return "["+time+"."+String(date.getMilliseconds()).padStart(3,"0")+" (+"+(Math.max(0,elapsedMs)/1000).toFixed(3)+"s)]";
}
async function copyDiagnosticLog(element,button){
 const value=element?.textContent?.trim();
 if(!value)return;
 const copiedAt=new Date().toLocaleString("ru-RU",{year:"numeric",month:"2-digit",day:"2-digit",hour:"2-digit",minute:"2-digit",second:"2-digit",hour12:false});
 const elapsedMs=Math.max(0,Math.round(performance.now()));
 const elapsedSeconds=Math.floor(elapsedMs/1000);
 const elapsedSinceStart="+"+String(Math.floor(elapsedSeconds/3600)).padStart(2,"0")+":"+String(Math.floor((elapsedSeconds%3600)/60)).padStart(2,"0")+":"+String(elapsedSeconds%60).padStart(2,"0")+"."+String(elapsedMs%1000).padStart(3,"0");
 const textToCopy="\n"+value+"\n(Скопировано: "+copiedAt+"; с запуска: "+elapsedSinceStart+")\n\n";
 try{
  if(navigator.clipboard?.writeText){
   await navigator.clipboard.writeText(textToCopy);
  }else{
   const temporary=document.createElement("textarea");
   temporary.value=textToCopy;
   temporary.setAttribute("readonly","");
   temporary.style.position="fixed";temporary.style.opacity="0";
   document.body.appendChild(temporary);temporary.select();
   const copied=document.execCommand("copy");temporary.remove();
   if(!copied)throw Error("Копирование не поддерживается браузером.");
  }
  const original=button.textContent;
  button.textContent="Скопировано";
  button.disabled=true;
  window.setTimeout(()=>{button.textContent=original;button.disabled=false},1200);
 }catch(error){
  debug("Не удалось скопировать журнал: "+(error.message||String(error)));
 }
}
function debug(message){
 const now=new Date();
 const perfNow=performance.now();
 if(diagnosticReportStartedPerf===null){
  diagnosticReportStartedPerf=perfNow;
  if(els.debugLog.textContent==="Ожидаем подключения. Здесь появятся события защищённого канала.")els.debugLog.textContent="";
 }
 const timestamp=formatDiagnosticLogTimestamp(now,perfNow-diagnosticReportStartedPerf);
 els.debugLog.textContent=(els.debugLog.textContent+"\n"+timestamp+" "+message).trim();
 if(diagnosticLogAutoFollow.main)scrollDiagnosticLogToBottom(els.debugLog);
}
window.addEventListener("voicelink:onesignal-status",event=>{
 if(els.oneSignalStatus&&event.detail?.text)els.oneSignalStatus.textContent=event.detail.text;
 updateWebPushStatus();
});
function setStatus(title,text,kind="idle"){
 els.statusTitle.textContent=title;els.statusText.textContent=text;
 els.indicator.className="status-pill status-"+kind;
 els.indicator.textContent=({idle:"Не подключено",wait:"Ожидание",live:"На связи",error:"Проблема"})[kind]||kind;
 els.statusIcon.textContent=kind==="live"?"♫":kind==="error"?"!":"⌁";
}
function showError(message){
 const target=els.callScreen&&!els.callScreen.classList.contains("hidden")?els.callError:els.error;
 target.textContent=message;target.classList.remove("hidden");debug("ОШИБКА: "+message);
}
function clearError(){
 for(const target of [els.error,els.callError])if(target){target.textContent="";target.classList.add("hidden")}
}
function clearInlineStatus(element){element.textContent="";element.classList.remove("hint-error")}
function setInlineStatus(element,message,isError=false){
 const screen=element.closest('[role="dialog"]');
 if(screen?.classList.contains("hidden"))return false;
 element.textContent=message;element.classList.toggle("hint-error",isError);return true;
}
let appNoticeTimer=null;
function showAppNotice(message,isError=false){
 if(!els.appNotice)return;
 if(appNoticeTimer!==null)clearTimeout(appNoticeTimer);
 els.appNotice.textContent=message;
 els.appNotice.classList.toggle("hint-error",isError);
 els.appNotice.classList.remove("hidden");
 appNoticeTimer=window.setTimeout(()=>{els.appNotice.classList.add("hidden");els.appNotice.textContent="";appNoticeTimer=null},10000);
}
function setServiceStatus(element,message){if(element)element.textContent=message}
function updateWebPushStatus(){
 const permission="Notification" in window?Notification.permission:"unsupported";
 const label=permission==="granted"?"Разрешены":permission==="denied"?"Запрещены":permission==="default"?"Ожидают разрешения":"Не поддерживается";
 setServiceStatus(els.webPushStatus,label);
}
async function checkPushBackendAvailability(){
 const url="https://signal-backend-9tai.onrender.com/health";
 const started=performance.now(),wasOnline=navigator.onLine,visibility=document.visibilityState;
 setServiceStatus(els.renderStatus,"Проверяем доступность…");
 const controller=new AbortController(),timeout=window.setTimeout(()=>controller.abort(),25000);
 let timedOut=false;const timer=window.setTimeout(()=>{timedOut=true},25000);
 try{
  const response=await fetch(url,{method:"GET",cache:"no-store",signal:controller.signal});
  const elapsed=Math.round(performance.now()-started);
  const body=(await response.text()).slice(0,160);
  debug(`[backend-health] HTTP ${response.status}; elapsed=${elapsed}ms; online(before)=${wasOnline}; visibility=${visibility}; content-type=${response.headers.get("content-type")||"n/a"}; body=${body||"(empty)"}.`);
  if(!response.ok)throw Error("HTTP "+response.status);
  setServiceStatus(els.renderStatus,"Доступен");
 }catch(error){
  const elapsed=Math.round(performance.now()-started);
  setServiceStatus(els.renderStatus,error.name==="AbortError"?"Нет ответа (тайм-аут)":"Недоступен");
  debug(`[backend-health] FAILED; elapsed=${elapsed}ms; error.name=${error.name||"unknown"}; error.message=${error.message||String(error)}; abortTimerFired=${timedOut}; online(before/after)=${wasOnline}/${navigator.onLine}; visibility(before/after)=${visibility}/${document.visibilityState}; urlHost=signal-backend-9tai.onrender.com. NetworkError в браузере не позволяет отличить DNS/TLS/CORS/сброс соединения — фиксируем только доступные признаки.`);
 }finally{clearTimeout(timeout);clearTimeout(timer)}
}
async function checkServiceWorkerAvailability(){
 if(!("serviceWorker" in navigator)){setServiceStatus(els.serviceWorkerStatus,"Не поддерживается");return}
 try{
  const registration=await navigator.serviceWorker.getRegistration("/");
  setServiceStatus(els.serviceWorkerStatus,registration?.active?"Активен":registration?"Зарегистрирован, запускается":"Не зарегистрирован");
 }catch(error){setServiceStatus(els.serviceWorkerStatus,"Ошибка проверки")}
}
function updateCallButtons(){
 const active=!!(state.peerPresent||state.outgoingCall||state.secure?.active||state.callStarted||state.answeringCall);
 els.contactScreenBack.disabled=!els.callScreen.classList.contains("hidden");
 els.connect.classList.toggle("hidden",active);
 els.connect.disabled=active||state.connecting;
 els.connect.textContent=state.connecting?"Подключаемся…":state.incomingCall?"Ответить":"Подключиться";
 els.hangup.classList.toggle("hidden",!active);
 els.hangup.disabled=!active||state.hangingUp;
 els.answerIncoming.disabled=state.connecting;
 els.dismissIncoming.disabled=state.connecting;
 const selectedPeer=NtfySecureSignaling.validUserId(els.peer.value)&&els.peer.value!==state.me;
 const callBlocked=!state.incomingCall&&(!selectedPeer||contactReplyFailures.has(els.peer.value));
 els.contactScreenCall.disabled=active||state.connecting||callBlocked;
 els.contactScreenCall.setAttribute("aria-label",state.incomingCall?"Ответить на звонок":callBlocked?"Позвонить — ответное приглашение не отправлено":"Позвонить");
 els.contactScreenCall.title=state.incomingCall?"Ответить на звонок":contactReplyFailures.has(els.peer.value)?"Ответное приглашение не отправлено":active||state.connecting?"Звонок уже устанавливается или идёт":"Позвонить";
 if(els.chatMessage)updateChatComposerState();
 const selectedContact=allContacts.find(contact=>contact.user_id===els.peer.value);
 const pendingRequest=selectedContact?.request_pending===true;
 els.contactScreenCall.classList.toggle("hidden",pendingRequest);
 els.contactRequestActions.classList.toggle("hidden",!pendingRequest);
 els.contactRequestText.textContent=pendingRequest
  ?"Этот человек воспользовался вашим приглашением. Добавьте его в контакты, когда будете готовы. После добавления вы сможете звонить ему. Если отклонить запрос, контакт не будет добавлен, и звонки между вами будут невозможны."
  :"";
 const requestReceivedAt=Date.parse(selectedContact?.request_received_at||"");
 const hasRequestReceivedAt=pendingRequest&&Number.isFinite(requestReceivedAt)&&requestReceivedAt>0;
 els.contactRequestReceivedAge.textContent=hasRequestReceivedAt
  ?"Запрос на добавление получен "+formatInvitationAge(requestReceivedAt)+"."
  :"";
 els.contactRequestReceivedAge.classList.toggle("hidden",!hasRequestReceivedAt);
 const invitationCreatedAt=Number(selectedContact?.invitation_created_at);
 const hasInvitationDate=pendingRequest&&Number.isFinite(invitationCreatedAt)&&invitationCreatedAt>0;
 els.contactRequestAge.textContent=hasInvitationDate
  ?"Ваше приглашение, которым он воспользовался, создано "+formatInvitationAge(invitationCreatedAt)+"."
  :"";
 els.contactRequestAge.classList.toggle("hidden",!hasInvitationDate);
 els.contactEditTools.classList.toggle("hidden",!selectedPeer);
 els.openContactEdit.classList.toggle("hidden",!selectedPeer);
 els.openContactDelete.classList.toggle("hidden",!selectedPeer||pendingRequest);
 els.confirmDeleteContact.disabled=!selectedPeer||state.connecting||state.callStarted||state.peerPresent||state.outgoingCall||state.incomingCall;
 els.saveContactName.disabled=!selectedPeer||state.connecting||state.callStarted||state.peerPresent||state.outgoingCall||state.incomingCall||!els.editContactName.value.trim()||els.editContactName.value.trim()===originalEditContactName;
 const exchangeCompleted=selectedPeer&&completedContactRequests.has(els.peer.value);
 els.replyInvite.classList.toggle("hidden",!selectedPeer||exchangeCompleted);
 els.replyInvite.querySelector(".contact-menu-label").textContent=sentContactRequests[els.peer.value]&&!completedContactRequests.has(els.peer.value)?"Послать ответное приглашение ещё раз":"Послать ответное приглашение";
 els.replyInvite.disabled=!selectedPeer||state.connecting||state.callStarted||state.peerPresent||state.outgoingCall||state.incomingCall;
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
  if(!AudioContextClass){debug("[ring] Web Audio API недоступен при разблокировке.");return}
  if(!state.ringContext)state.ringContext=new AudioContextClass();
  const context=state.ringContext;
  if(context.state==="suspended"){
   debug("[ring] пользовательское действие: пробуем разблокировать AudioContext; visibility="+document.visibilityState+".");
   context.resume().then(()=>debug("[ring] AudioContext после пользовательского действия: "+context.state+".")).catch(error=>debug("[ring] resume после пользовательского действия отклонён: "+(error.message||String(error))));
  }
 }catch(error){debug("[ring] ошибка подготовки AudioContext: "+(error.message||String(error)))}
}
async function startRinging(kind){
 stopRinging();state.ringingKind=kind;
 try{
  const AudioContextClass=window.AudioContext||window.webkitAudioContext;
  if(!AudioContextClass)throw Error("Web Audio API недоступен");
  if(!state.ringContext)state.ringContext=new AudioContextClass();
  if(!state.ringContext.__vlStateLogger){
   state.ringContext.__vlStateLogger=true;
   state.ringContext.addEventListener("statechange",()=>debug("[ring] AudioContext statechange: "+state.ringContext.state+"."));
  }
  debug("[ring] start kind="+kind+"; AudioContext="+state.ringContext.state+"; visibility="+document.visibilityState+"; notificationPermission="+(window.Notification?.permission||"unsupported")+".");
  if(state.ringContext.state==="suspended"){
   debug("[ring] AudioContext suspended: запрашиваем resume; incoming UI уже показан.");
   await state.ringContext.resume();
  }
  if(state.ringingKind!==kind){debug("[ring] запуск отменён: тип звонка уже изменился.");return}
  if(state.ringContext.state!=="running"){debug("[ring] мелодия не запущена: AudioContext="+state.ringContext.state+"; браузер заблокировал воспроизведение.");return}
  debug("[ring] AudioContext running; запускаем мелодию.");
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
   if(kind==="incoming")debug("[ring] входная мелодия запущена; следующий повтор через 3.2s.");
  };
  pulse();
 }catch(error){debug("[ring] не удалось включить звук звонка: "+(error.message||String(error))+"; AudioContext="+(state.ringContext?.state||"нет")+".");}
}
function clearIncomingUi(){
 if(state.incomingTimer){clearTimeout(state.incomingTimer);state.incomingTimer=null}
 state.incomingCall=false;els.answerIncoming.classList.add("hidden");els.dismissIncoming.classList.add("hidden");els.rejectIncoming.classList.add("hidden");updateCallButtons();
}
function showIncomingCall({peer,peerId,expiresAt}){
 if(state.connecting||state.callStarted||state.incomingCall)return;
 const remaining=Math.max(0,expiresAt-Date.now());
 if(!remaining)return;
 const returnSnapshot=captureCallReturnState();
 if(peerId&&NtfySecureSignaling.validUserId(peerId))els.peer.value=peerId;
 if(state.outgoingCall){
  if(state.secure?.role!=="A"||state.secure?.hello)return;
  stopOutgoingCall();
  debug("Одновременный вызов: роль A принимает входящий запрос; исходящий запрос отменён локально.");
 }
 state.incomingCall=true;state.callReturnSnapshot=returnSnapshot;els.answerIncoming.classList.remove("hidden");els.dismissIncoming.classList.remove("hidden");els.rejectIncoming.classList.remove("hidden");
 const incomingItem=Array.from(els.contactList.querySelectorAll(".contact-list-item[data-peer]")).find(item=>item.dataset.peer===els.peer.value);
 if(incomingItem)openContactScreen(incomingItem,true);
 else openContactScreen({dataset:{peer:els.peer.value},querySelector:()=>null},true);
 openCallScreen();
 updateCallButtons();
 const peerLabel=els.peer.selectedOptions[0]?.textContent||"контакт";
 setStatus("Входящий вызов","Вам звонит "+peerLabel+". Нажмите «Ответить», «Отклонить» или «Скрыть вызов».","wait");
 debug("Входящий вызов от "+peerLabel+".");
 startRinging("incoming");
 state.incomingTimer=setTimeout(()=>dismissIncoming(true),remaining);
}
function stopOutgoingCall(){
 if(state.callTimer){clearTimeout(state.callTimer);state.callTimer=null}
 state.outgoingCall=false;state.outgoingCallExpiresAt=null;stopRinging();
}
function scheduleOutgoingCallExpiry(){
 if(state.callTimer){clearTimeout(state.callTimer);state.callTimer=null}
 if(!state.outgoingCall||!Number.isFinite(state.outgoingCallExpiresAt))return;
 const remaining=state.outgoingCallExpiresAt-Date.now();
 if(remaining<=0){finishNoAnswer();return}
 state.callTimer=window.setTimeout(()=>{
  state.callTimer=null;
  scheduleOutgoingCallExpiry();
 },remaining);
}
function reconcileOutgoingCallExpiry(){
 if(!state.outgoingCall||!Number.isFinite(state.outgoingCallExpiresAt))return;
 if(Date.now()>=state.outgoingCallExpiresAt){
  debug("После возвращения приложения обнаружено, что срок исходящего вызова истёк.");
  finishNoAnswer();
 }else if(!state.callTimer){
  scheduleOutgoingCallExpiry();
 }
}
function startOutgoingCall({peer,expiresAt}){
 if(state.outgoingCall||state.incomingCall||state.secure?.ready||state.peerPresent)return;
 const remaining=Math.max(0,expiresAt-Date.now());
 if(!remaining)return;
 state.outgoingCall=true;state.outgoingCallExpiresAt=expiresAt;updateCallButtons();const peerLabel=els.peer.selectedOptions[0]?.textContent||"контакт";setStatus("Вызываем "+peerLabel,"Ожидаем ответа. Вызов завершится автоматически через 45 секунд.","wait");
 startRinging("outgoing");
 scheduleOutgoingCallExpiry();
}
async function rejectIncoming(){
 if(!state.incomingCall)return;
 try{
  await state.secure?.rejectIncoming();
  clearIncomingUi();stopRinging();
  setStatus("Вызов отклонён","Вызывающий получил подтверждённое уведомление об отказе.","idle");
  debug("Входящий вызов явно отклонён; подтверждённое сообщение отправлено через ntfy.");
  closeCallScreen();
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
 closeCallScreen();
}
async function finishRejectedCall(info){
 if(!state.outgoingCall)return;
 stopOutgoingCall();clearIncomingUi();state.secure?.resetSession();
 if(state.webrtc){await state.webrtc.close({stopTracks:true});state.webrtc=null}
 els.audio.srcObject=null;els.hangup.disabled=true;els.pilot.disabled=false;els.transport.textContent="Не выбран";
 state.callStarted=false;state.peerPresent=false;updateCallButtons();
 setStatus("Вызов отклонён",(info.peer||"Контакт")+" отклонил входящий вызов.","idle");
 debug("Получен подписанный отказ от вызова "+info.sid+".");
 closeCallScreen();
}
async function finishNoAnswer(){
 if(!state.outgoingCall)return;
 stopOutgoingCall();clearIncomingUi();state.secure?.resetSession();
 if(state.webrtc){await state.webrtc.close({stopTracks:true});state.webrtc=null}
 els.audio.srcObject=null;els.hangup.disabled=true;els.pilot.disabled=false;els.transport.textContent="Не выбран";
 state.callStarted=false;state.peerPresent=false;updateCallButtons();
 setStatus("Нет ответа","Время ожидания истекло. Вызов завершён только на этом устройстве; уведомление об отмене не отправлялось.","idle");
 debug("Исходящий вызов истёк через 45 секунд; отменяющий POST не отправлялся.");
 closeCallScreen();
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
  onStatus:m=>{
   els.statusText.textContent=m;debug(m);
   setServiceStatus(els.ntfyStatus,m.includes("переподключ")?"Переподключается…":"Подключён");
  },
  onIncoming:showIncomingCall,
  onContactRequest:handleIncomingContactRequest,
  onPeerMessage:markContactRequestReceived,
  onConversationEvent:async event=>{await addConversationEvent(event);if(els.peer.value===event.contact_user_id)renderConversation(event.contact_user_id).catch(error=>debug("Не удалось обновить историю контакта: "+(error.message||String(error))))},
  onCancelIncoming:info=>{
   if(state.incomingCall){clearIncomingUi();stopRinging();state.secure?.dismissIncoming();setStatus("Вызов отменён",info.peer+" отменил вызов до ответа.","idle");debug("Входящий вызов "+info.sid+" отменён вызывающим через ntfy.");}
  },
  onRejectOutgoing:info=>{finishRejectedCall(info).catch(error=>showError(error.message||String(error)))},
  onDialing:info=>{if(!state.answeringCall){startOutgoingCall(info);sendPushEventToContact(els.peer.value,"incoming_call",info.callId,info.expiresAt).then(()=>debug("OneSignal принял push входящего вызова.")).catch(error=>debug("Push не отправлен (звонок через ntfy продолжается): "+error.message))}},
  onReady:()=>{stopOutgoingCall();clearIncomingUi();stopRinging();return onSecureReady().catch(showError)},
  onError:e=>showError(e.message||String(e)),
  onDebug:debug
 });
}
async function subscribeForUser(me){
 if(!NtfySecureSignaling.validUserId(me))return false;
 if(state.secure&&state.secure.me===me&&!state.secure.closed){
  try{
   await state.secure.subscribe();
   debug("Фоновая подписка активна для локальной анонимной идентичности. POST hello пока не отправлялся.");
   return true;
  }catch(error){
   if(state.secure){setServiceStatus(els.ntfyStatus,"Недоступен");showError(error.message||String(error));setStatus("Подписка не установлена","При подключении попробуем открыть канал ещё раз.","error");}
   return false;
  }
 }
 if(state.secure){state.secure.close();state.secure=null}
 const peer=els.peer.value;
 const subscription=createSecureSignaling(me,NtfySecureSignaling.validUserId(peer)&&peer!==me?peer:"");
 state.secure=subscription;
 els.debugUrl.textContent="https://ntfy.sh/ · "+me.slice(0,12)+"…";
 setStatus("Подписываемся на ntfy","Открываем постоянный канал входящих сообщений для "+me+".","wait");
 try{
  await subscription.subscribe();
  debug("Фоновая подписка активна для локальной анонимной идентичности. POST hello пока не отправлялся.");
  return true;
 }catch(error){
  if(state.secure===subscription){showError(error.message||String(error));setStatus("Подписка не установлена","При подключении попробуем открыть канал ещё раз.","error");}
  return false;
 }
}
if("serviceWorker" in navigator){
 function requestServiceWorkerLog(target=navigator.serviceWorker.controller){
  target?.postMessage({type:"VL_GET_SW_LOG"});
 }
 let swLogStartedAt=null;
 function appendServiceWorkerLog(stage,details={}){
  if(!els.swDebugLog)return;
  const now=new Date();
  if(swLogStartedAt===null)swLogStartedAt=now.getTime();
  const line=formatDiagnosticLogTimestamp(now,now.getTime()-swLogStartedAt)+" "+stage+" "+JSON.stringify(details);
  const current=els.swDebugLog.textContent;
  els.swDebugLog.textContent=(current==="Ожидаем событий Service Worker."||current==="Записей пока нет."?"":current+"\n")+line;
  if(diagnosticLogAutoFollow.serviceWorker)scrollDiagnosticLogToBottom(els.swDebugLog);
 }
 function renderServiceWorkerLog(logs){
  if(!els.swDebugLog)return;
  const entries=Array.isArray(logs)?logs:[];
  const firstTime=entries.length?Number(entries[0].time):NaN;
  swLogStartedAt=Number.isFinite(firstTime)?firstTime:null;
  els.swDebugLog.textContent=entries.map(item=>{
   const timestamp=Number(item.time)||Date.now();
   const time=new Date(timestamp);
   const elapsed=swLogStartedAt===null?0:timestamp-swLogStartedAt;
   return formatDiagnosticLogTimestamp(time,elapsed)+" "+item.stage+" "+JSON.stringify(item.details||{});
  }).join("\n")||"Записей пока нет.";
  if(diagnosticLogAutoFollow.serviceWorker)scrollDiagnosticLogToBottom(els.swDebugLog);
 }
 function requestServiceWorkerStatus(reg){
  if(!reg)return;
  const send=(worker,role)=>{
   if(!worker)return;
   appendServiceWorkerLog("registration_worker",{role,state:worker.state||"unknown",scriptURL:worker.scriptURL||null});
   worker.postMessage({type:"VL_GET_SW_STATUS",role});
  };
  send(reg.active,"active");
  send(reg.waiting,"waiting");
  send(reg.installing,"installing");
 }
 navigator.serviceWorker.addEventListener("controllerchange",()=>{
  requestServiceWorkerLog();
  navigator.serviceWorker.getRegistration().then(requestServiceWorkerStatus);
 });
 navigator.serviceWorker.ready.then(reg=>{
  requestServiceWorkerLog(reg.active);
  requestServiceWorkerStatus(reg);
 });
 navigator.serviceWorker.getRegistration().then(requestServiceWorkerStatus);
 navigator.serviceWorker.addEventListener("message",event=>{
  if(event.data?.type==="VL_NOTIFICATION_CLICKED"){
   if(event.data.data?.event==="new_message"){
    openChatFromNotification(event.data.data.sender_id).catch(error=>debug("Не удалось открыть переписку из уведомления: "+(error.message||String(error))));
   }
   return;
  }
  if(event.data?.type==="VL_SW_STATUS"){
   appendServiceWorkerLog("worker_status",{role:event.data.requestRole,build:event.data.workerBuild,scriptURL:event.data.scriptURL,scope:event.data.scope});
   return;
  }
  if(event.data?.type==="VL_SW_LOG"||event.data?.type==="VL_SW_LOG_UPDATED"){
   if(event.data.type==="VL_SW_LOG")renderServiceWorkerLog(event.data.logs);
   else requestServiceWorkerLog();
   return;
  }
  if(event.data?.type==="VL_SW_LOG_WRITE_ERROR"){
   appendServiceWorkerLog("journal_write_error",{stage:event.data.stage||null,error:event.data.error||"Unknown error"});
   return;
  }
  if(event.data?.type==="VL_PUSH_PREPARE_NOTIFICATION"){
   const senderId=event.data.data?.sender_id||"";
   event.ports?.[0]?.postMessage({suppress:!!window.voicelinkIsReadingChat?.(senderId)});
   return;
  }
  if(event.data?.type==="VL_PUSH_EVENTS"){
   const pending=Array.isArray(event.data.events)?event.data.events:[];
   debug("VoiceLink получил из Service Worker "+pending.length+" сохранённых push-событий; сверяемся с очередью ntfy.");
   subscribeForUser(state.me).then(connected=>{
    if(connected)event.source?.postMessage({type:"VL_CLEAR_PUSH_EVENTS"});
   });
   return;
  }
  if(event.data?.type!=="VL_PUSH_RECEIVED")return;
  appendServiceWorkerLog("push_event_received",{source:"service_worker_message"});
  debug("Service Worker получил фоновый push. Проверяем канал входящих сообщений.");
  const subscription=state.secure;
  if(subscription&&!subscription.closed&&(!subscription.es||subscription.es.readyState===EventSource.CLOSED)){
   subscription.subscribe().then(()=>debug("Подписка ntfy восстановлена после фонового push.")).catch(error=>debug("Не удалось восстановить ntfy после push: "+(error.message||String(error))));
  }
 });
}
async function onSecureReady(){
 state.answeringCall=false;
 state.peerPresent=true;state.role=state.secure.role==="A"?"initiator":"receiver";
 updateCallButtons();
 setStatus("Защищённый канал установлен","Запускаем голосовой канал.","wait");
 debug("Защищённый канал установлен; secure-role="+state.role+"; peer="+(state.secure?.peer||els.peer.value)+".");
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
 const type=payload?.description?.type||(payload?.candidates?"candidate-batch":payload?.candidate?"candidate":"unknown");
 debug("SIGNAL receive: type="+type+"; peer="+(state.secure?.peer||els.peer.value)+".");
 await ensureWebRtc();
 debug("SIGNAL dispatch to WebRTC: type="+type+".");
 await state.webrtc.handleSignal(payload);
 debug("SIGNAL handled: type="+type+".");
}
async function startWebRtcOffer(){
 if(state.callStarted)return;state.callStarted=true;
 try{await ensureWebRtc();await state.webrtc.createOffer();debug("WebRTC offer отправлен пакетами ICE по временным отсечкам 200/500/2000 мс.");}
 catch(e){state.callStarted=false;showError("Не удалось запустить WebRTC: "+e.message);setStatus("Не удалось начать звонок","Проверьте разрешение микрофона и повторите попытку.","error")}
}

async function connect(){
 if(els.callScreen.classList.contains("hidden"))openCallScreen();
 const answering=state.incomingCall;
 const peer=els.peer.value;
 if(!answering&&contactReplyFailures.has(peer)){
  updateCallButtons();
  showError("Нельзя позвонить: ответное приглашение этому контакту не отправлено.");
  return;
 }
 state.answeringCall=answering;
 if(answering){state.secure?.acceptIncoming();clearIncomingUi();stopRinging()}
 clearError();setBusy(true);
 try{
  const me=state.me;
  // Keep a matching prepared PC even while its ICE gathering is still running.
  if(state.webrtc){await state.webrtc.close({stopTracks:true});state.webrtc=null}
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
  const failureMessage=e.message||String(e);
  setStatus("Не удалось подключиться","Проверьте разрешения и попробуйте снова.","error");
  if(state.secure){if(answering)state.secure.dismissIncoming();state.secure.resetSession()}
  if(state.webrtc){await state.webrtc.close({stopTracks:true});state.webrtc=null}
  state.peerPresent=false;state.answeringCall=false;updateCallButtons();
  if(answering){clearIncomingUi();stopRinging()}
  closeCallScreen();
  showAppNotice(failureMessage,true);
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
 state.callStarted=false;state.peerPresent=false;state.answeringCall=false;state.hangingUp=false;updateCallButtons();
 if(remote)setStatus("Собеседник завершил звонок","Удалённая сторона отправила P2P-сообщение HANGUP; звонок завершён.","idle");
 else if(failure)setStatus("Соединение потеряно","WebRTC не восстановил связь за отведённое время. Звонок завершён.","error");
 else setStatus("Звонок завершён","Подписка на ваше имя остаётся активной. Чтобы позвонить снова, нажмите кнопку звонка в карточке контакта.","idle");
 closeCallScreen();

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
let contactsLoaded=false;
let allContacts=[];
function renderContactList(contacts){
 allContacts=contacts;
 const query=els.contactSearch.value.trim().toLowerCase();
 els.contactSearchClear.classList.toggle("hidden",!els.contactSearch.value);
 const visibleContacts=allContacts.filter(contact=>String(contact.name||"").toLowerCase().includes(query));
 els.contactListItems.replaceChildren();
 els.contactsCount.textContent=String(visibleContacts.length);
 els.contactListEmpty.textContent=query?"По вашему запросу ничего не найдено.":"Пока нет контактов. Нажмите «+», чтобы добавить собеседника, или отправьте ему приглашение из своего профиля, чтобы он мог добавить вас в контакты.";
 els.contactListEmpty.classList.toggle("hidden",!contactsLoaded||visibleContacts.length>0);
 els.privacyHelp.classList.toggle("hidden",allContacts.length>0);
 for(const contact of visibleContacts){
  const item=document.createElement("button");
  const isPendingRequest=contact.request_pending===true;
  item.type="button";item.className="contact-list-item"+(isPendingRequest?" contact-list-item-pending":"");item.dataset.peer=contact.user_id;item.setAttribute("role","listitem");
  item.setAttribute("aria-pressed",String(els.peer.value===contact.user_id));
  const avatar=document.createElement("span");
  avatar.className="contact-avatar";avatar.textContent=contactInitials(contact.name);
  avatar.style.backgroundColor=isPendingRequest?"#80602f":contactAvatarColor(contact.user_id);
  const details=document.createElement("span");details.className="contact-list-details";
  const name=document.createElement("span");name.className="contact-list-name";name.textContent=contact.name;
  const status=document.createElement("span");status.className="contact-list-status";
  const replyFailed=contactReplyFailures.has(contact.user_id);
  status.textContent=isPendingRequest?"Новый запрос · "+formatLastInteraction(contact.request_received_at):replyFailed?"Ответное приглашение не отправлено":"Контакт добавлен";
  status.dataset.statusType=replyFailed&&!isPendingRequest?"error":isPendingRequest?"pending":"normal";
  details.append(name,status);
  const last=document.createElement("span");last.className="contact-list-last";last.textContent=formatLastInteraction(contact.last_interaction_at);
  item.append(avatar,details,last);
  els.contactListItems.append(item);
 }
 if(!contactListInitialPositioned&&contacts.length){
  contactListInitialPositioned=true;
  requestAnimationFrame(()=>requestAnimationFrame(()=>window.scrollTo({top:42,behavior:"instant"})));
 }
}
async function refreshContactOptions(selectUserId=""){
 const contacts=await listContacts();
 contacts.sort((a,b)=>{
  const aRequestTime=Date.parse(a.request_received_at||"")||0;
  const bRequestTime=Date.parse(b.request_received_at||"")||0;
  if(aRequestTime&&bRequestTime)return bRequestTime-aRequestTime;
  if(aRequestTime)return -1;
  if(bRequestTime)return 1;
  const aTime=Date.parse(a.last_interaction_at||"")||0,bTime=Date.parse(b.last_interaction_at||"")||0;
  return bTime-aTime||a.name.localeCompare(b.name);
 });
 els.peer.replaceChildren(new Option("Выберите контакт",""));
 for(const contact of contacts)els.peer.add(new Option(contact.name,contact.user_id));
 els.peer.disabled=contacts.length===0;
 if(selectUserId&&contacts.some(contact=>contact.user_id===selectUserId))els.peer.value=selectUserId;
 contactsLoaded=true;
 renderContactList(contacts);
 els.editContactName.value=els.peer.selectedOptions[0]?.textContent||"";
 originalEditContactName=els.editContactName.value.trim();
 updateReplyInviteStatus();
 updateCallButtons();
}

els.contactSearch.addEventListener("input",()=>renderContactList(allContacts));
els.contactSearchClear.addEventListener("click",()=>{
 els.contactSearch.value="";
 renderContactList(allContacts);
 els.contactSearch.focus();
});

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
async function createContactInvitation({focusResult=true,expectedRevision=null}={}){
 const profileRevision=profileInviteRevision;
 const displayName=getProfileDisplayName();
 els.createInvite.disabled=true;
 setInlineStatus(els.inviteStatus,"Проверяем разрешение на push-уведомления…");
 clearError();
 try{
  const subscriptionId=await enableOneSignalPush();
  const identity=await getCurrentSignalingIdentity();
  const unsigned={
   version:INVITATION_FORMAT_VERSION,user_id:identity.user_id,push_subscription_id:subscriptionId,
   invitation_id:crypto.randomUUID(),
   invitation_secret:toBase64UrlBytes(crypto.getRandomValues(new Uint8Array(32))),
   shared_secret_created_at:Date.now(),
   ...(displayName?{display_name:displayName}:{})
  };
  await createIssuedInvitation({id:unsigned.invitation_id,secret:unsigned.invitation_secret,created_at:Date.now(),max_activations:1});
  const contactPackage=unsigned;
  const encoded=toBase64UrlBytes(new TextEncoder().encode(JSON.stringify(contactPackage)));
  const url=window.location.origin+window.location.pathname+"#contact="+encoded;
  if(profileRevision!==profileInviteRevision||displayName!==getProfileDisplayName()||
     (expectedRevision!==null&&expectedRevision!==profileInviteRevision))return false;
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
  if(focusResult){els.inviteUrl.focus();els.inviteUrl.select()}
  debug("Создано защищённое приглашение с действующим OneSignal Subscription ID.");
  if(profileRevision===profileInviteRevision&&displayName===getProfileDisplayName())profileInviteDirty=false;
  updateInvitationPanel();
  return true;
  }catch(error){
   const message=error.message||String(error);
   setInlineStatus(els.inviteStatus,"Приглашение не создано. "+message,true);
   return false;
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
 if(!await refreshProfileInvitationIfNeeded())return;
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
  openProfileScreen();
  els.inviteUrl.focus();els.inviteUrl.select();
  setInlineStatus(els.inviteStatus,"Выделите ссылку и скопируйте её вручную.");
 }
}

async function pasteContactInvitation(event){
 event?.preventDefault();
 event?.stopPropagation();
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
  await suggestContactNameFromInvitation(clipboardValue);
  setInlineStatus(els.qrStatus,"Содержимое буфера вставлено. Укажите имя контакта.");
  els.contactName.focus();
 }catch(error){
  setInlineStatus(els.qrStatus,"Не удалось прочитать буфер обмена. Разрешите доступ браузеру или вставьте ссылку в поле вручную.",true);
  els.contactPackage.focus();
  debug("Не удалось вставить приглашение из буфера обмена: "+(error.message||String(error)));
 }
}

async function sendContactRequest(peerOverride=els.peer.value,statusElement=els.replyInviteStatus,displayNameOverride=undefined,options={}){
 const peer=peerOverride,senderDisplayName=displayNameOverride===undefined?getProfileDisplayName():String(displayNameOverride||"").trim().slice(0,60),report=(m,e=false)=>{if(els.debugMode.checked)showAppNotice(m,e)};
 if(!NtfySecureSignaling.validUserId(peer)||peer===state.me){const m="Не удалось отправить ответное приглашение: сначала выберите контакт, от которого вы получили приглашение.";report(m,true);debug(m);return false}
 updateCallButtons();els.replyInvite.disabled=true;clearError();
 try{
  const contact=await getContact(peer);if(!contact?.push_subscription_id||!contact?.invitation_secret||!contact?.invitation_id)throw Error("У контакта отсутствуют данные приглашения. Попросите его прислать новую ссылку.");
  const subscriptionId=await enableOneSignalPush(),identity=await getCurrentSignalingIdentity(),invitationId=contact.invitation_id,createdAt=Number(contact.shared_secret_created_at)||Date.now();
  const pack={version:INVITATION_FORMAT_VERSION,user_id:identity.user_id,push_subscription_id:subscriptionId,invitation_id:invitationId,invitation_secret:contact.invitation_secret,shared_secret_created_at:createdAt,...(senderDisplayName?{display_name:senderDisplayName}:{})};
  const requestId=crypto.randomUUID(),expiresAt=Number.MAX_SAFE_INTEGER,msg=await createContactRequestEnvelope({contact,contactPackage:pack,from:identity.user_id,to:peer,requestId,expiresAt});
  const response=await fetch("https://ntfy.sh/"+await getNtfyTopic(peer),{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(msg),cache:"no-store"});if(!response.ok)throw Error("ntfy не принял запрос (HTTP "+response.status+").");
  const activation=await consumeIssuedInvitation({invitationId,userId:peer,requestId});if(!activation.accepted)throw Error("Ответное приглашение отправлено, но не удалось зарегистрировать разрешение для контакта.");
  markContactRequestSent(peer,invitationId,createdAt);await updateContact(peer,{shared_secret_created_at:createdAt});setContactReplyFailure(peer,false);updateCallButtons();
  try{await sendPushEventToContact(peer,"contact_request",requestId,expiresAt);report("Ответное приглашение отправлено. OneSignal принял push-уведомление.");debug("Зашифрованный запрос контакта опубликован в ntfy; OneSignal принял push.")}
  catch(e){report("Ответное приглашение отправлено через ntfy, но push не отправлен: "+(e.message||String(e)),true);debug("Запрос контакта отправлен через ntfy; push не отправлен: "+(e.message||String(e)))}
  return true;
 }catch(e){const d=e.message||String(e),m="Не удалось отправить ответное приглашение: "+d;setContactReplyFailure(peer,true);report(m,true);if(els.debugMode.checked){const dialog=statusElement?.closest('[role="dialog"]');if(dialog&&!dialog.classList.contains("hidden"))showError(d)}debug(m);return false}
 finally{els.replyInvite.disabled=false;updateCallButtons()}
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
async function handleIncomingContactRequest(request){
 const id=request?.contact?.user_id;if(!NtfySecureSignaling.validUserId(id)||id===state.me)return;
 try{const existing=await getContact(id);if(existing?.request_id===request.requestId){debug("Повторная доставка уже обработанного запроса контакта пропущена.");return}
 const receivedAt=existing?.request_received_at||new Date().toISOString(),name=existing?.name||request.contact.display_name||"Новый контакт";
 await saveContact({...existing,...request.contact,name,request_pending:existing?existing.request_pending===true:true,...(existing?.request_received_at?{request_received_at:existing.request_received_at}:{request_received_at:receivedAt}),request_id:request.requestId,invitation_created_at:request.invitationCreatedAt,authorized_by_invitation_id:request.invitationId});
 await refreshContactOptions(els.peer.value);debug(existing?"Получено обновлённое приглашение от контакта: "+name+". Локальное имя и история сохранены.":"Получено и сохранено приглашение от контакта: "+name+".");
 }catch(e){debug("Не удалось сохранить запрос контакта: "+(e.message||String(e)))}
}

async function acceptContactRequest(){
 const peer=els.peer.value;
 const contact=await getContact(peer);
 if(!contact?.request_pending)return;
 els.acceptContactRequest.disabled=true;
 try{
  await saveContact({...contact,request_pending:false});
  await refreshContactOptions(peer);
  setStatus("Контакт добавлен","Теперь можно звонить этому контакту.","idle");
  debug("Запрос принят; контакт "+contact.name+" сохранён на прежнем месте в списке.");
 }catch(error){
  showError("Не удалось добавить контакт: "+(error.message||String(error)));
 }finally{
  els.acceptContactRequest.disabled=false;
  updateCallButtons();
 }
}

async function declineContactRequest(){
 const peer=els.peer.value;
 const contact=await getContact(peer);
 if(!contact?.request_pending)return;
 els.declineContactRequest.disabled=true;
 try{
  await deleteContact(peer);
  if(state.secure?.peer===peer)state.secure.setPeer("");
  await refreshContactOptions();
  closeContactScreen();
  clearError();
  debug("Запрос от "+contact.name+" отклонён и удалён из локального списка.");
 }catch(error){
  showError("Не удалось отклонить запрос: "+(error.message||String(error)));
 }finally{
  els.declineContactRequest.disabled=false;
 }
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

}
async function importContactFromInput(){
 importingContact=true;
 updateImportContactButton();
 try{
  const verified=await verifyContactPackage(els.contactPackage.value);
  if(verified.user_id===state.me)throw Error("Это ваше собственное приглашение. Его нельзя добавить в контакты.");
  const name=els.contactName.value.trim();
  const profileName=getProfileDisplayName();
  const senderDisplayName=profileName||String(els.responseDisplayName.value||"").trim().slice(0,60);
  const saveSenderName=!profileName&&!!senderDisplayName&&els.saveResponseDisplayName.checked;
  if(!name)throw Error("Укажите имя, под которым контакт будет сохранён только на этом устройстве.");
  const existing=await getContact(verified.user_id);
  if(existing&&!window.confirm("Этот контакт уже сохранён как «"+existing.name+"». Обновить данные приглашения? Локальное имя и история останутся без изменений."))return;
  if(existing&&existing.invitation_id===verified.invitation_id&&existing.invitation_secret!==verified.invitation_secret)throw Error("Эта ссылка выдана до ротации ключа. Попросите контакт создать новое приглашение.");
  const localInvitation=await getIssuedInvitation(verified.invitation_id);
  if(localInvitation&&(localInvitation.revoked||localInvitation.secret!==verified.invitation_secret))throw Error("Этот ID приглашения уже зарегистрирован с другим ключом или был отозван.");
  if(!localInvitation)await createIssuedInvitation({id:verified.invitation_id,secret:verified.invitation_secret,created_at:verified.shared_secret_created_at,max_activations:1});
  const localGrant=await consumeIssuedInvitation({invitationId:verified.invitation_id,userId:verified.user_id,requestId:crypto.randomUUID()});
  if(!localGrant.accepted)throw Error("Не удалось зарегистрировать локальное разрешение для контакта.");
  await saveContact(existing
   ?{...existing,...verified,name:existing.name}
   :{...verified,name});
  await refreshContactOptions(verified.user_id);
  if(state.secure&&!state.secure.active&&!state.connecting)state.secure.setPeer(verified.user_id);
  if(saveSenderName){
   els.profileDisplayName.value=senderDisplayName;
   handleProfileDisplayNameInput();
   debug("Имя отправителя сохранено в профиле по выбору пользователя.");
  }
  els.contactPackage.value="";
  updatePasteContactButton();
  els.contactName.value="";
  closeAddContactScreen();
  setInlineStatus(els.qrStatus,"Контакт «"+name+"» успешно проверен и сохранён локально.");
  clearError();
  debug("Импортирован и криптографически проверен новый контакт: "+name+".");
  setStatus("Контакт добавлен","Теперь его можно выбрать для звонка.","idle");
  if(!existing){
   setInlineStatus(els.qrStatus,"Контакт сохранён. Отправляем ответное приглашение…");
   debug("Автоматически отправляем ответное приглашение новому контакту.");
   await sendContactRequest(verified.user_id,els.qrStatus,senderDisplayName);
  }else{
   setInlineStatus(els.qrStatus,"Обновляем защищённую связь с контактом…");
   const sent=await sendContactRequest(verified.user_id,els.qrStatus,senderDisplayName);
   if(!sent)throw Error("Не удалось обновить защищённую связь с контактом.");
  }
 }catch(error){
  showError(error.message||String(error));
  setInlineStatus(els.qrStatus,error.message||"Не удалось импортировать контакт.",true);
 }finally{importingContact=false;updateImportContactButton()}
}
async function stopQrScan(){
 qrScanActive=false;
 if(qrStream){for(const track of qrStream.getTracks())track.stop();qrStream=null}
 els.qrVideo.srcObject=null;
 els.qrVideo.classList.add("hidden");
 els.scanQr.textContent="Сканировать QR-код";
}
async function configureQrScannerButton(){
 els.scanQr.classList.add("hidden");
 let supported=false;
 try{
  if("BarcodeDetector" in window){
   if(typeof BarcodeDetector.getSupportedFormats==="function"){
    const formats=await BarcodeDetector.getSupportedFormats();
    supported=formats.includes("qr_code");
   }else{
    new BarcodeDetector({formats:["qr_code"]});
    supported=true;
   }
  }
 }catch(error){supported=false}
 if(supported)els.scanQr.classList.remove("hidden");
}
configureQrScannerButton();
async function startQrScan(){
 if(qrScanActive){await stopQrScan();return}
 if(!("BarcodeDetector" in window)){
  els.scanQr.classList.add("hidden");
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
     await suggestContactNameFromInvitation(codes[0].rawValue);
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

let contactInvitationLookupRevision=0;
async function suggestContactNameFromInvitation(value){
 const revision=++contactInvitationLookupRevision;
 const invitation=String(value||"").trim();
 if(!invitation||els.contactName.value.trim())return;
 try{
  const contact=await verifyContactPackage(invitation);
  if(revision!==contactInvitationLookupRevision||invitation!==els.contactPackage.value.trim()||els.contactName.value.trim())return;
  if(contact.display_name){els.contactName.value=contact.display_name;updateImportContactButton();}
 }catch{}
}
function updatePasteContactButton(){els.pasteContact.textContent="Вставить";els.pasteContact.disabled=els.contactPackage.value.length>0;}
els.contactPackage.addEventListener("input",()=>{updateImportContactButton();updatePasteContactButton();suggestContactNameFromInvitation(els.contactPackage.value);});
els.pasteContact.addEventListener("click",pasteContactInvitation);
updatePasteContactButton();

els.contactName.addEventListener("input",updateImportContactButton);
els.responseDisplayName.addEventListener("input",()=>{els.saveResponseDisplayName.disabled=!els.responseDisplayName.value.trim();if(!els.responseDisplayName.value.trim())els.saveResponseDisplayName.checked=false;});
els.importContact.addEventListener("click",importContactFromInput);
updateImportContactButton();
els.replyInvite.addEventListener("click",()=>{els.contactScreenMenu.open=false;sendContactRequest()});
els.acceptContactRequest.addEventListener("click",acceptContactRequest);
els.declineContactRequest.addEventListener("click",declineContactRequest);
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
function openProfileScreen(){clearInlineStatus(els.inviteStatus);clearError();els.profileScreen.classList.remove("hidden");document.body.classList.add("contact-screen-open");els.inviteTools.open=true;updateInvitationPanel();els.profileScreenBack.focus();}
function closeProfileScreen(){clearInlineStatus(els.inviteStatus);els.profileScreen.classList.add("hidden");document.body.classList.remove("contact-screen-open");els.profileDockButton.focus();}
let diagnosticReturnFocus=null;
function openDiagnosticScreen(){diagnosticReturnFocus=document.activeElement;els.diagnosticScreen.classList.remove("hidden");document.body.classList.add("contact-screen-open");resetDiagnosticLogAutoFollow();els.diagnosticScreenBack.focus();}
function closeDiagnosticScreen(){els.diagnosticScreen.classList.add("hidden");document.body.classList.remove("contact-screen-open");if(diagnosticReturnFocus?.isConnected&&!diagnosticReturnFocus.classList.contains("hidden"))diagnosticReturnFocus.focus();else els.privacyHelp.focus();diagnosticReturnFocus=null;}
let profileLongPressTimer=null,profileLongPressTriggered=false;
els.profileDockButton.addEventListener("click",event=>{if(profileLongPressTriggered){event.preventDefault();profileLongPressTriggered=false;return;}openProfileScreen();});
els.diagnosticDockButton.addEventListener("click",openDiagnosticScreen);
els.contactDiagnosticButton.addEventListener("click",openDiagnosticScreen);
els.profileScreenBack.addEventListener("click",closeProfileScreen);
els.profileDisplayName.addEventListener("input",handleProfileDisplayNameInput);
els.inviteUrl.addEventListener("focus",()=>{if(profileInviteDirty)refreshProfileInvitationIfNeeded();});
els.diagnosticScreenBack.addEventListener("click",closeDiagnosticScreen);
els.copyDebugLog.addEventListener("click",()=>copyDiagnosticLog(els.debugLog,els.copyDebugLog));
els.copySwDebugLog.addEventListener("click",()=>copyDiagnosticLog(els.swDebugLog,els.copySwDebugLog));
els.profileDockButton.addEventListener("pointerdown",event=>{if(event.button!==undefined&&event.button!==0)return;try{els.profileDockButton.setPointerCapture(event.pointerId)}catch{}profileLongPressTriggered=false;cancelProfileLongPress();profileLongPressTimer=window.setTimeout(()=>{profileLongPressTimer=null;profileLongPressTriggered=true;els.profileDockLabel.textContent="Отпустите";},550);});
async function completeProfileLongPress(){
 if(els.inviteUrl.value.trim()&&!await refreshProfileInvitationIfNeeded()){
  openProfileScreen();
  return;
 }
 if(!els.inviteUrl.value.trim()){els.profileDockLabel.textContent="Профиль";openProfileScreen();setInlineStatus(els.inviteStatus,"Ссылка появится после разрешения push-уведомлений.");return;}
 try{
  await navigator.clipboard.writeText(els.inviteUrl.value.trim());
  els.profileDockLabel.textContent="Скопировано";
  setInlineStatus(els.inviteStatus,"Ссылка скопирована.");
  window.setTimeout(()=>{els.profileDockLabel.textContent="Профиль"},1500);
 }catch(error){
  els.profileDockLabel.textContent="Профиль";
  openProfileScreen();
  els.inviteUrl.focus();els.inviteUrl.select();
  setInlineStatus(els.inviteStatus,"Не удалось скопировать автоматически. Скопируйте ссылку из поля вручную.",true);
 }
}
function cancelProfileLongPress(){if(profileLongPressTimer!==null){window.clearTimeout(profileLongPressTimer);profileLongPressTimer=null;}}
els.profileDockButton.addEventListener("pointerup",()=>{const wasLongPress=profileLongPressTriggered;cancelProfileLongPress();if(wasLongPress)completeProfileLongPress();else els.profileDockLabel.textContent="Профиль";});
els.profileDockButton.addEventListener("pointerleave",event=>{if(event.pointerType==="mouse"&&!profileLongPressTriggered){cancelProfileLongPress();}});
els.profileDockButton.addEventListener("pointercancel",()=>{cancelProfileLongPress();profileLongPressTriggered=false;els.profileDockLabel.textContent="Профиль";});
els.copyInvite.addEventListener("click",copyContactInvitation);
els.copyInviteInline.addEventListener("click",copyContactInvitation);
els.scanQr.addEventListener("click",startQrScan);
window.addEventListener("pagehide",()=>{if(qrStream)for(const track of qrStream.getTracks())track.stop()});
els.connect.addEventListener("click",connect);
els.answerIncoming.addEventListener("click",connect);
els.dismissIncoming.addEventListener("click",()=>dismissIncoming(false));
els.rejectIncoming.addEventListener("click",rejectIncoming);
document.addEventListener("pointerdown",unlockRingingAudio,{passive:true});
document.addEventListener("keydown",unlockRingingAudio);
function applyDebugMode(){
 const enabled=els.debugMode.checked;
 els.contactDiagnosticsFooter.classList.toggle("hidden",!enabled);
 els.diagnosticDockButton.classList.toggle("hidden",!enabled);
 els.contactDiagnosticButton.classList.toggle("hidden",!enabled);
}
try{els.debugMode.checked=localStorage.getItem("vl.debugMode.v1")==="1"}catch{els.debugMode.checked=false}
applyDebugMode();
els.debugMode.addEventListener("change",()=>{
 try{localStorage.setItem("vl.debugMode.v1",els.debugMode.checked?"1":"0")}catch(error){debug("Не удалось сохранить режим отладки: "+error.message)}
 applyDebugMode();
 debug("Режим отладки "+(els.debugMode.checked?"включён":"выключен")+".");
});
els.pilot.addEventListener("change",()=>{
 try{localStorage.setItem("vl.simulateMicrophone.v1",els.pilot.checked?"1":"0")}catch(error){debug("Не удалось сохранить настройку симуляции микрофона: "+error.message)}
 debug("Симуляция микрофона "+(els.pilot.checked?"включена":"выключена")+". Настройка применяется при следующем подключении.");
});

function openAboutScreen(){
 els.headerMenu.open=false;
 els.aboutScreen.classList.remove("hidden");
 document.body.classList.add("contact-screen-open");
 els.aboutScreenBack.focus();
}
function closeAboutScreen(){
 els.aboutScreen.classList.add("hidden");
 document.body.classList.remove("contact-screen-open");
 els.privacyHelp.focus();
}
function openSettingsScreen(){
 els.headerMenu.open=false;
 els.settingsScreen.classList.remove("hidden");
 document.body.classList.add("contact-screen-open");
 els.settingsScreenBack.focus();
}
function closeSettingsScreen(){
 els.settingsScreen.classList.add("hidden");
 document.body.classList.remove("contact-screen-open");
 els.headerMenu.querySelector("summary").focus();
}
els.privacyHelp.addEventListener("click",openAboutScreen);
els.openAboutScreen.addEventListener("click",openAboutScreen);
els.openSettingsScreen.addEventListener("click",openSettingsScreen);
els.aboutScreenBack.addEventListener("click",closeAboutScreen);
els.settingsScreenBack.addEventListener("click",closeSettingsScreen);
const contextMenus=[els.headerMenu,els.contactScreenMenu].filter(Boolean);
function closeContextMenus(except=null){
 for(const menu of contextMenus)if(menu!==except&&menu.open)menu.open=false;
}
document.addEventListener("pointerdown",event=>{
 for(const menu of contextMenus){
  if(menu.open&&!menu.contains(event.target))menu.open=false;
 }
});
document.addEventListener("keydown",event=>{
 if(event.key!=="Escape")return;
 const openMenu=contextMenus.find(menu=>menu.open);
 if(!openMenu)return;
 closeContextMenus();
 openMenu.querySelector("summary")?.focus();
});
function updateResponseDisplayNameSection(){
 const profileName=getProfileDisplayName();
 els.responseDisplayNameSection.classList.toggle("hidden",!!profileName);
 els.saveResponseDisplayName.disabled=!els.responseDisplayName.value.trim();
 if(profileName){
  els.responseDisplayName.value="";
  els.saveResponseDisplayName.checked=false;
 }
}
function openAddContactScreen(pasteFromClipboard=false,{preserveInput=false}={}){
 clearInlineStatus(els.qrStatus);clearError();
 if(!preserveInput){
  els.contactPackage.value="";
  els.contactName.value="";
  els.responseDisplayName.value="";
  els.saveResponseDisplayName.checked=false;
  els.contactPackage.dispatchEvent(new Event("input",{bubbles:true}));
 }
 updateResponseDisplayNameSection();
 els.firstContactWelcome.classList.toggle("hidden",allContacts.length!==0);
 els.addContactScreen.classList.remove("hidden");
 document.body.classList.add("contact-screen-open");
 els.contactTools.open=true;
 if(pasteFromClipboard)pasteContactInvitation();
 else els.contactPackage.focus();
}
function closeAddContactScreen(){
 if(qrScanActive)stopQrScan();
 els.contactPackage.value="";
 els.contactName.value="";
 els.responseDisplayName.value="";
 els.saveResponseDisplayName.checked=false;
 els.contactPackage.dispatchEvent(new Event("input",{bubbles:true}));
 clearInlineStatus(els.qrStatus);
 els.addContactScreen.classList.add("hidden");
 document.body.classList.remove("contact-screen-open");
 els.addContactFab.focus();
}

function conversationEventLabel(event){
 if(event.type==="text")return "";
 if(event.type==="hello"||event.type==="request")return event.direction==="outgoing"?"Исходящий звонок":"Входящий звонок";
 if(event.type==="answer")return event.direction==="outgoing"?"Вы ответили на звонок":"Собеседник ответил на звонок";
 if(event.type==="reject")return event.direction==="outgoing"?"Вы отклонили вызов":"Собеседник отклонил вызов";
 return "Событие";
}
async function renderConversation(contactUserId){
 if(!els.chatEvents||!NtfySecureSignaling.validUserId(contactUserId))return;
 const events=await listConversationEvents(contactUserId);
 if(els.peer.value!==contactUserId)return;
 els.chatEvents.replaceChildren();
 if(!events.length){
  const empty=document.createElement("p");
  empty.className="chat-empty";
  empty.textContent="Пока нет сообщений";
  els.chatEvents.append(empty);
  return;
 }
 for(const event of events){
  const item=document.createElement("div");
  item.className=event.type==="text"?"chat-event chat-event-message chat-event-"+event.direction:"chat-event chat-event-system";
  if(event.type==="text"){
   const bubble=document.createElement("div");
   bubble.className="chat-message-bubble";
   const body=document.createElement("div");
   body.className="chat-message-text";
   body.textContent=event.text;
   const time=document.createElement("time");
   time.className="chat-message-time";
   time.dateTime=event.created_at;
   time.textContent=new Date(event.created_at).toLocaleTimeString("ru-RU",{hour:"2-digit",minute:"2-digit"});
   bubble.append(body,time);
   item.append(bubble);
  }else{
   const label=document.createElement("span");
   label.textContent=conversationEventLabel(event);
   const time=document.createElement("time");
   time.dateTime=event.created_at;
   time.textContent=new Date(event.created_at).toLocaleTimeString("ru-RU",{hour:"2-digit",minute:"2-digit"});
   item.append(label,time);
  }
  els.chatEvents.append(item);
 }
 els.chatEvents.scrollTop=els.chatEvents.scrollHeight;
}
function updateChatComposerState(){
 const contact=allContacts.find(item=>item.user_id===els.peer.value);
 const allowed=!!contact&&!contact.request_pending&&!contactReplyFailures.has(els.peer.value);
 els.chatMessage.disabled=!allowed;
 els.sendChatMessage.disabled=!allowed||!els.chatMessage.value.trim();
 els.chatMessage.placeholder=allowed?"Сообщение…":"Добавьте контакт, чтобы переписываться";
}
async function sendChatMessage(){
 const text=els.chatMessage.value.trim();
 const peer=els.peer.value;
 if(!text||!peer)return;
 updateChatComposerState();
 if(els.sendChatMessage.disabled)return;
 els.sendChatMessage.disabled=true;
 try{
  if(!state.secure||state.secure.closed||!state.secure.identity){
   const connected=await subscribeForUser(state.me);
   if(!connected||!state.secure?.identity)throw Error("Не удалось подключиться к каналу сообщений. Повторите попытку.");
  }
  await state.secure.sendText(peer,text);
  sendPushEventToContact(peer,"new_message",crypto.randomUUID(),Date.now()+24*60*60*1000)
   .then(()=>debug("OneSignal принял push о новом сообщении."))
   .catch(error=>debug("Push о сообщении не отправлен (сообщение уже доставлено через ntfy): "+(error.message||String(error))));
  if(els.peer.value===peer)els.chatMessage.value="";
  updateChatComposerState();
 }catch(error){
  showError("Не удалось отправить сообщение: "+(error.message||String(error)));
  updateChatComposerState();
 }
}
const CALL_RETURN_SCREEN_IDS=["contact-screen","profile-screen","diagnostic-screen","add-contact-screen","about-screen","settings-screen","contact-edit-screen","contact-delete-screen"];
function captureCallReturnState(){
 return {
  screens:Object.fromEntries(CALL_RETURN_SCREEN_IDS.map(id=>[id,$(id)?.classList.contains("hidden")??true])),
  contactScreenOpen:document.body.classList.contains("contact-screen-open"),
  peer:els.peer.value,
  contactName:els.contactScreenName.textContent,
  contactAvatar:els.contactScreenAvatar.textContent,
  contactAvatarColor:els.contactScreenAvatar.style.backgroundColor,
  chatScrollTop:els.chatEvents.scrollTop
 };
}
function restoreCallReturnState(snapshot){
 if(!snapshot)return;
 for(const [id,hidden] of Object.entries(snapshot.screens||{})){
  const screen=$(id);
  if(!screen)continue;
  screen.classList.toggle("hidden",hidden);
 }
 document.body.classList.toggle("contact-screen-open",!!snapshot.contactScreenOpen);
 if(snapshot.peer&&els.peer.value!==snapshot.peer){
  els.peer.value=snapshot.peer;
  els.peer.dispatchEvent(new Event("change",{bubbles:true}));
 }
 els.contactScreenName.textContent=snapshot.contactName||"";
 els.contactScreenAvatar.textContent=snapshot.contactAvatar||"";
 els.contactScreenAvatar.style.backgroundColor=snapshot.contactAvatarColor||"";
 if(!snapshot.screens?.["contact-screen"]&&snapshot.peer){
  renderConversation(snapshot.peer).then(()=>{els.chatEvents.scrollTop=snapshot.chatScrollTop||0;})
   .catch(error=>debug("Не удалось восстановить прежнюю переписку после звонка: "+(error.message||String(error))));
 }
}
function openCallScreen(){
 if(els.contactScreen.classList.contains("hidden"))return false;
 if(!state.callReturnSnapshot)state.callReturnSnapshot=captureCallReturnState();
 clearError();
 els.contactScreen.classList.add("hidden");
 els.callScreen.classList.remove("hidden");
 els.callScreenHeaderSlot.append(els.contactScreenHeader);
 els.contactScreenHeader.classList.add("call-screen-header-mode");
 els.callScreenDiagnosticsSlot.append(els.contactDiagnosticsFooter);
 document.body.classList.add("contact-screen-open");
 updateCallButtons();
 els.contactScreenBack.focus();
 return true;
}
function closeCallScreen(){
 if(els.callScreen.classList.contains("hidden"))return;
 els.callScreen.classList.add("hidden");
 els.contactScreenHeader.classList.remove("call-screen-header-mode");
 els.contactScreenHeaderPlaceholder.insertAdjacentElement("afterend",els.contactScreenHeader);
 els.contactDiagnosticsPlaceholder.insertAdjacentElement("afterend",els.contactDiagnosticsFooter);
 const returnState=state.callReturnSnapshot;
 state.callReturnSnapshot=null;
 if(returnState)restoreCallReturnState(returnState);
 else{
  els.contactScreen.classList.remove("hidden");
  document.body.classList.add("contact-screen-open");
 }
 clearError();
 updateCallButtons();
 if(!els.contactScreen.classList.contains("hidden"))els.contactScreenBack.focus();
}
function handleContactScreenBack(){
 if(!els.callScreen.classList.contains("hidden"))return;
 closeContactScreen();
}
function openContactScreen(item,preserveSelection=false){
 clearError();
 applyDebugMode();
 const peer=item.dataset.peer;
 if(!preserveSelection){
  els.peer.value=peer;
  els.peer.dispatchEvent(new Event("change",{bubbles:true}));
 }
 const avatar=item.querySelector(".contact-avatar");
 const name=item.querySelector(".contact-list-name");
 els.contactScreenAvatar.textContent=avatar?.textContent||"?";
 els.contactScreenAvatar.style.backgroundColor=avatar?.style.backgroundColor||"var(--accent)";
 els.contactScreenName.textContent=name?.textContent||"Контакт";
 updateCallButtons();
 renderConversation(peer).catch(error=>debug("Не удалось загрузить историю контакта: "+(error.message||String(error))));
 els.contactScreen.classList.remove("hidden");
 document.body.classList.add("contact-screen-open");
 els.contactScreenBack.focus();
}
async function openChatFromNotification(senderId){
 if(!NtfySecureSignaling.validUserId(senderId)||senderId===state.me)return false;
 let item=Array.from(els.contactList.querySelectorAll(".contact-list-item[data-peer]")).find(node=>node.dataset.peer===senderId);
 if(!item){
  await refreshContactOptions();
  item=Array.from(els.contactList.querySelectorAll(".contact-list-item[data-peer]")).find(node=>node.dataset.peer===senderId);
 }
 if(!item){
  debug("Push-уведомление относится к контакту, которого нет в локальном списке.");
  return false;
 }
 openContactScreen(item);
 return true;
}
function closeContactEditScreen(){
 clearError();
 els.contactEditScreen.classList.add("hidden");
 els.contactScreenMenu.open=false;
 els.contactScreenBack.focus();
}
function openContactEditScreen(){
 if(els.openContactEdit.classList.contains("hidden"))return;
 clearError();
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
 clearError();
 els.contactScreenMenu.open=false;
 els.contactDeleteName.textContent=els.contactScreenName.textContent||"Контакт";
 els.contactDeleteScreen.classList.remove("hidden");
 els.contactDeleteScreenBack.focus();
}
function closeContactScreen(){
 clearError();
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
els.addContactFab.addEventListener("click",()=>openAddContactScreen(false));
els.addContactScreenBack.addEventListener("click",closeAddContactScreen);
els.contactScreenBack.addEventListener("click",handleContactScreenBack);
els.contactScreenCall.addEventListener("click",()=>els.connect.click());
els.chatComposer.addEventListener("submit",event=>{event.preventDefault();sendChatMessage()});
els.chatMessage.addEventListener("input",updateChatComposerState);
els.chatMessage.addEventListener("keydown",event=>{
 if(event.key==="Enter"&&!event.shiftKey){event.preventDefault();sendChatMessage()}
});
els.openContactEdit.addEventListener("click",openContactEditScreen);
els.openContactDelete.addEventListener("click",openContactDeleteScreen);
els.contactEditScreenBack.addEventListener("click",closeContactEditScreen);
els.contactDeleteScreenBack.addEventListener("click",closeContactDeleteScreen);
els.cancelDeleteContact.addEventListener("click",closeContactDeleteScreen);
document.addEventListener("keydown",event=>{
 if(event.key!=="Escape")return;
 if(!els.contactDeleteScreen.classList.contains("hidden"))closeContactDeleteScreen();
 else if(!els.contactEditScreen.classList.contains("hidden"))closeContactEditScreen();
 else if(!els.profileScreen.classList.contains("hidden"))closeProfileScreen();
 else if(!els.aboutScreen.classList.contains("hidden"))closeAboutScreen();
 else if(!els.settingsScreen.classList.contains("hidden"))closeSettingsScreen();
 else if(!els.diagnosticScreen.classList.contains("hidden"))closeDiagnosticScreen();
 else if(!els.addContactScreen.classList.contains("hidden"))closeAddContactScreen();
 else if(!els.contactScreen.classList.contains("hidden"))closeContactScreen();
});
els.peer.addEventListener("change",()=>{
 els.editContactName.value=els.peer.selectedOptions[0]?.textContent||"";
 originalEditContactName=els.editContactName.value.trim();
 updateReplyInviteStatus();
 updateCallButtons();
 updateChatComposerState();
 const peer=els.peer.value;
 if(!els.contactScreen.classList.contains("hidden"))renderConversation(peer).catch(error=>debug("Не удалось обновить историю контакта: "+(error.message||String(error))));
 for(const item of els.contactList.querySelectorAll(".contact-list-item"))item.setAttribute("aria-pressed",String(item.dataset.peer===peer));
 if(state.incomingCall&&peer!==state.secure?.peer)dismissIncoming(false);
 if(state.secure&&!state.secure.active&&!state.connecting){
  const me=state.me;
  state.secure.setPeer(NtfySecureSignaling.validUserId(peer)&&peer!==me?peer:"");
 }

});

document.addEventListener("visibilitychange",()=>{
 if(!document.hidden){
  reconcileOutgoingCallExpiry();

 }
});
window.addEventListener("pageshow",reconcileOutgoingCallExpiry);
window.addEventListener("focus",reconcileOutgoingCallExpiry);

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

  const requestedChat=new URLSearchParams(window.location.search).get("openChat");
  if(requestedChat){
   await openChatFromNotification(requestedChat);
   const cleanUrl=new URL(window.location.href);
   cleanUrl.searchParams.delete("openChat");
   history.replaceState(null,"",cleanUrl.pathname+cleanUrl.search+cleanUrl.hash);
  }
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
  const fragment=new URLSearchParams(window.location.hash.slice(1));
  if(fragment.has("contact")){
    els.contactPackage.value=window.location.hash;
    updatePasteContactButton();
    suggestContactNameFromInvitation(window.location.hash);
    openAddContactScreen(false,{preserveInput:true});
    try{
     await verifyContactPackage(window.location.hash);
     els.qrStatus.textContent="Получена ссылка-приглашение. Укажите локальное имя контакта.";
    }catch(invitationError){
     setInlineStatus(els.qrStatus,invitationError.message||"Не удалось проверить версию приглашения.",true);
    }
   }
  const contacts=await listContacts();
  els.debugUrl.textContent="https://ntfy.sh/ · "+state.me.slice(0,12)+"…";
  setStatus("Локальная идентичность готова",contacts.length?"Выберите контакт для звонка.":"Сохранённых контактов пока нет.","idle");
  document.documentElement.dataset.voicelinkBooted="true";
  updateWebPushStatus();
   checkServiceWorkerAvailability();
   checkPushBackendAvailability();
   const oneSignalReady=initializeOneSignal().then(async()=>{
   debug("OneSignal Web Push SDK инициализирован.");
   if("Notification" in window&&Notification.permission==="granted")await createContactInvitation();
   return true;
  }).catch(error=>{
   debug("OneSignal пока недоступен: "+(error.message||String(error)));
   return false;
  });
  const subscribed=await subscribeForUser(state.me);
  if(subscribed)oneSignalReady.then(async ready=>{
   if(!ready)return;
   try{
    const registration=await navigator.serviceWorker.getRegistration();
    registration?.active?.postMessage({type:"VL_GET_PUSH_EVENTS"});
   }catch(error){debug("Не удалось подтвердить обработку фоновых push: "+(error.message||String(error)));}
  });
 }catch(error){
  showError("Не удалось инициализировать приложение: "+(error.message||String(error)));
  setStatus("Ошибка локального хранилища","Проверьте поддержку IndexedDB и Web Crypto.","error");
  document.documentElement.dataset.voicelinkBooted="true";
 }
}
els.tcp.classList.add("hidden");
try{els.pilot.checked=localStorage.getItem("vl.simulateMicrophone.v1")==="1"}catch{els.pilot.checked=false}
els.dismissIncoming.classList.add("hidden");
initializeApp();

