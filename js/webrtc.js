import { STUN_URL } from "./config.js";

export class WebRtcAudio {
  constructor({ sendSignal, onRemoteStream, onState }) {
    this.sendSignal = sendSignal;
    this.onRemoteStream = onRemoteStream;
    this.onState = onState || (() => {});
    this.pc = null;
    this.localStream = null;
    this.pendingCandidates = [];
    this.remoteDescriptionSet = false;
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
    }
    return this.localStream;
  }

  async createPeerConnection() {
    if (this.pc) return this.pc;
    const stream = await this.ensureMedia();
    const pc = new RTCPeerConnection({
      iceServers: [{ urls: STUN_URL }],
      iceTransportPolicy: "all"
    });

    for (const track of stream.getAudioTracks()) pc.addTrack(track, stream);

    pc.onicecandidate = event => {
      if (event.candidate) this.sendSignal({ candidate: event.candidate.toJSON() });
    };

    pc.ontrack = event => {
      const remoteStream = event.streams && event.streams[0];
      if (remoteStream) this.onRemoteStream(remoteStream);
    };

    pc.onconnectionstatechange = () => {
      this.onState(pc.connectionState);
    };

    pc.oniceconnectionstatechange = () => {
      if (pc.iceConnectionState === "failed") this.onState("failed");
      if (pc.iceConnectionState === "connected" || pc.iceConnectionState === "completed") {
        this.onState("connected");
      }
    };

    this.pc = pc;
    return pc;
  }

  async createOffer() {
    const pc = await this.createPeerConnection();
    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);
    this.sendSignal({ description: pc.localDescription });
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
        this.sendSignal({ description: pc.localDescription });
      }
    } else if (payload.candidate) {
      if (this.remoteDescriptionSet) {
        await pc.addIceCandidate(payload.candidate);
      } else {
        this.pendingCandidates.push(payload.candidate);
      }
    }
  }

  async close({ stopTracks = false } = {}) {
    if (this.pc) {
      this.pc.ontrack = null;
      this.pc.close();
      this.pc = null;
    }
    this.pendingCandidates = [];
    this.remoteDescriptionSet = false;
    if (stopTracks && this.localStream) {
      this.localStream.getTracks().forEach(track => track.stop());
      this.localStream = null;
    }
  }
}
