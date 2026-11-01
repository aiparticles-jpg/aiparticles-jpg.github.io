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
  this.onSignal=onSignal;this.onStatus=onStatus||(()=>{});this.onVerify=onVerify||(()=>{});this.onReady=onReady||(()=>{});this.onError=onError||(()=>{});this.onDebug=onDebug||(()=>{});
  this.es=null;this.identity=null;this.hello=null;this.answer=null;this.lastAnswerAt=0;this.ecdh=null;this.session=null;this.sendKey=null;this.recvKey=null;this.ready=false;this.confirmed=false;this.sas=null;this.seen=new Set();this.pendingSignals=[];this.retry=null;this.retryDelay=5000;this.publishQueue=Promise.resolve();this.lastPublishAt=0;this.publishCooldownUntil=0;this.closed=false;
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
   for(let attempt=0;attempt<2;attempt++){
    const wait=Math.max(0,this.lastPublishAt+1100-Date.now(),this.publishCooldownUntil-Date.now());
    if(wait)await new Promise(resolve=>setTimeout(resolve,wait));
    this.onDebug(`[ntfy] POST → ${msg.type} (попытка ${attempt+1}/2)`);
    const r=await fetch(BASE+await this.topic(to),{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(msg),cache:"no-store"});
    this.onDebug(`[ntfy] POST ← ${r.status} (${msg.type}, попытка ${attempt+1}/2)`);
    this.lastPublishAt=Date.now();
    if(r.ok)return;
    if(r.status===429){
     const h=r.headers.get("Retry-After");
     const retryMs=h?(Number.isFinite(Number(h))?Number(h)*1000:Math.max(1000,Date.parse(h)-Date.now())):15000;
     this.publishCooldownUntil=Date.now()+Math.max(1000,retryMs);
     if(attempt===0)continue;
    }
    throw Error("ntfy HTTP "+r.status+(r.status===429?"; повторить через "+Math.ceil((this.publishCooldownUntil-Date.now())/1000)+" с":""));
   }
  };
  const result=this.publishQueue.then(task,task);
  this.publishQueue=result.catch(()=>{});
  return result;
 }
 scheduleHelloRetry(){
  clearTimeout(this.retry);
  if(this.closed||this.ready||this.role!=="A")return;
  const delay=this.retryDelay;
  this.retry=setTimeout(()=>{
   this.sendHello().then(()=>{
    this.retryDelay=5000;
    this.scheduleHelloRetry();
   }).catch(err=>{
    this.onError(err);
    this.retryDelay=Math.min(Math.max(this.retryDelay*2,10000),60000);
    this.scheduleHelloRetry();
   });
  },delay);
 }
 async signed(type,payload){return {v:1,type,payload,sig:await this.sign({type,payload})}}
 async start(){
  if(!validName(this.me)||!validName(this.peer)||this.me===this.peer)throw Error("Имена: 3–24 символа, латинские буквы, цифры, _ или -. Имена должны различаться.");
  if(!crypto.subtle||!window.isSecureContext)throw Error("Для защищённого соединения нужен браузер с Web Crypto и HTTPS.");
  this.identity=await this.loadIdentity();
  const url=BASE+await this.topic(this.me)+"/sse";
  await new Promise((resolve,reject)=>{
   const es=new EventSource(url);this.es=es;let settled=false;
   es.onopen=()=>{if(!settled){settled=true;resolve()}this.onStatus("Канал ntfy подключён. Ищем собеседника…")};
   es.onerror=()=>{this.onStatus("Канал ntfy переподключается…");if(!settled){settled=true;reject(Error("Не удалось подключиться к ntfy"))}};
   es.onmessage=e=>this.handle(e).catch(err=>this.onError(err));
   setTimeout(()=>{if(!settled){settled=true;reject(Error("Тайм-аут подключения к ntfy"))}},15000);
  });
  if(this.role==="A"){
   try{await this.sendHello();this.scheduleHelloRetry()}
   catch(err){this.onError(err);this.retryDelay=10000;this.scheduleHelloRetry()}
  } else this.onStatus("Ожидаем запрос от "+this.peer+"…");
 }
 async sendHello(){
  if(this.closed||this.ready||this.role!=="A")return;
  if(!this.hello){
   this.ecdh=await crypto.subtle.generateKey({name:"ECDH",namedCurve:"P-256"},true,["deriveBits"]);
   this.hello={sid:b64u(crypto.getRandomValues(new Uint8Array(16))),from:this.me,to:this.peer,eph:b64u(await crypto.subtle.exportKey("raw",this.ecdh.publicKey)),identity:this.identity.publicJwk,nonce:b64u(crypto.getRandomValues(new Uint8Array(16)))};
  }
  await this.publish(this.peer,await this.signed("hello",this.hello));
  this.onStatus("Запрос отправлен. Ожидаем "+this.peer+"…");
 }
 async handle(event){
  const n=JSON.parse(event.data);if(!n.message||!n.id||this.seen.has(n.id))return;
  this.seen.add(n.id);if(this.seen.size>600)this.seen.delete(this.seen.values().next().value);
  let m;try{m=JSON.parse(n.message)}catch{return}
  if(m.v!==1||!m.payload||m.payload.from!==this.peer||m.payload.to!==this.me)return;
  const p=m.payload;
  if(m.type==="hello"&&this.role==="B"){
   if(this.hello){
    if(p.sid===this.hello.sid&&this.answer&&Date.now()-this.lastAnswerAt>=10000){
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
   await this.publish(this.peer,await this.signed("answer",answer));
   this.lastAnswerAt=Date.now();
   await this.derive(p,answer);return;
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
  this.sendKey=this.role==="A"?ab:ba;this.recvKey=this.role==="A"?ba:ab;this.session=hello.sid;this.ready=true;
  clearTimeout(this.retry);
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
 close(){this.closed=true;clearTimeout(this.retry);this.es?.close();}
}
