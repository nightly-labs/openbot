// The soundtrack, made from oscillators and noise in an OfflineAudioContext. Nothing is sampled
// or licensed. Every hit reads its time from cues.ts, so the sound stays on the picture.

import { CUE, PLATFORM_CHIPS, PROMISE_WORDS, PROVIDER_SWAPS, TEAM_MESSAGES, TRANSITIONS } from "./cues";
import { BEAT, DURATION, random } from "./timeline";

export const SAMPLE_RATE = 48000;
const SILENT = 0.0001;
/** The drums start on the slam and stop before the outro hit, so the hit lands after a gap. */
const GROOVE = { start: CUE.slam, end: 14.75 };
/** F minor: Fm, Db, Ab, Eb, one chord per bar from the slam. Numbers are MIDI notes. */
const BARS = [
  { root: 41, chord: [65, 68, 72] },
  { root: 37, chord: [65, 68, 73] },
  { root: 44, chord: [63, 68, 72] },
  { root: 39, chord: [63, 67, 70] },
] as const;
const OUTRO_CHORD = [53, 60, 63, 67, 72] as const;

function hertz(note: number): number {
  return 440 * 2 ** ((note - 69) / 12);
}

function barAt(time: number) {
  const index = Math.floor((time - CUE.slam) / (BEAT * 4));
  return BARS[((index % BARS.length) + BARS.length) % BARS.length] ?? BARS[0];
}

export async function renderSoundtrack(): Promise<AudioBuffer> {
  const context = new OfflineAudioContext(2, Math.ceil(DURATION * SAMPLE_RATE), SAMPLE_RATE);
  const next = random(5);

  const compressor = context.createDynamicsCompressor();
  compressor.threshold.value = -14;
  compressor.knee.value = 8;
  compressor.ratio.value = 4;
  compressor.attack.value = 0.004;
  compressor.release.value = 0.16;
  compressor.connect(context.destination);
  const master = bus(0.8, compressor);
  const drums = bus(0.9, master);
  const duck = bus(1, master);
  const music = bus(0.55, duck);
  const effects = bus(0.7, master);

  const reverb = context.createConvolver();
  reverb.buffer = impulse(2.4, 3.2);
  reverb.connect(bus(0.32, master));
  const echo = context.createDelay(1);
  echo.delayTime.value = BEAT * 0.75;
  const feedback = bus(0.38, echo);
  echo.connect(feedback);
  echo.connect(bus(0.4, master));
  const reverbSend = bus(1, reverb);
  const echoSend = bus(1, echo);

  const noiseBuffer = (() => {
    const buffer = context.createBuffer(1, SAMPLE_RATE * 2, SAMPLE_RATE);
    const data = buffer.getChannelData(0);
    for (let index = 0; index < data.length; index += 1) data[index] = next() * 2 - 1;
    return buffer;
  })();

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

  // Drums.

  function kick(at: number, level = 1) {
    tone("sine", at, 0.42, 160, 42, envelope(at, level, 0.002, 0.42, drums));
    noise(at, 0.02, filter("highpass", 3000, 0.7, envelope(at, 0.25 * level, 0.001, 0.02, drums)));
    duck.gain.setValueAtTime(0.28, at);
    duck.gain.setTargetAtTime(1, at + 0.02, 0.07);
  }

  function clap(at: number, level = 0.5) {
    const body = filter("bandpass", 1500, 0.9, drums);
    const send = bus(0.4, reverbSend);
    body.connect(send);
    for (const offset of [0, 0.011, 0.023]) noise(at + offset, 0.012, envelope(at + offset, level, 0.001, 0.012, body));
    noise(at + 0.03, 0.2, envelope(at + 0.03, level * 0.7, 0.002, 0.18, body));
  }

  function hat(at: number, level = 0.16, length = 0.035) {
    noise(at, length, filter("highpass", 7500, 0.8, envelope(at, level, 0.001, length, panner(0.2, drums))));
  }

  function snare(at: number, level = 0.35) {
    noise(at, 0.12, filter("bandpass", 1900, 0.7, envelope(at, level, 0.001, 0.12, drums)));
    tone("triangle", at, 0.1, 210, 160, envelope(at, level * 0.6, 0.001, 0.1, drums));
  }

  function crash(at: number, level = 0.3, length = 1.8) {
    const shape = filter("highpass", 4200, 0.6, envelope(at, level, 0.002, length, drums));
    noise(at, length, shape);
    shape.connect(bus(0.5, reverbSend));
  }

  function subDrop(at: number, level = 0.9) {
    tone("sine", at, 1.1, 90, 28, envelope(at, level, 0.004, 1.1, master));
  }

  // Music.

  function bass(at: number, note: number, length = 0.2, level = 0.5) {
    const shape = filter("lowpass", 300, 6, envelope(at, level, 0.004, length, music));
    shape.frequency.setValueAtTime(1500, at);
    shape.frequency.exponentialRampToValueAtTime(260, at + length);
    tone("sawtooth", at, length, hertz(note), hertz(note), shape);
    tone("square", at, length, hertz(note - 12), hertz(note - 12), shape, 4);
  }

  function stab(at: number, chord: readonly number[], level = 0.22, length = 0.3) {
    const shape = filter("lowpass", 3200, 1.2, envelope(at, level, 0.003, length, music));
    shape.connect(bus(0.35, reverbSend));
    chord.forEach((note, index) => {
      const pan = panner((index - 1) * 0.35, shape);
      tone("sawtooth", at, length, hertz(note), hertz(note), pan, -9);
      tone("sawtooth", at, length, hertz(note), hertz(note), pan, 9);
    });
  }

  function pad(at: number, until: number, chord: readonly number[], level = 0.09) {
    const gain = context.createGain();
    gain.gain.setValueAtTime(SILENT, at);
    gain.gain.exponentialRampToValueAtTime(level, at + 0.5);
    gain.gain.setValueAtTime(level, until - 0.9);
    gain.gain.exponentialRampToValueAtTime(SILENT, until);
    const shape = filter("lowpass", 1100, 0.5, gain);
    gain.connect(music);
    gain.connect(bus(0.6, reverbSend));
    chord.forEach((note, index) => {
      const pan = panner(index % 2 === 0 ? -0.4 : 0.4, shape);
      tone("sawtooth", at, until - at, hertz(note), hertz(note), pan, -12);
      tone("sawtooth", at, until - at, hertz(note), hertz(note), pan, 12);
    });
  }

  function pluck(at: number, note: number, level = 0.16, pan = 0, length = 0.18) {
    const shape = filter("lowpass", 4200, 1, envelope(at, level, 0.002, length, panner(pan, effects)));
    shape.connect(bus(0.5, echoSend));
    shape.connect(bus(0.3, reverbSend));
    tone("triangle", at, length, hertz(note), hertz(note), shape);
    tone(
      "square",
      at,
      length,
      hertz(note + 12),
      hertz(note + 12),
      envelope(at, level * 0.3, 0.002, length * 0.5, shape),
    );
  }

  // Effects.

  function whoosh(at: number, length: number, rising = true, level = 0.35) {
    const gain = context.createGain();
    gain.gain.setValueAtTime(SILENT, at);
    gain.gain.exponentialRampToValueAtTime(level, at + length * 0.8);
    gain.gain.exponentialRampToValueAtTime(SILENT, at + length);
    gain.connect(effects);
    gain.connect(bus(0.4, reverbSend));
    const shape = filter("bandpass", rising ? 300 : 3500, 1.4, gain);
    shape.frequency.setValueAtTime(rising ? 300 : 3500, at);
    shape.frequency.exponentialRampToValueAtTime(rising ? 4500 : 250, at + length);
    noise(at, length, shape);
  }

  function riser(at: number, until: number) {
    const gain = context.createGain();
    gain.gain.setValueAtTime(SILENT, at);
    gain.gain.exponentialRampToValueAtTime(0.4, until - 0.01);
    gain.gain.setValueAtTime(SILENT, until);
    gain.connect(effects);
    const shape = filter("bandpass", 400, 2, gain);
    shape.frequency.setValueAtTime(400, at);
    shape.frequency.exponentialRampToValueAtTime(7000, until);
    noise(at, until - at, shape);
    tone("sawtooth", at, until - at, 110, 880, filter("lowpass", 2400, 1, bus(0.25, gain)));
  }

  /** A pen on paper: filtered noise that jumps in pitch and loudness every few milliseconds. */
  function scribble(at: number, length: number, pan: number) {
    const gain = context.createGain();
    const steps = Math.ceil(length / 0.018);
    const shape = filter("bandpass", 3000, 3, gain);
    const curve = new Float32Array(steps);
    const loudness = new Float32Array(steps);
    for (let step = 0; step < steps; step += 1) {
      curve[step] = 1800 + next() * 4200;
      loudness[step] = (0.15 + next() * 0.35) * (1 - step / steps) ** 0.6;
    }
    shape.frequency.setValueCurveAtTime(curve, at, length);
    gain.gain.setValueCurveAtTime(loudness, at, length);
    gain.connect(panner(pan, effects));
    noise(at, length, shape);
  }

  function blip(at: number, from: number, to: number, level = 0.18, length = 0.05) {
    tone("sine", at, length, from, to, envelope(at, level, 0.002, length, effects));
  }

  function glitch(at: number) {
    const shape = envelope(at, 0.12, 0.002, 0.11, effects);
    const oscillator = context.createOscillator();
    oscillator.type = "square";
    const steps = new Float32Array(7);
    for (let step = 0; step < steps.length; step += 1) steps[step] = 200 + next() * 1800;
    oscillator.frequency.setValueCurveAtTime(steps, at, 0.11);
    oscillator.connect(shape);
    oscillator.start(at);
    oscillator.stop(at + 0.14);
    noise(at, 0.05, filter("highpass", 5000, 1, envelope(at, 0.12, 0.001, 0.05, effects)));
  }

  function impact(at: number, size = 1) {
    // Inside the groove, the beat already has a kick on this time.
    if (at < GROOVE.start || at >= GROOVE.end) kick(at, 1);
    subDrop(at, 0.8 * size);
    crash(at, 0.3 * size, 1.4 + size);
    noise(at, 0.4, filter("lowpass", 900, 0.7, envelope(at, 0.4 * size, 0.002, 0.4, bus(0.8, reverbSend))));
  }

  // The hook: the pen, the blink, the looks, and the riser into the slam.
  scribble(CUE.drawLeft, CUE.drawLength + 0.02, -0.35);
  scribble(CUE.drawRight, CUE.drawLength, 0.35);
  blip(CUE.blink, 2200, 1400, 0.16, 0.04);
  for (const [index, at] of CUE.looks.entries()) blip(at, 1300 + index * 180, 1100 + index * 180, 0.1, 0.03);
  riser(0.55, CUE.slam);
  impact(CUE.slam, 1.2);

  // The groove.
  for (let at = GROOVE.start; at < GROOVE.end - 0.01; at += BEAT) {
    const localDip = at >= CUE.local && at < CUE.price;
    kick(at, localDip ? 0.75 : 0.95);
    hat(at + BEAT / 2, 0.14);
    const beatInBar = Math.round((at - CUE.slam) / BEAT) % 4;
    if (beatInBar === 1 || beatInBar === 3) clap(at, 0.4);
    if (at >= CUE.promise) {
      const bar = barAt(at);
      bass(at + BEAT / 2, bar.root, 0.2, localDip ? 0.3 : 0.5);
      if (at >= CUE.team && at < CUE.local) bass(at + BEAT * 0.75, bar.root + 12, 0.1, 0.3);
    }
  }
  for (let at = CUE.team; at < 11.5; at += BEAT / 2) hat(at + BEAT / 4, 0.06, 0.02);
  for (let step = 0; step < 16; step += 1) hat(11.5 + step * (BEAT / 8), 0.05 + step * 0.012, 0.02);
  for (let step = 0; step < 16; step += 1) snare(14.25 + step * (0.5 / 16), 0.12 + step * 0.02);

  // The words, the swaps, and the messages.
  for (const at of PROMISE_WORDS) stab(at, barAt(at).chord, 0.24);
  for (const at of PROVIDER_SWAPS.slice(1)) glitch(at);
  for (const at of TEAM_MESSAGES) stab(at, barAt(at).chord, 0.16, 0.22);
  pad(CUE.models, CUE.team, barAt(CUE.models).chord, 0.05);
  for (let step = 0; step < 20; step += 1) {
    const at = CUE.team + step * (BEAT / 4);
    const chord = barAt(at).chord;
    pluck(at, (chord[step % chord.length] ?? 65) + 12, 0.08, step % 2 === 0 ? -0.3 : 0.3, 0.12);
  }

  // Transitions and hits.
  whoosh(CUE.dive, CUE.promise - CUE.dive, true, 0.45);
  for (const at of TRANSITIONS.slice(1)) whoosh(at - 0.3, 0.3, true, 0.3);
  impact(CUE.promise, 0.6);
  impact(CUE.models, 0.5);
  impact(CUE.team, 0.5);
  impact(CUE.local, 0.4);
  noise(CUE.lock, 0.02, filter("bandpass", 3200, 2, envelope(CUE.lock, 0.5, 0.001, 0.02, effects)));
  noise(CUE.lock + 0.03, 0.03, filter("bandpass", 2400, 2, envelope(CUE.lock + 0.03, 0.4, 0.001, 0.03, effects)));
  tone("sine", CUE.lock, 0.12, 140, 90, envelope(CUE.lock, 0.5, 0.002, 0.12, effects));
  impact(CUE.price, 0.8);
  for (const [index, note] of [72, 75, 77, 79, 84, 87, 89, 91].entries()) {
    pluck(CUE.price + 0.04 + index * 0.06, note, 0.1, index % 2 ? 0.4 : -0.4);
  }
  for (const [index, at] of PLATFORM_CHIPS.entries()) {
    pluck(at, 72 + ([0, 3, 5, 7, 10][index] ?? 0), 0.09, (index - 2) * 0.25, 0.08);
  }

  // The pull into the outro: a reversed cymbal and a suck, then two frames of silence.
  const reverse = context.createGain();
  reverse.gain.setValueAtTime(SILENT, 14.2);
  reverse.gain.exponentialRampToValueAtTime(0.35, 14.97);
  reverse.gain.setValueAtTime(SILENT, 14.98);
  reverse.connect(effects);
  noise(14.2, 0.78, filter("highpass", 5000, 0.5, reverse));
  whoosh(CUE.implode, CUE.outro - CUE.implode - 0.02, false, 0.4);

  // The outro.
  impact(CUE.outro, 1.3);
  pad(CUE.outro, DURATION - 0.05, OUTRO_CHORD, 0.08);
  for (const [index, note] of [65, 72, 77].entries()) pluck(CUE.wordmark + index * 0.12, note, 0.1, 0);
  tone("sine", CUE.cta, 0.14, 380, 920, envelope(CUE.cta, 0.3, 0.004, 0.14, effects));
  blip(CUE.wink, 1500, 2300, 0.14, 0.06);
  blip(CUE.blinkEnd, 1800, 1300, 0.08, 0.04);

  const rendered = await context.startRendering();
  normalize(rendered);
  return rendered;
}

/** Scales the mix so its peak sits at -1 dBFS. ffmpeg sets the final loudness. */
function normalize(buffer: AudioBuffer) {
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
export function encodeWav(buffer: AudioBuffer): ArrayBuffer {
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
