const VL_PUSH_DB="voicelink-push-events-v1";
const VL_APP_EVENTS=new Set([
 "incoming_call",
 "new_message",
 "contact_request",
 "call_cancelled",
 "call_ignored",
 "call_ended"
]);

function vlOpenPushDb(){
 return new Promise((resolve,reject)=>{
  const request=indexedDB.open(VL_PUSH_DB,1);
  request.onupgradeneeded=()=>request.result.createObjectStore("events",{autoIncrement:true});
  request.onsuccess=()=>resolve(request.result);
  request.onerror=()=>reject(request.error||new Error("IndexedDB open failed"));
 });
}
async function vlStorePush(payload){
 const db=await vlOpenPushDb();
 try{
  await new Promise((resolve,reject)=>{
   const tx=db.transaction("events","readwrite");
   tx.objectStore("events").add({receivedAt:Date.now(),payload});
   tx.oncomplete=resolve;
   tx.onerror=()=>reject(tx.error||new Error("IndexedDB write failed"));
   tx.onabort=()=>reject(tx.error||new Error("IndexedDB write aborted"));
  });
 }finally{db.close()}
}
async function vlClearPushes(){
 const db=await vlOpenPushDb();
 try{
  await new Promise((resolve,reject)=>{
   const tx=db.transaction("events","readwrite");
   tx.objectStore("events").clear();
   tx.oncomplete=resolve;
   tx.onerror=()=>reject(tx.error||new Error("IndexedDB clear failed"));
   tx.onabort=()=>reject(tx.error||new Error("IndexedDB clear aborted"));
  });
 }finally{db.close()}
}
function vlDecodeData(value){
 if(typeof value==="string"){
  try{return JSON.parse(value)}catch{return {}}
 }
 return value&&typeof value==="object"?value:{};
}
function vlParsePushData(parsed){
 const candidates=[
  parsed?.custom?.a,
  parsed?.data,
  parsed?.additionalData,
  parsed?.notification?.data
 ];
 for(const candidate of candidates){
  const data=vlDecodeData(candidate);
  if(VL_APP_EVENTS.has(data.event))return data;
 }
 return {};
}
async function vlFindContactName(userId){
 if(typeof userId!=="string"||!/^[a-f0-9]{64}$/.test(userId))return "";
 let db;
 try{
  db=await new Promise((resolve,reject)=>{
   const request=indexedDB.open("voicelink-local");
   request.onsuccess=()=>resolve(request.result);
   request.onerror=()=>reject(request.error||new Error("IndexedDB open failed"));
  });
  if(!db.objectStoreNames.contains("contacts"))return "";
  return await new Promise((resolve,reject)=>{
   const tx=db.transaction("contacts","readonly");
   const request=tx.objectStore("contacts").get(userId);
   request.onsuccess=()=>resolve(typeof request.result?.name==="string"?request.result.name.trim():"");
   request.onerror=()=>reject(request.error||new Error("Contact lookup failed"));
  });
 }catch{return ""}finally{db?.close()}
}
function vlNotificationBody(data,name){
 const who=name||"неизвестного контакта";
 switch(data.event){
  case "incoming_call":return "Входящий звонок от "+who+".";
  case "new_message":return "Новое сообщение от "+who+".";
  case "contact_request":return "Приглашение от "+who+".";
  case "call_cancelled":return "Вызов от "+who+" отменён.";
  case "call_ignored":return "Вызов от "+who+" отклонён.";
  case "call_ended":return "Звонок с "+who+" завершён.";
  default:return "Новое событие VoiceLink.";
 }
}
async function vlShouldSuppressNotification(data,windows){
 const visible=windows.filter(client=>client.visibilityState==="visible");
 if(!visible.length)return false;
 const checks=visible.map(client=>new Promise(resolve=>{
  const channel=new MessageChannel();
  let settled=false;
  const finish=value=>{if(settled)return;settled=true;channel.port1.close();resolve(value)};
  channel.port1.onmessage=event=>finish(event.data?.suppress===true);
  try{client.postMessage({type:"VL_PUSH_PREPARE_NOTIFICATION",data},[channel.port2])}catch{finish(false)}
  setTimeout(()=>finish(false),700);
 }));
 const results=await Promise.all(checks);
 return results.some(Boolean);
}
async function vlShowCustomNotification(data){
 const name=await vlFindContactName(data.sender_id);
 const options={
  body:vlNotificationBody(data,name),
  tag:"voicelink-"+String(data.event||"event")+"-"+String(data.sender_id||"unknown"),
  data:{voicelink:true,event:data.event||"",sender_id:data.sender_id||"",call_id:data.call_id||"",expires_at:data.expires_at||0}
 };
 await self.registration.showNotification("VoiceLink",options);
}
async function vlHandlePush(event){
 let payload="";
 let parsed={};
 try{
  payload=event.data?event.data.text():"";
  parsed=payload?JSON.parse(payload):{};
 }catch{}
 const data=vlParsePushData(parsed);
 const customEvent=VL_APP_EVENTS.has(data.event);
 if(customEvent)event.stopImmediatePropagation();
 event.waitUntil((async()=>{
  try{await vlStorePush(payload)}catch{}
  let windows=[];
  try{
   windows=await self.clients.matchAll({type:"window",includeUncontrolled:true});
   for(const client of windows)client.postMessage({type:"VL_PUSH_RECEIVED"});
  }catch{}
  if(!customEvent){
   if(typeof vlOneSignalPushHandler==="function"){
    try{await vlOneSignalPushHandler(parsed)}catch{}
   }
   return;
  }
  try{
   if(await vlShouldSuppressNotification(data,windows))return;
   await vlShowCustomNotification(data);
  }catch(error){
   // Keep app events out of OneSignal's generic notification path.
   try{await self.registration.showNotification("VoiceLink",{body:vlNotificationBody(data,""),tag:"voicelink-event-"+String(data.event||"unknown")})}catch{}
  }
 })());
}

self.addEventListener("notificationclick",event=>{
 if(!event.notification?.data?.voicelink)return;
 event.stopImmediatePropagation();
 const data=event.notification.data;
 event.notification.close();
 event.waitUntil((async()=>{
  const windows=await self.clients.matchAll({type:"window",includeUncontrolled:true});
  const existing=windows.find(client=>client.url.startsWith(self.registration.scope));
  if(existing){
   await existing.focus();
   existing.postMessage({type:"VL_NOTIFICATION_CLICKED",data});
   return;
  }
  await self.clients.openWindow(self.registration.scope);
 })());
});

async function vlReadPushes(){
 const db=await vlOpenPushDb();
 try{
  return await new Promise((resolve,reject)=>{
   const tx=db.transaction("events","readonly");
   const request=tx.objectStore("events").getAll();
   request.onsuccess=()=>resolve(request.result||[]);
   request.onerror=()=>reject(request.error||new Error("IndexedDB read failed"));
  });
 }finally{db.close()}
}

self.addEventListener("message",event=>{
 if(event.data?.type==="VL_CLEAR_PUSH_EVENTS"){
  event.waitUntil(vlClearPushes().catch(()=>{}));
  return;
 }
 if(event.data?.type==="VL_GET_PUSH_EVENTS"){
  event.waitUntil(vlReadPushes().then(events=>{
   event.source?.postMessage({type:"VL_PUSH_EVENTS",events});
  }).catch(()=>event.source?.postMessage({type:"VL_PUSH_EVENTS",events:[]})));
 }
});

// Load OneSignal first, then replace its standard push listener. This prevents
// the SDK from displaying its generic notification for VoiceLink app events.
importScripts("https://cdn.onesignal.com/sdks/web/v16/OneSignalSDK.sw.js");

const vlOneSignalPushHandler=self.OneSignalWorker?.onPushReceived;
if(typeof vlOneSignalPushHandler==="function"){
 self.removeEventListener("push",vlOneSignalPushHandler);
}
self.addEventListener("push",vlHandlePush);
