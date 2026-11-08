const VL_PUSH_DB="voicelink-push-events-v1";
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
self.addEventListener("push",event=>{
 let payload="";
 try{payload=event.data?event.data.text():""}catch{}
 event.waitUntil((async()=>{
  try{await vlStorePush(payload)}catch{}
  try{
   const windows=await self.clients.matchAll({type:"window",includeUncontrolled:true});
   for(const client of windows)client.postMessage({type:"VL_PUSH_RECEIVED"});
  }catch{}
 })());
});
self.addEventListener("message",event=>{
 if(event.data?.type!=="VL_CLEAR_PUSH_EVENTS")return;
 event.waitUntil(vlClearPushes().catch(()=>{}));
});
importScripts("https://cdn.onesignal.com/sdks/web/v16/OneSignalSDK.sw.js");
