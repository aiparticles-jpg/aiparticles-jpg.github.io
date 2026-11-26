import { WebRtcAudio } from "./webrtc.js?v=40";
import { SupabaseSecureSignaling } from "./supabase-signaling.js?v=6";
import { getCurrentSignalingIdentity } from "./local-identity.js?v=2";
import { listContacts, getContact, saveContact, updateContact, deleteContact, saveMyInvitation, clearMyInvitation, createIssuedInvitation, getIssuedInvitation, deleteUnusedIssuedInvitation, listIssuedInvitations, consumeIssuedInvitation, addConversationEvent, listConversationEvents, markConversationMessageDelivered, updateConversationMessageDeliveryStatus, findContactBySupabaseUserId, getSupabaseSequenceState, ensureSupabaseOutgoingSequence, advanceSupabaseIncomingSequence, getSupabaseInboxCursor, setSupabaseInboxCursor } from "./local-store.js?v=26";
import { INVITATION_FORMAT_VERSION, verifyContactPackage } from "./contact-exchange.js?v=17";
import { initializeOneSignal, enableOneSignalPush, getOptionalOneSignalSubscriptionId, getOneSignalPushDiagnostics } from "./onesignal.js?v=8";
import { sendPushEventToContact } from "./push-api.js?v=6";
import { getSupabaseIdentity, createSupabaseInvitation, submitSupabaseInvitationAcceptance, subscribeSupabaseInbox, fetchSupabaseInbox, decryptSupabaseInboxRecord, flushSupabaseOutbox } from "./supabase-client.js?v=10";

const $=id=>document.getElementById(id);
const els={
 contactList:$("contacts-list"),appNotice:$("app-notice"),supabaseStatus:$("supabase-status"),renderStatus:$("render-status"),serviceWorkerStatus:$("service-worker-status"),webPushStatus:$("web-push-status"),profileDockButton:$("profile-dock-button"),profileDockLabel:$("profile-dock-label"),profileScreen:$("profile-screen"),profileScreenBack:$("profile-screen-back"),invitationScreen:$("invitation-screen"),invitationScreenBack:$("invitation-screen-back"),invitationScreenStatus:$("invitation-screen-status"),diagnosticDockButton:$("diagnostic-dock-button"),contactDiagnosticButton:$("contact-diagnostic-button"),contactDiagnosticsFooter:$("contact-diagnostics-footer"),debugMode:$("debug-mode"),diagnosticScreen:$("diagnostic-screen"),diagnosticScreenBack:$("diagnostic-screen-back"),addContactFab:$("add-contact-fab"),addContactScreen:$("add-contact-screen"),addContactScreenBack:$("add-contact-screen-back"),firstContactWelcome:$("first-contact-welcome"),contactListItems:$("contacts-list-items"),contactSearch:$("contact-search"),contactSearchClear:$("contact-search-clear"),contactListEmpty:$("contacts-list-empty"),contactsCount:$("contacts-count"),contactScreen:$("contact-screen"),contactScreenBack:$("contact-screen-back"),contactScreenHeader:$("contact-screen-header"),contactScreenHeaderPlaceholder:$("contact-screen-header-placeholder"),callScreen:$("call-screen"),callScreenAvatar:$("call-screen-avatar"),callScreenName:$("call-screen-name"),callScreenStatus:$("call-screen-status"),contactDiagnosticsPlaceholder:$("contact-diagnostics-placeholder"),contactScreenAvatar:$("contact-screen-avatar"),contactScreenName:$("contact-screen-name"),contactScreenCall:$("contact-screen-call"),callError:$("call-error-message"),answerIncoming:$("answer-incoming"),contactScreenMenu:$("contact-screen-menu"),openContactEdit:$("open-contact-edit"),openContactDelete:$("open-contact-delete"),contactEditScreen:$("contact-edit-screen"),contactEditScreenBack:$("contact-edit-screen-back"),contactDeleteScreen:$("contact-delete-screen"),contactDeleteScreenBack:$("contact-delete-screen-back"),contactDeleteName:$("contact-delete-name"),confirmDeleteContact:$("confirm-delete-contact"),cancelDeleteContact:$("cancel-delete-contact"),brandAbout:$("brand-about"),headerMenu:$("header-menu"),openAboutScreen:$("open-about-screen"),openSettingsScreen:$("open-settings-screen"),aboutScreen:$("about-screen"),aboutScreenBack:$("about-screen-back"),settingsScreen:$("settings-screen"),settingsScreenBack:$("settings-screen-back"),peer:$("peer-contact"),connect:$("connect"),dismissIncoming:$("dismiss-incoming"),rejectIncoming:$("reject-incoming"),contactEditTools:$("contact-edit-tools"),editContactName:$("edit-contact-name"),saveContactName:$("save-contact-name"),indicator:$("connection-indicator"),
 statusIcon:$("status-icon"),statusTitle:$("status-title"),statusText:$("status-text"),
 transport:$("transport-label"),tcp:$("tcp-fallback"),hangup:$("hangup"),micToggle:$("mic-toggle"),speakerToggle:$("speaker-toggle"),cameraToggle:$("camera-toggle"),cameraSwitch:$("camera-switch"),
 audio:$("remote-audio"),remoteVideo:$("remote-video"),localVideo:$("local-video"),callVideoStage:$("call-video-stage"),remoteVideoPlaceholder:$("remote-video-placeholder"),pilot:$("diagnostic-pilot"),cameraPilot:$("diagnostic-camera-pilot"),error:$("error-message"),debugLog:$("debug-log"),swDebugLog:$("sw-debug-log"),
 copyDebugLog:$("copy-debug-log"),copySwDebugLog:$("copy-sw-debug-log"),debugUrl:$("debug-url"),debugState:$("debug-state"),oneSignalStatus:$("onesignal-status"),cameraDevicesStatus:$("camera-devices-status"),cameraDevicesList:$("camera-devices-list"),refreshCameraDevices:$("refresh-camera-devices"),
  contactTools:$("contact-tools"),contactInvitationEntry:$("contact-invitation-entry"),contactInvitationDetails:$("contact-invitation-details"),contactPackage:$("contact-package"),pasteContact:$("paste-contact"),contactName:$("contact-name"),responseDisplayName:$("response-display-name"),saveResponseDisplayName:$("save-response-display-name"),saveResponseDisplayNameLabel:$("save-response-display-name-label"),responseDisplayNameSection:$("response-display-name-section"),importContact:$("import-contact"),scanQr:$("scan-qr"),qrVideo:$("qr-video"),qrStatus:$("qr-status"),profileDisplayName:$("profile-display-name"),inviteContactName:$("invite-contact-name"),inviteStatus:$("invite-status"),invitePushHint:$("invite-push-hint"),createInvite:$("create-invite"),inviteUrl:$("invite-url"),copyInviteInline:$("copy-invite-inline"),inviteQr:$("invite-qr"),replyInvite:$("reply-contact-invite"),replyInviteStatus:$("reply-contact-invite-status"),contactRequestText:$("contact-request-detail-text"),contactRequestReceivedAge:$("contact-request-received-age"),contactRequestAge:$("contact-request-age"),contactRequestActions:$("contact-request-actions"),acceptContactRequest:$("accept-contact-request"),declineContactRequest:$("decline-contact-request"),chatEvents:$("chat-events"),chatComposer:$("chat-composer"),chatMessage:$("chat-message"),sendChatMessage:$("send-chat-message")
};
const contactOverlayScreens=[
 els.profileScreen,els.invitationScreen,els.diagnosticScreen,els.addContactScreen,
 els.contactScreen,els.contactEditScreen,els.contactDeleteScreen,
 els.aboutScreen,els.settingsScreen
];
function syncContactScreenOpenClass(){
 const hasOpenScreen=contactOverlayScreens.some(screen=>screen&&!screen.classList.contains("hidden"));
 document.body.classList.toggle("contact-screen-open",hasOpenScreen);
}
// Keep the body state aligned even when an overlay is hidden by a path that
// does not call its dedicated close handler.
if(typeof MutationObserver!=="undefined"){
 const contactOverlayObserver=new MutationObserver(syncContactScreenOpenClass);
 for(const screen of contactOverlayScreens){
  if(screen)contactOverlayObserver.observe(screen,{attributes:true,attributeFilter:["class"]});
 }
}
syncContactScreenOpenClass();
window.voicelinkIsReadingChat=senderId=>
 document.visibilityState==="visible"&&
 !els.contactScreen.classList.contains("hidden")&&
 els.callScreen.classList.contains("hidden")&&
 els.profileScreen.classList.contains("hidden")&&
 els.invitationScreen.classList.contains("hidden")&&
 els.diagnosticScreen.classList.contains("hidden")&&
 els.addContactScreen.classList.contains("hidden")&&
 els.aboutScreen.classList.contains("hidden")&&
 els.settingsScreen.classList.contains("hidden")&&
 els.contactEditScreen.classList.contains("hidden")&&
 els.contactDeleteScreen.classList.contains("hidden")&&
 els.peer.value===senderId;
const PROFILE_DISPLAY_NAME_KEY="vl.profileDisplayName.v1";
function getProfileDisplayName(){return String(els.profileDisplayName.value||"").trim().slice(0,40)}
let profileInviteRevision=0;
function getInviteContactName(){return String(els.inviteContactName.value||"").trim().slice(0,40)}
function updateInviteUrlLabel(){
 const name=getInviteContactName();
 const label=document.getElementById("invite-url-label");
 if(label)label.textContent=name?`Ссылка-приглашение для ${name}`:"Ваша ссылка-приглашение";
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
const CONTACT_REQUESTS_CONFIRMED_KEY="vl.contactRequestsConfirmed.v1";
function loadConfirmedContactRequests(){
 try{const value=JSON.parse(localStorage.getItem(CONTACT_REQUESTS_CONFIRMED_KEY)||"[]");return Array.isArray(value)?value.filter(id=>SupabaseSecureSignaling.validUserId(id)):[]}
 catch{return []}
}
const completedContactRequests=new Set(loadConfirmedContactRequests());
function persistConfirmedContactRequests(){
 try{localStorage.setItem(CONTACT_REQUESTS_CONFIRMED_KEY,JSON.stringify([...completedContactRequests]))}
 catch(error){debug("Не удалось сохранить подтверждение обмена приглашениями: "+(error.message||String(error)))}
}
function markContactRequestReceived(userId){
 if(!SupabaseSecureSignaling.validUserId(userId))return;
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
const state={secure:null,webrtc:null,supabaseUserId:null,role:null,peerPresent:false,connecting:false,hangingUp:false,disconnectTimer:null,callStarted:false,answeringCall:false,editingName:false,incomingCall:false,incomingTimer:null,callAttemptTimer:null,callAttemptSid:null,callTimer:null,outgoingCall:false,outgoingCallExpiresAt:null,ringingKind:null,ringContext:null,ringPulseTimer:null,ringOscillators:[],ringMasterGain:null,ringAnalyser:null,ringDiagnosticTimers:[],ringDiagnosticDone:false,ringResumePromise:null,callPeer:"",callPeerLabel:"",callReturnFocus:null,micMuted:false,speakerOutputId:null,audioOutputCount:null,audioOutputCheckPending:false};
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
function notifyServiceWorkerDiagnosticMode(enabled){
 if(!("serviceWorker" in navigator))return;
 const send=worker=>{try{worker?.postMessage({type:"VL_SET_DIAGNOSTIC_MODE",enabled:!!enabled})}catch{}};
 send(navigator.serviceWorker.controller);
 navigator.serviceWorker.getRegistration().then(reg=>{send(reg?.active);send(reg?.waiting);send(reg?.installing)}).catch(()=>{});
}
function getBrowserDiagnosticName(){
 const ua=navigator.userAgent||"";
 if(/EdgA?\//.test(ua))return "Microsoft Edge";
 if(/OPR\//.test(ua)||/Opera/.test(ua))return "Opera";
 if(/SamsungBrowser\//.test(ua))return "Samsung Internet";
 if(/Firefox\//.test(ua)||/FxiOS\//.test(ua))return "Firefox";
 if(/CriOS\//.test(ua))return "Google Chrome (iOS)";
 if(/Chrome\//.test(ua))return "Google Chrome";
 if(/Safari\//.test(ua))return "Safari";
 return "Не определён (UA: "+ua.slice(0,100)+")";
}
function debug(message){
 if(!els.debugMode?.checked)return;
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
function updateInvitePushHint(){
 if(!els.invitePushHint)return;
 if(!( "Notification" in window)){
  els.invitePushHint.textContent="Этот браузер не поддерживает push-уведомления.";
  els.invitePushHint.classList.remove("hidden");
  return;
 }
 const permission=Notification.permission;
 if(permission==="granted"){
  els.invitePushHint.classList.add("hidden");
 }else if(permission==="denied"){
  els.invitePushHint.textContent="Уведомления для VoiceLink запрещены. Чтобы получать оповещения о входящих звонках, разрешите их для этого сайта в настройках браузера.";
  els.invitePushHint.classList.remove("hidden");
 }else{
  els.invitePushHint.textContent="Для оповещений о входящих звонках VoiceLink использует push-уведомления. Если разрешение ещё не предоставлено, браузер предложит разрешить их при создании приглашения.";
  els.invitePushHint.classList.remove("hidden");
 }
}
function updateWebPushStatus(){
 const permission="Notification" in window?Notification.permission:"unsupported";
 const label=permission==="granted"?"Разрешены":permission==="denied"?"Запрещены":permission==="default"?"Ожидают разрешения":"Не поддерживается";
 setServiceStatus(els.webPushStatus,label);
}
async function checkPushBackendAvailability(){
 const baseUrl="https://signal-backend-9tai.onrender.com/health";
 const started=performance.now();
 const onlineBefore=navigator.onLine,visibilityBefore=document.visibilityState;
 const requestId=crypto.randomUUID();
 // Query parameter keeps the request a simple GET (no custom-header CORS preflight)
 // and lets Render logs correlate a request even if the browser hides its response.
 const url=baseUrl+"?vl_diag="+encodeURIComponent(requestId);
 setServiceStatus(els.renderStatus,"Проверяем доступность…");
 debug(`[backend-health] START; requestId=${requestId}; method=GET; customHeaders=none; online=${onlineBefore}; visibility=${visibilityBefore}; host=signal-backend-9tai.onrender.com.`);
 const controller=new AbortController(),timeout=window.setTimeout(()=>controller.abort(),25000);
 try{
  const response=await fetch(url,{method:"GET",mode:"cors",credentials:"omit",cache:"no-store",signal:controller.signal});
  const bodyText=await response.text(),elapsed=Math.round(performance.now()-started);
  let body=null;try{body=JSON.parse(bodyText)}catch{}
  const meta={instanceId:body?.instanceId||response.headers.get("x-vl-instance-id"),uptimeMs:body?.uptimeMs??response.headers.get("x-vl-uptime-ms"),bootTime:body?.bootTime||response.headers.get("x-vl-boot-time"),serverTime:body?.serverTime||null,serverRequestId:response.headers.get("x-vl-request-id")};
  debug(`[backend-health] CORS_FETCH_OK; status=${response.status}; ok=${response.ok}; elapsed=${elapsed}ms; requestId=${requestId}; serverMeta=${JSON.stringify(meta)}; contentType=${response.headers.get("content-type")||"n/a"}; body=${bodyText.slice(0,300)||"(empty)"}.`);
  if(!response.ok){
   setServiceStatus(els.renderStatus,"HTTP "+response.status);
   debug(`[backend-health] classification=HTTP_ERROR; status=${response.status}; requestId=${requestId}; cors=working.`);
   return;
  }
  const uptime=meta.uptimeMs==null?NaN:Number(meta.uptimeMs);
  debug(`[backend-health] classification=REACHABLE_CORS_OK; coldStartLikely=${Number.isFinite(uptime)?uptime<120000:"unknown"}; uptimeMs=${Number.isFinite(uptime)?uptime:"unknown"}; requestId=${requestId}.`);
  setServiceStatus(els.renderStatus,Number.isFinite(uptime)&&uptime<120000?"Доступен (недавно запущен)":"Доступен");
 }catch(error){
  const elapsed=Math.round(performance.now()-started),name=error?.name||"unknown",message=error?.message||String(error);
  const primary=!navigator.onLine?"DEVICE_OFFLINE":name==="AbortError"?"CLIENT_TIMEOUT":"CORS_FETCH_REJECTED";
  debug(`[backend-health] phase=CORS_FETCH_FAILED; provisionalClassification=${primary}; elapsed=${elapsed}ms; errorName=${name}; errorMessage=${message}; online(before/after)=${onlineBefore}/${navigator.onLine}; visibility(before/after)=${visibilityBefore}/${document.visibilityState}; requestId=${requestId}. This failure alone does NOT prove CORS.`);
  if(!navigator.onLine||name==="AbortError"){
   setServiceStatus(els.renderStatus,!navigator.onLine?"Нет сети":"Тайм-аут");
   return;
  }
  const probeStarted=performance.now(),probeController=new AbortController(),probeTimer=window.setTimeout(()=>probeController.abort(),8000);
  try{
   const probe=await fetch(url,{method:"GET",mode:"no-cors",credentials:"omit",cache:"no-store",signal:probeController.signal});
   const probeElapsed=Math.round(performance.now()-probeStarted);
   debug(`[backend-health] NO_CORS_FETCH_OK; type=${probe.type}; elapsed=${probeElapsed}ms; requestId=${requestId}; classification=NETWORK_REQUEST_COMPLETED_CORS_UNCONFIRMED. Opaque response does not expose HTTP status or body.`);
   debug(`[backend-health] classification=CORS_LIKELY; corsFetch=failed; noCorsFetch=resolved; requestId=${requestId}. Check the matching health_request/health_response entries in Render logs to confirm whether the server received and answered this request.`);
   setServiceStatus(els.renderStatus,"Сервер отвечает; возможен CORS");
  }catch(probeError){
   const classification=!navigator.onLine?"DEVICE_OFFLINE":probeError?.name==="AbortError"?"PROBE_TIMEOUT":"BOTH_FETCHES_FAILED_UNRESOLVED";
   debug(`[backend-health] NO_CORS_FETCH_FAILED; classification=${classification}; elapsed=${Math.round(performance.now()-probeStarted)}ms; errorName=${probeError?.name||"unknown"}; errorMessage=${probeError?.message||String(probeError)}; online=${navigator.onLine}; requestId=${requestId}. DNS/TLS/routing/connection reset/Render edge remain indistinguishable from browser-side failures.`);
   setServiceStatus(els.renderStatus,classification==="DEVICE_OFFLINE"?"Нет сети":classification==="PROBE_TIMEOUT"?"Тайм-аут":"Нет ответа (причина не определена)");
  }finally{clearTimeout(probeTimer)}
 }finally{clearTimeout(timeout)}
}
async function checkServiceWorkerAvailability(){
 if(!("serviceWorker" in navigator)){setServiceStatus(els.serviceWorkerStatus,"Не поддерживается");return}
 try{
  const registration=await navigator.serviceWorker.getRegistration("/");
  setServiceStatus(els.serviceWorkerStatus,registration?.active?"Активен":registration?"Зарегистрирован, запускается":"Не зарегистрирован");
 }catch(error){setServiceStatus(els.serviceWorkerStatus,"Ошибка проверки")}
}
function updateCallVideoStage(){
 const localActive=!!state.webrtc?.videoEnabled;
 const remoteTrack=els.remoteVideo.srcObject?.getVideoTracks?.().find(track=>track.readyState==="live");
 // A negotiated recvonly/sendrecv video m-line creates a remote MediaStreamTrack
 // even when the peer has not enabled its camera. A muted track is only a
 // reserved receiver, not an attempt to connect video.
 const remoteActive=!!remoteTrack&&!remoteTrack.muted;
 els.callVideoStage.classList.toggle("hidden",!localActive&&!remoteActive);
 els.remoteVideo.classList.toggle("hidden",!remoteActive);
 els.remoteVideoPlaceholder.classList.toggle("hidden",remoteActive);
 els.localVideo.classList.toggle("hidden",!localActive);
 els.remoteVideoPlaceholder.textContent=localActive
  ?"Ожидаем видео собеседника"
  :"Видео собеседника выключено";
}
async function refreshAudioOutputCount(){
 if(state.audioOutputCheckPending||state.audioOutputCount!==null)return;
 state.audioOutputCheckPending=true;
 try{
  const devices=await navigator.mediaDevices?.enumerateDevices?.()||[];
  state.audioOutputCount=devices.filter(device=>device.kind==="audiooutput"&&device.deviceId&&device.deviceId!=="default"&&device.deviceId!=="communications").length;
 }catch(error){
  state.audioOutputCount=0;
  debug("Не удалось определить аудиовыходы: "+(error.message||String(error)));
 }finally{
  state.audioOutputCheckPending=false;
  updateCallButtons();
 }
}
function updateCallButtons(){
 const active=!!(state.connecting||state.peerPresent||state.outgoingCall||state.secure?.active||state.callStarted||state.answeringCall);

 els.connect.classList.toggle("hidden",active);
 els.connect.disabled=active||state.connecting;
 els.connect.textContent=state.connecting?"Подключаемся…":state.incomingCall?"Ответить":"Подключиться";
 els.hangup.classList.toggle("hidden",!active);
 els.hangup.disabled=!active||state.hangingUp;
 const dialing=!!(state.outgoingCall||(state.connecting&&!state.answeringCall&&!state.peerPresent));
 els.hangup.setAttribute("aria-label",dialing?"Отменить вызов":"Завершить звонок");
 els.hangup.title=dialing?"Отменить вызов":"Завершить звонок";
 els.hangup.dataset.caption=dialing?"Отменить\nвызов":"Завершить\nзвонок";
 els.micToggle.classList.toggle("hidden",!active);
 els.micToggle.disabled=!active||state.hangingUp||!state.webrtc?.localStream;
 const micEnabled=!!state.webrtc?.micEnabled;
 state.micMuted=!micEnabled;
 els.micToggle.setAttribute("aria-pressed",String(!micEnabled));
 els.micToggle.setAttribute("aria-label",micEnabled?"Микрофон включен":"Микрофон выключен");
 els.micToggle.title=micEnabled?"Микрофон включен":"Микрофон выключен";
 els.micToggle.dataset.caption=micEnabled?"Микрофон\nвключен":"Микрофон\nвыключен";
 els.micToggle.dataset.muted=String(!micEnabled);
 if(active&&state.audioOutputCount===null)refreshAudioOutputCount();
 const canSelectOutput=typeof els.audio.setSinkId==="function"&&typeof navigator.mediaDevices?.selectAudioOutput==="function";
 els.speakerToggle.classList.toggle("hidden",!active||!canSelectOutput||state.audioOutputCount===null||state.audioOutputCount<=1);
 const androidUa=navigator.userAgent.toLowerCase();
 const androidChromeOrFirefox=androidUa.includes("android")&&(androidUa.includes("chrome/")||androidUa.includes("firefox/"));
 if(androidChromeOrFirefox){
  els.speakerToggle.disabled=true;
  els.speakerToggle.setAttribute("aria-pressed","true");
  els.speakerToggle.setAttribute("aria-label","Динамик включен");
  els.speakerToggle.title="Динамик включен";
  els.speakerToggle.dataset.enabled="true";
  els.speakerToggle.dataset.caption="Динамик\nвключен";
 }else{
  els.speakerToggle.disabled=!active||state.hangingUp||!canSelectOutput;
  const speakerEnabled=!!state.speakerOutputId;
  els.speakerToggle.setAttribute("aria-pressed",String(speakerEnabled));
  els.speakerToggle.setAttribute("aria-label",speakerEnabled?"Динамик включен":"Динамик выключен");
  els.speakerToggle.title=canSelectOutput?(speakerEnabled?"Динамик включен":"Динамик выключен"):"Переключение аудиовыхода не поддерживается этим браузером";
  els.speakerToggle.dataset.enabled=String(speakerEnabled);
  els.speakerToggle.dataset.caption=speakerEnabled?"Динамик\nвключен":"Динамик\nвыключен";
 }
 const canUseCamera=!!(active&&state.peerPresent&&!state.outgoingCall&&!state.hangingUp&&state.webrtc?.videoSender);
 els.cameraToggle.classList.toggle("hidden",!active);
 els.cameraToggle.disabled=!canUseCamera;
 const cameraEnabled=!!state.webrtc?.videoEnabled;
 els.cameraToggle.setAttribute("aria-pressed",String(cameraEnabled));
 els.cameraToggle.setAttribute("aria-label",cameraEnabled?"Камера включена":"Камера выключена");
 els.cameraToggle.title=cameraEnabled?"Камера включена":"Камера выключена";
 els.cameraToggle.dataset.enabled=String(cameraEnabled);
 els.cameraToggle.dataset.caption=cameraEnabled?"Камера\nвключена":"Камера\nвыключена";
 els.cameraSwitch.dataset.caption="";
 els.cameraSwitch.setAttribute("aria-label","Переключить камеру");
 els.cameraSwitch.title="Переключить камеру";
 els.cameraSwitch.classList.toggle("hidden",!cameraEnabled||!!state.webrtc?.diagnosticCamera);
 els.cameraSwitch.disabled=!canUseCamera;
 updateCallVideoStage();
 els.answerIncoming.disabled=state.connecting;
 els.dismissIncoming.disabled=state.connecting;
 const selectedPeer=SupabaseSecureSignaling.validUserId(els.peer.value)&&els.peer.value!==state.me;
 const callBlocked=!state.incomingCall&&!selectedPeer;
 els.contactScreenCall.disabled=active||state.connecting||callBlocked;
 els.contactScreenCall.setAttribute("aria-label",state.incomingCall?"Ответить на звонок":callBlocked?"Выберите контакт":"Позвонить");
 els.contactScreenCall.title=state.incomingCall?"Ответить на звонок":active||state.connecting?"Звонок уже устанавливается или идёт":"Позвонить";
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
 els.replyInvite.classList.add("hidden");
 els.replyInvite.disabled=true;
}
function setBusy(value){state.connecting=value;updateCallButtons();els.peer.disabled=value}
function stopRinging({suspend=true}={}){
 const stoppedKind=state.ringingKind;
 state.ringingKind=null;
 if(state.ringPulseTimer){clearTimeout(state.ringPulseTimer);state.ringPulseTimer=null}
 for(const timer of state.ringDiagnosticTimers)clearTimeout(timer);
 state.ringDiagnosticTimers.length=0;
 const activeNodes=state.ringOscillators.splice(0);
 for(const node of activeNodes){
  try{node.oscillator.stop()}catch{}
  try{node.oscillator.disconnect()}catch{}
  try{node.gain.disconnect()}catch{}
 }
 if(state.ringMasterGain){try{state.ringMasterGain.disconnect()}catch{};state.ringMasterGain=null}
 if(state.ringAnalyser){try{state.ringAnalyser.disconnect()}catch{};state.ringAnalyser=null}
 if(suspend&&state.ringContext&&state.ringContext.state==="running"){
  state.ringContext.suspend().catch(error=>debug("[ring] не удалось приостановить AudioContext: "+(error.message||String(error))));
 }
}
function prepareRingOutput(context){
 const master=context.createGain(),analyser=context.createAnalyser();
 master.gain.setValueAtTime(1,context.currentTime);
 analyser.fftSize=2048;analyser.smoothingTimeConstant=0;
 // Анализатор используется только как боковая ветвь измерения.
 // Основной сигнал идёт напрямую в destination, минуя AnalyserNode.
 master.connect(analyser);master.connect(context.destination);
 state.ringMasterGain=master;state.ringAnalyser=analyser;
}
function logRingOutputRms(label){
 const analyser=state.ringAnalyser;if(!analyser)return;
 const samples=new Float32Array(analyser.fftSize);analyser.getFloatTimeDomainData(samples);
 let sum=0,peak=0;
 for(const sample of samples){const value=Math.abs(sample);sum+=sample*sample;if(value>peak)peak=value}
 const rms=Math.sqrt(sum/samples.length);
 debug(`[ring-audio] ${label}: RMS=${rms.toFixed(6)} peak=${peak.toFixed(6)} context=${state.ringContext?.state||"none"}.`);
}
function scheduleRingDiagnostic(label,delay){
 const timer=setTimeout(()=>{
  const index=state.ringDiagnosticTimers.indexOf(timer);if(index!==-1)state.ringDiagnosticTimers.splice(index,1);
  logRingOutputRms(label);
 },delay);
 state.ringDiagnosticTimers.push(timer);
}
function scheduleRingTone(frequency,start,duration,{type="sine",volume=0.035,ramp=0.06}={}){
 const context=state.ringContext;
 const oscillator=context.createOscillator(),gain=context.createGain();
 oscillator.type=type;
 oscillator.frequency.setValueAtTime(frequency,start);
 // В паузе между гудками усиление должно быть ровно нулевым, а не остаточным 0.0001.
 gain.gain.setValueAtTime(0,start);
 gain.gain.linearRampToValueAtTime(volume,start+ramp);
 gain.gain.setValueAtTime(volume,start+duration-0.08);
 gain.gain.linearRampToValueAtTime(0,start+duration);
 oscillator.connect(gain);gain.connect(state.ringMasterGain||context.destination);
 const node={oscillator,gain};
 state.ringOscillators.push(node);
 oscillator.addEventListener("ended",()=>{
  try{oscillator.disconnect()}catch{}
  try{gain.disconnect()}catch{}
  const index=state.ringOscillators.indexOf(node);
  if(index!==-1)state.ringOscillators.splice(index,1);
 },{once:true});
 oscillator.start(start);oscillator.stop(start+duration);
}
function unlockRingingAudio(event){
 try{
  const target=event?.target;
  if(target instanceof Element&&target.closest("#connect, #contact-screen-call, #answer-incoming")){
   debug("[ring] действие вызова: пользовательский click разблокирует аудио для звонка; предварительный запуск отключён.");
   return;
  }
  // Остальные пользовательские действия могут заранее разблокировать Web Audio
  // для отдельной мелодии входящего вызова.
  const AudioContextClass=window.AudioContext||window.webkitAudioContext;
  if(!AudioContextClass){debug("[ring] Web Audio API недоступен при разблокировке входящей мелодии.");return}
  if(!state.ringContext)state.ringContext=new AudioContextClass();
  const context=state.ringContext;
  if(context.state==="suspended"){
   debug("[ring] пользовательское действие: разблокируем AudioContext для входящей мелодии; visibility="+document.visibilityState+".");
   context.resume().then(()=>debug("[ring] AudioContext после пользовательского действия: "+context.state+".")).catch(error=>debug("[ring] resume после пользовательского действия отклонён: "+(error.message||String(error))));
  }
 }catch(error){debug("[ring] ошибка подготовки аудио: "+(error.message||String(error)))}
}
async function startRinging(kind){
 stopRinging({suspend:false});state.ringingKind=kind;state.ringDiagnosticDone=false;
 if(kind==="outgoing"){
  try{
   const AudioContextClass=window.AudioContext||window.webkitAudioContext;
   if(!AudioContextClass)throw Error("Web Audio API недоступен");
   if(!state.ringContext)state.ringContext=new AudioContextClass({latencyHint:"interactive"});
   const ringContext=state.ringContext;
   if(!ringContext.__vlStateLogger){
    ringContext.__vlStateLogger=true;
    ringContext.addEventListener("statechange",()=>{
     debug("[ring] AudioContext statechange: "+ringContext.state+".");
     if(ringContext.state!=="suspended"||state.ringContext!==ringContext||!["incoming","outgoing"].includes(state.ringingKind)||state.ringResumePromise)return;
     const ringingKind=state.ringingKind;
     debug("[ring] AudioContext сам перешёл в suspended во время звонка; автоматически восстанавливаем аудиопоток.");
     const resumePromise=ringContext.resume()
      .then(()=>{
       if(state.ringContext===ringContext&&state.ringingKind===ringingKind)debug("[ring] AudioContext автоматически восстановлен: "+ringContext.state+".");
      })
      .catch(error=>debug("[ring] автоматическое восстановление AudioContext не удалось: "+(error.message||String(error))))
      .finally(()=>{if(state.ringResumePromise===resumePromise)state.ringResumePromise=null});
     state.ringResumePromise=resumePromise;
    });
   }
   debug("[ring] start outgoing oscillator; AudioContext="+ringContext.state+"; visibility="+document.visibilityState+".");
   // Вызываем resume до первого await: при исходящем вызове это ещё
   // находится внутри пользовательского click-жеста.
   const resumePromise=ringContext.state==="suspended"?ringContext.resume():Promise.resolve();
   await resumePromise;
   if(state.ringingKind!=="outgoing"){debug("[ring] запуск исходящего осциллятора отменён.");return}
   if(ringContext.state!=="running")throw Error("AudioContext не перешёл в running: "+ringContext.state);
   prepareRingOutput(ringContext);
   const pulse=()=>{
    if(state.ringingKind!=="outgoing")return;
    const now=ringContext.currentTime;
    // Стандартный двухчастотный ringback: 440 + 480 Hz, 2 секунды звук / 4 секунды пауза.
    scheduleRingTone(440,now,2,{type:"sine",volume:0.020,ramp:0.04});
    scheduleRingTone(480,now,2,{type:"sine",volume:0.020,ramp:0.04});
    state.ringPulseTimer=setTimeout(pulse,6000);
    debug("[ring] исходящий ringback: два sine-осциллятора 440/480 Hz; 2s on / 4s off.");
   };
   pulse();
   scheduleRingDiagnostic("outgoing-start",120);
   scheduleRingDiagnostic("outgoing-after-tone",2200);
  }catch(error){
   debug("[ring] не удалось включить исходящий осциллятор: "+(error.message||String(error))+"; AudioContext="+(state.ringContext?.state||"нет")+".");
  }
  return;
 }
 try{
  const AudioContextClass=window.AudioContext||window.webkitAudioContext;
  if(!AudioContextClass)throw Error("Web Audio API недоступен");
  if(!state.ringContext)state.ringContext=new AudioContextClass();
  const ringContext=state.ringContext;
  if(!ringContext.__vlStateLogger){
   ringContext.__vlStateLogger=true;
   ringContext.addEventListener("statechange",()=>{
    debug("[ring] AudioContext statechange: "+ringContext.state+".");
    if(ringContext.state!=="suspended"||state.ringContext!==ringContext||!["incoming","outgoing"].includes(state.ringingKind)||state.ringResumePromise)return;
    const ringingKind=state.ringingKind;
    debug("[ring] AudioContext сам перешёл в suspended во время звонка; автоматически восстанавливаем аудиопоток.");
    const resumePromise=ringContext.resume()
     .then(()=>{
      if(state.ringContext===ringContext&&state.ringingKind===ringingKind)debug("[ring] AudioContext автоматически восстановлен: "+ringContext.state+".");
     })
     .catch(error=>debug("[ring] автоматическое восстановление AudioContext не удалось: "+(error.message||String(error))))
     .finally(()=>{if(state.ringResumePromise===resumePromise)state.ringResumePromise=null});
    state.ringResumePromise=resumePromise;
   });
  }
  debug("[ring] start kind="+kind+"; AudioContext="+state.ringContext.state+"; visibility="+document.visibilityState+"; notificationPermission="+(window.Notification?.permission||"unsupported")+".");
  if(state.ringContext.state==="suspended"){
   debug("[ring] AudioContext suspended: запрашиваем resume; incoming UI уже показан.");
   await state.ringContext.resume();
  }
  if(state.ringingKind!==kind){debug("[ring] запуск отменён: тип звонка уже изменился.");return}
  if(state.ringContext.state!=="running"){debug("[ring] мелодия не запущена: AudioContext="+state.ringContext.state+"; браузер заблокировал воспроизведение.");return}
  debug("[ring] AudioContext running; запускаем мелодию.");
  prepareRingOutput(state.ringContext);
  const pulse=()=>{
   if(state.ringingKind!==kind)return;
   const now=state.ringContext.currentTime;
   // Входящая мелодия остаётся на Web Audio; исходящий гудок воспроизводится отдельным WAV.
   const notes=[880,1175,988,784],step=0.28,noteDuration=0.22;
   notes.forEach((frequency,index)=>{
    scheduleRingTone(frequency,now+index*step,noteDuration,{type:"triangle",volume:0.045});
   });
   state.ringPulseTimer=setTimeout(pulse,3.2*1000);
   debug("[ring] входная мелодия запущена; следующий повтор через 3.2s.");
  };
  pulse();
 }catch(error){debug("[ring] не удалось включить звук звонка: "+(error.message||String(error))+"; AudioContext="+(state.ringContext?.state||"нет")+".");}
}
function clearIncomingUi(){
 if(state.incomingTimer){clearTimeout(state.incomingTimer);state.incomingTimer=null}
 state.incomingCall=false;els.answerIncoming.classList.add("hidden");els.dismissIncoming.classList.add("hidden");els.rejectIncoming.classList.add("hidden");updateCallButtons();
}
function clearIncomingAttemptTimer(sid=null){
 if(sid&&state.callAttemptSid!==sid)return;
 if(state.callAttemptTimer){clearTimeout(state.callAttemptTimer);state.callAttemptTimer=null}
 state.callAttemptSid=null;
}
function startIncomingAttemptTimer(sid,receivedAt=performance.now()){
 clearIncomingAttemptTimer();
 state.callAttemptSid=sid;
 const remaining=Math.max(0,45000-(performance.now()-receivedAt));
 state.callAttemptTimer=window.setTimeout(()=>{
  state.callAttemptTimer=null;
  if(state.callAttemptSid!==sid)return;
  if(state.secure?.hello?.sid!==sid&&state.secure?.incomingHello?.sid!==sid){clearIncomingAttemptTimer(sid);return}
  debug("Истёк локальный 45-секундный срок входящего вызова; sid="+sid+".");
  if(state.incomingCall)dismissIncoming(true);
  else if(state.answeringCall)hangup({notifyPeer:false,failure:true});
  else clearIncomingAttemptTimer(sid);
 },remaining);
}
function setCallPeer(peerId,fallbackLabel=""){
 state.callPeer=SupabaseSecureSignaling.validUserId(peerId)&&peerId!==state.me?peerId:"";
 const item=state.callPeer?Array.from(els.contactList.querySelectorAll(".contact-list-item[data-peer]")).find(node=>node.dataset.peer===state.callPeer):null;
 const label=item?.querySelector(".contact-list-name")?.textContent?.trim()||String(fallbackLabel||"").trim()||"Контакт";
 state.callPeerLabel=label;
 els.callScreenName.textContent=label;
 els.callScreenAvatar.textContent=contactInitials(label);
 els.callScreenAvatar.style.backgroundColor=contactAvatarColor(state.callPeer);
}
function showIncomingCall({peer,peerId,sid,receivedAt}){
 if(state.connecting||state.callStarted||state.incomingCall||!sid)return;
 const incomingPeer=peerId||state.secure?.peer||"";
 if(!SupabaseSecureSignaling.validUserId(incomingPeer)||incomingPeer===state.me)return;
 if(state.outgoingCall){
  if(state.secure?.role!=="A"||state.secure?.hello)return;
  stopOutgoingCall();
  debug("Одновременный вызов: роль A принимает входящий запрос; исходящий запрос отменён локально.");
 }
 setCallPeer(incomingPeer,peer);
 startIncomingAttemptTimer(sid,receivedAt);
 state.incomingCall=true;
 els.answerIncoming.classList.remove("hidden");els.dismissIncoming.classList.remove("hidden");els.rejectIncoming.classList.remove("hidden");
 openCallScreen();
 updateCallButtons();
 els.callScreenStatus.textContent="Входящий вызов";
 setStatus("Входящий вызов","Вам звонит "+state.callPeerLabel+". Нажмите «Ответить», «Отклонить» или «Скрыть вызов».","wait");
 debug("Входящий вызов от "+state.callPeerLabel+".");
 startRinging("incoming");
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
 state.outgoingCall=true;state.outgoingCallExpiresAt=expiresAt;updateCallButtons();const peerLabel=state.callPeerLabel||"Контакт";els.callScreenStatus.textContent="Вызываем…";setStatus("Вызываем "+peerLabel,"Ожидаем ответа. Вызов завершится автоматически через 45 секунд.","wait");
 if(state.ringingKind!=="outgoing")startRinging("outgoing");
 scheduleOutgoingCallExpiry();
}
async function rejectIncoming(){
 if(!state.incomingCall)return;
 try{
  await state.secure?.rejectIncoming();
  clearIncomingAttemptTimer();
  clearIncomingUi();stopRinging();
  setStatus("Вызов отклонён","Вызывающий получил подтверждённое уведомление об отказе.","idle");
  debug("Входящий вызов явно отклонён; подтверждённое сообщение отправлено через Supabase.");
  closeCallScreen();
 }catch(error){showError("Не удалось отправить отказ: "+(error.message||String(error)));}
}
async function dismissIncoming(timedOut=false){
 if(!state.incomingCall)return;
 clearIncomingAttemptTimer();
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
 stopRemoteAudioDiagnostics();stopOutgoingCall();clearIncomingUi();state.secure?.resetSession();
 if(state.webrtc){await state.webrtc.close({stopTracks:true});state.webrtc=null}
 els.audio.srcObject=null;els.remoteVideo.srcObject=null;els.localVideo.srcObject=null;updateCallVideoStage();els.hangup.disabled=true;els.pilot.disabled=false;els.transport.textContent="Не выбран";
 state.callStarted=false;state.peerPresent=false;updateCallButtons();
 setStatus("Вызов отклонён",(info.peer||"Контакт")+" отклонил входящий вызов.","idle");
 debug("Получен подписанный отказ от вызова "+info.sid+".");
 closeCallScreen();
}
async function finishNoAnswer(){
 if(!state.outgoingCall)return;
 stopRemoteAudioDiagnostics();stopOutgoingCall();clearIncomingUi();state.secure?.resetSession();
 if(state.webrtc){await state.webrtc.close({stopTracks:true});state.webrtc=null}
 els.audio.srcObject=null;els.remoteVideo.srcObject=null;els.localVideo.srcObject=null;updateCallVideoStage();els.hangup.disabled=true;els.pilot.disabled=false;els.transport.textContent="Не выбран";
 state.callStarted=false;state.peerPresent=false;updateCallButtons();
 setStatus("Нет ответа","Время ожидания истекло. Вызов завершён только на этом устройстве; уведомление об отмене не отправлялось.","idle");
 debug("Исходящий вызов истёк через 45 секунд; отменяющий POST не отправлялся.");
 closeCallScreen();
}
let remoteAudioDiagnosticTimer=null;
function stopRemoteAudioDiagnostics(){
 if(remoteAudioDiagnosticTimer!==null){clearInterval(remoteAudioDiagnosticTimer);remoteAudioDiagnosticTimer=null}
}
function logRemoteAudioPlayback(){
 const audio=els.audio;
 if(!audio.srcObject){stopRemoteAudioDiagnostics();return}
 const track=audio.srcObject.getAudioTracks?.()[0];
 debug("Audio playback: readyState="+audio.readyState+
  "; paused="+audio.paused+
  "; currentTime="+audio.currentTime.toFixed(2)+"s"+
  "; playbackRate="+audio.playbackRate+
  "; visibility="+document.visibilityState+
  "; track="+(track?("readyState="+track.readyState+",enabled="+track.enabled+",muted="+track.muted):"none")+
  "; error="+(audio.error?.code||"none"));
}
function createWebRtcInstance(diagnosticPilot=els.pilot.checked,diagnosticCamera=els.cameraPilot.checked){
 const me=state.me,peer=state.callPeer||state.secure?.peer||els.peer.value;
 const audioDiagnostics=els.debugMode.checked||diagnosticPilot||diagnosticCamera;
 return new WebRtcAudio({
  diagnosticPilot,
  diagnosticCamera,
  audioDiagnostics,
  initiator:SupabaseSecureSignaling.validUserId(me)&&SupabaseSecureSignaling.validUserId(peer)&&me<peer,
  onRemoteHangup:()=>handleRemoteHangup(),
  sendSignal:payload=>state.secure.sendSignal(payload),
  onLocalVideoStream:stream=>{
   els.localVideo.srcObject=stream;
   els.localVideo.classList.toggle("is-front-camera",state.webrtc?.cameraFacingMode==="user");
   if(stream){const playResult=els.localVideo.play();if(playResult?.catch)playResult.catch(error=>debug("Не удалось показать локальное видео: "+error.message));}
   updateCallButtons();
   updateCallVideoStage();
  },
  onRemoteStream:stream=>{
   stopRemoteAudioDiagnostics();
   els.audio.srcObject=stream;
   els.remoteVideo.srcObject=stream;
   for(const videoTrack of stream.getVideoTracks?.()||[]){
    videoTrack.addEventListener("mute",updateCallVideoStage);
    videoTrack.addEventListener("unmute",updateCallVideoStage);
    videoTrack.addEventListener("ended",updateCallVideoStage);
   }
   els.remoteVideo.onplaying=()=>debug("WebRTC: REMOTE_VIDEO_PLAYING; readyState="+els.remoteVideo.readyState+"; videoWidth="+els.remoteVideo.videoWidth+"; videoHeight="+els.remoteVideo.videoHeight);
   const videoPlay=els.remoteVideo.play();if(videoPlay?.catch)videoPlay.catch(error=>{
    debug("Не удалось включить удалённое видео: "+error.name+": "+error.message);
   });
   updateCallVideoStage();
   const track=stream.getAudioTracks?.()[0];
   if(track){
    track.addEventListener("mute",()=>debug("Remote audio track event: mute"));
    track.addEventListener("unmute",()=>debug("Remote audio track event: unmute"));
    track.addEventListener("ended",()=>debug("Remote audio track event: ended"));
   }
   const playResult=els.audio.play();
   if(playResult&&typeof playResult.then==="function"){
    playResult.then(()=>{
     debug("Audio playback started: readyState="+els.audio.readyState+
      "; paused="+els.audio.paused+
      "; sampleTime="+els.audio.currentTime.toFixed(2)+"s"+
      "; visibility="+document.visibilityState);
     if(audioDiagnostics){
      logRemoteAudioPlayback();
      remoteAudioDiagnosticTimer=window.setInterval(logRemoteAudioPlayback,10000);
     }
    }).catch(e=>debug("Не удалось включить удалённый звук: "+e.message));
   }else if(audioDiagnostics){
    logRemoteAudioPlayback();
    remoteAudioDiagnosticTimer=window.setInterval(logRemoteAudioPlayback,10000);
   }
  },
  onError:error=>showError(error.message||String(error)),
  onState:value=>{
   debug("WebRTC: "+value);
   // Normalize diagnostic prefixes such as PC[id] connection-connected.
   const event=String(value).match(/(?:^|\s)(connection-[a-z]+|ice-[a-z]+)\.?$/)?.[1]||value;
   if(event==="local-audio-ready"||event==="Симуляция камеры включена: передаётся тестовое изображение."||event==="Камера выключена."||event==="Камера остановлена устройством.")updateCallButtons();
   else if(event==="connection-connected"){
    clearIncomingAttemptTimer();
    if(state.disconnectTimer){clearTimeout(state.disconnectTimer);state.disconnectTimer=null}
    updateCallButtons();if(els.callScreenStatus)els.callScreenStatus.textContent="На связи";els.transport.textContent="Прямой WebRTC / P2P";setStatus("WebRTC соединение установлено","Проверяем передачу аудио между устройствами.","live")
   }
   else if(event==="connection-failed"||event==="ice-failed"){
    if(state.disconnectTimer){clearTimeout(state.disconnectTimer);state.disconnectTimer=null}
    els.transport.textContent="WebRTC: соединение не установлено";setStatus("P2P не получилось","Сигнализация работает, но прямой аудиоканал не установился. TURN-сервер пока не настроен.","error");
    if(state.peerPresent&&!state.hangingUp)hangup({notifyPeer:false,failure:true})
   }
   else if(event==="connection-connecting"||event==="ice-checking"||event==="ice-connected"||event==="ice-completed"){
    if((event==="ice-connected"||event==="ice-completed")&&state.disconnectTimer){clearTimeout(state.disconnectTimer);state.disconnectTimer=null}
    setStatus("Устанавливаем аудиосоединение","Проверяем сетевые маршруты между устройствами.","wait")
   }
   else if(event==="connection-disconnected"||event==="ice-disconnected"){
    setStatus("Связь прервалась","Даём WebRTC время восстановить соединение (15 секунд).","wait");
    if(!state.disconnectTimer)state.disconnectTimer=setTimeout(()=>{
     state.disconnectTimer=null;
     if(state.webrtc?.pc?.connectionState==="disconnected"&&!state.hangingUp)hangup({notifyPeer:false,failure:true});
    },15000)
   }
   else if(event==="control-open"){debug("P2P управляющий канал готов (RTCDataChannel).")}
   else if(event==="control-closed"){debug("P2P управляющий канал закрыт.")}
  }
 });
}
async function ensureWebRtc(){
 if(!state.webrtc)state.webrtc=createWebRtcInstance();
}
function setSecurePeer(peer=""){
 if(!state.secure||state.secure.active||state.connecting)return;
 const nextPeer=SupabaseSecureSignaling.validUserId(peer)&&peer!==state.secure.me?peer:"";
 if(state.secure.peer===nextPeer)return;
 state.secure.setPeer(nextPeer);
}
function createSecureSignaling(me,peer=""){
 return new SupabaseSecureSignaling({
  me,peer,
  onSignal:handleSignal,
  onStatus:m=>{
   els.statusText.textContent=m;debug(m);
   setServiceStatus(els.supabaseStatus,"Подключён");
  },
  onIncoming:showIncomingCall,
  onPeerMessage:markContactRequestReceived,
  onConversationEvent:async event=>{
   await addConversationEvent(event);
   const storedEvents=await listConversationEvents(event.contact_user_id);
   const storedEvent=storedEvents.find(item=>item.id===event.id);
   if(!storedEvent||storedEvent.type!==event.type||storedEvent.direction!==event.direction||
      (event.type==="text"&&storedEvent.text!==event.text)){
    throw Error("Локальная проверка истории не подтвердила сохранение события "+String(event.id).slice(0,12)+".");
   }
   if(event.type==="text")debug("[chat-store] сообщение подтверждено повторным чтением IndexedDB; contact="+event.contact_user_id.slice(0,10)+"; direction="+event.direction+"; textLength="+event.text.length+".");
   if(els.peer.value===event.contact_user_id){
    await renderConversation(event.contact_user_id);
    const rendered=els.chatEvents?.querySelectorAll(".chat-message-bubble").length||0;
    debug("[chat-ui] история перерисована; contact="+event.contact_user_id.slice(0,10)+"; textBubbles="+rendered+".");
   }
  },
  onConversationDelivery:async event=>{await markConversationMessageDelivered(event.contact_user_id,event.message_id,event.delivered_at);if(els.peer.value===event.contact_user_id)renderConversation(event.contact_user_id).catch(error=>debug("Не удалось обновить статус доставки: "+(error.message||String(error))))},
  onConversationSent:async event=>{await updateConversationMessageDeliveryStatus(event.contact_user_id,event.message_id,"sent");if(els.peer.value===event.contact_user_id)renderConversation(event.contact_user_id).catch(error=>debug("Не удалось обновить статус отправки: "+(error.message||String(error))))},
  onCancelIncoming:info=>{
   if(state.incomingCall){
    clearIncomingAttemptTimer(info.sid);
    clearIncomingUi();
    stopRinging();
    state.secure?.dismissIncoming();
    setStatus("Вызов отменён",info.peer+" отменил вызов до ответа.","idle");
    debug("Входящий вызов "+info.sid+" отменён вызывающим через Supabase.");
    closeCallScreen();
   }
  },
  onRejectOutgoing:info=>{finishRejectedCall(info).catch(error=>showError(error.message||String(error)))},
  onDialing:info=>{if(!state.answeringCall){startOutgoingCall(info);sendPushEventToContact(state.callPeer||state.secure?.peer||info.peer,"incoming_call",info.callId,info.expiresAt,debug).then(()=>debug("OneSignal принял push входящего вызова.")).catch(error=>debug("Push не отправлен (сигнализация звонка работает через Supabase): "+error.message))}},
  onReady:()=>{stopOutgoingCall();clearIncomingUi();stopRinging();return onSecureReady().catch(showError)},
  onError:e=>showError(e.message||String(e)),
  onDebug:debug
 });
}
async function subscribeForUser(me){
 if(!SupabaseSecureSignaling.validUserId(me))return false;
 if(!state.supabaseUserId)throw Error("Supabase Auth недоступен. Для защищённого обмена требуется подключение к Supabase.");
 if(state.secure&&state.secure.me===me&&!state.secure.closed){await state.secure.subscribe();return true}
 if(state.secure){state.secure.close();state.secure=null}
 const peer=els.peer.value;
 const subscription=createSecureSignaling(me,SupabaseSecureSignaling.validUserId(peer)&&peer!==me?peer:"");
 state.secure=subscription;
 els.debugUrl.textContent="Supabase · "+state.supabaseUserId.slice(0,12)+"…";
 setStatus("Локальная идентичность готова","Входящие сообщения принимаются через Supabase inbox.","live");
 await subscription.subscribe();
 return true;
}
if("serviceWorker" in navigator){
 function requestServiceWorkerLog(target=navigator.serviceWorker.controller){
  if(!els.debugMode.checked)return;
  target?.postMessage({type:"VL_GET_SW_LOG"});
 }
 let swLogStartedAt=null;
 function appendServiceWorkerLog(stage,details={}){
  if(!els.debugMode.checked||!els.swDebugLog)return;
  const now=new Date();
  if(swLogStartedAt===null)swLogStartedAt=now.getTime();
  const line=formatDiagnosticLogTimestamp(now,now.getTime()-swLogStartedAt)+" "+stage+" "+JSON.stringify(details);
  const current=els.swDebugLog.textContent;
  els.swDebugLog.textContent=(current==="Ожидаем событий Service Worker."||current==="Записей пока нет."?"":current+"\n")+line;
  if(diagnosticLogAutoFollow.serviceWorker)scrollDiagnosticLogToBottom(els.swDebugLog);
 }
 function renderServiceWorkerLog(logs){
  if(!els.debugMode.checked||!els.swDebugLog)return;
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
  if(!els.debugMode.checked||!reg)return;
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
  notifyServiceWorkerDiagnosticMode(els.debugMode.checked);
  if(els.debugMode.checked){requestServiceWorkerLog();navigator.serviceWorker.getRegistration().then(requestServiceWorkerStatus)}
 });
 navigator.serviceWorker.ready.then(reg=>{
  notifyServiceWorkerDiagnosticMode(els.debugMode.checked);
  if(els.debugMode.checked){requestServiceWorkerLog(reg.active);requestServiceWorkerStatus(reg)}
 });
 navigator.serviceWorker.getRegistration().then(reg=>{if(els.debugMode.checked)requestServiceWorkerStatus(reg)});
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
   debug("VoiceLink получил из Service Worker "+pending.length+" сохранённых push-событий; запускаем восстановление Supabase inbox.");
   scheduleSupabaseInboxRecovery();
   event.source?.postMessage({type:"VL_CLEAR_PUSH_EVENTS"});
   return;
  }
  if(event.data?.type!=="VL_PUSH_RECEIVED")return;
  appendServiceWorkerLog("push_event_received",{source:"service_worker_message"});
  debug("Service Worker получил фоновый push. Запускаем восстановление Supabase inbox.");
  scheduleSupabaseInboxRecovery();
 });
}
async function onSecureReady(){
 state.answeringCall=false;
 state.peerPresent=true;state.role=state.secure.role==="A"?"initiator":"receiver";
 if(els.callScreenStatus)els.callScreenStatus.textContent="Соединяемся…";
 updateCallButtons();
 setStatus("Защищённый канал установлен","Запускаем голосовой канал.","wait");
 debug("Защищённый канал установлен; secure-role="+state.role+"; peer="+(state.secure?.peer||els.peer.value)+".");
 const peerId=state.secure?.peer||els.peer.value;
 if(SupabaseSecureSignaling.validUserId(peerId)){
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
 const answering=state.incomingCall;
 if(!answering)setCallPeer(els.peer.value,els.contactScreenName.textContent);
 const peer=state.callPeer;
 openCallScreen();
 state.answeringCall=answering;
 if(answering){state.secure?.acceptIncoming();clearIncomingUi();stopRinging();els.callScreenStatus.textContent="Соединяемся…"}
 else{
  els.callScreenStatus.textContent="Вызов…";
  startRinging("outgoing"); // Start audio synchronously in the user's click gesture, before async signaling/WebRTC work.
 }
 clearError();setBusy(true);
 try{
  const me=state.me;
  // Keep a matching prepared PC even while its ICE gathering is still running.
  if(state.webrtc){await state.webrtc.close({stopTracks:true});state.webrtc=null}
  state.callStarted=false;state.peerPresent=false;
  if(!SupabaseSecureSignaling.validUserId(me)||!SupabaseSecureSignaling.validUserId(peer)||me===peer)throw Error("Выберите сохранённый контакт. Собеседник должен отличаться от вашей идентичности.");
  
  if(state.secure&&state.secure.me!==me){state.secure.close();state.secure=null}
  if(!state.secure)state.secure=createSecureSignaling(me,peer);
  else setSecurePeer(peer);
  els.debugUrl.textContent="Supabase · "+(state.supabaseUserId||"недоступен");

  // The caller does not request microphone access while ringing.
  // The answerer requests it only after the user explicitly presses Answer.
  await ensureWebRtc();
  state.webrtc.setMicEnabled(answering);
  if(answering){
   try {
    await state.webrtc.ensureMedia();
   } catch(e) {
    throw new Error("Не удалось получить доступ к микрофону: "+e.message);
   }
  }
  state.webrtc.setCallAccepted(answering);

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
 clearIncomingAttemptTimer();
 state.hangingUp=true;updateCallButtons();
 if(notifyPeer&&state.outgoingCall&&state.secure?.role==="B"){
  setStatus("Отменяем вызов","Уведомляем собеседника через Supabase.","wait");
  try{const sent=await state.secure.cancelCall();debug(sent?"Отмена исходящего вызова отправлена через Supabase.":"У исходящего вызова не найден активный запрос для отмены.");}
  catch(error){debug("Не удалось отправить отмену через Supabase: "+(error.message||String(error)));}
 }
 if(notifyPeer&&state.peerPresent&&state.webrtc?.isControlOpen()){
  setStatus("Завершаем звонок","Отправляем собеседнику P2P-уведомление и ждём подтверждение.","wait");
  const acknowledged=await state.webrtc.sendHangup(1200);
  debug(acknowledged?"P2P HANGUP подтверждён собеседником.":"Подтверждение HANGUP не получено за 1,2 секунды; закрываем локально.");
 }else if(notifyPeer&&state.peerPresent){
  debug("P2P DataChannel ещё не открыт; завершение выполняется локально без отдельного POST.");
 }
 stopOutgoingCall();stopRemoteAudioDiagnostics();if(state.incomingCall)state.secure?.dismissIncoming();clearIncomingUi();stopRinging();
 if(state.disconnectTimer){clearTimeout(state.disconnectTimer);state.disconnectTimer=null}
 state.secure?.resetSession();
 if(state.webrtc){await state.webrtc.close({stopTracks:true});state.webrtc=null}
 els.audio.srcObject=null;els.remoteVideo.srcObject=null;els.localVideo.srcObject=null;updateCallVideoStage();try{if(typeof els.audio.setSinkId==="function")await els.audio.setSinkId("");}catch(error){debug("Не удалось вернуть аудиовыход по умолчанию: "+error.message)}state.speakerOutputId=null;els.pilot.disabled=false;els.transport.textContent="Не выбран";
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
let contactsLoaded=false;
let allContacts=[];

// Coordinated pull gesture: keep one continuous drag across the search strip and contact list.
(()=>{
 const list=els.contactList;
 const search=document.querySelector(".contacts-search-strip");
 if(!list||!search)return;
 let reveal=0,lastY=null,activeTouchId=null,mouseDragging=false,lastMoveAt=0,velocity=0,momentumFrame=0;
 const searchHeight=()=>search.getBoundingClientRect().height||54;
 const setReveal=value=>{
  reveal=Math.max(0,Math.min(searchHeight(),value));
  document.documentElement.style.setProperty("--vl-search-reveal",reveal+"px");
 };
 const moveBy=delta=>{
  if(!delta)return;
  const max=Math.max(0,list.scrollHeight-list.clientHeight);
  if(delta>0){
   const fromList=Math.min(max,list.scrollTop+delta);
   list.scrollTop=fromList;
   setReveal(reveal-delta);
  }else{
   list.scrollTop=Math.max(0,list.scrollTop+delta);
   setReveal(reveal-delta);
  }
 };
 const stopMomentum=()=>{if(momentumFrame){cancelAnimationFrame(momentumFrame);momentumFrame=0;}};
 const begin=y=>{stopMomentum();lastY=y;lastMoveAt=performance.now();velocity=0;};
 const move=y=>{
  if(lastY===null)return;
  const delta=lastY-y,now=performance.now(),elapsed=Math.max(1,now-lastMoveAt);
  if(Math.abs(delta)>0.05){
   moveBy(delta);
   const instant=delta/elapsed;
   velocity=velocity*0.65+instant*0.35;
  }
  lastY=y;lastMoveAt=now;
 };
 const finish=(withMomentum=false)=>{
  lastY=null;activeTouchId=null;mouseDragging=false;
  if(!withMomentum||Math.abs(velocity)<0.12){velocity=0;return;}
  let speed=velocity,previous=performance.now();
  const tick=now=>{
   const elapsed=Math.min(32,now-previous);previous=now;
   moveBy(speed*elapsed);
   speed*=Math.pow(0.92,elapsed/16.67);
   if(Math.abs(speed)>0.015)momentumFrame=requestAnimationFrame(tick);
   else{momentumFrame=0;velocity=0;}
  };
  momentumFrame=requestAnimationFrame(tick);
 };
 // Touch Events are tracked on window so moving across child elements or layer boundaries
 // cannot lose the drag. preventDefault keeps the browser from cancelling it for page scroll.
 list.addEventListener("touchstart",event=>{
  if(event.touches.length!==1)return;
  const touch=event.changedTouches[0];
  activeTouchId=touch.identifier;
  begin(touch.clientY);
 },{passive:true});
 window.addEventListener("touchmove",event=>{
  if(activeTouchId===null)return;
  const touch=Array.from(event.touches).find(item=>item.identifier===activeTouchId);
  if(!touch)return;
  if(event.cancelable)event.preventDefault();
  move(touch.clientY);
 },{passive:false,capture:true});
 window.addEventListener("touchend",event=>{
  if(activeTouchId===null)return;
  if(Array.from(event.changedTouches).some(item=>item.identifier===activeTouchId))finish(true);
 },{capture:true});
 window.addEventListener("touchcancel",()=>finish(false),{capture:true});
 // Mouse/pen support without setPointerCapture or lostpointercapture.
 list.addEventListener("pointerdown",event=>{
  if(event.pointerType==="touch"||event.button!==0)return;
  mouseDragging=true;begin(event.clientY);
 });
 window.addEventListener("pointermove",event=>{
  if(!mouseDragging||event.pointerType==="touch")return;
  if(event.cancelable)event.preventDefault();
  move(event.clientY);
 },{passive:false});
 window.addEventListener("pointerup",event=>{
  if(mouseDragging&&event.pointerType!=="touch")finish(false);
 });
 window.addEventListener("pointercancel",event=>{
  if(mouseDragging&&event.pointerType!=="touch")finish(false);
 });
 list.addEventListener("wheel",event=>{
  if(Math.abs(event.deltaY)<0.1)return;
  event.preventDefault();
  moveBy(event.deltaY);
 },{passive:false});
 window.addEventListener("resize",()=>setReveal(reveal));
 setReveal(0);
 list.scrollTop=0;
})();
function renderContactList(contacts){
 allContacts=contacts;
 const query=els.contactSearch.value.trim().toLowerCase();
 els.contactSearchClear.classList.toggle("hidden",!els.contactSearch.value);
 const visibleContacts=allContacts.filter(contact=>String(contact.name||"").toLowerCase().includes(query));
 els.contactListItems.replaceChildren();
 els.contactsCount.textContent=String(visibleContacts.length);
 els.contactListEmpty.textContent=query?"По вашему запросу ничего не найдено.":"Пока нет контактов. Нажмите «+», чтобы добавить собеседника, или отправьте ему приглашение из своего профиля, чтобы он мог добавить вас в контакты.";
 els.contactListEmpty.classList.toggle("hidden",!contactsLoaded||visibleContacts.length>0);
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
  status.textContent=isPendingRequest?"Новый запрос · "+formatLastInteraction(contact.request_received_at):"Контакт добавлен";
  status.dataset.statusType=isPendingRequest?"pending":"normal";
  details.append(name,status);
  const last=document.createElement("span");last.className="contact-list-last";last.textContent=formatLastInteraction(contact.last_interaction_at);
  item.append(avatar,details,last);
  els.contactListItems.append(item);
 }
}
async function refreshContactOptions(selectUserId=""){
 const contacts=await listContacts();
 // A contact request can only arrive as a response to an invitation we issued.
 // That invitation already represents our consent, so migrate legacy pending
 // entries and accept every newly verified response automatically.
 for(let i=0;i<contacts.length;i++){
  if(contacts[i].request_pending===true){
   const updated=await updateContact(contacts[i].user_id,{
    request_pending:false,
    last_interaction_at:contacts[i].last_interaction_at||contacts[i].request_received_at||new Date().toISOString()
   });
   if(updated)contacts[i]=updated;
  }
 }
 const callOverlayOpen=!els.callScreen.classList.contains("hidden");
 const previousPeer=els.peer.value;
 const previousEditName=els.editContactName.value;
 const previousOriginalEditName=originalEditContactName;
 contacts.sort((a,b)=>{
  const aTime=Date.parse(a.last_interaction_at||"")||0,bTime=Date.parse(b.last_interaction_at||"")||0;
  return bTime-aTime||a.name.localeCompare(b.name);
 });
 els.peer.replaceChildren(new Option("Выберите контакт",""));
 for(const contact of contacts)els.peer.add(new Option(contact.name,contact.user_id));
 els.peer.disabled=contacts.length===0;
 if(callOverlayOpen){
  if(previousPeer&&contacts.some(contact=>contact.user_id===previousPeer))els.peer.value=previousPeer;
 }else if(selectUserId&&contacts.some(contact=>contact.user_id===selectUserId)){
  els.peer.value=selectUserId;
 }
 contactsLoaded=true;
 renderContactList(contacts);
 if(callOverlayOpen){
  els.editContactName.value=previousEditName;
  originalEditContactName=previousOriginalEditName;
 }else{
  els.editContactName.value=els.peer.selectedOptions[0]?.textContent||"";
  originalEditContactName=els.editContactName.value.trim();
 }
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
let profileInvitationCreationQueue=Promise.resolve();
function createContactInvitation(options={}){
 const requestedRevision=Number.isInteger(options.expectedRevision)?options.expectedRevision:profileInviteRevision;
 const promise=profileInvitationCreationQueue.then(()=>{
  if(requestedRevision!==profileInviteRevision)return false;
  return createContactInvitationNow({...options,expectedRevision:requestedRevision});
 });
 // Serialize every generation so overlapping edits cannot race.
 profileInvitationCreationQueue=promise.catch(()=>false);
 return promise;
}
async function createContactInvitationNow({expectedRevision=null}={}){
 const profileRevision=profileInviteRevision;
 const displayName=getProfileDisplayName();
 const inviteContactName=getInviteContactName();
 els.createInvite.disabled=true;
 els.createInvite.setAttribute("aria-busy","true");
 els.profileDisplayName.disabled=true;
 els.inviteContactName.disabled=true;
 setInlineStatus(els.inviteStatus,"Проверяем разрешение на push-уведомления…");
 clearError();
 try{
  const subscriptionId=await enableOneSignalPush();
  const identity=await getCurrentSignalingIdentity();
  const isCurrentRevision=()=>profileRevision===profileInviteRevision&&
   displayName===getProfileDisplayName()&&inviteContactName===getInviteContactName()&&
   (expectedRevision===null||expectedRevision===profileInviteRevision);
  if(!isCurrentRevision())return false;
  let supabaseUserId=state.supabaseUserId;
  if(!supabaseUserId){
   try{const supabaseIdentity=await getSupabaseIdentity();supabaseUserId=supabaseIdentity.user_id;state.supabaseUserId=supabaseUserId;}
   catch(error){debug("Supabase Auth недоступен; приглашение будет совместимо со старым транспортом: "+(error.message||String(error)));}
  }
  let supabaseInvitation=null;
  try{
   supabaseInvitation=await createSupabaseInvitation();
   supabaseUserId=supabaseInvitation.supabase_user_id;
   state.supabaseUserId=supabaseUserId;
  }catch(error){
   debug("Не удалось создать одноразовый маршрут Supabase; приглашение останется совместимым со старым транспортом: "+(error.message||String(error)));
  }
  const unsigned={
   version:INVITATION_FORMAT_VERSION,user_id:identity.user_id,
   ...(supabaseInvitation||{}),
   push_subscription_id:subscriptionId,
   invitation_id:crypto.randomUUID(),
   invitation_secret:toBase64UrlBytes(crypto.getRandomValues(new Uint8Array(32))),
   shared_secret_created_at:Date.now(),
   ...(displayName?{display_name:displayName}:{})
  };
  const contactPackage=unsigned;
  const encoded=toBase64UrlBytes(new TextEncoder().encode(JSON.stringify(contactPackage)));
  const url=window.location.origin+window.location.pathname+"#contact="+encoded;
  if(!isCurrentRevision())return false;
  await createIssuedInvitation({
   id:unsigned.invitation_id,secret:unsigned.invitation_secret,created_at:Date.now(),
   max_activations:1,local_contact_name:inviteContactName
  });
  if(!isCurrentRevision()){
   await deleteUnusedIssuedInvitation(unsigned.invitation_id);
   return false;
  }
  await saveMyInvitation(url);
  if(!isCurrentRevision()){
   await deleteUnusedIssuedInvitation(unsigned.invitation_id);
   await clearMyInvitation(url);
   return false;
  }
  els.inviteUrl.textContent=url;
  updateInviteCopyButton();
  els.inviteQr.replaceChildren();
  try{
   await ensureQrCodeLibrary();
   if(!isCurrentRevision()){
    await deleteUnusedIssuedInvitation(unsigned.invitation_id);
    await clearMyInvitation(url);
    els.inviteUrl.textContent="";
    els.inviteQr.replaceChildren();
    updateInviteCopyButton();
    return false;
   }
   els.inviteQr.replaceChildren();
   new window.QRCode(els.inviteQr,{text:url,width:220,height:220,colorDark:"#101827",colorLight:"#ffffff",correctLevel:window.QRCode.CorrectLevel.M});
   setInlineStatus(els.inviteStatus,"");
  }catch(qrError){
   setInlineStatus(els.invitationScreenStatus,"Ссылка создана. QR-код пока недоступен: "+(qrError.message||String(qrError)),true);
  }
  debug("Создано защищённое приглашение; OneSignal="+(subscriptionId?"доступен":"недоступен")+"; Supabase route="+(supabaseInvitation?"создан":"не создан")+".");
  
  return true;
  }catch(error){
   const message=error.message||String(error);
   setInlineStatus(els.inviteStatus,"Приглашение не создано. "+message,true);
   return false;
  }finally{
  els.createInvite.disabled=false;
  els.createInvite.removeAttribute("aria-busy");
  els.profileDisplayName.disabled=false;
  els.inviteContactName.disabled=false;
 }
}
function updateInviteCopyButton(){
 els.copyInviteInline.disabled=!els.inviteUrl.textContent.trim();
}
function copyInviteFallback(value){
 const field=document.createElement("textarea");
 field.value=value;
 field.setAttribute("readonly","");
 field.style.position="fixed";
 field.style.opacity="0";
 field.style.pointerEvents="none";
 document.body.append(field);
 field.select();
 field.setSelectionRange(0,field.value.length);
 let copied=false;
 try{copied=document.execCommand("copy")}catch{}
 field.remove();
 return copied;
}
function copyContactInvitation(event){
 event?.preventDefault();
 event?.stopPropagation();
 const value=els.inviteUrl.textContent.trim();
 if(!value)return;
 const copied=()=>setInlineStatus(els.invitationScreenStatus,"Ссылка скопирована.");
 const failed=()=>{
  if(copyInviteFallback(value)){copied();return;}
  setInlineStatus(els.invitationScreenStatus,"Не удалось скопировать автоматически. Попробуйте ещё раз или выделите ссылку вручную.",true);
 };
 try{
  if(navigator.clipboard?.writeText)navigator.clipboard.writeText(value).then(copied,failed);
  else failed();
 }catch{failed()}
}

async function pasteContactInvitation(event){
 event?.preventDefault();event?.stopPropagation();
 if(els.contactPackage.value.length){
  contactInvitationLookupRevision++;
  els.contactPackage.value="";
  els.contactName.value="";
  els.responseDisplayName.value="";
  els.saveResponseDisplayName.checked=false;
  els.contactInvitationEntry.classList.remove("hidden");
  els.contactInvitationDetails.classList.add("hidden");
  els.firstContactWelcome.classList.add("hidden");
  clearInlineStatus(els.qrStatus);
  els.contactPackage.dispatchEvent(new Event("input",{bubbles:true}));
  updateResponseDisplayNameSection();
  els.contactPackage.focus();
  return;
 }
 try{
  if(!navigator.clipboard?.readText)throw Error("Чтение буфера обмена не поддерживается этим браузером.");
  const value=await navigator.clipboard.readText();
  if(!value.trim()){setInlineStatus(els.qrStatus,"Буфер обмена пуст.",true);return}
  els.contactPackage.value=value.trim();
  els.contactPackage.dispatchEvent(new Event("input",{bubbles:true}));
  await validateContactInvitation(els.contactPackage.value,"Вставленная ссылка");
 }catch(error){
  setInlineStatus(els.qrStatus,"Не удалось прочитать буфер обмена. Разрешите доступ браузеру или вставьте ссылку в поле вручную.",true);
  debug("Не удалось вставить приглашение из буфера обмена: "+(error.message||String(error)));
 }
}

/**
 * One-shot migration of imported contacts to their Supabase route.
 * The attempt is recorded before sending so it is never duplicated.
 */
async function redeemSupabaseInvitationOnce(contact,source="импорт"){
 if(!contact?.user_id||!contact.supabase_user_id||!contact.supabase_invitation_id||
    !contact.invitation_secret||contact.supabase_invitation_attempted_at||
    contact.supabase_invitation_redeemed_at||contact.request_pending)return false;
 await updateContact(contact.user_id,{supabase_invitation_attempted_at:new Date().toISOString()});
 try{
  const identity=await getCurrentSignalingIdentity();
  const pushSubscriptionId=await getOptionalOneSignalSubscriptionId();
  const result=await submitSupabaseInvitationAcceptance({
   contact,
   sender:{
    user_id:identity.user_id,
    display_name:getProfileDisplayName(),
    ...(pushSubscriptionId?{push_subscription_id:pushSubscriptionId}:{})
   }
  });
  await ensureSupabaseOutgoingSequence(contact.supabase_user_id,"1");
  await updateContact(contact.user_id,{supabase_invitation_redeemed_at:new Date().toISOString()});
  debug("Supabase-приглашение погашено ("+source+"); связь создана, первое зашифрованное сообщение записано (created_at="+result.created_at+").");
  return true;
 }catch(error){
  debug("Не удалось погасить Supabase-приглашение ("+source+"): "+(error.message||String(error)));
  return false;
 }
}
let supabaseInboxChannel=null;
let supabaseInboxQueue=Promise.resolve();
let supabaseRecoveryScheduled=false;
let supabaseRecoveryRunning=false;
let supabaseRecoveryRequested=false;

function scheduleSupabaseInboxRecovery(){
 if(!state.supabaseUserId)return;
 supabaseRecoveryRequested=true;
 if(supabaseRecoveryScheduled||supabaseRecoveryRunning)return;
 supabaseRecoveryScheduled=true;
 Promise.resolve().then(async()=>{
  supabaseRecoveryScheduled=false;
  while(supabaseRecoveryRequested){
   supabaseRecoveryRequested=false;
   try{await recoverSupabaseInbox()}
   catch(error){
    debug("Не удалось восстановить Supabase inbox: "+(error.message||String(error))+"; повтор через 5 секунд.");
    setTimeout(scheduleSupabaseInboxRecovery,5000);
    break;
   }
  }
 });
}

async function processSupabaseInboxRecord(record,source){
 if(!record||record.recipient_id!==state.supabaseUserId||typeof record.sender_id!=="string"||
    typeof record.created_at!=="string"||Number.isNaN(Date.parse(record.created_at)))return false;
 const recipientSeq=String(record.recipient_seq??"");
 if(!/^[1-9][0-9]*$/.test(recipientSeq))return false;
 const cursor=BigInt(await getSupabaseInboxCursor(state.supabaseUserId));
 const currentRecipientSeq=BigInt(recipientSeq);
 if(currentRecipientSeq<=cursor)return true;
 if(currentRecipientSeq!==cursor+1n){
  debug("Supabase inbox: пропуск recipient_seq (ожидается "+(cursor+1n)+", получено "+recipientSeq+"); требуется восстановление.");
  return false;
 }
 let contact=await findContactBySupabaseUserId(record.sender_id);
 let message=null;
 if(!contact){
  // First contact is also a normal v1 encrypted inbox message. Try the locally
  // issued one-time invitation secrets; a successful AES-GCM decrypt identifies
  // the invitation without exposing any routing metadata in the clear.
  const issuedInvitations=await listIssuedInvitations();
  for(const issued of issuedInvitations){
   if(!issued||issued.revoked||typeof issued.secret!=="string")continue;
   try{
    const candidate=await decryptSupabaseInboxRecord(record,issued.secret);
    const body=candidate?.body;
    if(candidate.type!=="contact_accept"||candidate.seq!=="1"||
       !body||typeof body!=="object"||body.invitation_id!==issued.id||
       typeof body.user_id!=="string"||!/^[a-f0-9]{64}$/.test(body.user_id)||
       typeof body.request_id!=="string"||!/^[0-9a-f-]{36}$/i.test(body.request_id))continue;
    const activation=await consumeIssuedInvitation({invitationId:issued.id,userId:body.user_id,requestId:body.request_id});
    if(!activation.accepted)throw new Error("Одноразовое локальное приглашение уже использовано или отозвано.");
    const existing=await getContact(body.user_id);
    const acceptedAt=new Date().toISOString();
    const contactData={
     ...(existing||{}),user_id:body.user_id,
     name:issued.local_contact_name||existing?.name||String(body.display_name||"").trim()||await nextGeneratedContactName(),
     invitation_id:issued.id,invitation_secret:issued.secret,
     shared_secret_created_at:Number(body.shared_secret_created_at)||issued.created_at,
     supabase_user_id:record.sender_id,
     supabase_contact_accepted_at:acceptedAt,
     supabase_invitation_redeemed_at:acceptedAt,
     last_interaction_at:existing?.last_interaction_at||acceptedAt,
     ...(typeof body.push_subscription_id==="string"&&body.push_subscription_id.trim()?{push_subscription_id:body.push_subscription_id.trim()}:{})
    };
    await saveContact(contactData);
    contact=await findContactBySupabaseUserId(record.sender_id);
    await refreshContactOptions();
    message=candidate;
    debug("Supabase v1: первое зашифрованное сообщение приняло приглашение и создало контакт «"+contact.name+"».");
    break;
   }catch(error){
    if(error?.name==="OperationError")continue;
    if(error?.message?.includes("Одноразовое локальное приглашение"))throw error;
   }
  }
  if(!contact){
   debug("Supabase inbox: не найден контакт или подходящее локальное приглашение для sender_id="+record.sender_id+"; recipient_seq="+recipientSeq+" оставлен необработанным.");
   return false;
  }
 }
 if(!message){
  const secrets=[contact.pending_secret,contact.invitation_secret,contact.previous_secret].filter(value=>typeof value==="string"&&value);
  if(!secrets.length)throw new Error("У контакта «"+contact.name+"» отсутствует общий ключ.");
  message=await decryptSupabaseInboxRecord(record,secrets);
 }
 const sequence=BigInt(message.seq);
 const current=await getSupabaseSequenceState(record.sender_id);
 const last=BigInt(current.incoming);
 if(sequence<=last){
  await setSupabaseInboxCursor(state.supabaseUserId,recipientSeq);
  return true;
 }

 if(sequence>last+1n){
  debug("Supabase inbox: пропуск seq отправителя «"+contact.name+
   "» (ожидается "+(last+1n)+", получено "+message.seq+"); запись оставлена до восстановления.");
  return false;
 }

 if(message.type==="contact_accept"){
  if(message.seq!=="1")throw new Error("Первое подтверждение контакта имеет неожиданный номер последовательности.");
  if(!contact.supabase_contact_accepted_at){
   await updateContact(contact.user_id,{
    supabase_contact_accepted_at:new Date().toISOString(),
    supabase_last_incoming_message_at:record.created_at
   });
   debug("Supabase inbox: получено и расшифровано подтверждение контакта «"+contact.name+
    "» ("+source+"); created_at="+record.created_at+".");
  }
 }else if(["hello","answer","cancel","reject","rotation_response","data","text","delivered"].includes(message.type)){
  if(!message.body||typeof message.body!=="object"||Array.isArray(message.body)||
     Object.hasOwn(message.body,"from")||Object.hasOwn(message.body,"to")){
   debug("Supabase inbox: некорректное plaintext body v1 типа «"+message.type+"»; seq оставлен необработанным.");
   return false;
  }
  if(!state.secure||state.secure.closed||state.secure.me!==state.me){
   state.secure=createSecureSignaling(state.me,contact.user_id);
  }
  await state.secure.handleSupabaseEnvelope(record,message,contact);
  debug("Supabase inbox: обработано сообщение v1 «"+message.type+"» от «"+contact.name+"»; seq="+message.seq+" ("+source+").");
 }else{
  debug("Supabase inbox: неизвестный тип «"+message.type+"» от «"+contact.name+
   "»; seq="+message.seq+" оставлен необработанным.");
  return false;
 }

 const advanced=await advanceSupabaseIncomingSequence(record.sender_id,message.seq);
 if(advanced==="gap")return false;
 await setSupabaseInboxCursor(state.supabaseUserId,recipientSeq);
 return true;
}
function enqueueSupabaseInboxRecord(record,source="Realtime"){
 const task=supabaseInboxQueue.then(()=>processSupabaseInboxRecord(record,source));
 supabaseInboxQueue=task.catch(error=>{
  debug("Ошибка обработки Supabase inbox ("+source+"): "+(error.message||String(error)));
 });
 return task;
}

async function recoverSupabaseInbox(){
 if(!state.supabaseUserId||supabaseRecoveryRunning)return;
 supabaseRecoveryRunning=true;
 let total=0;
 try{
  let cursor=await getSupabaseInboxCursor(state.supabaseUserId);
  while(true){
   const rows=await fetchSupabaseInbox(state.supabaseUserId,cursor,500);
   if(!rows.length)break;
   let blocked=false;
   for(const row of rows){
    const processed=await enqueueSupabaseInboxRecord(row,"восстановление durable inbox");
    if(processed!==true){
     debug("Supabase inbox: recipient cursor остановлен на recipient_seq="+row.recipient_seq+"; запись пока не обработана.");
     blocked=true;
     break;
    }
    cursor=String(row.recipient_seq);
    total++;
   }
   if(blocked||rows.length<500)break;
  }
  debug("Supabase inbox: проверено новых сохранённых записей: "+total+"; recipient_seq cursor="+cursor+".");
 }finally{supabaseRecoveryRunning=false}
}

function startSupabaseInbox(){
 if(!state.supabaseUserId||supabaseInboxChannel)return;
 debug("Supabase Realtime: подключаем приватную подписку inbox:"+state.supabaseUserId+".");
 supabaseInboxChannel=subscribeSupabaseInbox(state.supabaseUserId,
  record=>{
   enqueueSupabaseInboxRecord(record,"Realtime").then(processed=>{
    if(processed!==true)scheduleSupabaseInboxRecovery();
   }).catch(()=>{});
  },
  status=>{
   debug("Supabase Realtime status="+status+".");
   if(status==="SUBSCRIBED"){
    setServiceStatus(els.supabaseStatus,"Подключён");
    scheduleSupabaseInboxRecovery();
   }else if(["CHANNEL_ERROR","TIMED_OUT","CLOSED"].includes(status)){
    setServiceStatus(els.supabaseStatus,"Переподключение…");
   }
  });
}

async function redeemPendingSupabaseInvitations(){
 for(const contact of await listContacts()){
  if(contact.supabase_user_id&&contact.supabase_invitation_id&&!contact.supabase_invitation_attempted_at&&!contact.supabase_invitation_redeemed_at&&!contact.request_pending){
   await redeemSupabaseInvitationOnce(contact,"проверка сохранённых контактов");
  }
 }
}

async function flushPendingSupabaseOutboxes(source="повторная отправка") {
 if(!state.supabaseUserId)return;
 for(const contact of await listContacts()){
  if(!contact.supabase_user_id||!contact.invitation_secret||
     (!contact.supabase_invitation_redeemed_at&&!contact.supabase_contact_accepted_at))continue;
  try{
   const result=await flushSupabaseOutbox({contact});
   if(result.sent)debug("Supabase outbox ("+source+"): отправлено сообщений контакту «"+contact.name+"»: "+result.sent+".");
  }catch(error){
   debug("Supabase outbox ("+source+"): очередь контакта «"+contact.name+"» сохранена для повтора: "+(error.message||String(error)));
  }
 }
}

window.addEventListener("online",()=>{
 if(state.supabaseUserId)flushPendingSupabaseOutboxes("возврат сети");
});

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
let generatedContactNameNumber=null;
let generatedContactNameInitialization=null;
async function nextGeneratedContactName(){
 if(generatedContactNameNumber===null){
  if(!generatedContactNameInitialization){
   generatedContactNameInitialization=listContacts().then(contacts=>{
    let maxNumber=0;
    for(const contact of contacts){
     const match=/^Новый контакт\s+(\d+)$/i.exec(String(contact.name||"").trim());
     if(match)maxNumber=Math.max(maxNumber,Number(match[1])||0);
    }
    generatedContactNameNumber=maxNumber;
   }).catch(error=>{generatedContactNameInitialization=null;throw error});
  }
  await generatedContactNameInitialization;
 }
 generatedContactNameNumber++;
 return "Новый контакт "+generatedContactNameNumber;
}
async function acceptContactRequest(){
 const peer=els.peer.value;
 const contact=await getContact(peer);
 if(!contact?.request_pending)return;
 els.acceptContactRequest.disabled=true;
 try{
  await saveContact({...contact,request_pending:false,last_interaction_at:new Date().toISOString()});
  await refreshContactOptions(peer);
  setStatus("Контакт добавлен","Теперь можно звонить этому контакту.","idle");
  debug("Запрос принят; контакт "+contact.name+" поднят на первое место в списке.");
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
  if(state.secure?.peer===peer)setSecurePeer("");
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
 if(!SupabaseSecureSignaling.validUserId(peer)||peer===state.me){showError("Сначала выберите сохранённый контакт.");return}
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
 if(!SupabaseSecureSignaling.validUserId(peer)){
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
  if(state.secure?.peer===peer)setSecurePeer("");
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
let contactScreenReturnTarget="main";
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
  const senderDisplayName=profileName||String(els.responseDisplayName.value||"").trim().slice(0,40);
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
  const addedAt=new Date().toISOString();
  await saveContact(existing
   ?{...existing,...verified,name:existing.name,last_interaction_at:addedAt}
   :{...verified,name,last_interaction_at:addedAt});
  if(saveSenderName){
   els.profileDisplayName.value=senderDisplayName;
   persistProfileDisplayName();
   debug("Имя отправителя сохранено в профиле по выбору пользователя.");
  }
  const savedContact=await getContact(verified.user_id);
  if(savedContact?.supabase_user_id&&savedContact?.supabase_invitation_id&&!savedContact.supabase_invitation_attempted_at&&!savedContact.supabase_invitation_redeemed_at){
   await redeemSupabaseInvitationOnce(savedContact,"сразу после импорта");
  }
  await refreshContactOptions(verified.user_id);
  if(state.secure&&!state.secure.active&&!state.connecting)setSecurePeer(verified.user_id);

  els.contactPackage.value="";
  updatePasteContactButton();
  els.contactName.value="";
  closeAddContactScreen();
  clearError();
  debug("Импортирован и криптографически проверен контакт: "+name+".");
  const contactItem=Array.from(els.contactList.querySelectorAll(".contact-list-item[data-peer]"))
   .find(item=>item.dataset.peer===verified.user_id);
  if(contactItem)openContactScreen(contactItem,false,{returnTo:"main"});
  else debug("Контакт сохранён, но его карточку не удалось открыть автоматически.");
  const latestContact=await getContact(verified.user_id);
  const supabaseLinked=!!latestContact?.supabase_invitation_redeemed_at;
  if(!supabaseLinked)throw Error("Не удалось установить Supabase-связь. Старый транспорт отключён; попросите собеседника создать новую ссылку-приглашение и повторите импорт.");
  debug("Контакт принят через единый Supabase v1 протокол.");

 }catch(error){
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
let qrJsDecoderPromise=null;
async function getQrJsDecoder(){
 if(!qrJsDecoderPromise){
  qrJsDecoderPromise=import("https://cdn.jsdelivr.net/npm/jsqr@1.4.0/+esm").then(module=>{
   const decoder=module.default||module.jsQR||module;
   if(typeof decoder!=="function")throw Error("Библиотека QR-сканирования загружена некорректно.");
   return decoder;
  }).catch(error=>{
   qrJsDecoderPromise=null;
   throw error;
  });
 }
 return qrJsDecoderPromise;
}
async function configureQrScannerButton(){
 // Кнопка доступна и в браузерах без BarcodeDetector: для них используется jsQR.
 els.scanQr.classList.remove("hidden");
}
configureQrScannerButton();
async function startQrScan(){
 if(qrScanActive){await stopQrScan();return}
 clearInlineStatus(els.qrStatus);clearError();
 try{
  if(!navigator.mediaDevices?.getUserMedia)throw Error("Этот браузер не предоставляет доступ к камере. Откройте VoiceLink по HTTPS и разрешите доступ к камере.");
  let detector=null,jsQR=null;
  if("BarcodeDetector" in window){
   try{
    if(typeof BarcodeDetector.getSupportedFormats!=="function"||
       (await BarcodeDetector.getSupportedFormats()).includes("qr_code")){
     detector=new BarcodeDetector({formats:["qr_code"]});
    }
   }catch(error){debug("Встроенный QR-сканер недоступен, включаем резервный: "+(error.message||String(error)))}
  }
  if(!detector){
   setInlineStatus(els.qrStatus,"Подключаем сканер QR-кодов…");
   jsQR=await getQrJsDecoder();
  }
  qrStream=await navigator.mediaDevices.getUserMedia({video:{facingMode:{ideal:"environment"}},audio:false});
  els.qrVideo.srcObject=qrStream;
  els.qrVideo.classList.remove("hidden");
  await els.qrVideo.play();
  const canvas=document.createElement("canvas");
  const context=canvas.getContext("2d",{willReadFrequently:true});
  if(!context)throw Error("Не удалось подготовить изображение с камеры.");
  qrScanActive=true;
  els.scanQr.textContent="Остановить сканирование";
  setInlineStatus(els.qrStatus,"Наведите камеру на QR-код контакта.");
  const scan=async()=>{
   if(!qrScanActive)return;
   try{
    let value="";
    if(els.qrVideo.readyState>=HTMLMediaElement.HAVE_CURRENT_DATA&&els.qrVideo.videoWidth){
     if(detector){
      const codes=await detector.detect(els.qrVideo);
      value=codes.find(code=>code.rawValue)?.rawValue||"";
     }else{
      canvas.width=els.qrVideo.videoWidth;
      canvas.height=els.qrVideo.videoHeight;
      context.drawImage(els.qrVideo,0,0,canvas.width,canvas.height);
      const frame=context.getImageData(0,0,canvas.width,canvas.height);
      const code=jsQR(frame.data,frame.width,frame.height,{inversionAttempts:"dontInvert"});
      value=code?.data||"";
     }
    }
    if(value){
     els.contactPackage.value=value;
     els.contactPackage.dispatchEvent(new Event("input",{bubbles:true}));
     await stopQrScan();
     await validateContactInvitation(value,"QR-код");
     return;
    }
   }catch(error){debug("Ошибка чтения QR: "+(error.message||String(error)))}
   if(qrScanActive)setTimeout(scan,detector?250:180);
  };
  scan();
 }catch(error){
  await stopQrScan();
  showError("Не удалось запустить сканирование QR-кода: "+(error.message||String(error)));
 }
}
let contactInvitationLookupRevision=0;
async function validateContactInvitation(value,source="Ссылка-приглашение"){
 const revision=++contactInvitationLookupRevision,invitation=String(value??"");
 els.contactInvitationDetails.classList.add("hidden");els.firstContactWelcome.classList.add("hidden");
 clearInlineStatus(els.qrStatus);
 if(!invitation.trim()){
  els.contactInvitationEntry.classList.remove("hidden");
  setInlineStatus(els.qrStatus,"Вставьте ссылку-приглашение или отсканируйте QR-код.",true);
  return false;
 }
 els.contactInvitationEntry.classList.add("hidden");
 try{
  if(source!=="Ссылка-приглашение"){
   if(!invitation.startsWith("https://"))throw Error("Ссылка должна начинаться с https://.");
   if(/\s/.test(invitation))throw Error("В ссылке не должно быть пробелов или переносов строк.");
  }
  const contact=await verifyContactPackage(invitation);
  if(revision!==contactInvitationLookupRevision||invitation!==els.contactPackage.value)return false;
  const ownIdentity=await getCurrentSignalingIdentity();
  if(contact.user_id===ownIdentity.user_id)throw Error("Это ваше собственное приглашение. Его нельзя добавить как контакт.");
  const existingContact=await getContact(contact.user_id);
  if(revision!==contactInvitationLookupRevision||invitation!==els.contactPackage.value)return false;
  if(existingContact?.invitation_id===contact.invitation_id)throw Error("Контакт по этому приглашению уже добавлен.");
  els.contactInvitationDetails.classList.remove("hidden");
  els.firstContactWelcome.classList.toggle("hidden",allContacts.length!==0);
  if(!els.contactName.value.trim())els.contactName.value=contact.display_name||await nextGeneratedContactName();
  if(revision!==contactInvitationLookupRevision||invitation!==els.contactPackage.value)return false;
  updateResponseDisplayNameSection();updateImportContactButton();
  clearInlineStatus(els.qrStatus);
  els.contactName.focus();return true;
 }catch(error){
  if(revision!==contactInvitationLookupRevision)return false;
  // Keep the manual-entry controls available so the user can correct the link
  // without leaving the Add Contact screen. Deep-link failures remain compact:
  // retrying there means opening the invitation URL again.
  if(source!=="Ссылка-приглашение")els.contactInvitationEntry.classList.remove("hidden");
  setInlineStatus(els.qrStatus,error.message||"Не удалось проверить приглашение.",true);return false;
 }
}
let contactInvitationSyntaxError="";
function checkContactInvitationSyntax(){
 const value=els.contactPackage.value;
 let error="";
 if(/\s/.test(value))error="В ссылке не должно быть пробелов или переносов строк.";
 else if(value&&!value.startsWith("https://")&&!"https://".startsWith(value))error="Ссылка должна начинаться с https://.";
 if(error){
  contactInvitationSyntaxError=error;
  els.contactInvitationEntry.classList.remove("hidden");
  els.contactInvitationDetails.classList.add("hidden");
  els.firstContactWelcome.classList.add("hidden");
  setInlineStatus(els.qrStatus,error,true);
 }else if(contactInvitationSyntaxError){
  contactInvitationSyntaxError="";
  clearInlineStatus(els.qrStatus);
 }
}
function updatePasteContactButton(){els.pasteContact.textContent=els.contactPackage.value.length?"Очистить":"Вставить";els.pasteContact.disabled=false;}
els.contactPackage.addEventListener("input",()=>{
 contactInvitationLookupRevision++;
 updateImportContactButton();updatePasteContactButton();checkContactInvitationSyntax();
 if(!contactInvitationSyntaxError)void validateContactInvitation(els.contactPackage.value,"Ручной ввод");
});
els.contactPackage.addEventListener("paste",()=>{setTimeout(()=>validateContactInvitation(els.contactPackage.value,"Вставленная ссылка"),0);});
els.pasteContact.addEventListener("click",pasteContactInvitation);
updatePasteContactButton();

els.contactName.addEventListener("input",updateImportContactButton);
let responseDisplayNameWasPresent=false;
function updateSaveResponseDisplayNameOption(){const hasName=!!els.responseDisplayName.value.trim();els.saveResponseDisplayNameLabel.classList.toggle("hidden",!hasName);els.saveResponseDisplayName.disabled=!hasName;if(hasName&&!responseDisplayNameWasPresent)els.saveResponseDisplayName.checked=true;if(!hasName)els.saveResponseDisplayName.checked=false;responseDisplayNameWasPresent=hasName;}
 els.responseDisplayName.addEventListener("input",updateSaveResponseDisplayNameOption);
 updateSaveResponseDisplayNameOption();
els.importContact.addEventListener("click",importContactFromInput);
updateImportContactButton();
els.acceptContactRequest.addEventListener("click",acceptContactRequest);
els.declineContactRequest.addEventListener("click",declineContactRequest);
async function handleCreateInvitationClick(){
 clearInlineStatus(els.inviteStatus);
 clearInlineStatus(els.invitationScreenStatus);
 const created=await createContactInvitation({expectedRevision:profileInviteRevision});
 if(!created)return;
 els.profileScreen.classList.add("hidden");
 els.invitationScreen.classList.remove("hidden");
 syncContactScreenOpenClass();
 els.invitationScreenBack.focus();
 const value=els.inviteUrl.textContent.trim();
 if(!value)return;
 const qrNote=els.inviteQr.childElementCount?"":" QR-код пока недоступен.";
 try{
  if(navigator.clipboard?.writeText){
   await navigator.clipboard.writeText(value);
   setInlineStatus(els.invitationScreenStatus,"Приглашение создано и скопировано."+qrNote,!!qrNote);
   return;
  }
 }catch{}
 if(copyInviteFallback(value))setInlineStatus(els.invitationScreenStatus,"Приглашение создано и скопировано."+qrNote,!!qrNote);
 else setInlineStatus(els.invitationScreenStatus,"Приглашение создано. Если ссылка не скопировалась автоматически, нажмите кнопку копирования."+qrNote,true);
}
els.createInvite.addEventListener("click",handleCreateInvitationClick);
function openProfileScreen(){
 updateInvitePushHint();
 clearInlineStatus(els.inviteStatus);clearError();
 els.inviteContactName.value="";
 updateInviteUrlLabel();
 els.profileScreen.classList.remove("hidden");
 syncContactScreenOpenClass();
 els.profileScreenBack.focus();
}
function closeProfileScreen(){
 clearInlineStatus(els.inviteStatus);clearError();
 profileInviteRevision++;
 els.inviteContactName.value="";
 els.profileScreen.classList.add("hidden");
 syncContactScreenOpenClass();
 els.profileDockButton.focus();
}
async function closeInvitationScreen(){
 const issuedUrl=els.inviteUrl.textContent.trim();
 els.invitationScreen.classList.add("hidden");
 els.profileScreen.classList.remove("hidden");
 els.inviteContactName.value="";
 els.inviteUrl.textContent="";
 els.inviteQr.replaceChildren();
 clearInlineStatus(els.invitationScreenStatus);
 updateInviteUrlLabel();
 updateInviteCopyButton();
 syncContactScreenOpenClass();
 els.profileScreenBack.focus();
 if(issuedUrl){
  try{await clearMyInvitation(issuedUrl)}catch(error){debug("Не удалось очистить указатель приглашения: "+(error.message||String(error)))}
 }
}
let diagnosticReturnFocus=null;
async function refreshCameraDevices(){
 const button=els.refreshCameraDevices;
 button.disabled=true;
 els.cameraDevicesStatus.textContent="Проверяем доступные камеры…";
 els.cameraDevicesList.replaceChildren();
 try{
  if(!navigator.mediaDevices?.enumerateDevices)throw new Error("Браузер не поддерживает получение списка устройств.");
  const devices=await navigator.mediaDevices.enumerateDevices();
  const cameras=devices.filter(device=>device.kind==="videoinput");
  if(!cameras.length){
   els.cameraDevicesStatus.textContent="Камеры не обнаружены. Возможно, браузер пока не предоставил список устройств.";
   const item=document.createElement("li");item.textContent="Список видеоустройств пуст.";els.cameraDevicesList.append(item);
   return;
  }
  cameras.forEach((camera,index)=>{
   const item=document.createElement("li");
   const name=camera.label?.trim()||`Камера ${index+1} — название скрыто браузером`;
   item.textContent=name;
   els.cameraDevicesList.append(item);
  });
  const hiddenNames=cameras.some(camera=>!camera.label?.trim());
  els.cameraDevicesStatus.textContent=`Обнаружено камер: ${cameras.length}.`+(hiddenNames?" Firefox или другой браузер может скрывать названия до предоставления разрешения на камеру.":"");
 }catch(error){
  els.cameraDevicesStatus.textContent="Не удалось получить список камер: "+(error.message||String(error));
 }finally{
  button.disabled=false;
 }
}
function openDiagnosticScreen(){diagnosticReturnFocus=document.activeElement;els.diagnosticScreen.classList.remove("hidden");document.body.classList.add("contact-screen-open");resetDiagnosticLogAutoFollow();els.diagnosticScreenBack.focus();refreshCameraDevices();}
function closeDiagnosticScreen(){els.diagnosticScreen.classList.add("hidden");syncContactScreenOpenClass();if(diagnosticReturnFocus?.isConnected&&!diagnosticReturnFocus.classList.contains("hidden"))diagnosticReturnFocus.focus();else els.brandAbout.focus();diagnosticReturnFocus=null;}
window.addEventListener("focus",()=>{if(!els.profileScreen.classList.contains("hidden"))updateInvitePushHint();});
document.addEventListener("visibilitychange",()=>{if(document.visibilityState==="visible"&&!els.profileScreen.classList.contains("hidden"))updateInvitePushHint();});
els.profileDockButton.addEventListener("click",openProfileScreen);
els.diagnosticDockButton.addEventListener("click",openDiagnosticScreen);
els.contactDiagnosticButton.addEventListener("click",openDiagnosticScreen);
els.profileScreenBack.addEventListener("click",closeProfileScreen);
els.invitationScreenBack.addEventListener("click",closeInvitationScreen);
els.profileDisplayName.addEventListener("input",persistProfileDisplayName);
els.inviteContactName.addEventListener("input",updateInviteUrlLabel);
els.diagnosticScreenBack.addEventListener("click",closeDiagnosticScreen);
els.refreshCameraDevices.addEventListener("click",refreshCameraDevices);
els.copyDebugLog.addEventListener("click",()=>copyDiagnosticLog(els.debugLog,els.copyDebugLog));
els.copySwDebugLog.addEventListener("click",()=>copyDiagnosticLog(els.swDebugLog,els.copySwDebugLog));

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
 notifyServiceWorkerDiagnosticMode(enabled);
 els.contactDiagnosticsFooter.classList.toggle("hidden",!enabled);
 els.diagnosticDockButton.classList.toggle("hidden",!enabled);
 els.contactDiagnosticButton.classList.toggle("hidden",!enabled);
}
try{els.debugMode.checked=localStorage.getItem("vl.debugMode.v1")==="1"}catch{els.debugMode.checked=false}
applyDebugMode();
els.debugMode.addEventListener("change",()=>{
 try{localStorage.setItem("vl.debugMode.v1",els.debugMode.checked?"1":"0")}catch{}
 applyDebugMode();
 if(els.debugMode.checked){
  diagnosticReportStartedPerf=null;
  els.debugLog.textContent="";
  els.swDebugLog.textContent="Записей пока нет.";
  requestAnimationFrame(()=>{
   const requestLog=worker=>{try{worker?.postMessage({type:"VL_GET_SW_LOG"})}catch{}};
   requestLog(navigator.serviceWorker?.controller);
   navigator.serviceWorker?.getRegistration().then(reg=>requestLog(reg?.active)).catch(()=>{});
  });
  debug("Режим диагностики включён.");
 }else{
  els.debugLog.textContent="Диагностика выключена. Новые записи не сохраняются.";
  els.swDebugLog.textContent="Диагностика выключена. Новые записи не сохраняются.";
 }
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
 syncContactScreenOpenClass();
 els.brandAbout.focus();
}
function openSettingsScreen(){
 els.headerMenu.open=false;
 els.settingsScreen.classList.remove("hidden");
 document.body.classList.add("contact-screen-open");
 els.settingsScreenBack.focus();
}
function closeSettingsScreen(){
 els.settingsScreen.classList.add("hidden");
 syncContactScreenOpenClass();
 els.headerMenu.querySelector("summary").focus();
}
els.brandAbout.addEventListener("click",openAboutScreen);
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
 if(event.key!=="Escape"||!els.callScreen.classList.contains("hidden"))return;
 const openMenu=contextMenus.find(menu=>menu.open);
 if(!openMenu)return;
 closeContextMenus();
 openMenu.querySelector("summary")?.focus();
});
function updateResponseDisplayNameSection(){
 const profileName=getProfileDisplayName();
 els.responseDisplayNameSection.classList.toggle("hidden",!!profileName);
 updateSaveResponseDisplayNameOption();
 if(profileName){
  els.responseDisplayName.value="";
  els.saveResponseDisplayName.checked=false;
  updateSaveResponseDisplayNameOption();
 }
}
function openAddContactScreen(pasteFromClipboard=false,{preserveInput=false,fromInvitation=false}={}){
 clearInlineStatus(els.qrStatus);clearError();
 els.contactInvitationEntry.classList.remove("hidden");
 els.contactInvitationDetails.classList.add("hidden");els.firstContactWelcome.classList.add("hidden");
 if(!preserveInput){
  els.contactPackage.value="";els.contactName.value="";els.responseDisplayName.value="";els.saveResponseDisplayName.checked=false;
  els.contactPackage.dispatchEvent(new Event("input",{bubbles:true}));
 }
 updateResponseDisplayNameSection();
 els.addContactScreen.classList.remove("hidden");document.body.classList.add("contact-screen-open");els.contactTools.open=true;
 if(fromInvitation){els.contactInvitationEntry.classList.add("hidden");validateContactInvitation(els.contactPackage.value,"Ссылка-приглашение")}
 else if(pasteFromClipboard)pasteContactInvitation();else els.contactPackage.focus();
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
 syncContactScreenOpenClass();
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
 if(!els.chatEvents||!SupabaseSecureSignaling.validUserId(contactUserId))return;
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
   const meta=document.createElement("div");
   meta.className="chat-message-meta";
   const time=document.createElement("time");
   time.className="chat-message-time";
   time.dateTime=event.created_at;
   time.textContent=new Date(event.created_at).toLocaleTimeString("ru-RU",{hour:"2-digit",minute:"2-digit"});
   meta.append(time);
   if(event.direction==="outgoing"&&event.delivery_status!=="sending"){
    const status=document.createElement("span");
    status.className="chat-message-status";
    status.setAttribute("aria-label",event.delivery_status==="delivered"?"Доставлено":"Отправлено");
    status.textContent="✓";
    if(event.delivery_status==="delivered")status.classList.add("is-delivered");
    meta.append(status);
   }
   bubble.append(body,meta);
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
function syncChatVisualViewport(){
 const root=document.documentElement;
 const inputFocused=document.activeElement===els.chatMessage&&!els.contactScreen.classList.contains("hidden");
 if(!inputFocused){
  root.style.removeProperty("--vl-chat-viewport-height");
  root.style.removeProperty("--vl-chat-viewport-top");
  return;
 }
 const viewport=window.visualViewport;
 const height=viewport?.height||window.innerHeight;
 // Chrome on Android may pan the layout viewport to keep the focused textarea visible.
 // pageTop includes that automatic page scroll as well as visual-viewport offset.
 // Firefox for Android reports document pageTop while the keyboard is open;
 // using it as the fixed overlay's top makes the whole chat follow page panning.
 // offsetTop is relative to the layout viewport and keeps the chat aligned
 // with the visible viewport without moving its header with document scroll.
 const isFirefox= navigator.userAgent.includes("Firefox/");
 const top=viewport?(isFirefox?(viewport.offsetTop||0):(Number.isFinite(viewport.pageTop)?viewport.pageTop:(window.scrollY+(viewport.offsetTop||0)))):window.scrollY;
 root.style.setProperty("--vl-chat-viewport-height",Math.max(1,height)+"px");
 root.style.setProperty("--vl-chat-viewport-top",Math.max(0,top)+"px");
}
function updateChatComposerState(){
 const contact=allContacts.find(item=>item.user_id===els.peer.value);
 const allowed=!!contact&&!contact.request_pending;
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
  sendPushEventToContact(peer,"new_message",crypto.randomUUID(),Date.now()+24*60*60*1000,debug)
   .then(()=>debug("OneSignal принял push о новом сообщении."))
   .catch(error=>debug("Push о сообщении не отправлен (сообщение уже отправлено через Supabase): "+(error.message||String(error))));
  if(els.peer.value===peer)els.chatMessage.value="";
  updateChatComposerState();
 }catch(error){
  showError("Не удалось отправить сообщение: "+(error.message||String(error)));
  updateChatComposerState();
 }
}
function openCallScreen(){
 if(!els.callScreen.classList.contains("hidden"))return true;
 clearError();
 state.callReturnFocus=document.activeElement instanceof HTMLElement?document.activeElement:null;
 els.callScreen.classList.remove("hidden");
 document.body.classList.add("call-screen-open");
 updateCallButtons();
 els.callScreen.focus({preventScroll:true});
 return true;
}
function closeCallScreen(){
 if(els.callScreen.classList.contains("hidden"))return;
 els.callScreen.classList.add("hidden");
 document.body.classList.remove("call-screen-open");
 const returnFocus=state.callReturnFocus;
 state.callReturnFocus=null;
 state.callPeer="";
 state.callPeerLabel="";
 clearError();
 updateCallButtons();
 if(returnFocus?.isConnected&&!returnFocus.closest(".hidden")){
  try{returnFocus.focus({preventScroll:true})}catch{}
 }
}
function handleContactScreenBack(){
 if(!els.callScreen.classList.contains("hidden"))return;
 closeContactScreen();
}
function openContactScreen(item,preserveSelection=false,{returnTo="main"}={}){
 contactScreenReturnTarget=returnTo;
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
 if(!SupabaseSecureSignaling.validUserId(senderId)||senderId===state.me)return false;
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
 const returnTo=contactScreenReturnTarget;
 contactScreenReturnTarget="main";
 clearError();
 els.contactEditScreen.classList.add("hidden");
 els.contactDeleteScreen.classList.add("hidden");
 els.contactScreen.classList.add("hidden");
 syncContactScreenOpenClass();
 els.contactScreenMenu.open=false;
 if(returnTo==="add-contact")openAddContactScreen(false);
}
els.contactList.addEventListener("click",event=>{
 const item=event.target.closest(".contact-list-item[data-peer]");
 if(!item||!els.contactList.contains(item))return;
 openContactScreen(item);
});
els.addContactFab.addEventListener("click",()=>openAddContactScreen(false));
els.addContactScreenBack.addEventListener("click",closeAddContactScreen);
els.contactScreenBack.addEventListener("click",handleContactScreenBack);
els.contactScreenCall.addEventListener("click",connect);
els.chatComposer.addEventListener("submit",event=>{event.preventDefault();sendChatMessage()});
els.chatMessage.addEventListener("focus",syncChatVisualViewport);
els.chatMessage.addEventListener("blur",()=>requestAnimationFrame(syncChatVisualViewport));
window.visualViewport?.addEventListener("resize",syncChatVisualViewport);
window.visualViewport?.addEventListener("scroll",syncChatVisualViewport);
window.addEventListener("scroll",syncChatVisualViewport,{passive:true});
window.addEventListener("resize",syncChatVisualViewport);
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
 if(event.key!=="Escape"||!els.callScreen.classList.contains("hidden"))return;
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
  setSecurePeer(peer);
 }

});

document.addEventListener("visibilitychange",()=>{
 if(!document.hidden){
  syncContactScreenOpenClass();
  reconcileOutgoingCallExpiry();
 }
});
window.addEventListener("pageshow",()=>{
 syncContactScreenOpenClass();
 reconcileOutgoingCallExpiry();
});
window.addEventListener("focus",()=>{
 syncContactScreenOpenClass();
 reconcileOutgoingCallExpiry();
});

els.hangup.addEventListener("click",hangup);
els.cameraToggle.addEventListener("click",async()=>{
 if(!state.webrtc||state.hangingUp||!state.peerPresent||state.outgoingCall)return;
 try{
  const enabled=!state.webrtc.videoEnabled;
  await state.webrtc.setVideoEnabled(enabled);
  updateCallButtons();
  debug(enabled?"Видео включено пользователем.":"Видео выключено пользователем.");
 }catch(error){
  updateCallButtons();
  debug("Не удалось включить/выключить камеру: "+(error.name||"Error")+": "+(error.message||String(error)));
  showError("Не удалось включить камеру: "+(error.message||String(error)));
 }
});
els.cameraSwitch.addEventListener("click",async()=>{
 if(!state.webrtc||state.hangingUp||!state.webrtc.videoEnabled||state.webrtc.diagnosticCamera)return;
 try{await state.webrtc.switchCamera();updateCallButtons();}
 catch(error){showError("Не удалось переключить камеру: "+(error.message||String(error)));}
});
els.micToggle.addEventListener("click",()=>{
 if(!state.webrtc?.localStream||state.hangingUp)return;
 const enabled=!state.webrtc.micEnabled;
 state.webrtc.setMicEnabled(enabled);
 state.micMuted=!enabled;
 updateCallButtons();
 debug("Микрофон "+(enabled?"включён":"выключен")+" пользователем во время звонка.");
});
els.speakerToggle.addEventListener("click",async()=>{
 if(state.hangingUp||typeof els.audio.setSinkId!=="function"||typeof navigator.mediaDevices?.selectAudioOutput!=="function")return;
 try{
  if(state.speakerOutputId){
   await els.audio.setSinkId("");
   state.speakerOutputId=null;
   debug("Аудиовыход возвращён к настройке браузера.");
  }else{
   const device=await navigator.mediaDevices.selectAudioOutput();
   if(!device?.deviceId)return;
   await els.audio.setSinkId(device.deviceId);
   state.speakerOutputId=device.deviceId;
   debug("Выбран аудиовыход: "+(device.label||"устройство без названия")+".");
  }
  updateCallButtons();
 }catch(error){
  debug("Не удалось переключить аудиовыход: "+(error.name||"Error")+": "+(error.message||String(error)));
  showError("Браузер не смог переключить аудиовыход: "+(error.message||String(error)));
 }
});
els.confirmDeleteContact.addEventListener("click",deleteSelectedContact);
els.saveContactName.addEventListener("click",saveSelectedContactName);
els.editContactName.addEventListener("input",updateCallButtons);
els.tcp.classList.add("hidden");
try{els.pilot.checked=localStorage.getItem("vl.simulateMicrophone.v1")==="1"}catch{els.pilot.checked=false}
try{els.cameraPilot.checked=localStorage.getItem("vl.simulateCamera.v1")==="1"}catch{els.cameraPilot.checked=false}
els.dismissIncoming.classList.add("hidden");
async function initializeApp(){
 debug("Браузер: "+getBrowserDiagnosticName()+"; платформа: "+(navigator.userAgentData?.platform||navigator.platform||"не определена")+"; UA: "+(navigator.userAgent||"нет"));
 let deepLinkInvitation=false;
 try{
  // Remove obsolete extractable legacy keys; the active identity and trust records live in IndexedDB.
  try{
   for(let i=localStorage.length-1;i>=0;i--){
    const key=localStorage.key(i);
    if(key?.startsWith("vl.identity.v1.")||key?.startsWith("vl.peer.v1."))localStorage.removeItem(key);
   }
  }catch(error){debug("Не удалось очистить устаревшие локальные ключи: "+(error.message||String(error)));}
  try{
   const supabaseIdentity=await getSupabaseIdentity();
   state.supabaseUserId=supabaseIdentity.user_id;
   debug("Supabase Anonymous Auth готов; UUID="+state.supabaseUserId+".");
   const fragment=new URLSearchParams(window.location.hash.slice(1));
   deepLinkInvitation=fragment.has("contact");
   if(deepLinkInvitation){
    const invitationUrl=new URL(window.location.href);
    invitationUrl.protocol="https:";
    invitationUrl.search="";
    els.contactPackage.value=invitationUrl.href;
    updatePasteContactButton();
    openAddContactScreen(false,{preserveInput:true});
    const cleanUrl=new URL(window.location.href);
    cleanUrl.hash="";
    window.history.replaceState(null,"",cleanUrl.href);
   }

  }catch(error){
   state.supabaseUserId=null;
   throw new Error("Supabase Auth недоступен: "+(error.message||String(error)));
  }
  const identity=await getCurrentSignalingIdentity();
  state.me=identity.user_id;
  await redeemPendingSupabaseInvitations();
  await flushPendingSupabaseOutboxes("запуск приложения");
  await refreshContactOptions();
   if(deepLinkInvitation)await validateContactInvitation(els.contactPackage.value,"Ссылка-приглашение");
  if(!state.supabaseUserId)throw Error("Supabase Auth не инициализирован.");
  const subscribed=await subscribeForUser(state.me);
  try{startSupabaseInbox()}catch(error){throw new Error("Не удалось запустить Supabase inbox: "+(error.message||String(error)))}

  const requestedChat=new URLSearchParams(window.location.search).get("openChat");
  if(requestedChat){
   await openChatFromNotification(requestedChat);
   const cleanUrl=new URL(window.location.href);
   cleanUrl.searchParams.delete("openChat");
   window.history.replaceState(null,"",cleanUrl.href);
  }

  const contacts=await listContacts();
  els.debugUrl.textContent="Supabase · "+(state.supabaseUserId?state.supabaseUserId.slice(0,12)+"…":"недоступен");
  setStatus("Локальная идентичность готова",contacts.length?"Выберите контакт для звонка.":"Сохранённых контактов пока нет.","idle");
  document.documentElement.dataset.voicelinkBooted="true";
  updateWebPushStatus();
   checkServiceWorkerAvailability();
   checkPushBackendAvailability();
   const oneSignalReady=initializeOneSignal().then(async()=>{
   debug("OneSignal Web Push SDK инициализирован.");
   
   const pushDiagnostics=await getOneSignalPushDiagnostics();
   debug("[OneSignal subscription] permission="+pushDiagnostics.permission+
    "; supported="+pushDiagnostics.supported+
    "; optedIn="+(pushDiagnostics.optedIn===null?"unknown":pushDiagnostics.optedIn)+
    "; subscriptionId="+(pushDiagnostics.subscriptionIdSuffix?"…"+pushDiagnostics.subscriptionIdSuffix:"UNAVAILABLE")+
    "; idAvailable="+pushDiagnostics.idAvailable+
    (pushDiagnostics.error?"; error="+pushDiagnostics.error:"")+".");
   return true;
  }).catch(error=>{
   debug("OneSignal пока недоступен: "+(error.message||String(error)));
   return false;
  });
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
try{els.cameraPilot.checked=localStorage.getItem("vl.simulateCamera.v1")==="1"}catch{els.cameraPilot.checked=false}
els.pilot.addEventListener("change",()=>{try{localStorage.setItem("vl.simulateMicrophone.v1",els.pilot.checked?"1":"0")}catch{}});
els.cameraPilot.addEventListener("change",()=>{try{localStorage.setItem("vl.simulateCamera.v1",els.cameraPilot.checked?"1":"0")}catch{}});
els.dismissIncoming.classList.add("hidden");
initializeApp();

