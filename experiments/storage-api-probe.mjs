#!/usr/bin/env node
import { randomBytes, createHash } from "node:crypto";
import mqtt from "mqtt";
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
 await isolated("Browser-AISenseStorage",async()=>{
  const x=await page.evaluate(async()=>{
   const data=crypto.getRandomValues(new Uint8Array(8192)),form=new FormData();
   form.append("file",new Blob([data],{type:"application/octet-stream"}),"vl-probe.bin");
   const p=await fetch("https://aisenseapi.com/services/v1/storage",{method:"POST",body:form});
   const t=await p.text();let j;try{j=JSON.parse(t)}catch{}
   if(!p.ok||!j?.storage_id)return {upload:p.status,body:t.slice(0,160)};
   const g=await fetch("https://aisenseapi.com/services/v1/storage/"+encodeURIComponent(j.storage_id));
   const got=new Uint8Array(await g.arrayBuffer());
   return {upload:p.status,download:g.status,bytes:got.length,expected:8192,
    same:got.length===data.length&&got.every((v,i)=>v===data[i]),serverSha256:j.sha256_hash??null};
  });
  return {pass:x.same===true,details:x};
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
 await isolated("Browser-WebSocketEndpoints",async()=>{
  const checks=await page.evaluate(async()=>{
   const es=[["EMQX","wss://broker.emqx.io:8084/mqtt"],["HiveMQ","wss://broker.hivemq.com:8884/mqtt"],
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
async function mqttProbe(name,url){
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
  for(let i=0;i<count;i++){await new Promise((ok,no)=>pub.publish(topic,JSON.stringify({i,h,data:payload.toString("base64")}),e=>e?no(e):ok()));await wait(40)}
  const until=Date.now()+8000;while(got.size<count&&Date.now()<until)await wait(100);
  report("MQTT-"+name,got.size===count&&!bad?"PASS":"PARTIAL",{sent:count,received:got.size,loss:count-got.size,packetBytes:1024,elapsedMs:Date.now()-start,endpoint:url});
 }catch(e){report("MQTT-"+name,"FAIL",{endpoint:url,error:String(e).slice(0,220)})}
 finally{try{sub?.end(true)}catch{}try{pub?.end(true)}catch{}}
}
async function nostr(name,url){
 let s;
 try{
  s=new WebSocket(url);
  const result=await new Promise((ok,no)=>{const t=setTimeout(()=>no(Error("timeout")),9000);
   s.onopen=()=>s.send(JSON.stringify(["REQ","vl-probe",{"kinds":[20000],"limit":1}]));
   s.onmessage=e=>{let x;try{x=JSON.parse(e.data)}catch{return}if(x[0]==="EOSE"){clearTimeout(t);ok("EOSE")}if(x[0]==="NOTICE"){clearTimeout(t);ok("NOTICE: "+x[1])}};
   s.onerror=()=>{clearTimeout(t);no(Error("WebSocket error"))};s.onclose=e=>{clearTimeout(t);no(Error("closed "+e.code))}});
  report("Nostr-"+name,"PASS",{endpoint:url,subscription:result});
 }catch(e){report("Nostr-"+name,"FAIL",{endpoint:url,error:String(e).slice(0,200)})}
 finally{try{s?.close()}catch{}}
}
await browserBatch();
await Promise.all([
 mqttProbe("EMQX","wss://broker.emqx.io:8084/mqtt"),
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
