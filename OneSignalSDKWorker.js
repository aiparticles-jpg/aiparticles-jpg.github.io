const VL_SW_LOG_DB="voicelink-sw-log-v1";
function vlOpenLogDb(){
 return new Promise((resolve,reject)=>{
  const request=indexedDB.open(VL_SW_LOG_DB,2);
  request.onupgradeneeded=()=>{
   const db=request.result;
   if(!db.objectStoreNames.contains("logs"))db.createObjectStore("logs",{keyPath:"id",autoIncrement:true});
   if(!db.objectStoreNames.contains("settings"))db.createObjectStore("settings");
  };
  request.onsuccess=()=>resolve(request.result);
  request.onerror=()=>reject(request.error||new Error("Diagnostics database open failed"));
 });
}
async function vlIsDiagnosticEnabled(){
 const db=await vlOpenLogDb();
 try{return await new Promise((resolve,reject)=>{
  const tx=db.transaction("settings","readonly"),request=tx.objectStore("settings").get("enabled");
  request.onsuccess=()=>resolve(request.result===true);
  request.onerror=()=>reject(request.error||new Error("Diagnostics setting read failed"));
 })}finally{db.close()}
}
async function vlSetDiagnosticEnabled(enabled){
 const db=await vlOpenLogDb();
 try{await new Promise((resolve,reject)=>{
  const tx=db.transaction("settings","readwrite");
  tx.objectStore("settings").put(!!enabled,"enabled");
  tx.oncomplete=resolve;tx.onerror=()=>reject(tx.error||new Error("Diagnostics setting write failed"));
 })}finally{db.close()}
}
async function vlWriteLog(stage,details={}){
 try{
  if(!(await vlIsDiagnosticEnabled()))return;
  const db=await vlOpenLogDb();
  await new Promise((resolve,reject)=>{
   const tx=db.transaction("logs","readwrite");
   const store=tx.objectStore("logs");
   store.add({time:Date.now(),stage,details});
   const count=store.count();
   count.onsuccess=()=>{if(count.result>200){const cursor=store.openCursor();let remove=count.result-200;cursor.onsuccess=()=>{const c=cursor.result;if(c&&remove-->0){c.delete();c.continue()}}}};
   tx.oncomplete=resolve;tx.onerror=()=>reject(tx.error);
  });
  db.close();
  const windows=await self.clients.matchAll({type:"window",includeUncontrolled:true});
  for(const client of windows)client.postMessage({type:"VL_SW_LOG_UPDATED"});
 }catch(error){
  try{
   const windows=await self.clients.matchAll({type:"window",includeUncontrolled:true});
   for(const client of windows)client.postMessage({type:"VL_SW_LOG_WRITE_ERROR",stage,error:String(error?.message||error)});
  }catch{}
 }
}
async function vlReadLog(){
 const db=await vlOpenLogDb();
 try{return await new Promise((resolve,reject)=>{
  const tx=db.transaction("logs","readonly"),request=tx.objectStore("logs").getAll();
  request.onsuccess=()=>resolve(request.result||[]);request.onerror=()=>reject(request.error);
 })}finally{db.close()}
}
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
 await vlWriteLog("contact_lookup",{event:data.event,found:!!name,name:name||null});
 const options={
  body:vlNotificationBody(data,name),
  tag:"voicelink-"+String(data.event||"event")+"-"+String(data.sender_id||"unknown"),
  data:{voicelink:true,event:data.event||"",sender_id:data.sender_id||"",call_id:data.call_id||"",expires_at:data.expires_at||0}
 };
 await self.registration.showNotification("VoiceLink",options);
  await vlWriteLog("notification_shown",{event:data.event,withName:!!name});
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
  await vlWriteLog("push_received",{payloadPresent:!!payload,topLevelKeys:Object.keys(parsed||{}),customKeys:Object.keys(vlDecodeData(parsed?.custom?.a)),dataKeys:Object.keys(vlDecodeData(parsed?.data)),event:data.event||null,recognized:customEvent,senderIdSuffix:typeof data.sender_id==="string"?data.sender_id.slice(-8):null});
  try{await vlStorePush(payload)}catch{}
  let windows=[];
  try{
   windows=await self.clients.matchAll({type:"window",includeUncontrolled:true});
   for(const client of windows)client.postMessage({type:"VL_PUSH_RECEIVED"});
  }catch{}
  if(!customEvent){
   await vlWriteLog("unrecognized_push",{topLevelKeys:Object.keys(parsed||{})});
   if(typeof vlOneSignalPushHandler==="function"){
    try{await vlOneSignalPushHandler(parsed)}catch{}
   }
   return;
  }
  try{
   const suppressed=await vlShouldSuppressNotification(data,windows);
   if(suppressed){await vlWriteLog("notification_suppressed",{event:data.event});return;}
   await vlShowCustomNotification(data);
  }catch(error){
   await vlWriteLog("notification_error",{event:data.event,error:String(error?.message||error)});
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
  const targetUrl=new URL(self.registration.scope);
  if(data.event==="new_message"&&typeof data.sender_id==="string"&&/^[a-f0-9]{64}$/.test(data.sender_id)){
   targetUrl.searchParams.set("openChat",data.sender_id);
  }
  await vlWriteLog("notification_click_started",{
   event:data.event||null,
   targetUrl:targetUrl.href
  });
  try{
   const windows=await self.clients.matchAll({type:"window",includeUncontrolled:true});
   await vlWriteLog("notification_click_clients_found",{
    count:windows.length,
    clients:windows.map(client=>({
     url:client.url,
     visibilityState:client.visibilityState,
     focused:client.focused,
     type:client.type
    }))
   });
   const existing=windows.find(client=>client.url.startsWith(self.registration.scope));
   if(existing){
    await vlWriteLog("notification_focus_attempt",{
     url:existing.url,
     visibilityStateBefore:existing.visibilityState,
     focusedBefore:existing.focused
    });
    try{
     const focused=await existing.focus();
     await vlWriteLog("notification_focus_resolved",{
      requestedUrl:existing.url,
      returnedUrl:focused?.url||null,
      returnedVisibilityState:focused?.visibilityState||null,
      returnedFocused:focused?.focused??null
     });
     try{
      existing.postMessage({type:"VL_NOTIFICATION_CLICKED",data});
      await vlWriteLog("notification_click_message_sent",{url:existing.url});
     }catch(error){
      await vlWriteLog("notification_click_message_failed",{
       url:existing.url,
       error:String(error?.message||error)
      });
     }
     return;
    }catch(error){
     await vlWriteLog("notification_focus_failed",{
      url:existing.url,
      error:String(error?.message||error)
     });
     // If focusing an existing tab fails, try opening the app URL instead.
    }
   }else{
    await vlWriteLog("notification_focus_skipped",{reason:"no_matching_window"});
   }
   await vlWriteLog("notification_open_window_attempt",{url:targetUrl.href});
   try{
    const opened=await self.clients.openWindow(targetUrl.href);
    await vlWriteLog("notification_open_window_resolved",{
     opened:!!opened,
     url:opened?.url||null,
     visibilityState:opened?.visibilityState||null,
     focused:opened?.focused??null
    });
   }catch(error){
    await vlWriteLog("notification_open_window_failed",{
     url:targetUrl.href,
     error:String(error?.message||error)
    });
    throw error;
   }
  }catch(error){
   await vlWriteLog("notification_click_handler_failed",{
    error:String(error?.message||error),
    stack:String(error?.stack||"")
   });
   throw error;
  }
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
 if(event.data?.type==="VL_SET_DIAGNOSTIC_MODE"){
  event.waitUntil(vlSetDiagnosticEnabled(event.data.enabled===true).catch(()=>{}));
  return;
 }
 if(event.data?.type==="VL_GET_SW_STATUS"){
  event.source?.postMessage({type:"VL_SW_STATUS",requestRole:event.data.role||"unknown",workerBuild:"2026-11-10-status-1",scriptURL:self.location.href,scope:self.registration.scope});
  return;
 }
 if(event.data?.type==="VL_GET_SW_LOG"){event.waitUntil(vlReadLog().then(logs=>event.source?.postMessage({type:"VL_SW_LOG",logs})).catch(()=>event.source?.postMessage({type:"VL_SW_LOG",logs:[]})));return;}
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

// Activate each newly installed VoiceLink worker immediately. Without this,
// an installed worker can remain waiting and the previous push handler keeps running.
self.addEventListener("install",event=>{
 event.waitUntil((async()=>{
  await vlWriteLog("install_skip_waiting_requested",{build:"2026-11-10-lifecycle-1"});
  await self.skipWaiting();
 })());
});

self.addEventListener("activate",event=>{
 event.waitUntil((async()=>{
  await self.clients.claim();
  await vlWriteLog("worker_activated",{build:"2026-11-10-lifecycle-1"});
 })());
});

// Register our handler BEFORE loading OneSignal. Event listeners run in
// registration order, so VoiceLink can stop SDK handling for its own events.
// For all other pushes we leave propagation untouched and OneSignal handles them.
self.addEventListener("push",vlHandlePush);

// OneSignal's worker API does not expose a supported push-listener hook.
// Do not inspect or remove its private listener: intercept app events above.
importScripts("https://cdn.onesignal.com/sdks/web/v16/OneSignalSDK.sw.js");

void vlWriteLog("worker_loaded",{pushHandlerRegisteredBeforeOneSignal:true});
