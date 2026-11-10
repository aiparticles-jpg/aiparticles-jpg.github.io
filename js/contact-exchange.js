export const INVITATION_FORMAT_VERSION="2026-11-10T14:00:00Z";
const enc=new TextEncoder(),stable=v=>JSON.stringify(v);
const b64u=v=>{let s="";for(const b of new Uint8Array(v))s+=String.fromCharCode(b);return btoa(s).replaceAll("+","-").replaceAll("/","_").replace(/=+$/g,"")};
const un64=s=>{if(typeof s!=="string"||!/^[A-Za-z0-9_-]+$/.test(s))throw TypeError("Некорректное base64url-значение.");s=s.replaceAll("-","+").replaceAll("_","/");return Uint8Array.from(atob(s+"=".repeat((4-s.length%4)%4)),c=>c.charCodeAt(0))};
function decodeInput(input){const raw=String(input||"").trim();if(!raw)throw Error("Вставьте ссылку или пакет контакта.");let value=raw;try{const u=new URL(raw);value=new URLSearchParams(u.hash.slice(1)).get("contact")||raw}catch{if(raw.startsWith("#"))value=new URLSearchParams(raw.slice(1)).get("contact")||raw}return value.startsWith("{")?JSON.parse(value):JSON.parse(new TextDecoder().decode(un64(value)))}
export async function verifyContactPackage(input){
 const c=typeof input==="string"?decodeInput(input):input;
 if(!c||typeof c!=="object"||Array.isArray(c))throw Error("Некорректный формат приглашения.");
 if(c.version!==INVITATION_FORMAT_VERSION){
  const received=typeof c.version==="string"||typeof c.version==="number"?String(c.version):"не указана";
  throw Error("Версия приглашения «"+received+"» не поддерживается. Актуальная версия: "+INVITATION_FORMAT_VERSION+". Попросите собеседника создать новую ссылку.");
 }
 if(typeof c.user_id!=="string"||!/^[a-f0-9]{64}$/.test(c.user_id))throw Error("Некорректный анонимный идентификатор контакта.");
 if(typeof c.push_subscription_id!=="string"||!c.push_subscription_id.trim())throw Error("В приглашении отсутствует OneSignal Subscription ID.");
 if(typeof c.invitation_id!=="string"||!/^[0-9a-f-]{36}$/i.test(c.invitation_id))throw Error("Некорректный идентификатор приглашения.");
 if(typeof c.invitation_secret!=="string"||un64(c.invitation_secret).length!==32)throw Error("В приглашении отсутствует корректный общий симметричный ключ.");
 if(typeof c.display_name==="string"&&(c.display_name.length>60||c.display_name.trim()!==c.display_name))throw Error("Некорректное имя в приглашении.");
 return {version:INVITATION_FORMAT_VERSION,user_id:c.user_id,push_subscription_id:c.push_subscription_id,invitation_id:c.invitation_id,invitation_secret:c.invitation_secret,shared_secret_created_at:Number.isFinite(Number(c.shared_secret_created_at))?Number(c.shared_secret_created_at):Date.now(),...(Object.hasOwn(c,"display_name")?{display_name:c.display_name}:{})};
}
const aad=p=>enc.encode(stable({v:3,type:"contact_request",request_id:p.request_id,from:p.from,to:p.to,expires_at:p.expires_at,invitation_id:p.invitation_id}));
async function key(secret,from,to){const raw=un64(secret);if(raw.length!==32)throw Error("Некорректный общий симметричный ключ.");const material=await crypto.subtle.importKey("raw",raw,"HKDF",false,["deriveKey"]),pair=[from,to].sort().join("|"),salt=await crypto.subtle.digest("SHA-256",enc.encode("voicelink-contact-pair-v3|"+pair));return crypto.subtle.deriveKey({name:"HKDF",hash:"SHA-256",salt,info:enc.encode("voicelink-contact-request-v3|"+from+"|"+to)},material,{name:"AES-GCM",length:256},false,["encrypt","decrypt"])}
export async function createContactRequestEnvelope({contact,contactPackage,from,to,requestId,expiresAt}){
 if(!contact?.invitation_secret||contact.invitation_secret!==contactPackage?.invitation_secret||contact.invitation_id!==contactPackage?.invitation_id)throw Error("Ответ должен использовать тот же общий симметричный ключ и ID приглашения.");
 const p={request_id:requestId,from,to,expires_at:expiresAt,invitation_id:contact.invitation_id},iv=crypto.getRandomValues(new Uint8Array(12)),k=await key(contact.invitation_secret,from,to);
 return {v:3,type:"contact_request",payload:{...p,iv:b64u(iv),ciphertext:b64u(await crypto.subtle.encrypt({name:"AES-GCM",iv,additionalData:aad(p)},k,enc.encode(JSON.stringify(contactPackage))))}};
}
export async function decryptContactRequestEnvelope(message,secret){
 const p=message?.payload;if(message?.v!==3||message?.type!=="contact_request"||!p||typeof p.request_id!=="string"||!/^[0-9a-f-]{36}$/i.test(p.request_id)||typeof p.from!=="string"||typeof p.to!=="string"||typeof p.invitation_id!=="string"||typeof p.iv!=="string"||typeof p.ciphertext!=="string")throw Error("Некорректный запрос контакта.");
 if(!Number.isFinite(Number(p.expires_at))||Date.now()>Number(p.expires_at))throw Error("Срок действия запроса контакта истёк.");
 const k=await key(secret,p.from,p.to),plain=await crypto.subtle.decrypt({name:"AES-GCM",iv:un64(p.iv),additionalData:aad(p)},k,un64(p.ciphertext)),c=await verifyContactPackage(JSON.parse(new TextDecoder().decode(plain)));
 if(c.user_id!==p.from||c.invitation_secret!==secret||c.invitation_id!==p.invitation_id)throw Error("Ответ не соответствует приглашению или использует другой ключ.");return c;
}
