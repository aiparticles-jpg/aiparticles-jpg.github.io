import { WebRtcAudio } from "./webrtc.js";
import { NtfySecureSignaling } from "./ntfy-signaling.js?v=2";

const $=id=>document.getElementById(id);
const els={
 my:$("my-name"),peer:$("peer-name"),connect:$("connect"),verify:$("verify-panel"),
 verifyCode:$("verify-code"),confirm:$("confirm-peer"),indicator:$("connection-indicator"),
 statusIcon:$("status-icon"),statusTitle:$("status-title"),statusText:$("status-text"),
 transport:$("transport-label"),tcp:$("tcp-fallback"),hangup:$("hangup"),
 audio:$("remote-audio"),error:$("error-message"),debugLog:$("debug-log"),
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
  sendSignal:payload=>state.secure.sendSignal(payload).catch(showError),
  onRemoteStream:stream=>{els.audio.srcObject=stream;els.audio.play().catch(()=>{})},
  onState:value=>{
   if(value==="connected"){els.transport.textContent="Прямой WebRTC / P2P";setStatus("Вы на связи","Аудио передаётся напрямую между устройствами.","live")}
   else if(value==="failed"){els.transport.textContent="WebRTC: соединение не установлено";setStatus("P2P не получилось","Сеть не позволила установить прямой аудиоканал. TURN-сервер пока не настроен.","error")}
   else if(value==="connecting"||value==="checking")setStatus("Устанавливаем аудиосоединение","ICE проверяет доступные сетевые маршруты.","wait");
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
 try{await ensureWebRtc();await state.webrtc.createOffer();debug("WebRTC offer отправлен через зашифрованный ntfy-канал.")}
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
   onError:e=>showError(e.message||String(e))
  });
  els.debugUrl.textContent="https://ntfy.sh/ · "+me;
  await state.secure.start();
  els.hangup.disabled=false;
 }catch(e){showError(e.message||String(e));setStatus("Не удалось подключиться","Исправьте ошибку и попробуйте снова.","error");if(state.secure){state.secure.close();state.secure=null}}
 finally{setBusy(false)}
}
async function hangup(){
 state.secure?.close();state.secure=null;
 if(state.webrtc){await state.webrtc.close({stopTracks:true});state.webrtc=null}
 els.audio.srcObject=null;els.hangup.disabled=true;els.transport.textContent="Не выбран";
 els.verify.classList.add("hidden");state.callStarted=false;state.peerPresent=false;
 setStatus("Звонок завершён","Чтобы позвонить снова, нажмите «Подключиться».","idle");
}
els.connect.addEventListener("click",connect);
els.confirm.addEventListener("click",async()=>{
 els.confirm.disabled=true;
 try{await state.secure.confirmPeer();els.verify.classList.add("hidden");debug("Первичная проверка подтверждена пользователем.")}
 catch(e){showError(e.message);els.confirm.disabled=false}
});
els.hangup.addEventListener("click",hangup);
els.tcp.classList.add("hidden");
els.my.value=localStorage.getItem("vl.last-name")||"";
els.peer.value=localStorage.getItem("vl.last-peer")||"";
setStatus("Ожидаем подключения","Введите своё имя и имя собеседника.","idle");
