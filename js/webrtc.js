import { STUN_URL } from "./config.js";

export class WebRtcAudio {
  constructor({ sendSignal, onRemoteStream, onLocalVideoStream, onState, onError, onRemoteHangup, initiator = false, diagnosticPilot = false, diagnosticCamera = false, audioDiagnostics = false }) {
    this.sendSignal = sendSignal;
    this.onRemoteStream = onRemoteStream;
    this.onLocalVideoStream = onLocalVideoStream || (() => {});
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
    this.diagnosticCamera = diagnosticCamera;
    this.videoEnabled = false;
    this.remoteStream = null;
    this.cameraFacingMode = "user";
    this.videoStream = null;
    this.videoTransceiver = null;
    this.videoSender = null;
    this.simulatedCameraCanvas = null;
    this.simulatedCameraAnimation = 0;
    this.audioDiagnostics = diagnosticPilot || diagnosticCamera || audioDiagnostics;
    this.audioContext = null;
    this.audioContextResumePromise = null;
    // Create/resume the context while Connect is still running in the user's click
    // activation. The remote peer may answer much later, after autoplay activation expires.
    if (this.audioDiagnostics) {
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
    this.pilotOutputGain = null;
    this.remoteAnalyser = null;
    this.remoteAnalyserBuffer = null;
    this.signalMonitors = new Map();
    this.pendingCandidates = [];
    this.remoteDescriptionSet = false;
    this.statsTimer = null;
    this.statsInProgress = false;
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
        const outputGate = this.audioContext.createGain();
        oscillator.type = "sine";
        oscillator.frequency.value = 997;
        gain.gain.value = 0.025;
        outputGate.gain.value = this.micEnabled ? 1 : 0;
        oscillator.connect(gain);
        this.createSignalMonitorFromNode(gain, "pilot-source");
        gain.connect(outputGate);
        outputGate.connect(destination);
        oscillator.start();
        this.pilotOscillator = oscillator;
        this.pilotOutputGain = outputGate;
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
      if (this.audioDiagnostics && this.audioContext) {
        if (this.audioContextResumePromise) await this.audioContextResumePromise;
        if (this.audioContext.state === "suspended") await this.audioContext.resume();
      }
      const track = this.localStream.getAudioTracks()[0];
      if (track) {
        // Capture begins only after acceptance; respect the current mute state.
        // Keep a simulated MediaStreamTrack enabled in Firefox/Chrome.
        // Mute the generated signal upstream with pilotOutputGain instead.
        track.enabled = this.diagnosticPilot ? true : this.micEnabled;
        await this.attachLocalAudioTrack();
        if (this.audioDiagnostics) {
          this.createSignalMonitorFromStream(this.localStream, "local-track");
          this.onState("AudioContext: state=" + this.audioContext?.state +
            "; sampleRate=" + (this.audioContext?.sampleRate || "n/a") +
            "; baseLatency=" + (Number.isFinite(this.audioContext?.baseLatency) ? (this.audioContext.baseLatency * 1000).toFixed(1) + "ms" : "n/a") +
            "; outputLatency=" + (Number.isFinite(this.audioContext?.outputLatency) ? (this.audioContext.outputLatency * 1000).toFixed(1) + "ms" : "n/a"));
        }
        this.onState("Аудиотрек: readyState=" + track.readyState + "; enabled=" + track.enabled);
      }
    }
    return this.localStream;
  }

  async setVideoEnabled(enabled) {
    enabled = !!enabled;
    if (enabled === this.videoEnabled) return this.videoEnabled;
    if (!this.videoSender) throw new Error("Видеоканал WebRTC ещё не готов.");
    if (!enabled) {
      await this.videoSender.replaceTrack(null);
      this.videoEnabled = false;
      this.stopVideoStream();
      this.onLocalVideoStream(null);
      this.onState("LOCAL_VIDEO_SENDER_DISABLED; reason=user");
      this.logVideoNegotiation("local-camera-disabled", this.pc);
      if (this.pc) this.logMediaStats(this.pc);
      this.onState("Камера выключена.");
      return false;
    }
    let stream;
    try {
      stream = this.diagnosticCamera
        ? this.createSimulatedCameraStream()
        : await navigator.mediaDevices.getUserMedia({
            audio: false,
            video: {
              facingMode: { ideal: this.cameraFacingMode },
              width: { ideal: 640 },
              height: { ideal: 480 },
              frameRate: { ideal: 24, max: 30 }
            }
          });
      const track = stream.getVideoTracks()[0];
      if (!track) throw new Error("Видеоустройство не вернуло видеотрек.");
      await this.videoSender.replaceTrack(track);
      this.videoStream = stream;
      this.cameraFacingMode = track.getSettings?.().facingMode || this.cameraFacingMode;
      this.videoEnabled = true;
      this.onState("LOCAL_VIDEO_SENDER_ENABLED; trackReadyState=" + track.readyState);
      this.logVideoNegotiation("local-camera-enabled", this.pc);
      if (this.pc) this.logMediaStats(this.pc);
      track.addEventListener("ended", () => {
        if (this.videoEnabled && this.videoStream === stream) {
          this.videoEnabled = false;
          this.onState("LOCAL_VIDEO_SENDER_DISABLED; reason=device-ended");
          this.stopVideoStream();
          this.onLocalVideoStream(null);
          this.onState("Камера остановлена устройством.");
        }
      }, { once: true });
      this.onLocalVideoStream(stream);
      this.onState(this.diagnosticCamera
        ? "Симуляция камеры включена: передаётся тестовое изображение."
        : "Камера включена: видеотрек готов к передаче.");
      return true;
    } catch (error) {
      if (stream) stream.getTracks().forEach(track => track.stop());
      if (this.simulatedCameraCanvas) {
        if (this.simulatedCameraAnimation) cancelAnimationFrame(this.simulatedCameraAnimation);
        this.simulatedCameraAnimation = 0;
        this.simulatedCameraCanvas = null;
      }
      this.videoEnabled = false;
      throw error;
    }
  }

  createSimulatedCameraStream() {
    const canvas = document.createElement("canvas");
    canvas.width = 640;
    canvas.height = 480;
    const context = canvas.getContext("2d");
    if (!context || typeof canvas.captureStream !== "function") {
      throw new Error("Симуляция камеры не поддерживается этим браузером.");
    }
    this.simulatedCameraCanvas = canvas;
    const colors = ["#e34b4b", "#e9a33b", "#e8d94b", "#43ad69", "#398bd1", "#7957bd", "#bd5b9b"];
    const draw = timestamp => {
      if (this.simulatedCameraCanvas !== canvas) return;
      const seconds = timestamp / 1000, width = canvas.width, height = canvas.height;
      context.fillStyle = "#101827";
      context.fillRect(0, 0, width, height);
      const barWidth = width / colors.length;
      colors.forEach((color, index) => {
        context.fillStyle = color;
        context.fillRect(index * barWidth, 0, barWidth + 1, height * 0.62);
      });
      context.fillStyle = "rgba(5,12,22,.78)";
      context.fillRect(0, height * 0.62, width, height * 0.38);
      const x = width * (0.5 + 0.32 * Math.sin(seconds * 1.25));
      const y = height * (0.31 + 0.16 * Math.sin(seconds * 1.8));
      const radius = 35 + 7 * Math.sin(seconds * 2.4);
      const gradient = context.createRadialGradient(x - 10, y - 10, 3, x, y, radius);
      gradient.addColorStop(0, "#ffffff");
      gradient.addColorStop(1, "#172b48");
      context.fillStyle = gradient;
      context.beginPath();
      context.arc(x, y, radius, 0, Math.PI * 2);
      context.fill();
      context.fillStyle = "#ffffff";
      context.font = "600 30px system-ui, sans-serif";
      context.textAlign = "center";
      context.fillText("VOICELINK · CAMERA TEST", width / 2, height * 0.77);
      context.font = "22px system-ui, sans-serif";
      context.fillStyle = "#b8c7dc";
      context.fillText(new Date().toLocaleTimeString(), width / 2, height * 0.86);
      this.simulatedCameraAnimation = requestAnimationFrame(draw);
    };
    this.simulatedCameraAnimation = requestAnimationFrame(draw);
    return canvas.captureStream(15);
  }

  stopVideoStream() {
    if (this.simulatedCameraAnimation) {
      cancelAnimationFrame(this.simulatedCameraAnimation);
      this.simulatedCameraAnimation = 0;
    }
    if (this.videoStream) {
      this.videoStream.getTracks().forEach(track => track.stop());
      this.videoStream = null;
    }
    this.simulatedCameraCanvas = null;
  }

  async switchCamera() {
    if (!this.videoEnabled || this.diagnosticCamera || !this.videoSender) return false;
    const currentTrack = this.videoStream?.getVideoTracks?.()[0];
    const currentDeviceId = currentTrack?.getSettings?.().deviceId || "";
    const devices = await navigator.mediaDevices.enumerateDevices().catch(() => []);
    const cameras = devices.filter(device => device.kind === "videoinput" && device.deviceId);
    const currentIndex = cameras.findIndex(device => device.deviceId === currentDeviceId);
    const nextDevice = cameras.length > 1
      ? cameras[(currentIndex < 0 ? 0 : currentIndex + 1) % cameras.length]
      : null;
    const nextFacingMode = this.cameraFacingMode === "user" ? "environment" : "user";
    const videoOptions = {
      width: { ideal: 640 },
      height: { ideal: 480 },
      frameRate: { ideal: 24, max: 30 }
    };
    let nextStream;
    if (nextDevice) {
      try {
        nextStream = await navigator.mediaDevices.getUserMedia({
          audio: false,
          video: { ...videoOptions, deviceId: { exact: nextDevice.deviceId } }
        });
      } catch (deviceError) {
        nextStream = await navigator.mediaDevices.getUserMedia({
          audio: false,
          video: { ...videoOptions, facingMode: { ideal: nextFacingMode } }
        });
      }
    } else {
      nextStream = await navigator.mediaDevices.getUserMedia({
        audio: false,
        video: { ...videoOptions, facingMode: { ideal: nextFacingMode } }
      });
    }
    const nextTrack = nextStream.getVideoTracks()[0];
    if (!nextTrack) {
      nextStream.getTracks().forEach(track => track.stop());
      throw new Error("Не удалось получить изображение с выбранной камерой.");
    }
    const previousStream = this.videoStream;
    try {
      await this.videoSender.replaceTrack(nextTrack);
    } catch (error) {
      nextStream.getTracks().forEach(track => track.stop());
      throw error;
    }
    this.videoStream = nextStream;
    this.cameraFacingMode = nextTrack.getSettings?.().facingMode || nextFacingMode;
    nextTrack.addEventListener("ended", () => {
      if (this.videoEnabled && this.videoStream === nextStream) {
        this.videoEnabled = false;
        this.stopVideoStream();
        this.onLocalVideoStream(null);
        this.onState("Камера остановлена устройством.");
      }
    }, { once: true });
    previousStream?.getTracks().forEach(track => track.stop());
    this.onLocalVideoStream(nextStream);
    this.onState("Переключена камера: " + (this.cameraFacingMode === "user" ? "фронтальная." : "основная."));
    return true;
  }

  setCallAccepted(accepted) {
    this.callAccepted = !!accepted;
    if (this.callAccepted && this.controlChannel?.readyState === "open") {
      this.sendControl({ type: "ACCEPTED" });
    }
  }

  setMicEnabled(enabled) {
    this.micEnabled = !!enabled;
    if (this.diagnosticPilot) {
      if (this.pilotOutputGain && this.audioContext) {
        const now = this.audioContext.currentTime;
        this.pilotOutputGain.gain.cancelScheduledValues(now);
        this.pilotOutputGain.gain.setTargetAtTime(this.micEnabled ? 1 : 0, now, 0.015);
      }
      // Do not disable the generated track: some browsers couple track.enabled
      // to capture/playback state. A zero-gain gate mutes only our outgoing tone.
      for (const track of this.localStream?.getAudioTracks?.() || []) track.enabled = true;
    } else if (this.localStream) {
      for (const track of this.localStream.getAudioTracks()) track.enabled = this.micEnabled;
    }
    this.onState("Микрофон " + (this.micEnabled ? "включён" : "выключен"));
  }

  async attachLocalAudioTrack() {
    const track = this.localStream?.getAudioTracks?.()[0];
    if (!track || !this.audioSender) return false;
    track.enabled = this.diagnosticPilot ? true : this.micEnabled;
    await this.audioSender.replaceTrack(track);
    this.onState("local-audio-ready");
    return true;
  }

  async prepareOutgoingStream() {
    // In simulation mode ensureMedia already returns a generated audio stream.
    // No physical microphone is opened and no additional track is mixed in.
    return this.ensureMedia();
  }

  createSignalMonitorFromNode(sourceNode, label) {
    if (!this.audioDiagnostics || !this.audioContext || !sourceNode) return null;
    const analyser = this.audioContext.createAnalyser();
    analyser.fftSize = 4096;
    analyser.smoothingTimeConstant = 0;
    sourceNode.connect(analyser);
    // A private MediaStreamDestination keeps this parallel measurement branch
    // pull-active without routing the diagnostic tap to the phone speaker.
    const sink = this.audioContext.createMediaStreamDestination();
    analyser.connect(sink);
    const monitor = { label, analyser, sink, buffer: new Float32Array(analyser.fftSize) };
    this.signalMonitors.set(label, monitor);
    return monitor;
  }

  createSignalMonitorFromStream(stream, label) {
    if (!this.audioDiagnostics || !this.audioContext || !stream) return null;
    const source = this.audioContext.createMediaStreamSource(stream);
    const monitor = this.createSignalMonitorFromNode(source, label);
    if (monitor) monitor.source = source;
    return monitor;
  }

  sampleSignalMonitor(monitor) {
    if (!monitor || !this.audioContext) return null;
    monitor.analyser.getFloatTimeDomainData(monitor.buffer);
    let sumSquares = 0;
    let peak = 0;
    let clipped = 0;
    const crossings = [];
    const data = monitor.buffer;
    for (let i = 0; i < data.length; i++) {
      const value = data[i];
      sumSquares += value * value;
      const absolute = Math.abs(value);
      if (absolute > peak) peak = absolute;
      if (absolute >= 0.99) clipped++;
      if (i > 0 && data[i - 1] <= 0 && value > 0) {
        const previous = data[i - 1];
        const fraction = previous === value ? 0 : -previous / (value - previous);
        crossings.push(i - 1 + fraction);
      }
    }
    const rms = Math.sqrt(sumSquares / data.length);
    const dbfs = value => value > 0 ? (20 * Math.log10(value)).toFixed(1) : "-120.0";
    let frequency = "n/a";
    if (crossings.length >= 2) {
      const span = crossings[crossings.length - 1] - crossings[0];
      if (span > 0) frequency = ((crossings.length - 1) * this.audioContext.sampleRate / span).toFixed(1) + "Hz";
    }
    return monitor.label + "{rms=" + dbfs(rms) + "dBFS;peak=" + dbfs(peak) +
      "dBFS;freq≈" + frequency + ";clip=" + clipped + "/" + data.length + "}";
  }

  attachRemoteMonitor(stream) {
    if (!this.audioDiagnostics || !this.audioContext || !stream) return;
    try {
      const monitor = this.createSignalMonitorFromStream(stream, "remote-track");
      if (!monitor) return;
      this.remoteAnalyser = monitor.analyser;
      this.remoteAnalyserBuffer = new Float32Array(this.remoteAnalyser.frequencyBinCount);
      this.onState("MIC SIMULATION: измерительная ветвь подключена к входящему MediaStreamTrack (до audio element).");
    } catch (error) {
      this.onState("MIC SIMULATION: ошибка анализатора: " + error.message);
    }
  }

  logSignalPathDiagnostics() {
    if (!this.audioDiagnostics || !this.signalMonitors.size) return "";
    const values = [];
    for (const monitor of this.signalMonitors.values()) {
      const value = this.sampleSignalMonitor(monitor);
      if (value) values.push(value);
    }
    return values.join("; ");
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
    const pc=new RTCPeerConnection({iceServers:[{urls:STUN_URL}],iceTransportPolicy:"all",iceCandidatePoolSize:0});
    this.pcDiagnosticId=Math.random().toString(36).slice(2,8);
    this.onState("PC["+this.pcDiagnosticId+"] created; initiator="+this.initiator+"; microphone deferred until call acceptance.");
    // Reserve the audio m-line before SDP exchange. Attach the real microphone
    // track later, after the user accepts the call.
    this.audioTransceiver=pc.addTransceiver("audio",{direction:"sendrecv"});
    this.audioSender=this.audioTransceiver.sender;
    // Reserve the video m-line in the initial offer; later camera toggles use replaceTrack().
    this.videoTransceiver=pc.addTransceiver("video",{direction:"sendrecv"});
    this.videoSender=this.videoTransceiver.sender;
    if(this.localStream)await this.attachLocalAudioTrack();
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
    pc.ontrack=event=>{
      let remoteStream=this.remoteStream;
      if(!remoteStream){
        remoteStream=event.streams?.[0]||new MediaStream();
        this.remoteStream=remoteStream;
      }
      for(const track of event.streams?.[0]?.getTracks?.()||[]){
        if(!remoteStream.getTracks().some(existing=>existing.id===track.id))remoteStream.addTrack(track);
      }
      if(!remoteStream.getTracks().some(existing=>existing.id===event.track.id))remoteStream.addTrack(event.track);
      if(event.track.kind==="audio")this.attachRemoteMonitor(remoteStream);
      if(event.track.kind==="video"){
        this.onState("REMOTE_VIDEO_TRACK_RECEIVED; readyState="+event.track.readyState+"; muted="+event.track.muted);
        event.track.addEventListener("unmute",()=>this.onState("REMOTE_VIDEO_UNMUTED; readyState="+event.track.readyState));
        event.track.addEventListener("mute",()=>this.onState("REMOTE_VIDEO_MUTED"));
        event.track.addEventListener("ended",()=>this.onState("REMOTE_VIDEO_ENDED"));
      }
      this.onRemoteStream(remoteStream);
    };
    pc.onconnectionstatechange=()=>{
      const connectionState=pc.connectionState;
      this.onState("PC["+this.pcDiagnosticId+"] connection-"+connectionState+".");
      if(connectionState==="connected"){
        this.logVideoNegotiation("connection-connected", pc);
        this.startStatsMonitoring(pc);
      }
    };
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

  summarizeVideoSdp(sdp) {
    const lines = String(sdp || "").split(/\r?\n/);
    const firstMediaIndex = lines.findIndex(line => line.startsWith("m="));
    const sessionLines = firstMediaIndex < 0 ? lines : lines.slice(0, firstMediaIndex);
    const sessionDirection = sessionLines.find(line => /^a=(sendrecv|sendonly|recvonly|inactive)$/.test(line));
    const defaultDirection = sessionDirection ? sessionDirection.slice(2) : "sendrecv";
    const sections = [];
    let current = null;
    for (const line of lines) {
      if (line.startsWith("m=")) {
        if (current) sections.push(current);
        if (line.startsWith("m=video ")) {
          current = { mline: line.slice(2), direction: defaultDirection, mid: null, codecs: [], msid: false };
        } else {
          current = null;
        }
        continue;
      }
      if (!current) continue;
      const direction = line.match(/^a=(sendrecv|sendonly|recvonly|inactive)$/);
      if (direction) current.direction = direction[1];
      const mid = line.match(/^a=mid:(.+)$/);
      if (mid) current.mid = mid[1];
      const codec = line.match(/^a=rtpmap:\d+\s+([^/]+)/i);
      if (codec && !current.codecs.includes(codec[1])) current.codecs.push(codec[1]);
      if (line.startsWith("a=msid:") || (line.startsWith("a=ssrc:") && line.includes("msid:"))) current.msid = true;
    }
    if (current) sections.push(current);
    if (!sections.length) return "no m=video";
    return sections.map(section =>
      "m=video(port/proto/formats)=" + section.mline +
      ";dir=" + section.direction +
      ";mid=" + (section.mid || "n/a") +
      ";codecs=" + (section.codecs.slice(0, 5).join(",") || "n/a") +
      ";msid=" + (section.msid ? "yes" : "no")
    ).join(" | ");
  }

  logVideoNegotiation(reason, pc = this.pc) {
    if (!pc) return;
    const local = this.summarizeVideoSdp(pc.localDescription?.sdp);
    const remote = this.summarizeVideoSdp(pc.remoteDescription?.sdp);
    const transceivers = pc.getTransceivers()
      .filter(item => item.receiver?.track?.kind === "video" || item.sender?.track?.kind === "video")
      .map(item => {
        const senderTrack = item.sender?.track;
        const receiverTrack = item.receiver?.track;
        return "mid=" + (item.mid ?? "pending") +
          ",dir=" + item.direction +
          ",current=" + (item.currentDirection || "pending") +
          ",sender=" + (senderTrack ? senderTrack.readyState + "/enabled:" + senderTrack.enabled : "none") +
          ",receiver=" + (receiverTrack ? receiverTrack.readyState + "/muted:" + receiverTrack.muted : "none");
      });
    this.onState("VIDEO_NEGOTIATION [" + reason + "]: local{" + local + "}; remote{" + remote +
      "}; transceiver{" + (transceivers.join(" | ") || "none") + "}.");
  }

  startStatsMonitoring(pc) {
    if (this.statsTimer) return;
    // Compact 5s snapshots are temporary targeted diagnostics for short video calls.
    this.logMediaStats(pc);
    this.statsTimer = setInterval(() => this.logMediaStats(pc), 5000);
  }

  async logMediaStats(pc) {
    if (this.statsInProgress || this.pc !== pc) return;
    this.statsInProgress = true;
    try {
      const stats = await pc.getStats();
      if (this.pc !== pc) return;
      const reports = Array.from(stats.values());
      const fields = [];

      for (const kind of ["audio", "video"]) {
        for (const direction of ["outbound-rtp", "inbound-rtp"]) {
          const report = reports.find(item =>
            item.type === direction &&
            (item.kind === kind || item.mediaType === kind) &&
            !item.isRemote
          );
          if (!report) {
            fields.push(kind + (direction === "outbound-rtp" ? " out" : " in") + " RTP=absent");
            continue;
          }
          const label = kind + (direction === "outbound-rtp" ? " out" : " in");
          const parts = [];
          const packets = direction === "outbound-rtp" ? report.packetsSent : report.packetsReceived;
          const bytes = direction === "outbound-rtp" ? report.bytesSent : report.bytesReceived;
          if (Number.isFinite(packets)) parts.push("pkts=" + packets);
          if (Number.isFinite(bytes)) parts.push("bytes=" + bytes);
          if (kind === "video") {
            const frameFields = direction === "outbound-rtp"
              ? [["framesSent", "sent"], ["framesEncoded", "encoded"], ["keyFramesEncoded", "keyframes"], ["frameWidth", "width"], ["frameHeight", "height"], ["framesPerSecond", "fps"]]
              : [["framesReceived", "received"], ["framesDecoded", "decoded"], ["framesRendered", "rendered"], ["keyFramesDecoded", "keyframes"], ["frameWidth", "width"], ["frameHeight", "height"], ["framesPerSecond", "fps"]];
            for (const [field, label] of frameFields) {
              if (Number.isFinite(report[field])) parts.push(label + "=" + (label === "fps" ? report[field].toFixed(1) : report[field]));
            }
            if (Number.isFinite(report.framesDropped)) parts.push("dropped=" + report.framesDropped);
            if (Number.isFinite(report.framesReceived) && Number.isFinite(report.framesDecoded)) {
              parts.push("decodeGap=" + Math.max(0, report.framesReceived - report.framesDecoded));
            }
            if (report.decoderImplementation) parts.push("decoder=" + report.decoderImplementation);
            if (report.encoderImplementation) parts.push("encoder=" + report.encoderImplementation);
            if (report.qualityLimitationReason) parts.push("qualityLimit=" + report.qualityLimitationReason);
          } else {
            if (direction === "inbound-rtp" && Number.isFinite(report.packetsLost)) parts.push("lost=" + report.packetsLost);
            if (direction === "inbound-rtp" && Number.isFinite(report.jitter)) parts.push("jitter=" + (report.jitter * 1000).toFixed(1) + "ms");
            if (Number.isFinite(report.audioLevel)) parts.push("level=" + report.audioLevel.toFixed(3));
          }
          if (report.codecId) {
            const codec = stats.get(report.codecId);
            if (codec?.mimeType) parts.push("codec=" + String(codec.mimeType).replace(/^(audio|video)\//i, ""));
          }
          fields.push(label + " " + parts.join(" "));
        }
      }

      const pair = reports.find(report =>
        report.type === "candidate-pair" &&
        (report.selected === true || (report.nominated === true && report.state === "succeeded"))
      );
      if (pair && Number.isFinite(pair.currentRoundTripTime)) {
        fields.push("RTT=" + Math.round(pair.currentRoundTripTime * 1000) + "ms");
      }
      this.onState("Media stats [" + pc.iceConnectionState + "/" + pc.connectionState + "]: " +
        (fields.length ? fields.join("; ") : "данные пока недоступны"));
    } catch (error) {
      this.onState("Media stats error: " + error.message);
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
      this.onState("Собеседник ответил; запрашиваем микрофон.");
      this.ensureMedia()
        .then(() => this.onState("Собеседник ответил; микрофон включён."))
        .catch(error => {
          this.setMicEnabled(false);
          this.onError(new Error("Собеседник принял звонок, но не удалось получить доступ к микрофону: " + (error.message || String(error))));
        });
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
    const sdp=String(description.sdp||"").replace(/^a=candidate:[^\r\n]*(?:\r?\n)?/gm,"").replace(/^a=end-of-candidates\r?\n?/gm,"");
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
    const send=async()=>{if(this.iceBatching!==batch)return;await this.sendSignal(payload)};
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
    const offer=await pc.createOffer();this.beginIceBatching(pc,offer);await pc.setLocalDescription(offer);
    this.logVideoNegotiation("local-offer", pc);
    this.scheduleIceBatches(pc);
  }
  async handleSignal(payload){
    const pc=await this.createPeerConnection(),candidates=Array.isArray(payload.candidates)?payload.candidates:[];
    this.onState("PC["+this.pcDiagnosticId+"] handleSignal entered; description="+(payload.description?.type||"none")+"; candidates="+candidates.length+"; legacyCandidate="+!!payload.candidate+"; endOfCandidates="+!!payload.endOfCandidates+".");
    if(payload.description){
      const description=payload.description;
      this.onState("PC["+this.pcDiagnosticId+"] setRemoteDescription("+description.type+") started; SDP chars="+(description.sdp?.length||0)+".");
      await pc.setRemoteDescription(description);this.onState("PC["+this.pcDiagnosticId+"] setRemoteDescription("+description.type+") completed.");
      this.remoteDescriptionSet=true;
      this.logVideoNegotiation("remote-"+description.type, pc);
      while(this.pendingCandidates.length)await pc.addIceCandidate(this.pendingCandidates.shift());
      for(const candidate of candidates)await pc.addIceCandidate(candidate);
      if(payload.candidate)await pc.addIceCandidate(payload.candidate);
      if(payload.endOfCandidates)await pc.addIceCandidate(null);
      if(description.type==="offer"){
        this.onState("PC["+this.pcDiagnosticId+"] createAnswer started.");
        const answer=await pc.createAnswer();this.beginIceBatching(pc,answer);await pc.setLocalDescription(answer);
        this.logVideoNegotiation("local-answer", pc);
        this.scheduleIceBatches(pc);
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
    if (this.pilotOutputGain) {
      try { this.pilotOutputGain.disconnect(); } catch {}
      this.pilotOutputGain = null;
    }
    for (const monitor of this.signalMonitors.values()) {
      try { monitor.analyser.disconnect(); } catch {}
      try { monitor.source?.disconnect(); } catch {}
      try { monitor.sink?.stream?.getTracks().forEach(track => track.stop()); } catch {}
    }
    this.signalMonitors.clear();
    if (this.remoteAnalyser) {
      try { this.remoteAnalyser.disconnect(); } catch {}
      this.remoteAnalyser = null;
      this.remoteAnalyserBuffer = null;
    }
    this.stopVideoStream();
    this.onLocalVideoStream(null);
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
    this.videoSender = null;
    this.videoTransceiver = null;
    this.videoEnabled = false;
    this.remoteStream = null;
    this.signalEnabled = false;
    this.callAccepted = false;
    this.micEnabled = false;
    if (stopTracks && this.localStream) {
      this.localStream.getTracks().forEach(track => track.stop());
      this.localStream = null;
    }
  }
}
