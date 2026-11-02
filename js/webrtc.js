import { STUN_URL } from "./config.js";

export class WebRtcAudio {
  constructor({ sendSignal, onRemoteStream, onState, onError, diagnosticPilot = false }) {
    this.sendSignal = sendSignal;
    this.onRemoteStream = onRemoteStream;
    this.onState = onState || (() => {});
    this.onError = onError || (() => {});
    this.diagnosticPilot = diagnosticPilot;
    this.pc = null;
    this.localStream = null;
    this.outgoingStream = null;
    this.audioContext = null;
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
      this.localStream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true
        },
        video: false
      });
      const track = this.localStream.getAudioTracks()[0];
      if (track) {
        const settings = track.getSettings ? track.getSettings() : {};
        this.onState("Микрофон: readyState=" + track.readyState +
          "; enabled=" + track.enabled +
          "; muted=" + track.muted +
          (settings.sampleRate ? "; sampleRate=" + settings.sampleRate : ""));
      }
    }
    return this.localStream;
  }

  async prepareOutgoingStream() {
    const stream = await this.ensureMedia();
    if (!this.diagnosticPilot) return stream;
    if (this.outgoingStream) return this.outgoingStream;

    try {
      const AudioContextClass = window.AudioContext || window.webkitAudioContext;
      if (!AudioContextClass || !window.MediaStreamAudioDestinationNode) {
        throw new Error("Web Audio API / MediaStream destination недоступны");
      }
      this.audioContext = new AudioContextClass({ latencyHint: "interactive" });
      if (this.audioContext.state === "suspended") await this.audioContext.resume();

      const destination = this.audioContext.createMediaStreamDestination();
      const micSource = this.audioContext.createMediaStreamSource(stream);
      const micGain = this.audioContext.createGain();
      micGain.gain.value = 1;
      micSource.connect(micGain);
      micGain.connect(destination);

      const oscillator = this.audioContext.createOscillator();
      const pilotGain = this.audioContext.createGain();
      oscillator.type = "sine";
      oscillator.frequency.value = 997;
      // A low-level but deliberately detectable pilot. It is audible in diagnostic mode.
      pilotGain.gain.value = 0.025;
      oscillator.connect(pilotGain);
      pilotGain.connect(destination);
      oscillator.start();

      this.pilotOscillator = oscillator;
      this.outgoingStream = destination.stream;
      this.onState("AUDIO PILOT: добавлен тон 997 Hz; уровень −32 dBFS; исходный микрофон смешан без изменения усиления.");
      return this.outgoingStream;
    } catch (error) {
      this.onState("AUDIO PILOT: не удалось создать тестовый тракт (" + error.message + "); используем исходный микрофон.");
      this.diagnosticPilot = false;
      if (this.audioContext) {
        try { await this.audioContext.close(); } catch {}
        this.audioContext = null;
      }
      this.outgoingStream = null;
      return stream;
    }
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
      this.onState("AUDIO PILOT: анализатор подключён к входящему аудиопотоку.");
    } catch (error) {
      this.onState("AUDIO PILOT: ошибка анализатора: " + error.message);
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
    if (this.pc) return this.pc;
    const stream = await this.prepareOutgoingStream();
    const pc = new RTCPeerConnection({
      iceServers: [{ urls: STUN_URL }],
      iceTransportPolicy: "all"
    });

    for (const track of stream.getAudioTracks()) pc.addTrack(track, stream);

    pc.onicecandidate = async event => {
      if (event.candidate) {
        try {
          await this.sendSignal({ candidate: event.candidate.toJSON() });
        } catch (error) {
          this.onError(new Error("Не удалось передать ICE-кандидат: " + error.message));
        }
      } else {
        this.onState("ice-gathering-complete");
      }
    };

    pc.onicegatheringstatechange = () => this.onState("ice-gathering-" + pc.iceGatheringState);
    pc.onsignalingstatechange = () => this.onState("signaling-" + pc.signalingState);
    pc.oniceconnectionstatechange = () => {
      const iceState = pc.iceConnectionState;
      this.onState("ice-" + iceState);
      this.logSelectedCandidatePair("ice-" + iceState, pc);
    };

    pc.ontrack = event => {
      const remoteStream = event.streams && event.streams[0]
        ? event.streams[0]
        : new MediaStream([event.track]);
      this.attachRemoteMonitor(remoteStream);
      this.onRemoteStream(remoteStream);
    };

    pc.onconnectionstatechange = () => {
      this.onState("connection-" + pc.connectionState);
    };

    this.pc = pc;
    this.startStatsMonitoring(pc);
    return pc;
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
        if (candidate.address) parts.push(candidate.address + (candidate.port ? ":" + candidate.port : ""));
        if (candidate.relatedAddress) parts.push("related=" + candidate.relatedAddress +
          (candidate.relatedPort ? ":" + candidate.relatedPort : ""));
        if (candidate.relayProtocol) parts.push("relay=" + candidate.relayProtocol);
        if (candidate.tcpType) parts.push("tcpType=" + candidate.tcpType);
        return parts.join(" ");
      };
      const rtt = Number.isFinite(pair.currentRoundTripTime)
        ? Math.round(pair.currentRoundTripTime * 1000) + " ms" : "n/a";
      const sent = Number.isFinite(pair.bytesSent) ? pair.bytesSent : "?";
      const received = Number.isFinite(pair.bytesReceived) ? pair.bytesReceived : "?";
      this.onState("ICE pair [" + trigger + "]: local " + describe(local) +
        " ↔ remote " + describe(remote) + "; RTT=" + rtt +
        "; bytes sent/received=" + sent + "/" + received);
    } catch (error) {
      this.onState("ICE pair [" + trigger + "]: getStats error: " + error.message);
    }
  }

  startStatsMonitoring(pc) {
    if (this.statsTimer) clearInterval(this.statsTimer);
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

  async createOffer() {
    const pc = await this.createPeerConnection();
    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);
    await this.sendSignal({ description: pc.localDescription });
  }

  async handleSignal(payload) {
    const pc = await this.createPeerConnection();
    if (payload.description) {
      const description = payload.description;
      await pc.setRemoteDescription(description);
      this.remoteDescriptionSet = true;
      while (this.pendingCandidates.length) {
        await pc.addIceCandidate(this.pendingCandidates.shift());
      }
      if (description.type === "offer") {
        const answer = await pc.createAnswer();
        await pc.setLocalDescription(answer);
        await this.sendSignal({ description: pc.localDescription });
      }
    } else if (payload.candidate) {
      if (this.remoteDescriptionSet) await pc.addIceCandidate(payload.candidate);
      else this.pendingCandidates.push(payload.candidate);
    }
  }

  async close({ stopTracks = false } = {}) {
    if (this.statsTimer) {
      clearInterval(this.statsTimer);
      this.statsTimer = null;
    }
    this.previousRtpStats.clear();
    this.previousIcePairStats.clear();
    if (this.pc) {
      this.pc.ontrack = null;
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
    this.remoteDescriptionSet = false;
    if (stopTracks && this.localStream) {
      this.localStream.getTracks().forEach(track => track.stop());
      this.localStream = null;
    }
  }
}
