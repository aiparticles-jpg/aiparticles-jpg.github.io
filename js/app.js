import { WebRtcAudio } from "./webrtc.js?v=10";
import { NtfySecureSignaling } from "./ntfy-signaling.js?v=8";

const $=id=>document.getElementById(id);
const els={
 my:$("my-name"),peer:$("peer-name"),connect:$("connect"),resetPeer:$("reset-peer"),verify:$("verify-panel"),
 verifyCode:$("verify-code"),confirm:$("confirm-peer"),indicator:$("connection-indicator"),
 statusIcon:$("status-icon"),statusTitle:$("status-title"),statusText:$("status-text"),
 transport:$("transport-label"),tcp:$("tcp-fallback"),hangup:$("hangup"),
 audio:$("remote-audio"),pilot:$("diagnostic-pilot"),error:$("error-message"),debugLog:$("debug-log"),
 debugUrl:$("debug-url"),debugState:$("debug-state")
};
const state={secure:null,webrtc:null,role:null,peerPresent:false,connecting:false,callStarted:false};
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
function setBusy(value){state.connecting=value;els.connect.disabled=value;els.connect.textContent=value?"Подключаемся…":"Подключиться";els.my.disabled=value;els.peer.disabled=value}
async function ensureWebRtc(){
 if(state.webrtc)return;
 state.webrtc=new WebRtcAudio({
  diagnosticPilot:els.pilot.checked,
  sendSignal:payload=>state.secure.sendSignal(payload),
  onRemoteStream:stream=>{els.audio.srcObject=stream;els.audio.play().catch(e=>debug("Не удалось включить удалённый звук: "+e.message))},
  onError:error=>showError(error.message||String(error)),
  onState:value=>{
   debug("WebRTC: "+value);
   if(value==="connection-connected"){els.transport.textContent="Прямой WebRTC / P2P";setStatus("WebRTC соединение установлено","Проверяем передачу аудио между устройствами.","live")}
   else if(value==="connection-failed"||value==="ice-failed"){els.transport.textContent="WebRTC: соединение не установлено";setStatus("P2P не получилось","Сигнализация работает, но прямой аудиоканал не установился. TURN-сервер пока не настроен.","error")}
   else if(value==="connection-connecting"||value==="ice-checking"||value==="ice-connected"||value==="ice-completed"){setStatus("Устанавливаем аудиосоединение","Проверяем сетевые маршруты между устройствами.","wait")}
   else if(value==="connection-disconnected"||value==="ice-disconnected"){setStatus("Связь прервалась","WebRTC потерял сетевое соединение; ожидаем восстановления.","wait")}
  }
 });
}
async function onSecureReady(info){
 state.peerPresent=true;state.role=state.secure.role==="A"?"initiator":"receiver";
 els.verify.classList.add("hidden");els.hangup.disabled=false;
 setStatus("Ключ собеседника подтверждён",info.trusted?"Сохранённый ключ совпадает. Запускаем голосовой канал.":"Первичная проверка пройдена. Запускаем голосовой канал.","wait");
 debug(info.trusted?"Сохраненная идентичность подтверждена.":"Новая идентичность собеседника сохранена.");
 if(state.role==="initiator")await startWebRtcOffer();
}
async function handleSignal(payload){
 await ensureWebRtc();await state.webrtc.handleSignal(payload);
}
async function startWebRtcOffer(){
 if(state.callStarted)return;state.callStarted=true;
 try{await ensureWebRtc();await state.webrtc.createOffer();debug("WebRTC offer передан в ntfy. Ожидаем answer от второго устройства и установления P2P.")}
 catch(e){state.callStarted=false;showError("Не удалось запустить WebRTC: "+e.message);setStatus("Не удалось начать звонок","Проверьте разрешение микрофона и повторите попытку.","error")}
}
async function connect(){
 clearError();els.verify.classList.add("hidden");setBusy(true);
 try{
  if(state.secure)state.secure.close();
  if(state.webrtc){await state.webrtc.close({stopTracks:true});state.webrtc=null}
  state.callStarted=false;state.peerPresent=false;
  const me=els.my.value.trim().toLowerCase(),peer=els.peer.value.trim().toLowerCase();
  if(!NtfySecureSignaling.validName(me)||!NtfySecureSignaling.validName(peer)||me===peer)throw Error("Имена должны содержать 3–24 символа: a-z, 0-9, _ или -. Имена должны различаться.");
  localStorage.setItem("vl.last-name",me);localStorage.setItem("vl.last-peer",peer);
  setStatus("Подключаемся к ntfy","Открываем канал обнаружения собеседника.","wait");
  state.secure=new NtfySecureSignaling({
   me,peer,
   onSignal:handleSignal,
   onStatus:m=>{els.statusText.textContent=m;debug(m)},
   onVerify:({sas,peer:name})=>{els.verifyCode.textContent=sas;els.verify.classList.remove("hidden");els.confirm.disabled=false;setStatus("Нужно подтвердить собеседника","Сверьте короткий код с "+name+" по независимому каналу.","wait");debug("Код проверки: "+sas)},
   onReady:info=>onSecureReady(info).catch(showError),
   onError:e=>showError(e.message||String(e)),
   onDebug:debug
  });
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
  showError(e.message||String(e));
  setStatus("Не удалось подключиться","Проверьте разрешения и попробуйте снова.","error");
  if(state.secure){state.secure.close();state.secure=null}
  if(state.webrtc){await state.webrtc.close({stopTracks:true});state.webrtc=null}
 }
 finally{setBusy(false);els.pilot.disabled=!!state.webrtc}
}
async function hangup(){
 state.secure?.close();state.secure=null;
 if(state.webrtc){await state.webrtc.close({stopTracks:true});state.webrtc=null}
 els.audio.srcObject=null;els.hangup.disabled=true;els.pilot.disabled=false;els.transport.textContent="Не выбран";
 els.verify.classList.add("hidden");state.callStarted=false;state.peerPresent=false;
 setStatus("Звонок завершён","Чтобы позвонить снова, нажмите «Подключиться».","idle");
}
els.connect.addEventListener("click",connect);
els.pilot.addEventListener("change",()=>debug("Диагностический pilot-сигнал "+(els.pilot.checked?"включён":"выключен")+". Настройка применяется при следующем подключении."));
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
els.my.value=localStorage.getItem("vl.last-name")||"";
els.peer.value=localStorage.getItem("vl.last-peer")||"";
setStatus("Ожидаем подключения","Введите своё имя и имя собеседника.","idle");
