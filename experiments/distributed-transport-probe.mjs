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
  const payload=rnd(1024).toString("base64"),start=Date.now();
  for(let i=0;i<20;i++){await pub({run,from:role,type:"data",seq:i,payload});await wait(interval)}
  await poll(async()=>got.size>=20?true:null,15000);
  log("CrossRunner-MQTT-"+name,"PASS",{remotePackets:got.size,packetBytes:1024,elapsedMs:Date.now()-start});
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
await Promise.all([mqttCross("ConnectMQ","wss://broker.connectmq.com:8084/mqtt",100),mqttCross("HiveMQ","wss://broker.hivemq.com:8884/mqtt"),mqttCross("Mosquitto","wss://test.mosquitto.org:8081"),mqttCross("EMQX","wss://broker.emqx.io:8084/mqtt",100)]);
await Promise.all([nostrCross("nos.lol","wss://nos.lol"),nostrCross("Primal","wss://relay.primal.net")]);
