const BASE="https://ntfy.sh/";
const enc=new TextEncoder();
const stable=o=>JSON.stringify(o);
const bytes=b=>b instanceof Uint8Array?b:new Uint8Array(b);
const b64u=b=>{let s="";for(const x of bytes(b))s+=String.fromCharCode(x);return btoa(s).replaceAll("+","-").replaceAll("/","_").replace(/=+$/g,"")};
const un64=s=>{const x=atob(s.replace(/-/g,"+").replace(/_/g,"/")+"=".repeat((4-s.length%4)%4));return Uint8Array.from(x,c=>c.charCodeAt(0))};
const hex=b=>Array.from(bytes(b),x=>x.toString(16).padStart(2,"0")).join("");
const digest=async b=>new Uint8Array(await crypto.subtle.digest("SHA-256",b));
const validName=s=>/^[a-z0-9_-]{3,24}$/.test(s);
export class NtfySecureSignaling {
 constructor({me,peer,onSignal,onStatus,onVerify,onReady,onError,onDebug}) {
  this.me=me;this.peer=peer;this.role=me<peer?"A":"B";
  this.debugId=Array.from(crypto.getRandomValues(new Uint8Array(3)),x=>x.toString(16).padStart(2,"0")).join("");this.sseOpenCount=0;this.sseErrorCount=0;
  this.onSignal=onSignal;this.onStatus=onStatus||(()=>{});this.onVerify=onVerify||(()=>{});this.onReady=onReady||(()=>{});this.onError=onError||(()=>{});this.onDebug=onDebug||(()=>{});
  this.es=null;this.sseReadyPromise=null;this.subscribePromise=null;this.active=false;this.identity=null;this.hello=null;this.answer=null;this.lastAnswerAt=0;this.ecdh=null;this.session=null;this.sendKey=null;this.recvKey=null;this.ready=false;this.confirmed=false;this.sas=null;this.seen=new Set();this.pendingSignals=[];this.publishQueue=Promise.resolve();this.lastPublishAt=0;this.closed=false;this.rateLimited=false;this.helloAttempts=0;this.helloRetryTimer=null;
 }
 static validName(s){return validName(s)}
 async topic(name){return "vl-user-"+hex(await digest(enc.encode("voice-link-user-v1|"+name))).slice(0,40)}
 async loadIdentity(){
  const key="vl.identity.v1."+this.me,raw=localStorage.getItem(key);
  if(raw){const j=JSON.parse(raw);return {privateKey:await crypto.subtle.importKey("jwk",j.privateKey,{name:"ECDSA",namedCurve:"P-256"},true,["sign"]),publicJwk:j.publicKey}}
  const pair=await crypto.subtle.generateKey({name:"ECDSA",namedCurve:"P-256"},true,["sign","verify"]);
  const privateJwk=await crypto.subtle.exportKey("jwk",pair.privateKey),publicJwk=await crypto.subtle.exportKey("jwk",pair.publicKey);
  localStorage.setItem(key,JSON.stringify({privateKey:privateJwk,publicKey:publicJwk}));
  return {privateKey:pair.privateKey,publicJwk};
 }
 async sign(payload){return b64u(await crypto.subtle.sign({name:"ECDSA",hash:"SHA-256"},this.identity.privateKey,enc.encode(stable(payload))))}
 async verify(payload,sig,jwk){
  const k=await crypto.subtle.importKey("jwk",jwk,{name:"ECDSA",namedCurve:"P-256"},false,["verify"]);
  return crypto.subtle.verify({name:"ECDSA",hash:"SHA-256"},k,un64(sig),enc.encode(stable(payload)));
 }
 async publish(to,msg){
  const task=async()=>{
   if(this.rateLimited)throw Error("ntfy ранее вернул HTTP 429; новые отправки остановлены.");
   const wait=Math.max(0,this.lastPublishAt+1100-Date.now());
   if(wait)await new Promise(resolve=>setTimeout(resolve,wait));
   this.onDebug(`[ntfy] POST → ${msg.type} (одна попытка)`);
   const r=await fetch(BASE+await this.topic(to),{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(msg),cache:"no-store"});
   this.onDebug(`[ntfy] POST ← ${r.status} (${msg.type})`);
   this.lastPublishAt=Date.now();
   if(r.ok)return;
   const retryAfter=r.headers.get("Retry-After");
   if(r.status===429){this.rateLimited=true;this.clearHelloRetry();}
   throw Error("ntfy HTTP "+r.status+(r.status===429?"; сервер ограничил частоту запросов"+(retryAfter?"; Retry-After: "+retryAfter:""):""));
  };
  const result=this.publishQueue.then(task,task);
  this.publishQueue=result.catch(()=>{});
  return result;
 }
 async signed(type,payload){return {v:1,type,payload,sig:await this.sign({type,payload})}}
 async subscribe(){
  if(this.es&&this.es.readyState===EventSource.OPEN)return;
  if(this.subscribePromise)return this.subscribePromise;
  if(this.es&&this.sseReadyPromise)return this.sseReadyPromise;
  const task=this.openSubscription();
  this.subscribePromise=task;
  try{await task}
  finally{if(this.subscribePromise===task)this.subscribePromise=null}
 }
 async openSubscription(){
  this.onDebug(`[SSE ${this.debugId}] subscribe() вызван`);
  if(!validName(this.me))throw Error("Имя пользователя: 3–24 символа, латинские буквы, цифры, _ или -.");
  if(!crypto.subtle||!window.isSecureContext)throw Error("Для защищённого соединения нужен браузер с Web Crypto и HTTPS.");
  if(this.es){
   if(this.es.readyState===EventSource.OPEN)return;
   if(this.sseReadyPromise)return this.sseReadyPromise;
  }
  this.identity=await this.loadIdentity();
  if(this.closed)throw Error("Открытие подписки отменено.");
  const url=BASE+await this.topic(this.me)+"/sse";
  if(this.closed)throw Error("Открытие подписки отменено.");
  const es=new EventSource(url);this.es=es;
  let settled=false;
  const createdAt=performance.now();let lastOpenAt=null;
  const elapsed=()=>Math.round(performance.now()-createdAt);
  const stateName=()=>es.readyState===EventSource.CONNECTING?"CONNECTING":es.readyState===EventSource.OPEN?"OPEN":es.readyState===EventSource.CLOSED?"CLOSED":String(es.readyState);
  this.onDebug(`[SSE ${this.debugId}] ${new Date().toISOString()} CREATED; t=+0ms; readyState=${es.readyState} (${stateName()})`);
  const ready=new Promise((resolve,reject)=>{
   const timeout=setTimeout(()=>{if(!settled){settled=true;reject(Error("Тайм-аут подключения к ntfy"))}},15000);
   es.onopen=()=>{
    const now=performance.now(),sincePrevious=lastOpenAt===null?"—":Math.round(now-lastOpenAt)+"ms";
    this.sseOpenCount++;
    this.onDebug(`[SSE ${this.debugId}] ${new Date().toISOString()} OPEN #${this.sseOpenCount}; since-create=+${elapsed()}ms; since-prev-open=${sincePrevious}; readyState(before)=${es.readyState} (${stateName()})`);
    lastOpenAt=now;
    if(!settled){settled=true;clearTimeout(timeout);resolve()}
    this.onStatus(this.active?"Канал ntfy подключён. Ищем собеседника…":"Подписка ntfy активна. Можно подключаться.");
    this.onDebug(`[SSE ${this.debugId}] OPEN #${this.sseOpenCount} handler завершён; readyState(after)=${es.readyState} (${stateName()})`);
   };
   es.onerror=event=>{
    this.sseErrorCount++;
    this.onDebug(`[SSE ${this.debugId}] ${new Date().toISOString()} ERROR #${this.sseErrorCount}; since-create=+${elapsed()}ms; readyState(before)=${es.readyState} (${stateName()}); event=${event.type}; trusted=${event.isTrusted}`);
    this.onStatus("Канал ntfy переподключается…");
    if(!settled){settled=true;clearTimeout(timeout);reject(Error("Не удалось подключиться к ntfy"))}
    this.onDebug(`[SSE ${this.debugId}] ERROR #${this.sseErrorCount} handler завершён; readyState(after)=${es.readyState} (${stateName()})`);
   };
   es.onmessage=e=>this.handle(e).catch(err=>this.onError(err));
  });
  this.sseReadyPromise=ready;
  try{await ready}
  catch(error){if(this.es===es){es.close();this.es=null;this.sseReadyPromise=null}throw error}
 }
 async start(){
  this.onDebug(`[SSE ${this.debugId}] start() вызван`);
  if(!validName(this.me)||!validName(this.peer)||this.me===this.peer)throw Error("Имена: 3–24 символа, латинские буквы, цифры, _ или -. Имена должны различаться.");
  await this.subscribe();
  this.active=true;
  if(this.role==="A"){
   try{await this.sendHello()}catch(err){this.onError(err)}
   this.scheduleHelloRetry(5000);
  } else this.onStatus("Ожидаем запрос от "+this.peer+"…");
 }
 setPeer(peer){
  if(!validName(peer)||peer===this.me)throw Error("Имя собеседника должно содержать 3–24 символа и отличаться от вашего имени.");
  this.resetSession();this.peer=peer;this.role=this.me<peer?"A":"B";
 }
 resetSession(){
  this.active=false;this.clearHelloRetry();
  this.hello=null;this.answer=null;this.lastAnswerAt=0;this.ecdh=null;this.session=null;
  this.sendKey=null;this.recvKey=null;this.ready=false;this.confirmed=false;this.sas=null;this.peerJwk=null;
  this.pendingSignals=[];this.rateLimited=false;this.helloAttempts=0;
 }
 async sendHello(){
  if(this.closed||this.ready||this.rateLimited||this.role!=="A")return;
  if(!this.hello){
   this.ecdh=await crypto.subtle.generateKey({name:"ECDH",namedCurve:"P-256"},true,["deriveBits"]);
   this.hello={sid:b64u(crypto.getRandomValues(new Uint8Array(16))),from:this.me,to:this.peer,eph:b64u(await crypto.subtle.exportKey("raw",this.ecdh.publicKey)),identity:this.identity.publicJwk,nonce:b64u(crypto.getRandomValues(new Uint8Array(16)))};
  }
  this.helloAttempts++;
  this.onDebug(`[signaling] hello attempt ${this.helloAttempts}/3`);
  await this.publish(this.peer,await this.signed("hello",this.hello));
  this.onStatus("Запрос отправлен. Ожидаем "+this.peer+"…");
 }
 scheduleHelloRetry(delay){
  this.clearHelloRetry();
  if(this.closed||this.ready||this.rateLimited||this.role!=="A"||this.helloAttempts>=3)return;
  this.helloRetryTimer=setTimeout(async()=>{
   this.helloRetryTimer=null;
   if(this.closed||this.ready||this.rateLimited)return;
   try{await this.sendHello()}catch(err){this.onError(err)}
   this.scheduleHelloRetry(this.helloAttempts===2?10000:5000);
  },delay);
 }
 clearHelloRetry(){if(this.helloRetryTimer!==null){clearTimeout(this.helloRetryTimer);this.helloRetryTimer=null}}
 async handle(event){
  if(!this.active)return;
  const n=JSON.parse(event.data);if(!n.message||!n.id||this.seen.has(n.id))return;
  this.seen.add(n.id);if(this.seen.size>600)this.seen.delete(this.seen.values().next().value);
  let m;try{m=JSON.parse(n.message)}catch{return}
  if(m.v!==1||!m.payload||m.payload.from!==this.peer||m.payload.to!==this.me)return;
  const p=m.payload;
  if(m.type==="hello"&&this.role==="B"){
   if(this.hello){
    if(p.sid===this.hello.sid&&this.answer&&Date.now()-this.lastAnswerAt>=10000){
     this.onDebug("[signaling] answer resend after repeated hello");
     await this.publish(this.peer,await this.signed("answer",this.answer));
     this.lastAnswerAt=Date.now();
    }
    return;
   }
   if(this.ready)return;
   if(!await this.verify({type:m.type,payload:p},m.sig,p.identity))throw Error("Подпись собеседника недействительна.");
   await this.checkPinned(p.identity);
   this.hello=p;
   this.ecdh=await crypto.subtle.generateKey({name:"ECDH",namedCurve:"P-256"},true,["deriveBits"]);
   const answer={sid:p.sid,from:this.me,to:this.peer,eph:b64u(await crypto.subtle.exportKey("raw",this.ecdh.publicKey)),identity:this.identity.publicJwk,nonce:b64u(crypto.getRandomValues(new Uint8Array(16))),helloEph:p.eph,helloNonce:p.nonce};
   this.answer=answer;
   // Derive before publishing: if the POST fails transiently, a repeated hello
   // can resend this same cached answer without leaving the receiver uninitialized.
   await this.derive(p,answer);
   this.onDebug("[signaling] answer attempt 1 (initial)");
   await this.publish(this.peer,await this.signed("answer",answer));
   this.lastAnswerAt=Date.now();return;
  }
  if(m.type==="answer"&&this.role==="A"&&!this.ready){
   if(!this.hello||p.sid!==this.hello.sid||p.helloEph!==this.hello.eph||p.helloNonce!==this.hello.nonce)return;
   if(!await this.verify({type:m.type,payload:p},m.sig,p.identity))throw Error("Подпись ответа недействительна.");
   await this.checkPinned(p.identity);await this.derive(this.hello,p);return;
  }
  if(m.type==="data"&&this.ready&&p.sid===this.session){
   const dir=p.from<p.to?"A-to-B":"B-to-A";
   const plain=await crypto.subtle.decrypt({name:"AES-GCM",iv:un64(p.iv),additionalData:enc.encode(this.session+"|"+dir)},this.recvKey,un64(p.data));
   const msg=JSON.parse(new TextDecoder().decode(plain));
   if(msg.type==="signal"){if(this.confirmed)await this.onSignal(msg.payload);else this.pendingSignals.push(msg.payload)}
  }
 }
 async checkPinned(jwk){
  const raw=localStorage.getItem("vl.peer.v1."+this.peer);if(!raw)return false;
  if(stable(JSON.parse(raw))!==stable(jwk))throw Error("Ключ "+this.peer+" изменился! Соединение остановлено. Не подтверждайте новый ключ, пока не проверите собеседника.");
  return true;
 }
 async derive(hello,answer){
  const tr={v:1,sid:hello.sid,a:hello.from,b:hello.to,aIdentity:hello.identity,bIdentity:answer.identity,aEph:hello.eph,bEph:answer.eph,aNonce:hello.nonce,bNonce:answer.nonce};
  const hash=await digest(enc.encode(stable(tr)));
  this.sas=hex(hash.slice(0,6)).toUpperCase().match(/.{1,4}/g).join("-");
  const remote=this.role==="A"?answer.identity:hello.identity;this.peerJwk=remote;
  const remoteEph=this.role==="A"?answer.eph:hello.eph;
  const pub=await crypto.subtle.importKey("raw",un64(remoteEph),{name:"ECDH",namedCurve:"P-256"},false,[]);
  const shared=await crypto.subtle.deriveBits({name:"ECDH",public:pub},this.ecdh.privateKey,256);
  const material=await crypto.subtle.importKey("raw",shared,"HKDF",false,["deriveKey"]);
  const mk=dir=>crypto.subtle.deriveKey({name:"HKDF",hash:"SHA-256",salt:hash,info:enc.encode("voice-link-v1|"+dir)},material,{name:"AES-GCM",length:256},false,["encrypt","decrypt"]);
  const [ab,ba]=await Promise.all([mk("A-to-B"),mk("B-to-A")]);
  this.sendKey=this.role==="A"?ab:ba;this.recvKey=this.role==="A"?ba:ab;this.session=hello.sid;this.ready=true;this.clearHelloRetry();
  const pinned=await this.checkPinned(remote);
  if(pinned){this.confirmed=true;this.onReady({trusted:true,sas:this.sas});}
  else this.onVerify({sas:this.sas,peer:this.peer});
 }
 async confirmPeer(){
  if(!this.ready||!this.peerJwk)throw Error("Ключ ещё не согласован.");
  localStorage.setItem("vl.peer.v1."+this.peer,stable(this.peerJwk));this.confirmed=true;
  for(const payload of this.pendingSignals.splice(0))await this.onSignal(payload);
  this.onReady({trusted:false,sas:this.sas});
 }
 async sendSignal(payload){
  if(!this.ready||!this.confirmed)throw Error("Защищённый канал ещё не подтверждён.");
  const dir=this.role==="A"?"A-to-B":"B-to-A",iv=crypto.getRandomValues(new Uint8Array(12));
  const plain=enc.encode(JSON.stringify({type:"signal",payload}));
  const data=await crypto.subtle.encrypt({name:"AES-GCM",iv,additionalData:enc.encode(this.session+"|"+dir)},this.sendKey,plain);
  await this.publish(this.peer,{v:1,type:"data",payload:{sid:this.session,from:this.me,to:this.peer,iv:b64u(iv),data:b64u(data)}});
 }
 close(){this.closed=true;this.active=false;this.clearHelloRetry();if(this.es){const before=this.es.readyState;this.onDebug(`[SSE ${this.debugId}] ${new Date().toISOString()} close() вызван; readyState(before)=${before}`);this.es.close();this.onDebug(`[SSE ${this.debugId}] ${new Date().toISOString()} close() завершён; readyState(after)=${this.es.readyState}`)}else this.onDebug(`[SSE ${this.debugId}] ${new Date().toISOString()} close() вызван без EventSource`);}
}
