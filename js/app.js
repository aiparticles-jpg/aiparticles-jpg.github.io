import { WebRtcAudio } from "./webrtc.js?v=12";
import { NtfySecureSignaling } from "./ntfy-signaling.js?v=14";

const $=id=>document.getElementById(id);
const els={
 my:$("my-name"),changeName:$("change-name"),peer:$("peer-name"),connect:$("connect"),dismissIncoming:$("dismiss-incoming"),resetPeer:$("reset-peer"),verify:$("verify-panel"),
 verifyCode:$("verify-code"),confirm:$("confirm-peer"),indicator:$("connection-indicator"),
 statusIcon:$("status-icon"),statusTitle:$("status-title"),statusText:$("status-text"),
 transport:$("transport-label"),tcp:$("tcp-fallback"),hangup:$("hangup"),
 audio:$("remote-audio"),pilot:$("diagnostic-pilot"),error:$("error-message"),debugLog:$("debug-log"),
 debugUrl:$("debug-url"),debugState:$("debug-state")
};
const state={secure:null,webrtc:null,role:null,peerPresent:false,connecting:false,callStarted:false,editingName:false,prewarmNames:null,prewarmTargetNames:null,prewarmTimer:null,prewarmPromise:null,prewarmPending:null,incomingCall:false,incomingTimer:null,callTimer:null,outgoingCall:false,ringingKind:null,ringContext:null,ringPulseTimer:null,ringOscillators:[]};
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
function updateCallButtons(){
 const active=!!(state.peerPresent||state.outgoingCall||state.secure?.active);
 els.connect.classList.toggle("hidden",active);
 els.connect.disabled=active||state.connecting;
 els.connect.textContent=state.connecting?"Подключаемся…":state.incomingCall?"Ответить":"Подключиться";
 els.hangup.classList.toggle("hidden",!active);
 els.hangup.disabled=!active;
 els.dismissIncoming.disabled=state.connecting;
}
function setBusy(value){state.connecting=value;updateCallButtons();els.my.disabled=value||!state.editingName;els.changeName.disabled=value;els.peer.disabled=value}
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
 state.incomingCall=false;els.dismissIncoming.classList.add("hidden");updateCallButtons();
}
function showIncomingCall({peer,expiresAt,trusted=true}){
 if(state.connecting||state.callStarted||state.outgoingCall||state.incomingCall)return;
 const remaining=Math.max(0,expiresAt-Date.now());
 if(!remaining)return;
 state.incomingCall=true;els.dismissIncoming.classList.remove("hidden");updateCallButtons();
 const description=trusted
  ?"Вам звонит "+peer+". Нажмите «Ответить» или «Скрыть вызов».":"Запрос от "+peer+". Устройство ещё не сопряжено: после ответа обязательно сверьте проверочный код.";
 setStatus(trusted?"Входящий вызов":"Новый запрос на сопряжение",description,"wait");
 debug((trusted?"Входящий вызов от подтверждённого устройства ":"Новый запрос от непроверенного устройства ")+peer+".");
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
 state.outgoingCall=true;updateCallButtons();setStatus("Вызываем "+peer,"Ожидаем ответа. Вызов завершится автоматически через 45 секунд.","wait");
 startRinging("outgoing");
 state.callTimer=setTimeout(()=>finishNoAnswer(),remaining);
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
 return new WebRtcAudio({
  diagnosticPilot,
  sendSignal:payload=>state.secure.sendSignal(payload),
  onRemoteStream:stream=>{els.audio.srcObject=stream;els.audio.play().catch(e=>debug("Не удалось включить удалённый звук: "+e.message))},
  onError:error=>showError(error.message||String(error)),
  onState:value=>{
   debug("WebRTC: "+value);
   if(value==="connection-connected"){updateCallButtons();els.transport.textContent="Прямой WebRTC / P2P";setStatus("WebRTC соединение установлено","Проверяем передачу аудио между устройствами.","live")}
   else if(value==="connection-failed"||value==="ice-failed"){els.transport.textContent="WebRTC: соединение не установлено";setStatus("P2P не получилось","Сигнализация работает, но прямой аудиоканал не установился. TURN-сервер пока не настроен.","error")}
   else if(value==="connection-connecting"||value==="ice-checking"||value==="ice-connected"||value==="ice-completed"){setStatus("Устанавливаем аудиосоединение","Проверяем сетевые маршруты между устройствами.","wait")}
   else if(value==="connection-disconnected"||value==="ice-disconnected"){setStatus("Связь прервалась","WebRTC потерял сетевое соединение; ожидаем восстановления.","wait")}
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
  onDialing:startOutgoingCall,
  onVerify:({sas,peer:name})=>{stopOutgoingCall();clearIncomingUi();stopRinging();els.verifyCode.textContent=sas;els.verify.classList.remove("hidden");els.confirm.disabled=false;setStatus("Нужно подтвердить собеседника","Сверьте короткий код с "+name+" по независимому каналу.","wait");debug("Код проверки: "+sas)},
  onReady:info=>{stopOutgoingCall();clearIncomingUi();stopRinging();return onSecureReady(info).catch(showError)},
  onError:e=>showError(e.message||String(e)),
  onDebug:debug
 });
}
async function subscribeForUser(me){
 if(!NtfySecureSignaling.validName(me))return;
 if(state.secure&&state.secure.me===me&&state.secure.es)return;
 if(state.secure){state.secure.close();state.secure=null}
 const peer=els.peer.value.trim().toLowerCase();
 const subscription=createSecureSignaling(me,NtfySecureSignaling.validName(peer)&&peer!==me?peer:"");
 state.secure=subscription;
 els.debugUrl.textContent="https://ntfy.sh/ · "+me;
 setStatus("Подписываемся на ntfy","Открываем постоянный канал входящих сообщений для "+me+".","wait");
 try{
  await subscription.subscribe();
  debug("Фоновая подписка активна для имени "+me+". POST hello пока не отправлялся.");
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
  const me=els.my.value.trim().toLowerCase(),peer=els.peer.value.trim().toLowerCase();
  const names=me+"|"+peer;
  const eligible=NtfySecureSignaling.validName(me)&&NtfySecureSignaling.validName(peer)&&
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
    const latestMe=els.my.value.trim().toLowerCase(),latestPeer=els.peer.value.trim().toLowerCase();
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
 state.peerPresent=true;state.role=state.secure.role==="A"?"initiator":"receiver";
 els.verify.classList.add("hidden");updateCallButtons();
 setStatus("Ключ собеседника подтверждён",info.trusted?"Сохранённый ключ совпадает. Запускаем голосовой канал.":"Первичная проверка пройдена. Запускаем голосовой канал.","wait");
 debug(info.trusted?"Сохраненная идентичность подтверждена.":"Новая идентичность собеседника сохранена.");
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
 if(answering){clearIncomingUi();stopRinging()}
 clearError();els.verify.classList.add("hidden");setBusy(true);
 try{
  const me=els.my.value.trim().toLowerCase(),peer=els.peer.value.trim().toLowerCase();
  if(state.prewarmPromise&&(state.prewarmTargetNames===me+"|"+peer||state.prewarmNames===me+"|"+peer)){try{await state.prewarmPromise}catch{}}
  const keepPrewarm=!!(state.webrtc&&state.webrtc.isPrewarmed()&&state.prewarmNames===me+"|"+peer&&me<peer&&!els.pilot.checked);
  if(state.webrtc&&!keepPrewarm){await state.webrtc.close({stopTracks:true});state.webrtc=null;state.prewarmNames=null}
  state.callStarted=false;state.peerPresent=false;
  if(!NtfySecureSignaling.validName(me)||!NtfySecureSignaling.validName(peer)||me===peer)throw Error("Имена должны содержать 3–24 символа: a-z, 0-9, _ или -. Имена должны различаться.");
  localStorage.setItem("vl.last-name",me);localStorage.setItem("vl.last-peer",peer);
  state.editingName=false;els.my.disabled=true;els.changeName.textContent="Сменить имя пользователя";
  if(state.secure&&state.secure.me!==me){state.secure.close();state.secure=null}
  if(!state.secure)state.secure=createSecureSignaling(me,peer);
  else state.secure.setPeer(peer);
  els.debugUrl.textContent="https://ntfy.sh/ · "+me;

  // Request microphone while the user-initiated Connect click is still active.
  // Do not wait for the asynchronous secure handshake before asking permission.
  ensureWebRtc();
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
  state.peerPresent=false;updateCallButtons();
  if(answering){clearIncomingUi();stopRinging()}
 }
 finally{setBusy(false);els.pilot.disabled=!!state.webrtc}
}
async function hangup(){
 stopOutgoingCall();if(state.incomingCall)state.secure?.dismissIncoming();clearIncomingUi();stopRinging();
 state.secure?.resetSession();
 if(state.webrtc){await state.webrtc.close({stopTracks:true});state.webrtc=null}
 els.audio.srcObject=null;els.pilot.disabled=false;els.transport.textContent="Не выбран";
 els.verify.classList.add("hidden");state.callStarted=false;state.peerPresent=false;updateCallButtons();
 setStatus("Звонок завершён","Подписка на ваше имя остаётся активной. Чтобы позвонить снова, нажмите «Подключиться».","idle");
 scheduleIcePrewarm("hangup",true);
}
els.connect.addEventListener("click",connect);
els.dismissIncoming.addEventListener("click",()=>dismissIncoming(false));
document.addEventListener("pointerdown",unlockRingingAudio,{passive:true});
document.addEventListener("keydown",unlockRingingAudio);
els.changeName.addEventListener("click",async()=>{
 if(!state.editingName){
  state.editingName=true;els.my.disabled=false;els.my.focus();
  els.changeName.textContent="Сохранить имя";
  debug("Режим смены имени пользователя.");
  return;
 }
 const next=els.my.value.trim().toLowerCase();
 if(!NtfySecureSignaling.validName(next)){
  showError("Имя пользователя должно содержать 3–24 символа: a-z, 0-9, _ или -.");
  return;
 }
 const previous=localStorage.getItem("vl.last-name")||"";
 if(previous!==next&&state.secure){
  if(state.secure.active)await hangup();
  state.secure.close();state.secure=null;
 }
 localStorage.setItem("vl.last-name",next);
 state.editingName=false;els.my.disabled=true;els.changeName.textContent="Сменить имя пользователя";
 clearError();
 if(previous!==next||!state.secure)await subscribeForUser(next);
 else setStatus("Подписка активна","Вы подписаны на входящие сообщения для "+next+".","idle");
});
els.pilot.addEventListener("change",async()=>{
 debug("Диагностический pilot-сигнал "+(els.pilot.checked?"включён":"выключен")+". Настройка применяется при следующем подключении.");
 if(!state.secure?.active&&!state.callStarted){if(state.webrtc?.prewarmed){await state.webrtc.close({stopTracks:true});state.webrtc=null;state.prewarmNames=null}scheduleIcePrewarm("pilot-change")}
});
els.my.addEventListener("input",()=>scheduleIcePrewarm("input"));
els.peer.addEventListener("input",()=>{
 const peer=els.peer.value.trim().toLowerCase();
 if(state.incomingCall&&peer!==state.secure?.peer)dismissIncoming(false);
 if(state.secure&&!state.secure.active&&!state.connecting){
  const me=els.my.value.trim().toLowerCase();
  state.secure.setPeer(NtfySecureSignaling.validName(peer)&&peer!==me?peer:"");
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
els.resetPeer.addEventListener("click",async()=>{
 const peer=els.peer.value.trim().toLowerCase();
 if(!NtfySecureSignaling.validName(peer)){
  showError("Сначала укажите корректное имя собеседника.");
  return;
 }
 if(!window.confirm("Удалить сохранённое доверие к устройству с именем "+peer+" на этом браузере? Собственный ключ не удаляется. Для повторного сопряжения выполните сброс и на другом устройстве."))return;
 await hangup();
 localStorage.removeItem("vl.peer.v1."+peer);
 clearError();
 debug("Удалено сохранённое сопряжение с "+peer+". При следующем подключении потребуется сверить новый код.");
 setStatus("Сопряжение сброшено","Подключитесь заново и сравните проверочные коды на обоих устройствах.","idle");
});
els.tcp.classList.add("hidden");
els.pilot.checked=false;
els.dismissIncoming.classList.add("hidden");
els.my.value=localStorage.getItem("vl.last-name")||"";
els.peer.value=localStorage.getItem("vl.last-peer")||"";
state.editingName=!NtfySecureSignaling.validName(els.my.value.trim().toLowerCase());
els.my.disabled=!state.editingName;
els.changeName.textContent=state.editingName?"Сохранить имя":"Сменить имя пользователя";
setStatus("Ожидаем подключения","Введите имя собеседника.","idle");
if(!state.editingName)subscribeForUser(els.my.value.trim().toLowerCase());
scheduleIcePrewarm();
