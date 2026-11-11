import { STUN_URL } from "./config.js";

export class WebRtcAudio {
  constructor({ sendSignal, onRemoteStream, onState, onError, onRemoteHangup, initiator = false, diagnosticPilot = false }) {
    this.sendSignal = sendSignal;
    this.onRemoteStream = onRemoteStream;
    this.onState = onState || (() => {});
    this.onError = onError || (() => {});
    this.onRemoteHangup = onRemoteHangup || (() => {});
    this.initiator = initiator;
    this.micEnabled = false;
    this.callAccepted = false;
    this.controlChannel = null;
    this.pendingHangup = null;
    this.remoteHangupHandled = false;
    this.diagnosticPilot = diagnosticPilot;
    this.audioContext = null;
    this.audioContextResumePromise = null;
    // Create/resume the context while Connect is still running in the user's click
    // activation. The remote peer may answer much later, after autoplay activation expires.
    if (this.diagnosticPilot) {
      try {
        const AudioContextClass = window.AudioContext || window.webkitAudioContext;
        if (AudioContextClass) {
          this.audioContext = new AudioContextClass({ latencyHint: "interactive" });
          if (this.audioContext.state === "suspended") {
            this.audioContextResumePromise = this.audioContext.resume().catch(() => {});
          }
        }
      } catch (error) {
        this.onState("MIC SIMULATION: AudioContext init error: " + error.message);
      }
    }
    this.pc = null;
    this.pcDiagnosticId = null;
    this.diagnosticStartedAt = Date.now();
    this.audioSender = null;
    this.iceBatching = null;
    this.iceBatchTimers = [];
    this.localCandidateCount = 0;
    this.iceGatheringStartedAt = 0;
    this.iceGatheringCompletedAt = 0;
    this.lastIceCandidateAt = 0;
    this.iceCandidateErrorCount = 0;
    this.signalEnabled = false;
    this.pendingLocalCandidates = [];
    this.localStream = null;
    this.outgoingStream = null;
    this.pilotOscillator = null;
    this.remoteAnalyser = null;
    this.remoteAnalyserBuffer = null;
    this.pendingCandidates = [];
    this.remoteDescriptionSet = false;
    this.statsTimer = null;
    this.statsInProgress = false;
    this.previousRtpStats = new Map();
    this.previousIcePairStats = new Map();
  }

  async ensureMedia() {
    if (!this.localStream) {
      if (this.diagnosticPilot) {
        const AudioContextClass = window.AudioContext || window.webkitAudioContext;
        if (!AudioContextClass) throw new Error("Web Audio API недоступен для симуляции микрофона.");
        if (!this.audioContext) this.audioContext = new AudioContextClass({ latencyHint: "interactive" });
        if (this.audioContextResumePromise) await this.audioContextResumePromise;
        if (this.audioContext.state === "suspended") await this.audioContext.resume();
        const destination = this.audioContext.createMediaStreamDestination();
        const oscillator = this.audioContext.createOscillator();
        const gain = this.audioContext.createGain();
        oscillator.type = "sine";
        oscillator.frequency.value = 997;
        gain.gain.value = 0.025;
        oscillator.connect(gain);
        gain.connect(destination);
        oscillator.start();
        this.pilotOscillator = oscillator;
        this.localStream = destination.stream;
        this.outgoingStream = this.localStream;
        this.onState("Симуляция микрофона: генерируется тестовый тон 997 Hz; физический микрофон не используется.");
      } else {
        this.localStream = await navigator.mediaDevices.getUserMedia({
          audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
          video: false
        });
        this.onState("Физический микрофон: поток получен.");
      }
      const track = this.localStream.getAudioTracks()[0];
      if (track) {
        // Caller stays muted until the answerer confirms acceptance over DataChannel.
        track.enabled = this.micEnabled;
        this.onState("Аудиотрек: readyState=" + track.readyState + "; enabled=" + track.enabled);
      }
    }
    return this.localStream;
  }

  setCallAccepted(accepted) {
    this.callAccepted = !!accepted;
    if (this.callAccepted && this.controlChannel?.readyState === "open") {
      this.sendControl({ type: "ACCEPTED" });
    }
  }

  setMicEnabled(enabled) {
    this.micEnabled = !!enabled;
    if (this.localStream) {
      for (const track of this.localStream.getAudioTracks()) track.enabled = this.micEnabled;
    }
    this.onState("Микрофон " + (this.micEnabled ? "включён" : "ожидает подтверждения ответа"));
  }

  async prepareOutgoingStream() {
    // In simulation mode ensureMedia already returns a generated audio stream.
    // No physical microphone is opened and no additional track is mixed in.
    return this.ensureMedia();
  }

  attachRemoteMonitor(stream) {
    if (!this.diagnosticPilot || !this.audioContext || !stream) return;
    try {
      if (this.remoteAnalyser) {
        try { this.remoteAnalyser.disconnect(); } catch {}
      }
      const source = this.audioContext.createMediaStreamSource(stream);
      const analyser = this.audioContext.createAnalyser();
      analyser.fftSize = 4096;
      analyser.smoothingTimeConstant = 0.25;
      analyser.minDecibels = -100;
      analyser.maxDecibels = -10;
      source.connect(analyser);
      this.remoteAnalyser = analyser;
      this.remoteAnalyserBuffer = new Float32Array(analyser.frequencyBinCount);
      this.onState("MIC SIMULATION: анализатор подключён к входящему аудиопотоку.");
    } catch (error) {
      this.onState("MIC SIMULATION: ошибка анализатора: " + error.message);
    }
  }

  measureRemotePilot() {
    if (!this.remoteAnalyser || !this.remoteAnalyserBuffer || !this.audioContext) return null;
    this.remoteAnalyser.getFloatFrequencyData(this.remoteAnalyserBuffer);
    const sampleRate = this.audioContext.sampleRate;
    const minBin = Math.ceil(950 * this.remoteAnalyser.fftSize / sampleRate);
    const maxBin = Math.floor(1045 * this.remoteAnalyser.fftSize / sampleRate);
    let peak = -Infinity;
    for (let i = minBin; i <= maxBin; i++) {
      if (this.remoteAnalyserBuffer[i] > peak) peak = this.remoteAnalyserBuffer[i];
    }
    return Number.isFinite(peak) ? peak : null;
  }

  async createPeerConnection() {
    if(this.pc)return this.pc;
    const stream=await this.prepareOutgoingStream();
    const pc=new RTCPeerConnection({iceServers:[{urls:STUN_URL}],iceTransportPolicy:"all",iceCandidatePoolSize:0});
    this.pcDiagnosticId=Math.random().toString(36).slice(2,8);
    this.onState("PC["+this.pcDiagnosticId+"] created; initiator="+this.initiator+"; prewarm=false.");
    for(const track of stream.getAudioTracks())this.audioSender=pc.addTrack(track,stream);
    this.ensureControlChannel(pc);this.signalEnabled=true;
    pc.onicecandidate=event=>{
      if(event.candidate){
        this.lastIceCandidateAt=Date.now();this.localCandidateCount++;
        if(this.iceBatching&&!this.iceBatching.stopped)this.pendingLocalCandidates.push(event.candidate.toJSON());
        const elapsed=this.iceGatheringStartedAt?((Date.now()-this.iceGatheringStartedAt)/1000).toFixed(3)+"s":"n/a";
        this.onState("PC["+this.pcDiagnosticId+"] ICE candidate #"+this.localCandidateCount+
          "; type="+(event.candidate.type||"unknown")+"; protocol="+(event.candidate.protocol||"unknown")+
          "; local="+(event.candidate.address||"n/a")+":"+(event.candidate.port??"n/a")+
          "; related="+(event.candidate.relatedAddress?event.candidate.relatedAddress+":"+(event.candidate.relatedPort??"n/a"):"n/a")+
          "; elapsed="+elapsed+(this.iceBatching&&!this.iceBatching.stopped?"; queued for timed batch.":"; after 2s cutoff, not signaled."));
      }else{if(this.iceBatching)this.iceBatching.gatheringComplete=true;this.onState("PC["+this.pcDiagnosticId+"] ICE end-of-candidates; total="+this.localCandidateCount+".")}
    };
    pc.onicecandidateerror=event=>{
      this.iceCandidateErrorCount++;const address=event.address||"",family=address?(address.includes(":")?"IPv6":"IPv4"):"unknown";
      this.onState("PC["+this.pcDiagnosticId+"] ICE candidate error #"+this.iceCandidateErrorCount+
        "; code="+(event.errorCode||"unknown")+"; local="+(address||"n/a")+":"+((event.port??"n/a"))+
        " ("+family+"); url="+(event.url||"unknown")+"; text="+(event.errorText||"no details")+".");
    };
    pc.onicegatheringstatechange=()=>{
      if(pc.iceGatheringState==="gathering"&&!this.iceGatheringStartedAt){
        this.iceGatheringStartedAt=Date.now();if(this.iceBatching&&!this.iceBatching.startedAt)this.iceBatching.startedAt=this.iceGatheringStartedAt;
        this.onState("PC["+this.pcDiagnosticId+"] ICE gathering started.");
      }else if(pc.iceGatheringState==="complete"&&!this.iceGatheringCompletedAt){
        this.iceGatheringCompletedAt=Date.now();if(this.iceBatching)this.iceBatching.gatheringComplete=true;
        const elapsed=this.iceGatheringStartedAt?((this.iceGatheringCompletedAt-this.iceGatheringStartedAt)/1000).toFixed(3):"n/a";
        const since=this.lastIceCandidateAt?((this.iceGatheringCompletedAt-this.lastIceCandidateAt)/1000).toFixed(3)+"s":"n/a";
        this.onState("PC["+this.pcDiagnosticId+"] ICE gathering complete; duration="+elapsed+"s; candidates="+this.localCandidateCount+
          "; since-last-candidate="+since+"; candidate-errors="+this.iceCandidateErrorCount+".");
      }
    };
    pc.onsignalingstatechange=()=>this.onState("PC["+this.pcDiagnosticId+"] signaling-"+pc.signalingState+".");
    pc.oniceconnectionstatechange=()=>{const state=pc.iceConnectionState;this.onState("PC["+this.pcDiagnosticId+"] ice-"+state+".");if(this.signalEnabled)this.logSelectedCandidatePair("ice-"+state,pc)};
    pc.ontrack=event=>{const remoteStream=event.streams&&event.streams[0]?event.streams[0]:new MediaStream([event.track]);this.attachRemoteMonitor(remoteStream);this.onRemoteStream(remoteStream)};
    pc.onconnectionstatechange=()=>this.onState("PC["+this.pcDiagnosticId+"] connection-"+pc.connectionState+".");
    this.pc=pc;return pc;
  }

  async logSelectedCandidatePair(trigger, pc) {
    try {
      const stats = await pc.getStats();
      if (this.pc !== pc) return;
      const reports = Array.from(stats.values());
      let pair = null;
      for (const report of reports) {
        if (report.type === "transport" && report.selectedCandidatePairId) {
          pair = stats.get(report.selectedCandidatePairId);
          if (pair) break;
        }
      }
      if (!pair) {
        pair = reports.find(report =>
          report.type === "candidate-pair" &&
          (report.selected === true ||
            (report.nominated === true && report.state === "succeeded"))
        );
      }
      if (!pair) {
        this.onState("ICE pair [" + trigger + "]: выбранная пара пока не найдена");
        return;
      }
      const local = stats.get(pair.localCandidateId);
      const remote = stats.get(pair.remoteCandidateId);
      const describe = candidate => {
        if (!candidate) return "unknown";
        const parts = [(candidate.candidateType || "?") + "/" + (candidate.protocol || "?")];
        const address = candidate.address || candidate.ip;
        if (address) {
          parts.push(address + (Number.isFinite(candidate.port) ? ":" + candidate.port : ""));
        } else {
          parts.push("address=n/a" + (Number.isFinite(candidate.port) ? " port=" + candidate.port : ""));
        }
        if (candidate.relatedAddress || Number.isFinite(candidate.relatedPort)) {
          parts.push("related=" + (candidate.relatedAddress || "n/a") +
            (Number.isFinite(candidate.relatedPort) ? ":" + candidate.relatedPort : ""));
        }
        if (candidate.relayProtocol) parts.push("relay=" + candidate.relayProtocol);
        if (candidate.tcpType) parts.push("tcpType=" + candidate.tcpType);
        if (candidate.networkType) parts.push("network=" + candidate.networkType);
        if (candidate.url) parts.push("server=" + candidate.url);
        return parts.join(" ");
      };
      const rtt = Number.isFinite(pair.currentRoundTripTime)
        ? Math.round(pair.currentRoundTripTime * 1000) + " ms" : "n/a";
      const sent = Number.isFinite(pair.bytesSent) ? pair.bytesSent : "?";
      const received = Number.isFinite(pair.bytesReceived) ? pair.bytesReceived : "?";
      const route = local && remote
        ? (local.candidateType === "relay" || remote.candidateType === "relay" ? "TURN relay" : "direct (no TURN)")
        : "route unknown";
      const pairFields = ["state=" + (pair.state || "?"), "route=" + route];
      for (const [field, label] of [
        ["requestsSent", "requests"],
        ["responsesReceived", "responses"],
        ["consentRequestsSent", "consent"]
      ]) {
        if (Number.isFinite(pair[field])) pairFields.push(label + "=" + pair[field]);
      }
      if (Number.isFinite(pair.availableOutgoingBitrate)) {
        pairFields.push("available-out=" + Math.round(pair.availableOutgoingBitrate / 1000) + "kbps");
      }
      if (Number.isFinite(pair.availableIncomingBitrate)) {
        pairFields.push("available-in=" + Math.round(pair.availableIncomingBitrate / 1000) + "kbps");
      }
      this.onState("ICE pair [" + trigger + "]: local " + describe(local) +
        " ↔ remote " + describe(remote) + "; " + pairFields.join("; ") +
        "; RTT=" + rtt + "; bytes sent/received=" + sent + "/" + received);
    } catch (error) {
      this.onState("ICE pair [" + trigger + "]: getStats error: " + error.message);
    }
  }

  startStatsMonitoring(pc) {
    if (this.statsTimer) return;
    this.previousRtpStats.clear();
    this.previousIcePairStats.clear();
    this.statsTimer = setInterval(() => this.logMediaStats(pc), 1000);
  }

  async logMediaStats(pc) {
    if (this.statsInProgress || this.pc !== pc) return;
    this.statsInProgress = true;
    try {
      const stats = await pc.getStats();
      if (this.pc !== pc) return;
      const reports = Array.from(stats.values());
      const audioReports = reports.filter(report =>
        (report.type === "inbound-rtp" || report.type === "outbound-rtp") &&
        (report.kind === "audio" || report.mediaType === "audio")
      );
      const fields = [];

      for (const report of audioReports) {
        const previous = this.previousRtpStats.get(report.id);
        const packetField = report.type === "inbound-rtp" ? "packetsReceived" : "packetsSent";
        const packets = Number.isFinite(report[packetField]) ? report[packetField] : null;
        const delta = packets !== null && previous && Number.isFinite(previous[packetField])
          ? packets - previous[packetField] : null;
        const label = report.type === "inbound-rtp" ? "in" : "out";
        fields.push(label + " Δpkts=" + (delta === null ? "n/a" : delta));

        if (report.type === "inbound-rtp") {
          if (Number.isFinite(report.packetsLost)) fields.push("lost=" + report.packetsLost);
          if (Number.isFinite(report.jitter)) fields.push("jitter=" + (report.jitter * 1000).toFixed(1) + "ms");
        }
        if (Number.isFinite(report.audioLevel)) fields.push(label + " level=" + report.audioLevel.toFixed(3));

        const counterFields = report.type === "inbound-rtp"
          ? ["concealedSamples", "concealmentEvents"]
          : [];
        for (const field of counterFields) {
          if (!Number.isFinite(report[field])) continue;
          const d = previous && Number.isFinite(previous[field]) ? report[field] - previous[field] : null;
          fields.push(field + " Δ=" + (d === null ? "n/a" : d));
        }

        if (report.type === "inbound-rtp" &&
            Number.isFinite(report.jitterBufferDelay) &&
            Number.isFinite(report.jitterBufferEmittedCount) &&
            previous &&
            Number.isFinite(previous.jitterBufferDelay) &&
            Number.isFinite(previous.jitterBufferEmittedCount)) {
          const delayDelta = report.jitterBufferDelay - previous.jitterBufferDelay;
          const emittedDelta = report.jitterBufferEmittedCount - previous.jitterBufferEmittedCount;
          if (emittedDelta > 0 && delayDelta >= 0) {
            fields.push("jitterBuffer≈" + (delayDelta / emittedDelta * 1000).toFixed(1) + "ms");
          }
        }

        this.previousRtpStats.set(report.id, {
          packetsReceived: report.packetsReceived,
          packetsSent: report.packetsSent,
          concealedSamples: report.concealedSamples,
          concealmentEvents: report.concealmentEvents,
          jitterBufferDelay: report.jitterBufferDelay,
          jitterBufferEmittedCount: report.jitterBufferEmittedCount
        });
      }

      const pilotDb = this.measureRemotePilot();
      if (this.diagnosticPilot) {
        fields.push("remotePilot=" + (pilotDb === null ? "n/a" : pilotDb.toFixed(1) + "dBFS"));
      }

      const pair = reports.find(report =>
        report.type === "candidate-pair" &&
        (report.selected === true ||
          (report.nominated === true && report.state === "succeeded"))
      );
      if (pair) {
        const previous = this.previousIcePairStats.get(pair.id);
        for (const [field, label] of [
          ["requestsSent", "ICE req→"],
          ["responsesReceived", "ICE resp←"],
          ["consentRequestsSent", "consent→"]
        ]) {
          if (!Number.isFinite(pair[field])) continue;
          const d = previous && Number.isFinite(previous[field]) ? pair[field] - previous[field] : null;
          fields.push(label + " Δ=" + (d === null ? "n/a" : d));
        }
        this.previousIcePairStats.set(pair.id, {
          requestsSent: pair.requestsSent,
          responsesReceived: pair.responsesReceived,
          consentRequestsSent: pair.consentRequestsSent
        });
      }

      const remoteInbound = reports.find(report =>
        report.type === "remote-inbound-rtp" &&
        (report.kind === "audio" || report.mediaType === "audio")
      );
      if (remoteInbound && Number.isFinite(remoteInbound.roundTripTime)) {
        fields.push("remoteRTT=" + Math.round(remoteInbound.roundTripTime * 1000) + "ms");
      }
      if (pair && Number.isFinite(pair.currentRoundTripTime)) {
        fields.push("ICE-RTT=" + Math.round(pair.currentRoundTripTime * 1000) + "ms");
      }

      this.onState("RTP stats [" + pc.iceConnectionState + "/" + pc.connectionState + "]: " +
        (fields.length ? fields.join("; ") : "аудиостатистика пока недоступна"));
    } catch (error) {
      this.onState("RTP stats: getStats error: " + error.message);
    } finally {
      this.statsInProgress = false;
    }
  }

  ensureControlChannel(pc) {
    if (this.initiator) {
      if (!this.controlChannel) {
        this.bindControlChannel(pc.createDataChannel("voice-control", { ordered: true }));
      }
    } else {
      pc.ondatachannel = event => {
        if (event.channel.label === "voice-control") this.bindControlChannel(event.channel);
        else event.channel.close();
      };
    }
  }

  bindControlChannel(channel) {
    this.controlChannel = channel;
    channel.onopen = () => {
      this.onState("control-open");
      if (this.callAccepted) this.sendControl({ type: "ACCEPTED" });
    };
    channel.onmessage = event => this.handleControlMessage(event.data);
    channel.onerror = () => this.onState("control-error");
    channel.onclose = () => {
      if (this.controlChannel === channel) this.controlChannel = null;
      this.onState("control-closed");
    };
  }

  sendControl(message) {
    const channel = this.controlChannel;
    if (!channel || channel.readyState !== "open") return false;
    try {
      channel.send(JSON.stringify(message));
      return true;
    } catch (error) {
      this.onState("control-send-error: " + error.message);
      return false;
    }
  }

  isControlOpen() {
    return !!this.controlChannel && this.controlChannel.readyState === "open";
  }

  handleControlMessage(raw) {
    let message;
    try { message = JSON.parse(raw); } catch { return; }
    if (!message || typeof message.type !== "string") return;

    if (message.type === "ACCEPTED") {
      this.setMicEnabled(true);
      this.onState("Собеседник ответил; микрофон включён.");
      return;
    }

    if (message.type === "HANGUP" && typeof message.id === "string") {
      this.sendControl({ type: "HANGUP_ACK", id: message.id });
      this.onState("Получено уведомление о завершении звонка.");
      if (!this.remoteHangupHandled) {
        this.remoteHangupHandled = true;
        setTimeout(() => this.onRemoteHangup(), 250);
      }
      return;
    }

    if (message.type === "HANGUP_ACK" && this.pendingHangup &&
        message.id === this.pendingHangup.id) {
      const pending = this.pendingHangup;
      this.pendingHangup = null;
      clearTimeout(pending.timer);
      pending.resolve(true);
    }
  }

  async sendHangup(timeoutMs = 1200) {
    if (!this.isControlOpen()) return false;
    if (this.pendingHangup) return this.pendingHangup.promise;
    const id = Array.from(crypto.getRandomValues(new Uint8Array(12)),
      value => value.toString(16).padStart(2, "0")).join("");
    let resolveResult;
    const promise = new Promise(resolve => { resolveResult = resolve; });
    const timer = setTimeout(() => {
      if (!this.pendingHangup || this.pendingHangup.id !== id) return;
      this.pendingHangup = null;
      resolveResult(false);
    }, timeoutMs);
    this.pendingHangup = { id, timer, resolve: resolveResult, promise };
    if (!this.sendControl({ type: "HANGUP", id })) {
      clearTimeout(timer);
      this.pendingHangup = null;
      resolveResult(false);
    }
    return promise;
  }

  beginIceBatching(pc,description){
    this.cancelIceBatching();
    const sdp=String(description.sdp||"").replace(/^a=candidate:[^\\r\\n]*(?:\\r?\\n)?/gm,"").replace(/^a=end-of-candidates\\r?\\n?/gm,"");
    this.pendingLocalCandidates=[];this.localCandidateCount=0;
    this.iceBatching={pc,description:{type:description.type,sdp},startedAt:0,gatheringComplete:false,stopped:false,sendQueue:Promise.resolve()};
  }
  scheduleIceBatches(pc){
    const batch=this.iceBatching;if(!batch||batch.pc!==pc)throw Error("ICE batch generation is unavailable.");
    if(!batch.startedAt)batch.startedAt=this.iceGatheringStartedAt||Date.now();
    const elapsed=Date.now()-batch.startedAt;
    this.onState("PC["+this.pcDiagnosticId+"] timed ICE signaling scheduled at 200/500/2000ms; gathering is not awaited.");
    [200,500,2000].forEach((cutoff,index)=>this.iceBatchTimers.push(setTimeout(()=>this.flushIceBatch(index+1,batch).catch(error=>this.onError(error)),Math.max(0,cutoff-elapsed))));
  }
  async flushIceBatch(index,batch){
    if(this.iceBatching!==batch||batch.stopped||this.pc!==batch.pc)return;
    const candidates=this.pendingLocalCandidates.splice(0),end=batch.gatheringComplete||index===3;
    if(end){batch.stopped=true;this.iceBatchTimers.forEach(clearTimeout);this.iceBatchTimers=[];}
    let payload=null;
    if(index===1)payload={description:batch.description,candidates,...(end?{endOfCandidates:true}:{})};
    else if(candidates.length||end)payload={candidates,...(end?{endOfCandidates:true}:{})};
    if(!payload){this.onState("PC["+this.pcDiagnosticId+"] ICE batch "+index+" skipped: no new candidates.");return;}
    this.onState("PC["+this.pcDiagnosticId+"] sending ICE batch "+index+"; elapsed="+(Date.now()-batch.startedAt)+"ms; candidates="+candidates.length+"; endOfCandidates="+end+".");
    const send=async()=>{if(this.iceBatching!==batch&&index!==1)return;await this.sendSignal(payload)};
    batch.sendQueue=batch.sendQueue.then(send,send).catch(error=>this.onError(new Error("Не удалось передать ICE-пакет "+index+": "+(error.message||String(error)))));
    await batch.sendQueue;
    if(end)this.onState("PC["+this.pcDiagnosticId+"] ICE signaling cutoff reached; later local candidates will not be sent.");
  }
  cancelIceBatching(){
    this.iceBatchTimers.forEach(clearTimeout);this.iceBatchTimers=[];
    if(this.iceBatching)this.iceBatching.stopped=true;
    this.iceBatching=null;this.pendingLocalCandidates=[];
  }
  async createOffer(){
    const pc=await this.createPeerConnection();this.onState("PC["+this.pcDiagnosticId+"] createOffer started.");
    const offer=await pc.createOffer();this.beginIceBatching(pc,offer);await pc.setLocalDescription(offer);this.scheduleIceBatches(pc);
  }
  async handleSignal(payload){
    const pc=await this.createPeerConnection(),candidates=Array.isArray(payload.candidates)?payload.candidates:[];
    this.onState("PC["+this.pcDiagnosticId+"] handleSignal entered; description="+(payload.description?.type||"none")+"; candidates="+candidates.length+"; legacyCandidate="+!!payload.candidate+"; endOfCandidates="+!!payload.endOfCandidates+".");
    if(payload.description){
      const description=payload.description;
      this.onState("PC["+this.pcDiagnosticId+"] setRemoteDescription("+description.type+") started; SDP chars="+(description.sdp?.length||0)+".");
      await pc.setRemoteDescription(description);this.onState("PC["+this.pcDiagnosticId+"] setRemoteDescription("+description.type+") completed.");
      this.remoteDescriptionSet=true;
      while(this.pendingCandidates.length)await pc.addIceCandidate(this.pendingCandidates.shift());
      for(const candidate of candidates)await pc.addIceCandidate(candidate);
      if(payload.candidate)await pc.addIceCandidate(payload.candidate);
      if(payload.endOfCandidates)await pc.addIceCandidate(null);
      if(description.type==="offer"){
        this.onState("PC["+this.pcDiagnosticId+"] createAnswer started.");
        const answer=await pc.createAnswer();this.beginIceBatching(pc,answer);await pc.setLocalDescription(answer);this.scheduleIceBatches(pc);
      }
    }else if(candidates.length||payload.candidate||payload.endOfCandidates){
      if(this.remoteDescriptionSet){
        for(const candidate of candidates)await pc.addIceCandidate(candidate);
        if(payload.candidate)await pc.addIceCandidate(payload.candidate);
        if(payload.endOfCandidates)await pc.addIceCandidate(null);
      }else{
        this.pendingCandidates.push(...candidates);if(payload.candidate)this.pendingCandidates.push(payload.candidate);if(payload.endOfCandidates)this.pendingCandidates.push(null);
        this.onState("PC["+this.pcDiagnosticId+"] remote ICE batch queued until remote SDP is set; queued="+this.pendingCandidates.length+".");
      }
    }
  }

  async close({ stopTracks = false } = {}) {
    this.cancelIceBatching();
    if (this.statsTimer) {
      clearInterval(this.statsTimer);
      this.statsTimer = null;
    }
    this.previousRtpStats.clear();
    this.previousIcePairStats.clear();
    if (this.pendingHangup) {
      clearTimeout(this.pendingHangup.timer);
      this.pendingHangup.resolve(false);
      this.pendingHangup = null;
    }
    if (this.controlChannel) {
      this.controlChannel.onopen = null;
      this.controlChannel.onmessage = null;
      this.controlChannel.onclose = null;
      try { this.controlChannel.close(); } catch {}
      this.controlChannel = null;
    }
    if (this.pc) {
      this.pc.ontrack = null;
      this.pc.ondatachannel = null;
      this.pc.close();
      this.pc = null;
    }
    if (this.pilotOscillator) {
      try { this.pilotOscillator.stop(); } catch {}
      this.pilotOscillator.disconnect();
      this.pilotOscillator = null;
    }
    if (this.remoteAnalyser) {
      try { this.remoteAnalyser.disconnect(); } catch {}
      this.remoteAnalyser = null;
      this.remoteAnalyserBuffer = null;
    }
    if (this.outgoingStream) {
      this.outgoingStream.getTracks().forEach(track => track.stop());
      this.outgoingStream = null;
    }
    if (this.audioContext) {
      try { await this.audioContext.close(); } catch {}
      this.audioContext = null;
    }
    this.pendingCandidates = [];
    this.pendingLocalCandidates = [];
    this.remoteDescriptionSet = false;
    this.audioSender = null;
    this.signalEnabled = false;
    this.callAccepted = false;
    this.micEnabled = false;
    if (stopTracks && this.localStream) {
      this.localStream.getTracks().forEach(track => track.stop());
      this.localStream = null;
    }
  }
}
