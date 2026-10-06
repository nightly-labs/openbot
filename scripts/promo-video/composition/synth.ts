// The building blocks of a synthesized soundtrack: buses, envelopes, oscillators and noise in one
// OfflineAudioContext. Each video's audio module plays its own instruments with them.

export const SAMPLE_RATE = 48000;
export const SILENT = 0.0001;

export function hertz(note: number): number {
  return 440 * 2 ** ((note - 69) / 12);
}

export type Synth = ReturnType<typeof createSynth>;

/** `next` is the seeded random source for the noise, the reverbs and anything else the video plays. */
export function createSynth(context: OfflineAudioContext, next: () => number) {
  const noiseBuffer = context.createBuffer(1, SAMPLE_RATE * 2, SAMPLE_RATE);
  const noiseData = noiseBuffer.getChannelData(0);
  for (let index = 0; index < noiseData.length; index += 1) noiseData[index] = next() * 2 - 1;

  function bus(level: number, destination: AudioNode): GainNode {
    const node = context.createGain();
    node.gain.value = level;
    node.connect(destination);
    return node;
  }

  function impulse(seconds: number, fall: number): AudioBuffer {
    const buffer = context.createBuffer(2, Math.ceil(seconds * SAMPLE_RATE), SAMPLE_RATE);
    for (let channel = 0; channel < 2; channel += 1) {
      const data = buffer.getChannelData(channel);
      for (let index = 0; index < data.length; index += 1) {
        data[index] = (next() * 2 - 1) * (1 - index / data.length) ** fall;
      }
    }
    return buffer;
  }

  /** A gain that rises to `peak` in `attack` seconds, then falls away over `length`. */
  function envelope(at: number, peak: number, attack: number, length: number, destination: AudioNode): GainNode {
    const node = context.createGain();
    node.gain.setValueAtTime(SILENT, at);
    node.gain.exponentialRampToValueAtTime(peak, at + attack);
    node.gain.exponentialRampToValueAtTime(SILENT, at + attack + length);
    node.connect(destination);
    return node;
  }

  function noise(at: number, length: number, destination: AudioNode) {
    const source = context.createBufferSource();
    source.buffer = noiseBuffer;
    source.loop = true;
    source.connect(destination);
    source.start(at, next() * 1.5);
    source.stop(at + length + 0.05);
  }

  function filter(type: BiquadFilterType, frequency: number, q: number, destination: AudioNode): BiquadFilterNode {
    const node = context.createBiquadFilter();
    node.type = type;
    node.frequency.value = frequency;
    node.Q.value = q;
    node.connect(destination);
    return node;
  }

  function panner(pan: number, destination: AudioNode): StereoPannerNode {
    const node = context.createStereoPanner();
    node.pan.value = pan;
    node.connect(destination);
    return node;
  }

  function tone(
    type: OscillatorType,
    at: number,
    length: number,
    from: number,
    to: number,
    destination: AudioNode,
    detune = 0,
  ) {
    const oscillator = context.createOscillator();
    oscillator.type = type;
    oscillator.detune.value = detune;
    oscillator.frequency.setValueAtTime(from, at);
    if (to !== from) oscillator.frequency.exponentialRampToValueAtTime(to, at + length);
    oscillator.connect(destination);
    oscillator.start(at);
    oscillator.stop(at + length + 0.05);
  }

  return { bus, impulse, envelope, noise, filter, panner, tone };
}

/** Scales the mix so its peak sits at -1 dBFS. ffmpeg sets the final loudness. */
export function normalize(buffer: AudioBuffer) {
  let peak = 0;
  for (let channel = 0; channel < buffer.numberOfChannels; channel += 1) {
    for (const sample of buffer.getChannelData(channel)) peak = Math.max(peak, Math.abs(sample));
  }
  if (peak === 0) return;
  const gain = 10 ** (-1 / 20) / peak;
  for (let channel = 0; channel < buffer.numberOfChannels; channel += 1) {
    const data = buffer.getChannelData(channel);
    for (let index = 0; index < data.length; index += 1) data[index] = (data[index] ?? 0) * gain;
  }
}

/** 16-bit PCM WAV. */
function encodeWav(buffer: AudioBuffer): ArrayBuffer {
  const channels = buffer.numberOfChannels;
  const frames = buffer.length;
  const bytes = frames * channels * 2;
  const view = new DataView(new ArrayBuffer(44 + bytes));
  const text = (offset: number, value: string) => {
    for (let index = 0; index < value.length; index += 1) view.setUint8(offset + index, value.charCodeAt(index));
  };
  text(0, "RIFF");
  view.setUint32(4, 36 + bytes, true);
  text(8, "WAVE");
  text(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, channels, true);
  view.setUint32(24, buffer.sampleRate, true);
  view.setUint32(28, buffer.sampleRate * channels * 2, true);
  view.setUint16(32, channels * 2, true);
  view.setUint16(34, 16, true);
  text(36, "data");
  view.setUint32(40, bytes, true);
  const data = Array.from({ length: channels }, (_, channel) => buffer.getChannelData(channel));
  let offset = 44;
  for (let frame = 0; frame < frames; frame += 1) {
    for (const channel of data) {
      const sample = Math.max(-1, Math.min(1, channel[frame] ?? 0));
      view.setInt16(offset, sample < 0 ? sample * 0x8000 : sample * 0x7fff, true);
      offset += 2;
    }
  }
  return view.buffer;
}

/** The buffer as a base64 WAV, for `window.promo.renderAudio`. */
export function wavBase64(buffer: AudioBuffer): string {
  const bytes = new Uint8Array(encodeWav(buffer));
  let text = "";
  for (let index = 0; index < bytes.length; index += 0x8000) {
    text += String.fromCharCode(...bytes.subarray(index, index + 0x8000));
  }
  return btoa(text);
}
