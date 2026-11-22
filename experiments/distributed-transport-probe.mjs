#!/usr/bin/env node
import { randomBytes, createHash } from "node:crypto";
import mqtt from "mqtt";
import { generateSecretKey, finalizeEvent } from "nostr-tools/pure";
const role=process.env.CLIENT_ROLE,run=process.env.GITHUB_RUN_ID;
if(!["A","B"].includes(role)||!run)throw Error("CLIENT_ROLE and GITHUB_RUN_ID required");
const wait=ms=>new Promise(r=>setTimeout(r,ms)),rnd=n=>randomBytes(n),sha=b=>createHash("sha256").update(b).digest("hex");
function log(name,status,details={}){console.log(JSON.stringify({name,role,status,...details}))}
async function json(url,init={}){const r=await fetch(url,{...init,signal:AbortSignal.timeout(15000)});const t=await r.text();let j;try{j=JSON.parse(t)}catch{j=t}if(!r.ok)throw Error("HTTP "+r.status+" "+String(t).slice(0,150));return j}
async function poll(fn,ms=45000){const end=Date.now()+ms;while(Date.now()<end){const x=await fn();if(x)return x;await wait(300)}throw Error("cross-runner rendezvous timeout")}
async function sharedStorage(){
 const ns="vlgha"+run,base="https://mantledb.sh/v2/"+ns+"/";
 try{
  if(role==="A"){
   const data=rnd(24576),digest=sha(data);
   await json(base+"payload",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({data:data.toString("base64"),sha256:digest,from:"A"})});
   const bin=rnd(128*1024),form=new FormData();form.append("file",new Blob([bin],{type:"application/octet-stream"}),"vl-cross-runner.bin");
   const up=await json("https://aisenseapi.com/services/v1/storage",{method:"POST",body:form});
   const meta={id:up.storage_id,sha256:sha(bin),bytes:bin.length};
   await json(base+"filemeta",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(meta)});
   const ack=await poll(async()=>{try{return await json(base+"ack")}catch{return null}});
   for(const p of ["payload","filemeta","ack"])await fetch(base+p,{method:"DELETE"});
   log("CrossRunner-MantleDB-AISense","PASS",{peerAck:ack.ok===true,jsonBytes:data.length,fileBytes:meta.bytes});
  }else{
   const msg=await poll(async()=>{try{return await json(base+"payload")}catch{return null}});
   const data=Buffer.from(msg.data,"base64");if(sha(data)!==msg.sha256)throw Error("MantleDB hash mismatch");
   const meta=await poll(async()=>{try{return await json(base+"filemeta")}catch{return null}});
   const r=await fetch("https://aisenseapi.com/services/v1/storage/"+encodeURIComponent(meta.id),{signal:AbortSignal.timeout(20000)});
   if(!r.ok)throw Error("AISense HTTP "+r.status);
   const bin=Buffer.from(await r.arrayBuffer());if(bin.length!==meta.bytes||sha(bin)!==meta.sha256)throw Error("AISense hash mismatch");
   await json(base+"ack",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({ok:true,from:"B"})});
   log("CrossRunner-MantleDB-AISense","PASS",{jsonBytes:data.length,fileBytes:bin.length,hashesMatch:true});
  }
 }catch(e){log("CrossRunner-MantleDB-AISense","FAIL",{error:String(e).slice(0,220)})}
}
async function fileHandoff(){
 const base="https://mantledb.sh/v2/vlgha"+run+"/";
 try{
  if(role==="A"){
   const specs={};
   const tempData=rnd(8192),tf=new FormData();tf.append("files",new Blob([tempData],{type:"text/plain"}),"vl-cross.txt");tf.append("expiryHours","1");
   const tj=await json("https://tempfile.org/api/upload/local",{method:"POST",body:tf});
   specs.tempfile={id:tj.files[0].id,url:"https://tempfile.org/"+tj.files[0].id+"/download",bytes:tempData.length,sha256:sha(tempData)};
   const beaconData=rnd(8192),bf=new FormData();bf.append("file",new Blob([beaconData],{type:"text/plain"}),"vl-cross.txt");
   const bj=await json("https://beacon.host/v1/publish",{method:"POST",body:bf});
   specs.beacon={slug:bj.slug,url:bj.fileUrl,claimToken:bj.claimToken,bytes:beaconData.length,sha256:sha(beaconData)};
   const waifuData=rnd(8192),wf=new FormData();wf.append("file",new Blob([waifuData],{type:"text/plain"}),"vl-cross.txt");
   const wj=await json("https://waifuvault.moe/rest",{method:"PUT",body:wf});
   const wurl=wj.url??wj.fileUrl??wj.file?.url;
   const wtoken=wj.token??wj.file?.token??wurl?.match(/\/f\/([^/]+)\//)?.[1];
   specs.waifuvault={url:wurl,token:wtoken,bytes:waifuData.length,sha256:sha(waifuData)};
   await json(base+"filemeta2",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(specs)});
   const ack=await poll(async()=>{try{return await json(base+"ack2")}catch{return null}});
   await fetch("https://tempfile.org/api/file/"+specs.tempfile.id,{method:"DELETE"});
   await fetch("https://beacon.host/v1/sites/"+specs.beacon.slug,{method:"DELETE",headers:{"X-Claim-Token":specs.beacon.claimToken}});
   if(specs.waifuvault.token)await fetch("https://waifuvault.moe/rest/"+encodeURIComponent(specs.waifuvault.token),{method:"DELETE"});
   log("CrossRunner-TempFile-Beacon-WaifuVault","PASS",{peerAck:ack.ok===true,services:ack.services});
  }else{
   const specs=await poll(async()=>{try{return await json(base+"filemeta2")}catch{return null}});
   const verified={};
   for(const name of ["tempfile","beacon","waifuvault"]){
    const m=specs[name];if(!m.url)throw Error(name+" missing URL");
    const r=await fetch(m.url,{signal:AbortSignal.timeout(20000)});
    if(!r.ok)throw Error(name+" download HTTP "+r.status);
    const b=Buffer.from(await r.arrayBuffer());
    verified[name]={bytes:b.length,ok:b.length===m.bytes&&sha(b)===m.sha256};
    if(!verified[name].ok)throw Error(name+" binary hash mismatch");
   }
   await json(base+"ack2",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({ok:true,services:verified})});
   log("CrossRunner-TempFile-Beacon-WaifuVault","PASS",{services:verified});
  }
 }catch(e){log("CrossRunner-TempFile-Beacon-WaifuVault","FAIL",{error:String(e).slice(0,240)})}
}
async function kappaHandoff(){
 const base="https://mantledb.sh/v2/vlgha"+run+"/";
 try{
  if(role==="A"){
   const specs={};
   for(const name of ["kappa","segs"]){
    const host=name==="kappa"?"https://kappa.lol/api/upload":"https://segs.lol/api/upload";
    const data=rnd(8192),form=new FormData();form.append("file",new Blob([data],{type:"text/plain"}),"vl-cross.txt");
    const up=await json(host,{method:"POST",body:form});
    specs[name]={url:up.link,delete:up.delete,bytes:data.length,sha256:sha(data)};
   }
   await json(base+"filemeta3",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(specs)});
   const ack=await poll(async()=>{try{return await json(base+"ack3")}catch{return null}});
   const deletes={};
   for(const name of ["kappa","segs"]){const r=await fetch(specs[name].delete);deletes[name]=r.status}
   log("CrossRunner-Kappa-Segs","PASS",{peerAck:ack.ok===true,verified:ack.verified,deletes});
  }else{
   const specs=await poll(async()=>{try{return await json(base+"filemeta3")}catch{return null}});
   const verified={};
   for(const name of ["kappa","segs"]){
    const r=await fetch(specs[name].url,{signal:AbortSignal.timeout(15000)});
    if(!r.ok)throw Error(name+" download HTTP "+r.status);
    const b=Buffer.from(await r.arrayBuffer());
    verified[name]={bytes:b.length,ok:b.length===specs[name].bytes&&sha(b)===specs[name].sha256};
    if(!verified[name].ok)throw Error(name+" hash mismatch");
   }
   await json(base+"ack3",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({ok:true,verified})});
   log("CrossRunner-Kappa-Segs","PASS",{verified});
  }
 }catch(e){log("CrossRunner-Kappa-Segs","FAIL",{error:String(e).slice(0,220)})}
}
async function svixCross(){
 const base="https://mantledb.sh/v2/vlsvix"+run+"/";
 try{
  if(role==="A"){
   const tr=await json("https://api.play.svix.com/api/v1/token/generate/",{method:"POST"});
   const token=typeof tr==="string"?tr:(tr.token??tr.id??tr.data?.token);
   if(!token)throw Error("Svix token missing");
   const marker="VL-SVIX-CROSS-"+run+"-"+rnd(8).toString("hex");
   const sent=await fetch("https://api.play.svix.com/api/v1/in/"+encodeURIComponent(token)+"/",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({marker,from:"A",bytes:rnd(1024).toString("base64")})});
   if(!sent.ok)throw Error("Svix send HTTP "+sent.status);
   await json(base+"meta",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({token,marker})});
   const ack=await poll(async()=>{try{return await json(base+"ack")}catch{return null}});
   log("CrossRunner-SvixPlay","PASS",{sendStatus:sent.status,peerAck:ack.ok===true,historyEvent:ack.eventId});
  }else{
   const meta=await poll(async()=>{try{return await json(base+"meta")}catch{return null}});
   const hist=await json("https://api.play.svix.com/api/v1/history/"+encodeURIComponent(meta.token)+"/");
   const found=(hist.data??[]).find(e=>{try{return Buffer.from(e.body??"","base64").toString("utf8").includes(meta.marker)}catch{return false}});
   if(!found)throw Error("Svix history did not contain marker; events="+(hist.data??[]).length);
   await json(base+"ack",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({ok:true,eventId:found.id})});
   log("CrossRunner-SvixPlay","PASS",{eventId:found.id,method:found.method,bodyBytes:Buffer.from(found.body,"base64").length});
  }
 }catch(e){log("CrossRunner-SvixPlay","FAIL",{error:String(e).slice(0,220)})}
}
async function writeAsCross(){
 const base="https://mantledb.sh/v2/vlwrites"+run+"/";
 try{
  if(role==="A"){
   const content="VL-WRITEAS-CROSS-"+run+"-"+rnd(8).toString("hex");
   const p=await json("https://write.as/api/posts",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({body:content,title:"VoiceLink cross-runner probe"})});
   if(p.code!==201||!p.data?.id||!p.data?.token)throw Error("Write.as create response "+JSON.stringify(p).slice(0,150));
   await json(base+"meta",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({id:p.data.id,token:p.data.token,content})});
   const ack=await poll(async()=>{try{return await json(base+"ack")}catch{return null}});
   const final=await json("https://write.as/api/posts/"+p.data.id);
   const verified=final.data?.body===ack.updatedBody;
   await fetch("https://write.as/api/posts/"+p.data.id+"?token="+encodeURIComponent(p.data.token),{method:"DELETE"});
   if(!verified)throw Error("Write.as final content mismatch");
   log("CrossRunner-WriteAs","PASS",{postId:p.data.id,updatedByPeer:true,deleted:true});
  }else{
   const meta=await poll(async()=>{try{return await json(base+"meta")}catch{return null}});
   const g=await json("https://write.as/api/posts/"+meta.id);
   if(g.data?.body!==meta.content)throw Error("Write.as initial body mismatch");
   const updatedBody=meta.content+"-UPDATED-BY-B";
   const u=await json("https://write.as/api/posts/"+meta.id,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({token:meta.token,body:updatedBody})});
   if(u.data?.body!==updatedBody)throw Error("Write.as update failed");
   await json(base+"ack",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({ok:true,updatedBody})});
   log("CrossRunner-WriteAs","PASS",{postId:meta.id,readByB:true,updatedByB:true});
  }
 }catch(e){log("CrossRunner-WriteAs","FAIL",{error:String(e).slice(0,220)})}
}
async function pasteGgCross(){
 const base="https://mantledb.sh/v2/vlpastegg"+run+"/";
 try{
  if(role==="A"){
   const value="VL-PASTEGG-CROSS-"+run+"-"+rnd(8).toString("hex");
   const p=await json("https://api.paste.gg/v1/pastes",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({
    name:"VoiceLink probe",description:"temporary synthetic probe",visibility:"unlisted",expires:new Date(Date.now()+3600000).toISOString(),
    files:[{name:"probe.txt",content:{format:"text",value}}]})});
   if(p.status!=="success"||!p.result?.id||!p.result?.deletion_key)throw Error("Paste.gg create response "+JSON.stringify(p).slice(0,160));
   await json(base+"meta",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({id:p.result.id,key:p.result.deletion_key,value})});
   const ack=await poll(async()=>{try{return await json(base+"ack")}catch{return null}});
   await fetch("https://api.paste.gg/v1/pastes/"+p.result.id,{method:"DELETE",headers:{"Authorization":"Key "+p.result.deletion_key}});
   log("CrossRunner-PasteGG","PASS",{pasteId:p.result.id,peerAck:ack.ok===true,deleted:true});
  }else{
   const meta=await poll(async()=>{try{return await json(base+"meta")}catch{return null}});
   const g=await json("https://api.paste.gg/v1/pastes/"+meta.id+"?full=true");
   const found=(g.result?.files??[]).some(f=>f.content?.value===meta.value);
   if(!found)throw Error("Paste.gg file content mismatch");
   await json(base+"ack",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({ok:true})});
   log("CrossRunner-PasteGG","PASS",{pasteId:meta.id,bytes:meta.value.length});
  }
 }catch(e){log("CrossRunner-PasteGG","FAIL",{error:String(e).slice(0,220)})}
}
async function mqttCross(name,url,interval=40){
 const topic="vl/distributed/"+run+"/"+name.toLowerCase();let c;
 try{
  c=mqtt.connect(url,{clientId:"vl"+run+role+name.slice(0,2),clean:true,connectTimeout:12000,reconnectPeriod:0,protocolVersion:4});
  await new Promise((ok,no)=>{const t=setTimeout(()=>no(Error("connect timeout")),12000);c.once("connect",()=>{clearTimeout(t);ok()});c.once("error",e=>{clearTimeout(t);no(e)})});
  let remoteReady=false;const got=new Set();
  c.on("message",(_,b)=>{try{const m=JSON.parse(b.toString());if(m.run!==run||m.from===role)return;if(m.type==="ready")remoteReady=true;if(m.type==="data")got.add(m.seq)}catch{}});
  await new Promise((ok,no)=>c.subscribe(topic,{qos:1},e=>e?no(e):ok()));
  const pub=(m,retain=false)=>new Promise((ok,no)=>c.publish(topic,JSON.stringify(m),{qos:1,retain},e=>e?no(e):ok()));
  await pub({run,from:role,type:"ready"},true);await poll(async()=>remoteReady?true:null,15000);
  const profiles=[];let seq=0,previousReceived=0;
  for(const rate of [16,24,40]){const packetBytes=Math.round(rate*1000/8/10),count=100,start=Date.now();let payloadBytes=0;
    for(let i=0;i<count;i++){const payload=rnd(packetBytes).toString("base64");await pub({run,from:role,type:"data",seq:seq++,rate,bytes:packetBytes,payload});payloadBytes+=packetBytes;await wait(100)}
    await poll(async()=>got.size>=seq?true:null,15000);const received=got.size-previousReceived;previousReceived=got.size;
    profiles.push({targetKbps:rate,sentPackets:count,receivedPackets:received,payloadBytes,elapsedMs:Date.now()-start,
      measuredPayloadKbps:payloadBytes*8/(Date.now()-start)*1000,pass:received===count});}
  log("CrossRunner-MQTT-"+name,profiles.every(x=>x.pass)?"PASS":"PARTIAL",{profiles});
 }catch(e){log("CrossRunner-MQTT-"+name,"FAIL",{error:String(e).slice(0,200)})}
 finally{try{if(c?.connected){c.publish(topic,"",{qos:1,retain:true});c.end(true)}}catch{}}
}
async function nostrCross(name,url){
 let ws;
 try{
  const channel="vl-"+run+"-"+name.toLowerCase(),sk=generateSecretKey();ws=new WebSocket(url);
  const result=await new Promise((resolve,reject)=>{
   const sub="vld"+run+role;let remoteReady=false,interval,deadline,got=new Set(),seq=0,subscribed=false;
   const fail=s=>{clearInterval(interval);clearTimeout(deadline);reject(Error(s))};
   const send=phase=>{const tags=[["d",channel],["phase",phase],["client",role]];if(phase==="data")tags.push(["seq",String(seq++)]);
    const ev=finalizeEvent({kind:20000,created_at:Math.floor(Date.now()/1000),tags,content:phase==="data"?rnd(1024).toString("base64"):"ready"},sk);
    ws.send(JSON.stringify(["EVENT",ev]));};
   deadline=setTimeout(()=>fail("timeout remoteReady="+remoteReady+" received="+got.size),45000);
   ws.onopen=()=>ws.send(JSON.stringify(["REQ",sub,{kinds:[20000],"#d":[channel]}]));
   ws.onmessage=e=>{let m;try{m=JSON.parse(e.data)}catch{return}
    if(m[0]==="EOSE"&&m[1]===sub&&!subscribed){subscribed=true;send("ready");interval=setInterval(()=>{if(!remoteReady)send("ready")},1000)}
    if(m[0]==="EVENT"&&m[1]===sub&&m[2]?.kind===20000){const tags=m[2].tags??[],who=tags.find(t=>t[0]==="client")?.[1],phase=tags.find(t=>t[0]==="phase")?.[1];
     if(who!==role&&phase==="ready"&&!remoteReady){remoteReady=true;clearInterval(interval);for(let i=0;i<20;i++)setTimeout(()=>send("data"),i*200)}
     if(who!==role&&phase==="data"){const n=Number(tags.find(t=>t[0]==="seq")?.[1]);if(Number.isInteger(n))got.add(n)}
     if(got.size>=20){clearInterval(interval);clearTimeout(deadline);resolve({remotePackets:got.size,packetBytes:1024})}
    }
    if(m[0]==="OK"&&m[2]===false)fail("relay rejected: "+m[3]);
   };
   ws.onerror=()=>fail("WebSocket error");ws.onclose=e=>fail("closed "+e.code+" "+e.reason);
  });
  log("CrossRunner-Nostr-"+name,"PASS",result);
 }catch(e){log("CrossRunner-Nostr-"+name,"FAIL",{error:String(e).slice(0,220)})}
 finally{try{ws?.close()}catch{}}
}
await sharedStorage();
await fileHandoff();
await kappaHandoff();
await svixCross();
await writeAsCross();
await pasteGgCross();
await Promise.all([mqttCross("ConnectMQ","wss://broker.connectmq.com:8084/mqtt",100),mqttCross("HiveMQ","wss://broker.hivemq.com:8884/mqtt"),mqttCross("Mosquitto","wss://test.mosquitto.org:8081"),mqttCross("EMQX","wss://broker.emqx.io:8084/mqtt",100)]);
await Promise.all([nostrCross("nos.lol","wss://nos.lol"),nostrCross("Primal","wss://relay.primal.net")]);
