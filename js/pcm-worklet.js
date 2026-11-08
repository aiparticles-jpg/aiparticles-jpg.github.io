// Captures microphone audio, down-samples to 16 kHz mono and emits 100 ms PCM16 frames.
class PcmCaptureProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.phase = 0;
    this.sum = 0;
    this.count = 0;
    this.frame = new Int16Array(1600);
    this.offset = 0;
  }

  process(inputs) {
    const channel = inputs[0] && inputs[0][0];
    if (!channel) return true;

    const ratio = sampleRate / 16000;
    for (let i = 0; i < channel.length; i++) {
      this.sum += channel[i];
      this.count += 1;
      this.phase += 1;

      if (this.phase >= ratio) {
        const sample = this.sum / this.count;
        const clipped = Math.max(-1, Math.min(1, sample));
        this.frame[this.offset++] = clipped < 0
          ? Math.round(clipped * 32768)
          : Math.round(clipped * 32767);
        this.phase -= ratio;
        this.sum = 0;
        this.count = 0;

        if (this.offset === this.frame.length) {
          const output = this.frame;
          this.port.postMessage(output.buffer, [output.buffer]);
          this.frame = new Int16Array(1600);
          this.offset = 0;
        }
      }
    }
    return true;
  }
}
registerProcessor("pcm-capture", PcmCaptureProcessor);
