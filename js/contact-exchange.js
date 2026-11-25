export const INVITATION_FORMAT_VERSION="2026-11-10T14:00:00Z";
const un64=s=>{if(typeof s!=="string"||!/^[A-Za-z0-9_-]+$/.test(s))throw TypeError("Некорректное base64url-значение.");s=s.replaceAll("-","+").replaceAll("_","/");return Uint8Array.from(atob(s+"=".repeat((4-s.length%4)%4)),c=>c.charCodeAt(0))};
function decodeInput(input){const raw=String(input||"").trim();if(!raw)throw Error("Вставьте ссылку или пакет контакта.");let value=raw;try{const u=new URL(raw);value=new URLSearchParams(u.hash.slice(1)).get("contact")||raw}catch{if(raw.startsWith("#"))value=new URLSearchParams(raw.slice(1)).get("contact")||raw}try{return value.startsWith("{")?JSON.parse(value):JSON.parse(new TextDecoder().decode(un64(value)))}catch{throw Error("Возможно, ссылка неполная, скопирована некорректно или изменена.")}}
export async function verifyContactPackage(input){
 const c=typeof input==="string"?decodeInput(input):input;
 if(!c||typeof c!=="object"||Array.isArray(c))throw Error("Некорректный формат приглашения.");
 if(c.version!==INVITATION_FORMAT_VERSION){
  const received=typeof c.version==="string"||typeof c.version==="number"?String(c.version):"не указана";
  throw Error("Версия приглашения «"+received+"» не поддерживается. Актуальная версия: "+INVITATION_FORMAT_VERSION+". Попросите собеседника создать новую ссылку.");
 }
 if(typeof c.user_id!=="string"||!/^[a-f0-9]{64}$/.test(c.user_id))throw Error("Некорректный анонимный идентификатор контакта.");
 // Web Push is optional; the contact handshake is delivered through Supabase.
 if(c.push_subscription_id!==undefined&&c.push_subscription_id!==null&&
    (typeof c.push_subscription_id!=="string"||!c.push_subscription_id.trim()))throw Error("Некорректный OneSignal Subscription ID.");
 if(typeof c.invitation_id!=="string"||!/^[0-9a-f-]{36}$/i.test(c.invitation_id))throw Error("Некорректный идентификатор приглашения.");
 if(typeof c.invitation_secret!=="string"||un64(c.invitation_secret).length!==32)throw Error("В приглашении отсутствует корректный общий симметричный ключ.");
 if(typeof c.display_name==="string"&&(c.display_name.length>60||c.display_name.trim()!==c.display_name))throw Error("Некорректное имя в приглашении.");
 if(typeof c.supabase_user_id!=="string"||!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(c.supabase_user_id))throw Error("Приглашение не содержит корректный Supabase Auth UUID владельца.");
 if(typeof c.supabase_invitation_id!=="string"||!/^[A-Za-z0-9_-]{43}$/.test(c.supabase_invitation_id)||un64(c.supabase_invitation_id).length!==32)throw Error("Приглашение не содержит корректный одноразовый ID Supabase.");
 return {version:INVITATION_FORMAT_VERSION,user_id:c.user_id,...(typeof c.supabase_user_id==="string"?{supabase_user_id:c.supabase_user_id.toLowerCase()}:{}),...(typeof c.supabase_invitation_id==="string"?{supabase_invitation_id:c.supabase_invitation_id}:{}),push_subscription_id:typeof c.push_subscription_id==="string"&&c.push_subscription_id.trim()?c.push_subscription_id:null,invitation_id:c.invitation_id,invitation_secret:c.invitation_secret,shared_secret_created_at:Number.isFinite(Number(c.shared_secret_created_at))?Number(c.shared_secret_created_at):Date.now(),...(Object.hasOwn(c,"display_name")?{display_name:c.display_name}:{})};
}
