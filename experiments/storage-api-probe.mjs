#!/usr/bin/env node
import { randomBytes, createHash } from "node:crypto";
import mqtt from "mqtt";
import { generateSecretKey, finalizeEvent } from "nostr-tools/pure";
import { chromium } from "playwright";
const ORIGIN="https://aiparticles-jpg.github.io", results=[];
const rnd=n=>randomBytes(n), sha=b=>createHash("sha256").update(b).digest("hex");
const wait=ms=>new Promise(r=>setTimeout(r,ms));
function report(name,status,details={}){const x={name,status,...details};results.push(x);console.log(JSON.stringify(x))}
async function browserBatch(){
 let browser,page;
 try{
  browser=await chromium.launch({headless:true});
  page=await browser.newPage();
  await page.goto(ORIGIN,{waitUntil:"domcontentloaded",timeout:30000});
  report("BrowserOrigin","PASS",{origin:await page.evaluate(()=>location.origin)});
 }catch(e){report("BrowserOrigin","BLOCKED",{error:String(e).slice(0,250)});await browser?.close();return}
 async function isolated(name,fn){
  try{const x=await fn();report(name,x.pass?"PASS":"FAIL",x.details??x)}
  catch(e){report(name,"FAIL",{error:String(e).slice(0,260)})}
 }
 await isolated("Browser-MantleDB",async()=>{
  const x=await page.evaluate(async()=>{
   const ns="vl-browser-"+crypto.randomUUID().replaceAll("-","");
   const u="https://mantledb.sh/v2/"+ns+"/probe";
   const data=btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(12000))));
   const p=await fetch(u,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({data})});
   const pt=await p.text(),g=await fetch(u),gt=await g.text();
   return {post:p.status,get:g.status,same:gt.includes(data),postBody:pt.slice(0,80)};
  });
  return {pass:x.post===200&&x.get===200&&x.same,details:x};
 });
 await isolated("Browser-OneJSONFile",async()=>{
  const x=await page.evaluate(async()=>{
   const c=await fetch("https://onejsonfile.com/api/v1/anonymous",{method:"POST",headers:{"Content-Type":"application/json"},body:"{}"});
   const t=await c.text();let j;try{j=JSON.parse(t)}catch{}
   if(!c.ok||!j?.token)return {create:c.status,body:t.slice(0,100)};
   const u="https://onejsonfile.com/api/v1/files/"+encodeURIComponent(j.token);
   const p=await fetch(u,{method:"PUT",headers:{"Content-Type":"application/json"},body:'{"browserProbe":true}'});
   const g=await fetch(u);return {create:c.status,put:p.status,get:g.status,body:await g.text()};
  });
  return {pass:x.put===200&&x.get===200&&x.body.includes("browserProbe"),details:x};
 });
 await isolated("Browser-qurl",async()=>{
  const x=await page.evaluate(async()=>{
   const name="vl-"+crypto.randomUUID()+".bin",data=crypto.getRandomValues(new Uint8Array(4096));
   const p=await fetch("https://qurl.sh/"+name,{method:"PUT",headers:{"X-Format":"json","X-TTL":"1h","X-Downloads":"2"},body:data});
   const t=await p.text();let j;try{j=JSON.parse(t)}catch{}
   if(!p.ok||!j?.url)return {put:p.status,body:t.slice(0,140)};
   const g=await fetch(j.url+"?raw=true"),a=new Uint8Array(await g.arrayBuffer());
   return {put:p.status,get:g.status,bytes:a.length,same:a.length===data.length&&a.every((v,i)=>v===data[i])};
  });
  return {pass:x.same===true,details:x};
 });
 await isolated("Browser-AISenseStorage-2Contexts",async()=>{
  const upload=await page.evaluate(async()=>{
   const data=new Uint8Array(262144);
   for(let i=0;i<data.length;i+=65536)data.set(crypto.getRandomValues(new Uint8Array(65536)),i);
   const form=new FormData();form.append("file",new Blob([data],{type:"application/octet-stream"}),"vl-256k.bin");
   const p=await fetch("https://aisenseapi.com/services/v1/storage",{method:"POST",body:form});
   const t=await p.text();let j;try{j=JSON.parse(t)}catch{}
   const expected=await crypto.subtle.digest("SHA-256",data);
   return {status:p.status,id:j?.storage_id,expected:Array.from(new Uint8Array(expected)).map(x=>x.toString(16).padStart(2,"0")).join("")};
  });
  if(upload.status!==200||!upload.id)return {pass:false,details:upload};
  const page2=await browser.newPage();await page2.goto(ORIGIN,{waitUntil:"domcontentloaded",timeout:30000});
  const d=await page2.evaluate(async id=>{
   const r=await fetch("https://aisenseapi.com/services/v1/storage/"+encodeURIComponent(id));
   const b=await r.arrayBuffer(),h=await crypto.subtle.digest("SHA-256",b);
   return {status:r.status,bytes:b.byteLength,hash:Array.from(new Uint8Array(h)).map(x=>x.toString(16).padStart(2,"0")).join("")};
  },upload.id);
  await page2.close();
  return {pass:d.status===200&&d.bytes===262144&&d.hash===upload.expected,
   details:{uploadStatus:upload.status,downloadStatus:d.status,bytes:d.bytes,hashMatch:d.hash===upload.expected}};
 });
 await isolated("Browser-RESTfulAPI",async()=>{
  const x=await page.evaluate(async()=>{
   const marker="vl-"+crypto.randomUUID();
   const p=await fetch("https://api.restful-api.dev/objects",{method:"POST",headers:{"Content-Type":"application/json"},
    body:JSON.stringify({name:marker,data:{payload:"hello",marker}})});
   const pt=await p.text();let j;try{j=JSON.parse(pt)}catch{}
   if(!p.ok||!j?.id)return {create:p.status,body:pt.slice(0,150)};
   const u="https://api.restful-api.dev/objects/"+encodeURIComponent(j.id);
   const g=await fetch(u);const value=await g.json();
   const patch=await fetch(u,{method:"PATCH",headers:{"Content-Type":"application/json"},body:JSON.stringify({data:{ack:true}})});
   const verify=await fetch(u);const v=await verify.json();
   const del=await fetch(u,{method:"DELETE"});
   return {create:p.status,read:g.status,stored:value.name===marker,patch:patch.status,
    updated:v.data?.ack===true,delete:del.status,id:j.id};
  });
  return {pass:x.create===200&&x.read===200&&x.stored&&x.patch===200&&x.updated&&x.delete>=200&&x.delete<300,details:x};
 });
 await isolated("Browser-CrudCrud",async()=>{
  const endpointPage=await browser.newPage();
  await endpointPage.goto("https://crudcrud.com/",{waitUntil:"domcontentloaded",timeout:30000});
  const text=await endpointPage.locator("body").innerText();
  await endpointPage.close();
  const base=text.match(/https:\/\/crudcrud\.com\/api\/[a-f0-9]{32}/i)?.[0];
  if(!base)throw new Error("Could not extract generated anonymous endpoint");
  const x=await page.evaluate(async base=>{
   const resource=base+"/vlprobe",marker="vl-"+crypto.randomUUID();
   const p=await fetch(resource,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({marker,stage:"created"})});
   const pt=await p.text();let j;try{j=JSON.parse(pt)}catch{}
   if(!p.ok||!j?._id)return {create:p.status,body:pt.slice(0,120)};
   const id=j._id,u=resource+"/"+id,g=await fetch(resource),arr=await g.json();
   const put=await fetch(u,{method:"PUT",headers:{"Content-Type":"application/json"},body:JSON.stringify({marker,stage:"updated"})});
   const v=await fetch(resource),rows=await v.json(),updated=rows.find(x=>x._id===id)?.stage==="updated";
   const del=await fetch(u,{method:"DELETE"});
   return {create:p.status,read:g.status,found:arr.some(x=>x._id===id),update:put.status,updated,delete:del.status};
  },base);
  return {pass:x.create===201&&x.read===200&&x.found&&x.update===200&&x.updated&&x.delete>=200&&x.delete<300,details:x};
 });
 await isolated("Browser-TempFileOrg",async()=>{
  const x=await page.evaluate(async()=>{
   const data=crypto.getRandomValues(new Uint8Array(4096)),form=new FormData();
   form.append("files",new Blob([data],{type:"text/plain"}),"vl-probe.txt");form.append("expiryHours","1");
   const p=await fetch("https://tempfile.org/api/upload/local",{method:"POST",body:form});
   const t=await p.text();let j;try{j=JSON.parse(t)}catch{}
   if(!p.ok||!j?.files?.[0]?.id)return {upload:p.status,body:t.slice(0,140)};
   const id=j.files[0].id,info=await fetch("https://tempfile.org/api/file/"+id),ij=await info.json();
   const dl=await fetch("https://tempfile.org"+ij.file.downloadUrl),b=new Uint8Array(await dl.arrayBuffer());
   const del=await fetch("https://tempfile.org/api/file/"+id,{method:"DELETE"});
   return {upload:p.status,info:info.status,download:dl.status,bytes:b.length,same:b.length===data.length&&b.every((v,i)=>v===data[i]),delete:del.status};
  });
  return {pass:x.same===true,details:x};
 });
 await isolated("Browser-Filebin",async()=>{
  const x=await page.evaluate(async()=>{
   const bin="vl"+crypto.randomUUID().replaceAll("-","").slice(0,16),path="https://filebin.net/"+bin+"/probe.txt";
   const data=crypto.getRandomValues(new Uint8Array(4096));
   const p=await fetch(path,{method:"POST",headers:{"Content-Type":"text/plain"},body:data});
   if(!p.ok)return {upload:p.status,body:(await p.text()).slice(0,120)};
   const g=await fetch(path),b=new Uint8Array(await g.arrayBuffer());
   const del=await fetch("https://filebin.net/"+bin,{method:"DELETE"});
   return {upload:p.status,download:g.status,bytes:b.length,same:b.length===data.length&&b.every((v,i)=>v===data[i]),delete:del.status};
  });
  return {pass:x.same===true,details:x};
 });
 await isolated("Browser-Uguu",async()=>{
  const x=await page.evaluate(async()=>{
   const data=crypto.getRandomValues(new Uint8Array(4096)),form=new FormData();
   form.append("files[]",new Blob([data],{type:"text/plain"}),"vl-probe.txt");
   const p=await fetch("https://uguu.se/upload",{method:"POST",body:form});
   const t=await p.text();let j;try{j=JSON.parse(t)}catch{}
   const url=j?.files?.[0]?.url??j?.url??t.trim().split(/\s+/).find(x=>x.startsWith("https://"));
   if(!p.ok||!url)return {upload:p.status,body:t.slice(0,140)};
   const g=await fetch(url),b=new Uint8Array(await g.arrayBuffer());
   return {upload:p.status,download:g.status,bytes:b.length,same:b.length===data.length&&b.every((v,i)=>v===data[i]),url};
  });
  return {pass:x.same===true,details:x};
 });
 await isolated("Browser-WaifuVault",async()=>{
  const x=await page.evaluate(async()=>{
   const data=crypto.getRandomValues(new Uint8Array(4096)),form=new FormData();
   form.append("file",new Blob([data],{type:"text/plain"}),"vl-probe.txt");
   const p=await fetch("https://waifuvault.moe/rest",{method:"PUT",body:form});
   const t=await p.text();let j;try{j=JSON.parse(t)}catch{}
   let url=j?.url??j?.fileUrl??j?.file?.url;
   if(!url){const token=j?.token??j?.file?.token;if(token){const meta=await fetch("https://waifuvault.moe/rest/"+token);const m=await meta.json();url=m.url??m.fileUrl??m.file?.url}}
   if(!p.ok||!url)return {upload:p.status,body:t.slice(0,180)};
   const g=await fetch(url),b=new Uint8Array(await g.arrayBuffer());
   return {upload:p.status,download:g.status,bytes:b.length,same:b.length===data.length&&b.every((v,i)=>v===data[i]),url};
  });
  return {pass:x.same===true,details:x};
 });
 await isolated("Browser-BeaconHost",async()=>{
  const x=await page.evaluate(async()=>{
   const data=crypto.getRandomValues(new Uint8Array(4096)),form=new FormData();
   form.append("file",new Blob([data],{type:"text/plain"}),"vl-probe.txt");
   const p=await fetch("https://beacon.host/v1/publish",{method:"POST",body:form});
   const t=await p.text();let j;try{j=JSON.parse(t)}catch{}
   if(!p.ok||!j?.fileUrl)return {upload:p.status,body:t.slice(0,160)};
   const g=await fetch(j.fileUrl),b=new Uint8Array(await g.arrayBuffer());
   return {upload:p.status,download:g.status,bytes:b.length,same:b.length===data.length&&b.every((v,i)=>v===data[i]),expiresAt:j.expiresAt};
  });
  return {pass:x.same===true,details:x};
 });
 await isolated("Browser-Litterbox",async()=>{
  const x=await page.evaluate(async()=>{
   const data=crypto.getRandomValues(new Uint8Array(4096)),form=new FormData();
   form.append("reqtype","fileupload");form.append("time","1h");
   form.append("fileToUpload",new Blob([data],{type:"text/plain"}),"vl-probe.txt");
   const p=await fetch("https://litterbox.catbox.moe/resources/internals/api.php",{method:"POST",body:form});
   const url=(await p.text()).trim();
   if(!p.ok||!url.startsWith("https://"))return {upload:p.status,body:url.slice(0,140)};
   const g=await fetch(url),b=new Uint8Array(await g.arrayBuffer());
   return {upload:p.status,download:g.status,bytes:b.length,same:b.length===data.length&&b.every((v,i)=>v===data[i]),url};
  });
  return {pass:x.same===true,details:x};
 });
 await isolated("Browser-Gofile-GuestAccount",async()=>{
  const x=await page.evaluate(async()=>{
   const a=await fetch("https://api.gofile.io/accounts",{method:"POST",headers:{"Content-Type":"application/json"},body:"{}"});
   const aj=await a.json();if(!a.ok||aj.status!=="ok")return {account:a.status,body:aj};
   const token=aj.data.token,accountId=aj.data.id;
   const check=await fetch("https://api.gofile.io/accounts/getid",{headers:{Authorization:"Bearer "+token}});
   const cj=await check.json();
   const data=crypto.getRandomValues(new Uint8Array(4096)),form=new FormData();
   form.append("file",new Blob([data],{type:"text/plain"}),"vl-probe.txt");
   const up=await fetch("https://upload.gofile.io/uploadfile",{method:"POST",headers:{Authorization:"Bearer "+token},body:form});
   const uj=await up.json();if(!up.ok||uj.status!=="ok")return {account:a.status,accountCheck:check.status,guestEmail:cj.data?.email,tier:cj.data?.tier,upload:up.status,body:uj};
   const id=uj.data.id,code=uj.data.code;
   const dl=await fetch("https://gofile.io/dl/"+code,{headers:{Authorization:"Bearer "+token}});
   const b=new Uint8Array(await dl.arrayBuffer());
   const del=await fetch("https://api.gofile.io/contents",{method:"DELETE",headers:{Authorization:"Bearer "+token,"Content-Type":"application/json"},body:JSON.stringify({contentsId:id})});
   const dj=await del.json();
   return {account:a.status,accountCheck:check.status,guestEmail:cj.data?.email,tier:cj.data?.tier,
    upload:up.status,download:dl.status,contentType:dl.headers.get("content-type"),bytes:b.length,
    same:b.length===data.length&&b.every((v,i)=>v===data[i]),delete:del.status,deleteStatus:dj.status};
  });
  return {pass:x.guestEmail===null&&x.tier==="guest"&&x.same===true&&x.deleteStatus==="ok",details:x};
 });
 await isolated("Browser-Kappa",async()=>{
  const x=await page.evaluate(async()=>{
   const data=crypto.getRandomValues(new Uint8Array(4096)),form=new FormData();
   form.append("file",new Blob([data],{type:"text/plain"}),"vl-probe.txt");
   const p=await fetch("https://kappa.lol/api/upload",{method:"POST",body:form});
   const t=await p.text();let j;try{j=JSON.parse(t)}catch{}
   if(!p.ok||!j?.link)return {upload:p.status,body:t.slice(0,140)};
   const g=await fetch(j.link),b=new Uint8Array(await g.arrayBuffer());
   const del=await fetch(j.delete);
   return {upload:p.status,download:g.status,bytes:b.length,same:b.length===data.length&&b.every((v,i)=>v===data[i]),delete:del.status};
  });
  return {pass:x.same===true,details:x};
 });
 await isolated("Browser-Segs",async()=>{
  const x=await page.evaluate(async()=>{
   const data=crypto.getRandomValues(new Uint8Array(4096)),form=new FormData();
   form.append("file",new Blob([data],{type:"text/plain"}),"vl-probe.txt");
   const p=await fetch("https://segs.lol/api/upload",{method:"POST",body:form});
   const t=await p.text();let j;try{j=JSON.parse(t)}catch{}
   if(!p.ok||!j?.link)return {upload:p.status,body:t.slice(0,140)};
   const g=await fetch(j.link),b=new Uint8Array(await g.arrayBuffer());
   const del=await fetch(j.delete);
   return {upload:p.status,download:g.status,bytes:b.length,same:b.length===data.length&&b.every((v,i)=>v===data[i]),delete:del.status};
  });
  return {pass:x.same===true,details:x};
 });
 await isolated("Browser-Tmpfiles",async()=>{
  const x=await page.evaluate(async()=>{
   const data=crypto.getRandomValues(new Uint8Array(4096)),form=new FormData();
   form.append("file",new Blob([data],{type:"text/plain"}),"vl-probe.txt");form.append("expire","3600");
   const p=await fetch("https://tmpfiles.org/api/v1/upload",{method:"POST",body:form});
   const t=await p.text();let j;try{j=JSON.parse(t)}catch{}
   const url=j?.data?.url??j?.url??j?.data?.downloadUrl;
   if(!p.ok||!url)return {upload:p.status,body:t.slice(0,160)};
   const raw=url.replace("://tmpfiles.org/","://tmpfiles.org/dl/");
   const g=await fetch(raw),b=new Uint8Array(await g.arrayBuffer());
   return {upload:p.status,download:g.status,bytes:b.length,same:b.length===data.length&&b.every((v,i)=>v===data[i]),url:raw};
  });
  return {pass:x.same===true,details:x};
 });
 await isolated("Browser-KeyVal",async()=>{
  const x=await page.evaluate(async()=>{
   const key="vlprobe-"+crypto.randomUUID().replaceAll("-","").slice(0,24);
   const v1="A".repeat(240),v2="B".repeat(240);
   const s=await fetch("https://api.keyval.org/set/"+encodeURIComponent(key)+"/"+v1);
   const g=await fetch("https://api.keyval.org/get/"+encodeURIComponent(key));
   const t1=(await g.text()).trim();
   const u=await fetch("https://api.keyval.org/set/"+encodeURIComponent(key)+"/"+v2);
   const h=await fetch("https://api.keyval.org/get/"+encodeURIComponent(key));
   const t2=(await h.text()).trim();
   return {set:s.status,read:g.status,firstMatch:t1===v1,overwrite:u.status,secondMatch:t2===v2,limitTest:v2.length};
  });
  return {pass:x.set===200&&x.read===200&&x.firstMatch&&x.overwrite===200&&x.secondMatch,details:x};
 });
 await isolated("Browser-PastersIO",async()=>{
  const x=await page.evaluate(async()=>{
   const data="VL-PROBE-"+crypto.randomUUID()+"-"+ "x".repeat(4096);
   const p=await fetch("https://pasters.io/?expires=1d",{method:"POST",headers:{"Content-Type":"text/plain"},body:data});
   const url=(await p.text()).trim(),deleteUrl=p.headers.get("x-delete-url");
   if(!p.ok||!url.startsWith("https://"))return {upload:p.status,body:url.slice(0,120),deleteHeader:!!deleteUrl};
   const g=await fetch(url),body=await g.text();
   let del=null;if(deleteUrl){const d=await fetch(deleteUrl,{method:"DELETE"});del=d.status}
   return {upload:p.status,download:g.status,match:body===data,delete:del,deleteHeader:!!deleteUrl,expires:p.headers.get("x-paste-expires-in")};
  });
  return {pass:x.upload===201&&x.download===200&&x.match,details:x};
 });
 await isolated("Browser-PastebinAI",async()=>{
  const x=await page.evaluate(async()=>{
   const content="VL-PROBE-"+crypto.randomUUID()+"-"+"q".repeat(4096);
   const p=await fetch("https://pastebin.ai/api/v1/pastes",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({content,visibility:"unlisted",expiration:"10m"})});
   const pt=await p.text();let j;try{j=JSON.parse(pt)}catch{}
   if(!p.ok||!j?.id)return {create:p.status,body:pt.slice(0,180)};
   const g=await fetch("https://pastebin.ai/api/v1/pastes/"+encodeURIComponent(j.id));
   const gt=await g.text();let gj;try{gj=JSON.parse(gt)}catch{}
   const match=gt.includes(content);
   let del=null;if(j.delete_token){const d=await fetch("https://pastebin.ai/api/v1/pastes/"+encodeURIComponent(j.id),{method:"DELETE",headers:{"X-Delete-Token":j.delete_token}});del=d.status}
   return {create:p.status,read:g.status,match,delete:del,expiresAt:j.expires_at};
  });
  return {pass:x.create===201&&x.read===200&&x.match,details:x};
 });
 await isolated("Browser-rTS-Linx",async()=>{
  const x=await page.evaluate(async()=>{
   const data=crypto.getRandomValues(new Uint8Array(4096));
   const p=await fetch("https://paste.rtech.support/upload/",{method:"PUT",headers:{
    "Accept":"application/json","Linx-Randomize":"yes","Linx-Expiry":"3600"
   },body:data});
   const pt=await p.text();let j;try{j=JSON.parse(pt)}catch{}
   if(!p.ok||!j?.url)return {upload:p.status,body:pt.slice(0,180)};
   const g=await fetch(j.direct_url??j.url),b=new Uint8Array(await g.arrayBuffer());
   let del=null;if(j.delete_key){const d=await fetch(j.url,{method:"DELETE",headers:{"Linx-Delete-Key":j.delete_key}});del=d.status}
   return {upload:p.status,download:g.status,bytes:b.length,match:b.length===data.length&&b.every((v,i)=>v===data[i]),delete:del,expiry:j.expiry};
  });
  return {pass:x.match===true,details:x};
 });
 await isolated("Browser-SvixPlay-Mailbox",async()=>{
  const x=await page.evaluate(async()=>{
   const t=await fetch("https://api.play.svix.com/api/v1/token/generate/",{method:"POST"});
   const tt=await t.text();let tj;try{tj=JSON.parse(tt)}catch{}
   const token=typeof tj==="string"?tj:(tj?.token??tj?.id??tj?.data?.token);
   if(!t.ok||!token)return {tokenStatus:t.status,body:tt.slice(0,160)};
   const marker="VL-PROBE-"+crypto.randomUUID();
   const p=await fetch("https://api.play.svix.com/api/v1/in/"+encodeURIComponent(token)+"/",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({marker,sequence:1})});
   const h=await fetch("https://api.play.svix.com/api/v1/history/"+encodeURIComponent(token)+"/");
   const ht=await h.text();
   return {tokenStatus:t.status,send:p.status,history:h.status,found:ht.includes(marker),historyBody:ht.slice(0,120)};
  });
  return {pass:x.send>=200&&x.send<300&&x.history===200&&x.found,details:x};
 });
 await isolated("Browser-WebhookSite-Mailbox",async()=>{
  const x=await page.evaluate(async()=>{
   const t=await fetch("https://webhook.site/token",{method:"POST",headers:{"Accept":"application/json","Content-Type":"application/json"},body:"{}"});
   const tt=await t.text();let tj;try{tj=JSON.parse(tt)}catch{}
   const id=tj?.uuid??tj?.token??tj?.id;
   if(!t.ok||!id)return {create:t.status,body:tt.slice(0,150)};
   const marker="VL-PROBE-"+crypto.randomUUID();
   let sendStatus=null,sendError=null;
   try{const s=await fetch("https://webhook.site/"+id,{method:"POST",headers:{"Content-Type":"text/plain"},body:marker});sendStatus=s.status}
   catch(e){sendError=String(e).slice(0,100)}
   const g=await fetch("https://webhook.site/token/"+id+"/requests");
   const gt=await g.text();
   let del=null;try{const d=await fetch("https://webhook.site/token/"+id,{method:"DELETE",headers:{"Accept":"application/json"}});del=d.status}catch{}
   return {create:t.status,send:sendStatus,sendError,read:g.status,found:gt.includes(marker),delete:del,body:gt.slice(0,120)};
  });
  return {pass:x.read===200&&x.found,details:x};
 });
 await isolated("Browser-WebSocketEndpoints",async()=>{
  const checks=await page.evaluate(async()=>{
   const es=[["ConnectMQ","wss://broker.connectmq.com:8084/mqtt"],["EMQX","wss://broker.emqx.io:8084/mqtt"],["HiveMQ","wss://broker.hivemq.com:8884/mqtt"],
    ["Eclipse","wss://mqtt.eclipseprojects.io:443/mqtt"],["Mosquitto","wss://test.mosquitto.org:8081"]];
   return Promise.all(es.map(([name,url])=>new Promise(resolve=>{
    let s;const t=setTimeout(()=>{try{s?.close()}catch{};resolve({name,status:"TIMEOUT"})},9000);
    try{s=new WebSocket(url,"mqtt");s.onopen=()=>{clearTimeout(t);s.close();resolve({name,status:"OPEN"})};
     s.onerror=()=>{clearTimeout(t);resolve({name,status:"ERROR"})}}
    catch(e){clearTimeout(t);resolve({name,status:"ERROR",error:String(e)})}
   })));
  });
  return {pass:checks.some(x=>x.status==="OPEN"),details:{checks}};
 });
 await browser.close();
}
async function mqttProbe(name,url,interval=40){
 const id=rnd(8).toString("hex"),topic="vl-probe/"+id;let sub,pub;
 try{
  const conn=c=>new Promise((ok,no)=>{const t=setTimeout(()=>no(Error("connect timeout")),12000);
   c.once("connect",()=>{clearTimeout(t);ok()});c.once("error",e=>{clearTimeout(t);no(e)})});
  sub=mqtt.connect(url,{clientId:"vls"+id,clean:true,connectTimeout:12000,reconnectPeriod:0});
  await conn(sub);await new Promise((ok,no)=>sub.subscribe(topic,e=>e?no(e):ok()));
  pub=mqtt.connect(url,{clientId:"vlp"+id,clean:true,connectTimeout:12000,reconnectPeriod:0});await conn(pub);
  const payload=rnd(1024),h=sha(payload),count=75,got=new Set();let bad=false;
  sub.on("message",(_,b)=>{try{const x=JSON.parse(b.toString());if(x.h!==h)bad=true;got.add(x.i)}catch{bad=true}});
  const start=Date.now();
  for(let i=0;i<count;i++){await new Promise((ok,no)=>pub.publish(topic,JSON.stringify({i,h,data:payload.toString("base64")}),e=>e?no(e):ok()));await wait(interval)}
  const until=Date.now()+8000;while(got.size<count&&Date.now()<until)await wait(100);
  report("MQTT-"+name,got.size===count&&!bad?"PASS":"PARTIAL",{sent:count,received:got.size,loss:count-got.size,packetBytes:1024,elapsedMs:Date.now()-start,endpoint:url});
 }catch(e){report("MQTT-"+name,"FAIL",{endpoint:url,error:String(e).slice(0,220)})}
 finally{try{sub?.end(true)}catch{}try{pub?.end(true)}catch{}}
}
async function nostr(name,url){
 let s;
 try{
  const sk=generateSecretKey();
  const event=finalizeEvent({kind:20000,created_at:Math.floor(Date.now()/1000),tags:[],content:"vl-probe:"+rnd(12).toString("hex")},sk);
  s=new WebSocket(url);
  const state=await new Promise((resolve,reject)=>{
   const sub="vl"+rnd(6).toString("hex");let accepted=false,echoed=false,eose=false;
   const timer=setTimeout(()=>reject(Error("timeout accepted="+accepted+" echoed="+echoed+" eose="+eose)),12000);
   s.onopen=()=>s.send(JSON.stringify(["REQ",sub,{ids:[event.id]}]));
   s.onmessage=e=>{
    let x;try{x=JSON.parse(e.data)}catch{return}
    if(x[0]==="EOSE"&&x[1]===sub&&!eose){eose=true;s.send(JSON.stringify(["EVENT",event]));}
    if(x[0]==="OK"&&x[1]===event.id){accepted=x[2]===true;if(x[2]===false){clearTimeout(timer);reject(Error("relay rejected: "+x[3]))}}
    if(x[0]==="EVENT"&&x[1]===sub&&x[2]?.id===event.id)echoed=true;
    if(accepted&&echoed){clearTimeout(timer);resolve({accepted,echoed,eose,kind:event.kind})}
   };
   s.onerror=()=>{clearTimeout(timer);reject(Error("WebSocket error"))};
   s.onclose=e=>{clearTimeout(timer);reject(Error("closed "+e.code+" "+e.reason))};
  });
  report("Nostr-"+name,"PASS",{endpoint:url,...state});
 }catch(e){report("Nostr-"+name,"FAIL",{endpoint:url,error:String(e).slice(0,240)})}
 finally{try{s?.close()}catch{}}
}
await browserBatch();
await Promise.all([
 mqttProbe("EMQX","wss://broker.emqx.io:8084/mqtt"),
 mqttProbe("ConnectMQ","wss://broker.connectmq.com:8084/mqtt",100),
 mqttProbe("HiveMQ","wss://broker.hivemq.com:8884/mqtt"),
 mqttProbe("Eclipse","wss://mqtt.eclipseprojects.io:443/mqtt"),
 mqttProbe("Mosquitto","wss://test.mosquitto.org:8081")
]);
await Promise.all([
 nostr("Primal","wss://relay.primal.net"),nostr("nos.lol","wss://nos.lol"),nostr("Damus","wss://relay.damus.io")
]);
console.log(JSON.stringify({summary:{total:results.length,passed:results.filter(x=>x.status==="PASS").length,
 partial:results.filter(x=>x.status==="PARTIAL").length,failed:results.filter(x=>["FAIL","BLOCKED"].includes(x.status)).length,
 note:"Browser fetch from deployed GitHub Pages origin; network probes from one Actions runner, not Turkey mobile."}},null,2));
