import { getOrCreateIdentity, getContact } from "./local-store.js?v=10";
const encoder=new TextEncoder();
function toHex(value){return Array.from(new Uint8Array(value),b=>b.toString(16).padStart(2,"0")).join("")}
export function isUserId(value){return typeof value==="string"&&/^[a-f0-9]{64}$/.test(value)}
export async function getNtfyTopic(userId){
 if(!isUserId(userId))throw new TypeError("A valid anonymous user_id is required.");
 const hash=await crypto.subtle.digest("SHA-256",encoder.encode("voice-link-user-v1|"+userId));
 return "vl-user-"+toHex(hash).slice(0,40);
}
export async function getCurrentSignalingIdentity(){
 const identity=await getOrCreateIdentity();
 if(!isUserId(identity.user_id))throw new Error("The local anonymous identity is invalid.");
 return {user_id:identity.user_id};
}
export async function getPeerSignalingIdentity(userId){
 if(!isUserId(userId))throw new TypeError("A valid contact user_id is required.");
 const contact=await getContact(userId);
 if(!contact)throw new Error("This contact is not saved on this device.");
 if(!contact.message_encryption_public_key||!contact.message_encryption_key_id||!contact.invitation_secret)throw new Error("У контакта нет данных нового защищённого протокола. Попросите его отправить новое приглашение.");
 return {user_id:contact.user_id,name:contact.name,invitation_id:contact.invitation_id||null,message_encryption_public_key:contact.message_encryption_public_key,message_encryption_key_id:contact.message_encryption_key_id,message_encryption_generation:Number(contact.message_encryption_generation)||1};
}
