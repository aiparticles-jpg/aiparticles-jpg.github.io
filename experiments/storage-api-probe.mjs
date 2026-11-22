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
  browser=await chromium.launch({headless:true,args:["--autoplay-policy=no-user-gesture-required","--use-fake-device-for-media-stream","--use-fake-ui-for-media-stream"]});
  page=await browser.newPage();
  await page.goto(ORIGIN,{waitUntil:"domcontentloaded",timeout:30000});
  report("BrowserOrigin","PASS",{origin:await page.evaluate(()=>location.origin)});
  async function workerProbe(name,base,healthPath,turnPath){
    if(healthPath) await isolated(name+"-Health-CORS",async()=>{
      const x=await page.evaluate(async({base,healthPath})=>{
        const r=await fetch(base+healthPath,{cache:"no-store"});
        const body=await r.text();
        return {httpStatus:r.status,body:body.slice(0,160)};
      },{base,healthPath});
      return {pass:x.httpStatus===200,details:x};
    });
    if(turnPath){
      await isolated(name+"-Turn-Credentials-CORS",async()=>{
        const x=await page.evaluate(async({base,turnPath})=>{
          const pre=await fetch(base+turnPath,{method:"OPTIONS",headers:{
            "Access-Control-Request-Method":"POST",
            "Access-Control-Request-Headers":"content-type"
          }});
          const preflight={httpStatus:pre.status};
          if(pre.status<200||pre.status>=300)return {preflight};
          const r=await fetch(base+turnPath,{method:"POST",headers:{"Content-Type":"application/json"},body:"{}"});
          const body=await r.text();let j;try{j=JSON.parse(body)}catch{}
          const urls=(j?.iceServers??[]).flatMap(s=>Array.isArray(s.urls)?s.urls:[s.urls]).filter(Boolean);
          return {preflight,httpStatus:r.status,
            hasIceServers:urls.length>0,urls:urls.map(u=>String(u).replace(/^(turns?:)[^?]+/,"$1<host>")),
            expiresAt:j?.expiresAt,body:body.slice(0,180)};
        },{base,turnPath});
        return {pass:x.preflight?.httpStatus>=200&&x.preflight?.httpStatus<300&&x.httpStatus===200&&x.hasIceServers,details:x};
      });
    }
    if(turnPath) await isolated(name+"-Forced-TURN-Relay",async()=>{
      const x=await page.evaluate(async({base,turnPath})=>{
        const r=await fetch(base+turnPath,{method:"POST",headers:{"Content-Type":"application/json"},body:"{}"});
        if(!r.ok)return {httpStatus:r.status,body:(await r.text()).slice(0,160)};
        const j=await r.json(),iceServers=j.iceServers??[];
        const config={iceServers,iceTransportPolicy:"relay"};
        const a=new RTCPeerConnection(config),b=new RTCPeerConnection(config);
        const audioContext=new AudioContext();
        const oscillator=audioContext.createOscillator();
        const audioDestination=audioContext.createMediaStreamDestination();
        oscillator.frequency.value=440;oscillator.connect(audioDestination);oscillator.start();
        await audioContext.resume();
        a.addTrack(audioDestination.stream.getAudioTracks()[0],audioDestination.stream);
        let remoteAudioTrack=false,queuedA=[],queuedB=[];
        a.onicecandidate=e=>{if(e.candidate){if(b.remoteDescription)b.addIceCandidate(e.candidate).catch(()=>{});else queuedA.push(e.candidate)}};
        b.onicecandidate=e=>{if(e.candidate){if(a.remoteDescription)a.addIceCandidate(e.candidate).catch(()=>{});else queuedB.push(e.candidate)}};
        b.ontrack=e=>{if(e.track.kind==="audio")remoteAudioTrack=true};
        const dc=a.createDataChannel("relay-probe");
        let gotMessage=false;
        let resolveOpen,resolveMessage;
        const opened=new Promise((resolve,reject)=>{resolveOpen=resolve;setTimeout(()=>reject(Error("datachannel open timeout")),30000)});
        const received=new Promise((resolve,reject)=>{resolveMessage=resolve;setTimeout(()=>reject(Error("datachannel message timeout")),30000)});
        dc.onopen=()=>resolveOpen();
        b.ondatachannel=e=>{e.channel.onmessage=ev=>{gotMessage=ev.data==="VL-TURN-RELAY-PROBE";resolveMessage()}};
        try{
          const offer=await a.createOffer();await a.setLocalDescription(offer);await b.setRemoteDescription(a.localDescription);
          for(const candidate of queuedA)await b.addIceCandidate(candidate);queuedA=[];
          const answer=await b.createAnswer();await b.setLocalDescription(answer);await a.setRemoteDescription(b.localDescription);
          for(const candidate of queuedB)await a.addIceCandidate(candidate);queuedB=[];
          await opened;dc.send("VL-TURN-RELAY-PROBE");await received;
          await new Promise(resolve=>setTimeout(resolve,1500));
          const stats=await a.getStats();let pair;
          for(const s of stats.values())if(s.type==="transport"&&s.selectedCandidatePairId)pair=stats.get(s.selectedCandidatePairId);
          if(!pair)for(const s of stats.values())if(s.type==="candidate-pair"&&s.state==="succeeded"&&s.nominated)pair=s;
          const local=pair?stats.get(pair.localCandidateId):null,remote=pair?stats.get(pair.remoteCandidateId):null;
          const remoteStats=await b.getStats();
          const audioBytesReceived=[...remoteStats.values()].filter(s=>s.type==="inbound-rtp"&&(s.kind==="audio"||s.mediaType==="audio")).reduce((n,s)=>n+(s.bytesReceived??0),0);
          return {httpStatus:r.status,iceServerCount:iceServers.length,messageReceived:gotMessage,
            audioTrackReceived:remoteAudioTrack,audioBytesReceived,
            localCandidateType:local?.candidateType??null,remoteCandidateType:remote?.candidateType??null,
            protocol:local?.protocol??null,forcedRelay:local?.candidateType==="relay"&&remote?.candidateType==="relay"};
        }finally{a.close();b.close();oscillator.stop();await audioContext.close()}
      },{base,turnPath});
      return {pass:x.httpStatus===200&&x.messageReceived&&x.forcedRelay&&x.audioTrackReceived&&x.audioBytesReceived>0,details:x};
    });
  }
  await workerProbe("CopyPaesto-Worker","https://copypaesto-relay.albyaty.workers.dev","/health",null);
  await workerProbe("Weblink-Worker","https://ws.webl.ink",null,"/turn-credentials");
  await isolated("YSTP-Public-Worker-Same-Origin-Streaming-File-Relay",async()=>{
    const ystpPage=await browser.newPage();
    await ystpPage.goto("https://ystp.dbk.wtf/");
    const x=await ystpPage.evaluate(async()=>{
      const wsBase=location.origin.replace(/^https:/,"wss:");
      const wait=ms=>new Promise(r=>setTimeout(r,ms));
      const timed=(promise,label,ms=25000)=>Promise.race([promise,new Promise((_,reject)=>setTimeout(()=>reject(Error(label+" timeout")),ms))]);
      const sender=new WebSocket(wsBase+"/send");
      await timed(new Promise((resolve,reject)=>{sender.onopen=resolve;sender.onerror=()=>reject(Error("sender websocket error"))}),"sender open");
      const code=await timed(new Promise((resolve,reject)=>{sender.onmessage=e=>{try{const j=JSON.parse(e.data);if(j.code)resolve(j.code)}catch{}}}),"session code");
      await wait(250);
      const size=1024*1024, payload=new Uint8Array(size);for(let i=0;i<size;i+=65536)payload.set(crypto.getRandomValues(new Uint8Array(Math.min(65536,size-i))),i);
      const digest=async bytes=>Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256",bytes))).map(x=>x.toString(16).padStart(2,"0")).join("");
      const expectedHash=await digest(payload);
      let sentBytes=0,senderDone=false,firstChunk=null,receivedBytes=0,metadata=null;
      const receiver=new WebSocket(wsBase+"/receive/"+encodeURIComponent(code));
      receiver.binaryType="arraybuffer";
      await timed(new Promise((resolve,reject)=>{receiver.onopen=resolve;receiver.onerror=()=>reject(Error("receiver websocket error"))}),"receiver open");
      let resolveMeta,resolveFirst,resolveComplete;
      const metaPromise=new Promise(resolve=>resolveMeta=resolve);
      const firstPromise=new Promise(resolve=>resolveFirst=resolve);
      const completePromise=new Promise(resolve=>resolveComplete=resolve);
      const chunks=[];
      receiver.onmessage=e=>{
        if(typeof e.data==="string"){
          if(!metadata){try{metadata=JSON.parse(e.data);resolveMeta(metadata)}catch{}}
          else if(e.data==="EOF")resolveComplete();
        }else{
          const part=new Uint8Array(e.data);chunks.push(part);receivedBytes+=part.byteLength;
          if(!firstChunk){firstChunk={receivedAtBytes:receivedBytes,senderBytesSent:sentBytes,senderAlreadyFinished:senderDone};resolveFirst(firstChunk)}
        }
      };
      sender.send(JSON.stringify({name:"vl-stream-probe.bin",size}));
      await wait(100);
      const meta=await timed(metaPromise,"receiver metadata");
      await wait(250);
      const senderReady=timed(new Promise((resolve,reject)=>{sender.onmessage=e=>{if(e.data==="LET_IT_RIP")resolve();else if(e.data==="ERROR")reject(Error("sender rejected"))}}),"sender approval");
      receiver.send("LET_IT_RIP");
      await senderReady;
      const chunkSize=64*1024;
      for(let offset=0;offset<size;offset+=chunkSize){
        const part=payload.slice(offset,Math.min(size,offset+chunkSize));
        sender.send(part.buffer);sentBytes+=part.byteLength;
        await wait(80);
      }
      sender.send("EOF");senderDone=true;
      await timed(completePromise,"receiver EOF");
      await timed(firstPromise,"first chunk");
      const received=new Uint8Array(receivedBytes);let offset=0;
      for(const part of chunks){received.set(part,offset);offset+=part.byteLength}
      const actualHash=await digest(received);
      sender.close();receiver.close();
      return {codeLength:code.length,metadataSize:meta.size,bytesSent:sentBytes,bytesReceived:receivedBytes,
        firstChunk,hashMatch:actualHash===expectedHash,chunkCount:chunks.length};
    });
    await ystpPage.close();
    return {pass:x.metadataSize===1048576&&x.bytesSent===1048576&&x.bytesReceived===1048576&&
      x.firstChunk?.senderAlreadyFinished===false&&x.firstChunk?.senderBytesSent<1048576&&x.hashMatch,details:x};
  });
  await isolated("Mazupo-Cloudflare-SFU-Public-Key-Tokens",async()=>{
    const x=await page.evaluate(async()=>{
      const base="https://api.mazupo.com/sfu";
      const deviceKey="1L4-mUUztDWhzF_ORhPHb4xpQK2Y9bEgeif0pYn7PXI";
      const viewerKey="-706d13ForZLHmv6FwARf9ZgEEfO78AattyxWhNoHFo";
      const room="vlprobe-"+crypto.randomUUID().replaceAll("-","").slice(0,18);
      const secret=crypto.randomUUID()+crypto.randomUUID();
      async function token(key,body){
        const r=await fetch(base+"/token",{method:"POST",headers:{
          "Authorization":"Bearer "+key,"Content-Type":"application/json"
        },body:JSON.stringify(body)});
        const txt=await r.text();let j;try{j=JSON.parse(txt)}catch{}
        return {httpStatus:r.status,tokenIssued:!!j?.token,expiresIn:j?.expires_in,
          websocketOrigin:j?.url?new URL(j.url).origin:null,error:j?.error?.code??null,body:txt.slice(0,120)};
      }
      const device=await token(deviceKey,{device_id:room+"-dev",room_ids:[room],can_subscribe:false,secret});
      const viewer=await token(viewerKey,{viewer_id:room+"-view",room_id:room,can_subscribe:true,secret});
      return {device,viewer,roomLength:room.length};
    });
    return {pass:x.device.httpStatus===200&&x.viewer.httpStatus===200&&x.device.tokenIssued&&x.viewer.tokenIssued&&
      x.device.expiresIn===30&&x.viewer.expiresIn===30,details:x};
  });
  await isolated("Mazupo-Public-SFU-Binary-DataChannel-Streaming",async()=>{
    let devicePage,viewerPage;
    try{
      const room="vl-"+Date.now().toString(36);
      const deviceId="vl-device-"+Date.now().toString(36);
      const deviceKey="1L4-mUUztDWhzF_ORhPHb4xpQK2Y9bEgeif0pYn7PXI";
      const viewerKey="-706d13ForZLHmv6FwARf9ZgEEfO78AattyxWhNoHFo";
      const capture=()=>{window.__vlChannels=[];const original=RTCPeerConnection.prototype.createDataChannel;
        RTCPeerConnection.prototype.createDataChannel=function(...args){const ch=original.apply(this,args);window.__vlChannels.push(ch);return ch}};
      devicePage=await browser.newPage();viewerPage=await browser.newPage();
      await devicePage.addInitScript(capture);await viewerPage.addInitScript(capture);
      await Promise.all([devicePage.goto("https://api.mazupo.com/sfu/device"),viewerPage.goto("https://api.mazupo.com/sfu/")]);
      await devicePage.locator("#api-url").fill("https://api.mazupo.com/sfu");
      await devicePage.locator("#device-key").fill(deviceKey);
      await devicePage.locator("#device-id").fill(deviceId);
      await devicePage.locator("#rooms").fill(room);
      await devicePage.locator("#source").selectOption("pattern");
      await devicePage.locator("#ipc").check();
      await devicePage.locator("#connect").click();
      await devicePage.waitForFunction(()=>document.querySelector("#status")?.textContent.includes("Connected as"),null,{timeout:25000});
      await viewerPage.locator("#api-url").fill("https://api.mazupo.com/sfu");
      await viewerPage.locator("#viewer-key").fill(viewerKey);
      await viewerPage.locator("#room").fill(room);
      await viewerPage.locator("#ipc").check();
      await viewerPage.locator("#join").click();
      await viewerPage.locator('#tiles [data-action="take"]').first().waitFor({state:"visible",timeout:25000});
      await Promise.all([
        devicePage.waitForFunction(()=>window.__vlChannels?.some(c=>c.label==="_reliable"&&c.readyState==="open"),null,{timeout:25000}),
        viewerPage.waitForFunction(()=>window.__vlChannels?.some(c=>c.label==="_reliable"&&c.readyState==="open"),null,{timeout:25000})
      ]);
      await viewerPage.locator('#tiles [data-action="take"]').first().click();
      await viewerPage.waitForFunction(()=>[...document.querySelectorAll("#tiles .control")].some(e=>e.textContent.includes("You control this device")),null,{timeout:15000});
      async function attachReceiver(page){
        await page.evaluate(()=>{
          window.__vlReceivedBytes=0;window.__vlSum=0;window.__vlFirst=null;window.__vlSentBytes=0;
          const ch=[...(window.__vlChannels??[])].reverse().find(c=>c.label==="_reliable"&&c.readyState==="open");
          if(!ch)throw Error("reliable DataChannel not open");
          ch.addEventListener("message",event=>{
            if(!(event.data instanceof ArrayBuffer))return;
            const bytes=new Uint8Array(event.data);
            if(!window.__vlFirst)window.__vlFirst={senderBytesAtFirst:window.__vlSentBytes,chunkBytes:bytes.length};
            for(const byte of bytes)window.__vlSum=(window.__vlSum+byte)>>>0;
            window.__vlReceivedBytes+=bytes.length;
          });
        });
      }
      async function transfer(senderPage,receiverPage){
        const size=256*1024,chunkSize=16*1024;
        let expectedSum=0;
        const chunks=[];
        for(let offset=0;offset<size;offset+=chunkSize){
          const bytes=Buffer.alloc(chunkSize);
          for(let i=0;i<chunkSize;i++){const value=((offset+i)*31+7)&255;bytes[i]=value;expectedSum=(expectedSum+value)>>>0}
          chunks.push(bytes.toString("base64"));
        }
        await attachReceiver(receiverPage);
        let sent=0;
        for(const encoded of chunks){
          sent+=chunkSize;
          await receiverPage.evaluate(value=>{window.__vlSentBytes=value},sent);
          await senderPage.evaluate(encoded=>{
            const ch=[...(window.__vlChannels??[])].reverse().find(c=>c.label==="_reliable"&&c.readyState==="open");
            if(!ch)throw Error("sender reliable DataChannel closed");
            const bytes=Uint8Array.from(atob(encoded),c=>c.charCodeAt(0));ch.send(bytes.buffer);
          },encoded);
          await receiverPage.waitForFunction(expected=>window.__vlReceivedBytes>=expected,sent,{timeout:15000});
        }
        const result=await receiverPage.evaluate(()=>({bytes:window.__vlReceivedBytes,sum:window.__vlSum,first:window.__vlFirst}));
        return {pass:result.bytes===size&&result.sum===expectedSum&&result.first?.senderBytesAtFirst<size,
          sent:size,expectedSum,result};
      }
      const viewerToDevice=await transfer(viewerPage,devicePage);
      const deviceToViewer=await transfer(devicePage,viewerPage);
      const video=await viewerPage.evaluate(()=>{const v=document.querySelector("#tiles video");return v?{width:v.videoWidth,height:v.videoHeight}:null});
      return {pass:viewerToDevice.pass&&deviceToViewer.pass&&!!video?.width,roomLength:room.length,
        viewerToDevice,deviceToViewer,video};
    }finally{
      await Promise.all([devicePage?.close().catch(()=>{}),viewerPage?.close().catch(()=>{})]);
    }
  });
  await isolated("CopyPaesto-Public-Worker-Forced-WebSocket-File-Relay",async()=>{
    let browser2,senderPage,receiverPage;
    try{
      browser2=await chromium.launch({headless:true,args:["--autoplay-policy=no-user-gesture-required"]});
      senderPage=await browser.newPage();receiverPage=await browser2.newPage();
      const instrumentSender=()=>{
        window.__vlWsBinarySent=0;window.__vlWsBinaryReceived=0;window.__vlWsUrls=[];
        const nativeSend=WebSocket.prototype.send;
        WebSocket.prototype.send=function(data){
          if(data instanceof ArrayBuffer){window.__vlWsBinarySent+=data.byteLength;const start=performance.now();while(performance.now()-start<5){}}
          else if(ArrayBuffer.isView(data))window.__vlWsBinarySent+=data.byteLength;
          return nativeSend.call(this,data);
        };
        const nativeAdd=WebSocket.prototype.addEventListener;
        WebSocket.prototype.addEventListener=function(type,listener,options){
          if(type!=="message")return nativeAdd.call(this,type,listener,options);
          const wrapped=function(event){
            if(event.data instanceof ArrayBuffer)window.__vlWsBinaryReceived+=event.data.byteLength;
            else if(event.data instanceof Blob)window.__vlWsBinaryReceived+=event.data.size;
            return listener.call(this,event);
          };
          return nativeAdd.call(this,type,wrapped,options);
        };
        const NativePC=window.RTCPeerConnection;
        window.RTCPeerConnection=new Proxy(NativePC,{construct(target,args){
          const config={...(args[0]||{}),iceTransportPolicy:"relay"};
          return Reflect.construct(target,[config,...args.slice(1)]);
        }});
      };
      const instrumentReceiver=()=>{
        try{Object.defineProperty(window,"showSaveFilePicker",{value:undefined,configurable:true})}catch{}
        window.__vlWsBinarySent=0;window.__vlWsBinaryReceived=0;window.__vlWsUrls=[];
        const nativeSend=WebSocket.prototype.send;
        WebSocket.prototype.send=function(data){
          if(data instanceof ArrayBuffer)window.__vlWsBinarySent+=data.byteLength;
          else if(ArrayBuffer.isView(data))window.__vlWsBinarySent+=data.byteLength;
          return nativeSend.call(this,data);
        };
        const nativeAdd=WebSocket.prototype.addEventListener;
        WebSocket.prototype.addEventListener=function(type,listener,options){
          if(type!=="message")return nativeAdd.call(this,type,listener,options);
          const wrapped=function(event){
            if(event.data instanceof ArrayBuffer)window.__vlWsBinaryReceived+=event.data.byteLength;
            else if(event.data instanceof Blob)window.__vlWsBinaryReceived+=event.data.size;
            return listener.call(this,event);
          };
          return nativeAdd.call(this,type,wrapped,options);
        };
        const NativePC=window.RTCPeerConnection;
        window.RTCPeerConnection=new Proxy(NativePC,{construct(target,args){
          const config={...(args[0]||{}),iceTransportPolicy:"relay"};
          return Reflect.construct(target,[config,...args.slice(1)]);
        }});
      };
      await senderPage.addInitScript(instrumentSender);await receiverPage.addInitScript(instrumentReceiver);
      const forceStun=async route=>{
        const headers={"access-control-allow-origin":"*","access-control-allow-methods":"POST, OPTIONS",
          "access-control-allow-headers":"authorization, content-type"};
        if(route.request().method()==="OPTIONS")return route.fulfill({status:204,headers});
        return route.fulfill({status:200,headers:{...headers,"content-type":"application/json"},
          body:JSON.stringify({iceServers:[{urls:"stun:stun.cloudflare.com:3478"}],relayAvailable:false})});
      };
      await senderPage.route("**/rooms/*/turn",forceStun);await receiverPage.route("**/rooms/*/turn",forceStun);
      await Promise.all([senderPage.goto("https://albyaty.github.io/CopyPaesto/"),receiverPage.goto("https://albyaty.github.io/CopyPaesto/")]);
      await senderPage.locator("#device-name").fill("VL probe sender");
      await senderPage.getByRole("button",{name:/Show pairing code/}).click();
      await senderPage.locator(".pairing-code-display").first().waitFor({state:"visible",timeout:15000});
      const pairingCode=(await senderPage.locator(".pairing-code-display").first().innerText()).replace(/\D/g,"");
      await receiverPage.getByRole("button",{name:/Join with a 5-digit code/}).click();
      await receiverPage.locator("#pairing-code").fill(pairingCode);
      await receiverPage.locator("#join-device-name").fill("VL probe receiver");
      await receiverPage.getByRole("button",{name:/Request connection/}).click();
      await senderPage.locator(".approve-button").waitFor({state:"visible",timeout:20000});
      await senderPage.locator(".approve-button").click();
      await Promise.all([
        senderPage.locator(".workspace").waitFor({state:"visible",timeout:20000}),
        receiverPage.locator(".workspace").waitFor({state:"visible",timeout:20000})
      ]);
      await senderPage.waitForFunction(()=>document.querySelector(".connection-badge")?.textContent.includes("2 devices"),null,{timeout:20000});
      const fileSize=40*1024*1024;
      const file=Buffer.alloc(fileSize,0x5a);
      receiverPage.on("download",()=>{});
      await senderPage.locator('input[type="file"]').setInputFiles({name:"vl-probe.bin",mimeType:"application/octet-stream",buffer:file});
      const receiverRow=receiverPage.locator(".transfer-row").filter({hasText:"vl-probe.bin"});
      await receiverRow.getByRole("button",{name:"Save"}).waitFor({state:"visible",timeout:20000});
      await receiverRow.getByRole("button",{name:"Save"}).click();
      const senderRow=senderPage.locator(".transfer-row").filter({hasText:"vl-probe.bin"});
      await senderRow.waitFor({state:"visible",timeout:15000});
      let early=null,peak={sent:0,received:0};
      const deadline=Date.now()+60000;
      while(Date.now()<deadline){
        const [sent,received]=await Promise.all([
          senderPage.evaluate(()=>window.__vlWsBinarySent??0),
          receiverPage.evaluate(()=>window.__vlWsBinaryReceived??0)
        ]);
        peak={sent:Math.max(peak.sent,sent),received:Math.max(peak.received,received)};
        if(received>0&&sent<fileSize){early={senderWsBytes:sent,receiverWsBytes:received};break}
        await new Promise(resolve=>setTimeout(resolve,100));
      }
      await receiverPage.waitForFunction(()=>[...document.querySelectorAll(".transfer-row")].some(row=>row.textContent.includes("vl-probe.bin")&&row.classList.contains("transfer-complete")),null,{timeout:90000}).catch(()=>{});
      const final=await Promise.all([
        senderPage.evaluate(()=>({binarySent:window.__vlWsBinarySent,rows:[...document.querySelectorAll(".transfer-row")].map(x=>x.innerText)})),
        receiverPage.evaluate(()=>({binaryReceived:window.__vlWsBinaryReceived,rows:[...document.querySelectorAll(".transfer-row")].map(x=>x.innerText)}))
      ]);
      return {pass:!!early&&peak.received>0,origin:"https://albyaty.github.io",fileSize,
        pairingCodeLength:pairingCode.length,early,peak,final,
        relaySocketObserved:final[0].binarySent>0&&final[1].binaryReceived>0};
    }finally{
      await Promise.all([senderPage?.close().catch(()=>{}),receiverPage?.close().catch(()=>{})]);
      await browser2?.close().catch(()=>{});
    }
  });
  await isolated("Mazupo-Public-SFU-Audio-RTP",async()=>{
    let devicePage,viewerPage;
    try{
      const room="vl-audio-"+Date.now().toString(36);
      const deviceId="vl-audio-device-"+Date.now().toString(36);
      const deviceKey="1L4-mUUztDWhzF_ORhPHb4xpQK2Y9bEgeif0pYn7PXI";
      const viewerKey="-706d13ForZLHmv6FwARf9ZgEEfO78AattyxWhNoHFo";
      const capture=()=>{window.__vlPCs=[];const Native=window.RTCPeerConnection;
        window.RTCPeerConnection=new Proxy(Native,{construct(target,args){const pc=Reflect.construct(target,args);window.__vlPCs.push(pc);return pc}})};
      devicePage=await browser.newPage();viewerPage=await browser.newPage();
      await devicePage.addInitScript(capture);await viewerPage.addInitScript(capture);
      await Promise.all([devicePage.goto("https://api.mazupo.com/sfu/device"),viewerPage.goto("https://api.mazupo.com/sfu/")]);
      await devicePage.locator("#api-url").fill("https://api.mazupo.com/sfu");
      await devicePage.locator("#device-key").fill(deviceKey);
      await devicePage.locator("#device-id").fill(deviceId);
      await devicePage.locator("#rooms").fill(room);
      await devicePage.locator("#source").selectOption("camera");
      await devicePage.locator("#connect").click();
      await devicePage.waitForFunction(()=>document.querySelector("#status")?.textContent.includes("Connected as"),null,{timeout:25000});
      await viewerPage.locator("#api-url").fill("https://api.mazupo.com/sfu");
      await viewerPage.locator("#viewer-key").fill(viewerKey);
      await viewerPage.locator("#room").fill(room);
      await viewerPage.locator("#join").click();
      await viewerPage.locator("#tiles video").first().waitFor({state:"visible",timeout:25000});
      await viewerPage.waitForFunction(()=>{const v=document.querySelector("#tiles video");return !!v&&v.videoWidth>0},null,{timeout:25000});
      await new Promise(resolve=>setTimeout(resolve,2500));
      const stats=await viewerPage.evaluate(async()=>{
        const audio=[],video=[];
        for(const pc of window.__vlPCs??[]){
          const report=await pc.getStats();
          for(const s of report.values()){
            if(s.type==="inbound-rtp"&&(s.kind==="audio"||s.mediaType==="audio"))audio.push({bytesReceived:s.bytesReceived??0,packetsReceived:s.packetsReceived??0,kind:s.kind??s.mediaType});
            if(s.type==="inbound-rtp"&&(s.kind==="video"||s.mediaType==="video"))video.push({bytesReceived:s.bytesReceived??0,framesDecoded:s.framesDecoded??0});
          }
        }
        const v=document.querySelector("#tiles video");
        return {pcCount:window.__vlPCs?.length??0,audio,video,videoElement:v?{width:v.videoWidth,height:v.videoHeight}:null};
      });
      return {pass:stats.audio.some(x=>x.bytesReceived>0)&&stats.video.some(x=>x.bytesReceived>0),roomLength:room.length,stats};
    }finally{await Promise.all([devicePage?.close().catch(()=>{}),viewerPage?.close().catch(()=>{})])}
  });
  await isolated("Uploadcare-Demo-Public-Key-Browser-Image-Upload",async()=>{
    const x=await page.evaluate(async()=>{
      const encoded="iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/t3cAAAAASUVORK5CYII=";
      const bytes=Uint8Array.from(atob(encoded),c=>c.charCodeAt(0));
      const form=new FormData();form.append("UPLOADCARE_PUB_KEY","demopublickey");form.append("UPLOADCARE_STORE","0");
      form.append("file",new Blob([bytes],{type:"image/png"}),"vl-probe.png");
      const upload=await fetch("https://upload.uploadcare.com/base/",{method:"POST",body:form});
      const body=await upload.text();let data;try{data=JSON.parse(body)}catch{data={raw:body}};
      const uuid=data.file??null;
      let cdnStatus=null,cdnBytes=0,cdnType=null;
      if(uuid){const cdn=await fetch("https://ucarecdn.com/"+uuid+"/");cdnStatus=cdn.status;cdnBytes=(await cdn.arrayBuffer()).byteLength;cdnType=cdn.headers.get("content-type")}
      return {httpStatus:upload.status,uuid,cdnStatus,cdnBytes,cdnType,response:data,sourceBytes:bytes.length};
    });
    return {pass:x.httpStatus===200&&!!x.uuid&&x.cdnStatus===200&&x.cdnBytes===x.sourceBytes,details:x};
  });
  await isolated("P2PCF-Public-Worker",async()=>{
    const x=await page.evaluate(async()=>{
      const r=await fetch("https://p2pcf.minddrop.workers.dev",{cache:"no-store"});
      const body=await r.text();
      return {status:r.status,acao:r.headers.get("access-control-allow-origin"),body:body.slice(0,180)};
    });
    return {pass:x.status===200&&!!x.acao,details:x};
  });
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
   return {set:s.status,read:g.status,firstMatch:t1===v1,overwrite:u.status,secondMatch:t2===v2,firstBody:t1.slice(0,100),secondBody:t2.slice(0,100),setBody:(await s.text()).slice(0,100),keyLength:key.length};
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
   const ht=await h.text();let hj;try{hj=JSON.parse(ht)}catch{};const found=(hj?.data??[]).some(e=>{try{return atob(e.body??"").includes(marker)}catch{return false}});
   return {tokenStatus:t.status,send:p.status,history:h.status,found,eventCount:hj?.data?.length,bodyEncoding:hj?.data?.[0]?.body?.slice(0,32)};
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
 await isolated("Browser-KeyVal-POST",async()=>{
  const x=await page.evaluate(async()=>{
   const key="vlprobe-"+crypto.randomUUID().replaceAll("-","").slice(0,24),v1="A".repeat(120),v2="B".repeat(120);
   const s=await fetch("https://api.keyval.org/set",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({key,val:v1})});
   const sj=await s.json();
   const g=await fetch("https://api.keyval.org/get",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({key})});
   const gj=await g.json();
   const u=await fetch("https://api.keyval.org/set",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({key,val:v2})});
   const uj=await u.json();
   const h=await fetch("https://api.keyval.org/get",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({key})});
   const hj=await h.json();
   return {set:s.status,setBody:sj,read:g.status,firstMatch:gj.val===v1,firstBody:gj,overwrite:u.status,overwriteBody:uj,secondMatch:hj.val===v2,secondBody:hj};
  });
  return {pass:x.firstMatch&&x.secondMatch,details:x};
 });
 await isolated("Browser-PasteGG",async()=>{
  const x=await page.evaluate(async()=>{
   const value="VL-PROBE-"+crypto.randomUUID()+"-"+"g".repeat(4096),expires=new Date(Date.now()+3600000).toISOString();
   const body={name:"VoiceLink probe",description:"temporary synthetic probe",visibility:"unlisted",expires,
    files:[{name:"probe.txt",content:{format:"text",value}}]};
   const p=await fetch("https://api.paste.gg/v1/pastes",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(body)});
   const pt=await p.text();let pj;try{pj=JSON.parse(pt)}catch{}
   const r=pj?.result??{},id=r.id,delkey=r.deletion_key;
   if(!p.ok||!id)return {create:p.status,body:pt.slice(0,180)};
   const g=await fetch("https://api.paste.gg/v1/pastes/"+id+"?full=true"),gt=await g.text();
   const match=gt.includes(value);
   let del=null;if(delkey){const d=await fetch("https://api.paste.gg/v1/pastes/"+id,{method:"DELETE",headers:{"Authorization":"Key "+delkey}});del=d.status}
   return {create:p.status,read:g.status,match,delete:del,expires:r.expires};
  });
  return {pass:x.create===201&&x.read===200&&x.match&&x.delete===204,details:x};
 });
 await isolated("Browser-PasteMyst-v3",async()=>{
  const x=await page.evaluate(async()=>{
   const value="VL-PROBE-"+crypto.randomUUID()+"-"+"m".repeat(2048);
   const p=await fetch("https://paste.myst.rs/api/v3/pastes",{method:"POST",headers:{"Content-Type":"application/json"},
    body:JSON.stringify({title:"VoiceLink probe",expiresIn:"1h",anonymous:true,pasties:[{title:"probe.txt",content:value,language:"Text"}]})});
   const pt=await p.text();let pj;try{pj=JSON.parse(pt)}catch{}
   const id=pj?.id??pj?.data?.id;
   if(!p.ok||!id)return {create:p.status,body:pt.slice(0,180)};
   const g=await fetch("https://paste.myst.rs/api/v3/pastes/"+encodeURIComponent(id)),gj=await g.json();
   const content=gj?.pasties?.[0]?.content??gj?.data?.pasties?.[0]?.content;
   return {create:p.status,read:g.status,match:content===value,id,expiresIn:gj?.expiresIn??gj?.data?.expiresIn};
  });
  return {pass:x.create===201&&x.read===200&&x.match,details:x};
 });
 await isolated("Browser-WriteAs-AnonymousPost",async()=>{
  const x=await page.evaluate(async()=>{
   const body1="VL-PROBE-"+crypto.randomUUID()+"-"+"w".repeat(2048),body2=body1+"-UPDATED";
   const p=await fetch("https://write.as/api/posts",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({body:body1,title:"VoiceLink anonymous probe"})});
   const pt=await p.text();let pj;try{pj=JSON.parse(pt)}catch{}
   const d=pj?.data??{},id=d.id,token=d.token;
   if(!p.ok||!id||!token)return {create:p.status,body:pt.slice(0,180)};
   const g=await fetch("https://write.as/api/posts/"+id),gj=await g.json();
   const u=await fetch("https://write.as/api/posts/"+id,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({token,body:body2})});
   const uj=await u.json();
   const h=await fetch("https://write.as/api/posts/"+id),hj=await h.json();
   const del=await fetch("https://write.as/api/posts/"+id+"?token="+encodeURIComponent(token),{method:"DELETE"});
   return {create:p.status,read:g.status,firstMatch:gj?.data?.body===body1,update:u.status,updated:uj?.data?.body===body2||uj?.data?.body===body2,secondMatch:hj?.data?.body===body2,delete:del.status,id};
  });
  return {pass:x.create===201&&x.read===200&&x.firstMatch&&x.update===200&&x.secondMatch&&x.delete===204,details:x};
 });
 await isolated("Browser-Telegraph-AnonymousAccount",async()=>{
  const x=await page.evaluate(async()=>{
   const form=o=>new URLSearchParams(Object.entries(o).map(([k,v])=>[k,typeof v==="string"?v:JSON.stringify(v)]));
   const a=await fetch("https://api.telegra.ph/createAccount",{method:"POST",headers:{"Content-Type":"application/x-www-form-urlencoded"},body:form({short_name:"VL"+crypto.randomUUID().slice(0,8),author_name:"Anonymous"})});
   const aj=await a.json(),token=aj?.result?.access_token;
   if(!a.ok||!aj.ok||!token)return {account:a.status,body:aj};
   const title="VL probe "+crypto.randomUUID(),text="VL-TELEGRAPH-"+crypto.randomUUID();
   const content=[{tag:"p",children:[text]}];
   const p=await fetch("https://api.telegra.ph/createPage",{method:"POST",headers:{"Content-Type":"application/x-www-form-urlencoded"},
    body:form({access_token:token,title,content,return_content:true})});
   const pj=await p.json(),path=pj?.result?.path;
   if(!p.ok||!pj.ok||!path)return {account:a.status,create:p.status,body:pj};
   const g=await fetch("https://api.telegra.ph/getPage",{method:"POST",headers:{"Content-Type":"application/x-www-form-urlencoded"},
    body:form({path,return_content:true})});
   const gj=await g.json(),flat=JSON.stringify(gj?.result?.content??[]);
   const revoke=await fetch("https://api.telegra.ph/revokeAccessToken",{method:"POST",headers:{"Content-Type":"application/x-www-form-urlencoded"},body:form({access_token:token})});
   return {account:a.status,create:p.status,read:g.status,found:flat.includes(text),revoke:revoke.status,pageCount:aj.result.page_count,path};
  });
  return {pass:x.create===200&&x.read===200&&x.found&&x.revoke===200,details:x};
 });
 await isolated("Browser-BpaSt-Pinnwand",async()=>{
  const x=await page.evaluate(async()=>{
   const value="VL-PROBE-"+crypto.randomUUID()+"-"+"p".repeat(2048);
   const p=await fetch("https://bpa.st/api/v1/paste",{method:"POST",headers:{"Content-Type":"application/json"},
    body:JSON.stringify({expiry:"1day",files:[{name:"probe.txt",lexer:"text",content:value}]})});
   const pt=await p.text();let pj;try{pj=JSON.parse(pt)}catch{}
   const link=pj?.link??pj?.result?.link??pj?.paste_url;
   const removal=pj?.removal??pj?.result?.removal??pj?.removal_url;
   if(!p.ok||!link)return {create:p.status,body:pt.slice(0,180)};
   const id=link.replace(/\/+$/,"").split("/").pop();
   const g=await fetch("https://bpa.st/api/v1/paste/"+encodeURIComponent(id));
   const gt=await g.text();
   let del=null;if(removal){const d=await fetch(removal);del=d.status}
   return {create:p.status,read:g.status,match:gt.includes(value),delete:del,link,body:gt.slice(0,100)};
  });
  return {pass:x.create===200&&x.read===200&&x.match,details:x};
 });
 await isolated("Browser-PB-Nekoid",async()=>{
  const x=await page.evaluate(async()=>{
   const data=crypto.getRandomValues(new Uint8Array(4096)),form=new FormData();
   form.append("u",new Blob([data],{type:"application/octet-stream"}),"vl-probe.bin");
   form.append("expired_at",String(Date.now()+3600000));
   const p=await fetch("https://pb.nekoid.cc/?json=1",{method:"POST",body:form});
   const pt=await p.text();let pj;try{pj=JSON.parse(pt)}catch{}
   const id=pj?.uuid;
   if(!p.ok||!id)return {upload:p.status,body:pt.slice(0,180)};
   const g=await fetch("https://pb.nekoid.cc/"+encodeURIComponent(id)+"/raw"),b=new Uint8Array(await g.arrayBuffer());
   const d=await fetch("https://pb.nekoid.cc/"+encodeURIComponent(id),{method:"DELETE"});
   return {upload:p.status,download:g.status,bytes:b.length,match:b.length===data.length&&b.every((v,i)=>v===data[i]),delete:d.status,expires:pj.expired};
  });
  return {pass:x.match===true&&x.delete>=200&&x.delete<300,details:x};
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
