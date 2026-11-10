const encoder=new TextEncoder();
const stable=value=>JSON.stringify(value);
const bytes=value=>value instanceof Uint8Array?value:new Uint8Array(value);
const b64u=value=>{let s="";for(const byte of bytes(value))s+=String.fromCharCode(byte);return btoa(s).replaceAll("+","-").replaceAll("/","_").replace(/=+$/g,"")};
const un64=value=>{if(typeof value!=="string"||!/^[A-Za-z0-9_-]+$/.test(value))throw new TypeError("Некорректное base64url-значение.");const s=value.replaceAll("-","+").replaceAll("_","/");return Uint8Array.from(atob(s+"=".repeat((4-s.length%4)%4)),c=>c.charCodeAt(0))};
const hex=value=>Array.from(bytes(value),b=>b.toString(16).padStart(2,"0")).join("");
const digest=async value=>new Uint8Array(await crypto.subtle.digest("SHA-256",value));
function decodeInput(input){
 const raw=String(input||"").trim();if(!raw)throw Error("Вставьте ссылку или пакет контакта.");
 let encoded=raw;
 try{const url=new URL(raw);encoded=new URLSearchParams(url.hash.slice(1)).get("contact")||raw}
 catch{if(raw.startsWith("#"))encoded=new URLSearchParams(raw.slice(1)).get("contact")||raw}
 if(encoded.startsWith("{"))return JSON.parse(encoded);
 return JSON.parse(new TextDecoder().decode(un64(encoded)));
}
export async function verifyContactPackage(input){
 const contact=typeof input==="string"?decodeInput(input):input;
 if(!contact||typeof contact!=="object"||Array.isArray(contact))throw Error("Пакет контакта должен быть JSON-объектом.");
 if(contact.version!==2)throw Error("Эта версия приглашения больше не поддерживается. Попросите собеседника создать новую ссылку.");
 if(typeof contact.user_id!=="string"||!/^[a-f0-9]{64}$/.test(contact.user_id))throw Error("Некорректный анонимный идентификатор контакта.");
 if(typeof contact.push_subscription_id!=="string"||!contact.push_subscription_id.trim())throw Error("В приглашении отсутствует OneSignal Subscription ID.");
 if(typeof contact.invitation_id!=="string"||!/^[0-9a-f-]{36}$/i.test(contact.invitation_id))throw Error("Некорректный идентификатор приглашения.");
 if(typeof contact.invitation_secret!=="string")throw Error("В приглашении отсутствует секрет доступа. Попросите создать новую ссылку.");
 const invitationSecret=un64(contact.invitation_secret);if(invitationSecret.length!==32)throw Error("Некорректный секрет приглашения.");
 if(typeof contact.display_name==="string"&&(contact.display_name.length>60||contact.display_name.trim()!==contact.display_name))throw Error("Некорректное имя в приглашении.");
 if(typeof contact.message_encryption_public_key!=="string"||!/^[A-Za-z0-9_-]{80,100}$/.test(contact.message_encryption_public_key)||typeof contact.message_encryption_key_id!=="string"||!/^[a-f0-9]{64}$/.test(contact.message_encryption_key_id))throw Error("В приглашении отсутствует корректный ключ шифрования. Попросите создать новую ссылку.");
 const publicBytes=un64(contact.message_encryption_public_key);
 if(publicBytes.length!==65||publicBytes[0]!==4)throw Error("Некорректный открытый ключ шифрования.");
 try{await crypto.subtle.importKey("raw",publicBytes,{name:"ECDH",namedCurve:"P-256"},false,[])}catch{throw Error("Открытый ключ шифрования недействителен.");}
 if(hex(await digest(publicBytes))!==contact.message_encryption_key_id)throw Error("Идентификатор ключа шифрования не совпадает с ключом в приглашении.");
 if(contact.message_encryption_generation!==undefined&&(!Number.isSafeInteger(contact.message_encryption_generation)||contact.message_encryption_generation<1))throw Error("Некорректный номер поколения ключа шифрования.");
 return {version:2,user_id:contact.user_id,push_subscription_id:contact.push_subscription_id,invitation_id:contact.invitation_id,invitation_secret:contact.invitation_secret,message_encryption_public_key:contact.message_encryption_public_key,message_encryption_key_id:contact.message_encryption_key_id,message_encryption_generation:Number(contact.message_encryption_generation)||1,...(Object.hasOwn(contact,"display_name")?{display_name:contact.display_name}:{})};
}
function requestAad(p){return encoder.encode(stable({v:2,type:"contact_request",request_id:p.request_id,from:p.from,to:p.to,expires_at:p.expires_at,invitation_id:p.invitation_id,recipient_key_id:p.recipient_key_id,eph:p.eph}));}
async function importInvitationMacKey(secret,usages){
 const raw=un64(secret);if(raw.length!==32)throw Error("Некорректный секрет приглашения.");
 return crypto.subtle.importKey("raw",raw,{name:"HMAC",hash:"SHA-256"},false,usages);
}
async function deriveRequestAesKey(privateKey,remotePublicKey,invitationId,requestId){
 const remote=await crypto.subtle.importKey("raw",un64(remotePublicKey),{name:"ECDH",namedCurve:"P-256"},false,[]);
 const shared=await crypto.subtle.deriveBits({name:"ECDH",public:remote},privateKey,256);
 const material=await crypto.subtle.importKey("raw",shared,"HKDF",false,["deriveKey"]);
 const salt=await digest(encoder.encode("voicelink-contact-request-v2|"+invitationId+"|"+requestId));
 return crypto.subtle.deriveKey({name:"HKDF",hash:"SHA-256",salt,info:encoder.encode("voicelink-contact-request-aes-gcm-v2")},material,{name:"AES-GCM",length:256},false,["encrypt","decrypt"]);
}
export async function createContactRequestEnvelope({contact,contactPackage,from,to,requestId,expiresAt}){
 if(!contact?.invitation_secret||!contact?.message_encryption_public_key||!contact?.message_encryption_key_id)throw Error("В приглашении контакта отсутствуют данные для защищённого ответа.");
 const pair=await crypto.subtle.generateKey({name:"ECDH",namedCurve:"P-256"},true,["deriveBits"]);
 const eph=b64u(await crypto.subtle.exportKey("raw",pair.publicKey));
 const payload={request_id:requestId,from,to,expires_at:expiresAt,invitation_id:contact.invitation_id,recipient_key_id:contact.message_encryption_key_id,eph};
 const key=await deriveRequestAesKey(pair.privateKey,contact.message_encryption_public_key,contact.invitation_id,requestId);
 const iv=crypto.getRandomValues(new Uint8Array(12));
 const ciphertext=await crypto.subtle.encrypt({name:"AES-GCM",iv,additionalData:requestAad(payload)},key,encoder.encode(JSON.stringify(contactPackage)));
 payload.iv=b64u(iv);payload.ciphertext=b64u(ciphertext);
 const envelope={v:2,type:"contact_request",payload};
 const macKey=await importInvitationMacKey(contact.invitation_secret,["sign"]);
 const mac=await crypto.subtle.sign("HMAC",macKey,encoder.encode(stable(envelope)));
 return {...envelope,auth:{scheme:"invite-hmac-sha256",mac:b64u(mac)}};
}
export async function decryptContactRequestEnvelope(message,invitationSecret,keyRing){
 const p=message?.payload;
 if(message?.v!==2||message?.type!=="contact_request"||!p||typeof p.request_id!=="string"||!/^[0-9a-f-]{36}$/i.test(p.request_id)||typeof p.from!=="string"||typeof p.to!=="string"||typeof p.invitation_id!=="string"||typeof p.recipient_key_id!=="string"||typeof p.eph!=="string"||typeof p.iv!=="string"||typeof p.ciphertext!=="string"||message.auth?.scheme!=="invite-hmac-sha256"||typeof message.auth.mac!=="string")throw Error("Некорректный запрос контакта.");
 const expires=Number(p.expires_at);if(!Number.isFinite(expires)||Date.now()>expires)throw Error("Срок действия запроса контакта истёк.");
 const macKey=await importInvitationMacKey(invitationSecret,["verify"]);
 const valid=await crypto.subtle.verify("HMAC",macKey,un64(message.auth.mac),encoder.encode(stable({v:message.v,type:message.type,payload:p})));
 if(!valid)throw Error("Не удалось подтвердить подлинность ответа. Приглашение могло быть подменено.");
 const candidates=[keyRing?.active,keyRing?.pending,keyRing?.previous].filter(item=>item?.privateKey&&item.key_id===p.recipient_key_id);
 if(candidates.length!==1)throw Error("Ключ приглашения больше не доступен на этом устройстве. Создайте новую ссылку и отправьте её повторно.");
 const key=await deriveRequestAesKey(candidates[0].privateKey,p.eph,p.invitation_id,p.request_id);
 const plain=await crypto.subtle.decrypt({name:"AES-GCM",iv:un64(p.iv),additionalData:requestAad(p)},key,un64(p.ciphertext));
 return verifyContactPackage(JSON.parse(new TextDecoder().decode(plain)));
}
