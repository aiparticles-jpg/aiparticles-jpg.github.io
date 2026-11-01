import { STUN_URL } from "./config.js";

export class WebRtcAudio {
  constructor({ sendSignal, onRemoteStream, onState, onError }) {
    this.sendSignal = sendSignal;
    this.onRemoteStream = onRemoteStream;
    this.onState = onState || (() => {});
    this.onError = onError || (() => {});
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
    pc.oniceconnectionstatechange = () => this.onState("ice-" + pc.iceConnectionState);

    pc.ontrack = event => {
      const remoteStream = event.streams && event.streams[0];
      if (remoteStream) this.onRemoteStream(remoteStream);
    };

    pc.onconnectionstatechange = () => {
      this.onState("connection-" + pc.connectionState);
    };

    this.pc = pc;
    return pc;
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
