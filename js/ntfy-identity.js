import {getOrCreateIdentity,getContact} from "./local-store.js?v=11";
const enc=new TextEncoder(),toHex=v=>Array.from(new Uint8Array(v),b=>b.toString(16).padStart(2,"0")).join("");
export function isUserId(v){return typeof v==="string"&&/^[a-f0-9]{64}$/.test(v)}
export async function getNtfyTopic(id){if(!isUserId(id))throw new TypeError("A valid anonymous user ID is required.");return "vl-"+toHex(await crypto.subtle.digest("SHA-256",enc.encode("voicelink-ntfy-topic-v1|"+id))).slice(0,40)}
export async function getCurrentSignalingIdentity(){const x=await getOrCreateIdentity();if(!isUserId(x.user_id))throw Error("The local anonymous identity is invalid.");return {user_id:x.user_id}}
export async function getPeerSignalingIdentity(id){if(!isUserId(id))throw new TypeError("A valid contact user_id is required.");const c=await getContact(id);if(!c)throw Error("This contact is not saved on this device.");if(!c.invitation_id||!c.invitation_secret)throw Error("У контакта отсутствуют данные нового защищённого протокола. Попросите его отправить новое приглашение.");return {user_id:c.user_id,name:c.name,invitation_id:c.invitation_id}}
