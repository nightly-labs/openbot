// The pastel soundtrack: a light marimba groove in F major at 120 BPM, with a cartoon sound for
// each pop, hop, landing and coin. Nothing is sampled or licensed. Every sound reads its time from
// cues.ts.

import { createSynth, hertz, normalize, SAMPLE_RATE, SILENT } from "../synth";
import { random } from "../timeline";
import { at, BEAT, CUE, PASTEL_DURATION, WIPES } from "./cues";

/** F, C, Dm, Bb: one chord per bar of four beats, from beat 0. Numbers are MIDI notes. */
const BARS = [
  { root: 41, chord: [65, 69, 72] },
  { root: 36, chord: [64, 67, 72] },
  { root: 38, chord: [62, 65, 69] },
  { root: 34, chord: [62, 65, 70] },
] as const;
/** The drums play from the mascot's hop to the end card. */
const GROOVE = { start: at(4), end: CUE.wipeOutro } as const;
/** F major, for pops that climb. */
const SCALE = [65, 67, 69, 70, 72, 74, 76, 77, 79, 81, 84] as const;
const OUTRO_CHORD = [53, 60, 65, 69, 72, 76] as const;

function barAt(time: number) {
  const index = Math.floor(time / (BEAT * 4));
  return BARS[((index % BARS.length) + BARS.length) % BARS.length] ?? BARS[0];
}

function scale(step: number): number {
  return SCALE[Math.min(SCALE.length - 1, Math.max(0, step))] ?? 72;
}

export async function renderPastelSoundtrack(): Promise<AudioBuffer> {
  const context = new OfflineAudioContext(2, Math.ceil(PASTEL_DURATION * SAMPLE_RATE), SAMPLE_RATE);
  const next = random(9);
  const { bus, impulse, envelope, noise, filter, panner, tone } = createSynth(context, next);

  const compressor = context.createDynamicsCompressor();
  compressor.threshold.value = -16;
  compressor.knee.value = 10;
  compressor.ratio.value = 3;
  compressor.attack.value = 0.006;
  compressor.release.value = 0.2;
  compressor.connect(context.destination);
  const master = bus(0.8, compressor);
  const drums = bus(0.7, master);
  const duck = bus(1, master);
  const music = bus(0.6, duck);
  const effects = bus(0.65, master);
  const reverb = context.createConvolver();
  reverb.buffer = impulse(1.8, 3.6);
  reverb.connect(bus(0.3, master));
  const reverbSend = bus(1, reverb);

  // Drums: round and soft, no distortion.

  function kick(time: number, level = 0.8) {
    tone("sine", time, 0.24, 150, 48, envelope(time, level, 0.002, 0.24, drums));
    duck.gain.setValueAtTime(0.55, time);
    duck.gain.setTargetAtTime(1, time + 0.02, 0.06);
  }

  function snap(time: number, level = 0.35) {
    const body = filter("bandpass", 2300, 1.4, drums);
    body.connect(bus(0.5, reverbSend));
    noise(time, 0.05, envelope(time, level, 0.001, 0.05, body));
  }

  function shaker(time: number, level = 0.06) {
    noise(time, 0.04, filter("highpass", 8000, 0.7, envelope(time, level, 0.012, 0.03, panner(-0.25, drums))));
  }

  // Music.

  /** A wooden bar: the note and a short, bright overtone near four times its pitch. */
  function marimba(time: number, note: number, level = 0.16, pan = 0, length = 0.4) {
    const out = panner(pan, music);
    out.connect(bus(0.35, reverbSend));
    tone("sine", time, length, hertz(note), hertz(note), envelope(time, level, 0.003, length, out));
    tone("sine", time, 0.07, hertz(note) * 3.93, hertz(note) * 3.93, envelope(time, level * 0.35, 0.001, 0.07, out));
  }

  function bass(time: number, note: number, length = 0.22, level = 0.5) {
    const shape = filter("lowpass", 700, 1, envelope(time, level, 0.006, length, music));
    tone("triangle", time, length, hertz(note), hertz(note), shape);
    tone("sine", time, length, hertz(note - 12), hertz(note - 12), shape);
  }

  function pad(start: number, until: number, chord: readonly number[], level = 0.06) {
    const gain = context.createGain();
    gain.gain.setValueAtTime(SILENT, start);
    gain.gain.exponentialRampToValueAtTime(level, start + 0.3);
    gain.gain.setValueAtTime(level, until - 1);
    gain.gain.exponentialRampToValueAtTime(SILENT, until);
    gain.connect(music);
    gain.connect(bus(0.6, reverbSend));
    const shape = filter("lowpass", 1600, 0.5, gain);
    chord.forEach((note, index) => {
      const pan = panner(index % 2 === 0 ? -0.35 : 0.35, shape);
      tone("triangle", start, until - start, hertz(note), hertz(note), pan, -6);
      tone("triangle", start, until - start, hertz(note), hertz(note), pan, 6);
    });
  }

  // Cartoon effects.

  /** A bubble pop that rises an octave: the sound of a thing that appears. */
  function bloop(time: number, note: number, level = 0.22, pan = 0) {
    const out = panner(pan, effects);
    out.connect(bus(0.25, reverbSend));
    tone("sine", time, 0.09, hertz(note) / 2, hertz(note), envelope(time, level, 0.004, 0.1, out));
  }

  /** A slide whistle down, for a fall. */
  function fall(time: number, length: number) {
    tone("sine", time, length, 1500, 420, envelope(time, 0.12, 0.05, length, panner(0, effects)));
  }

  /** A spring for a landing or a hop. */
  function boing(time: number, from: number, to: number, level = 0.22) {
    const shape = envelope(time, level, 0.003, 0.3, effects);
    const oscillator = context.createOscillator();
    oscillator.type = "triangle";
    oscillator.frequency.setValueAtTime(from, time);
    oscillator.frequency.exponentialRampToValueAtTime(to, time + 0.28);
    const wobble = context.createOscillator();
    wobble.frequency.value = 22;
    const depth = context.createGain();
    depth.gain.value = from * 0.08;
    wobble.connect(depth);
    depth.connect(oscillator.frequency);
    oscillator.connect(shape);
    for (const node of [oscillator, wobble]) {
      node.start(time);
      node.stop(time + 0.35);
    }
  }

  function whoosh(time: number, length: number, level = 0.22) {
    const gain = context.createGain();
    gain.gain.setValueAtTime(SILENT, time);
    gain.gain.exponentialRampToValueAtTime(level, time + length * 0.6);
    gain.gain.exponentialRampToValueAtTime(SILENT, time + length);
    gain.connect(effects);
    gain.connect(bus(0.4, reverbSend));
    const shape = filter("bandpass", 500, 1.2, gain);
    shape.frequency.setValueAtTime(500, time);
    shape.frequency.exponentialRampToValueAtTime(5000, time + length);
    noise(time, length, shape);
  }

  /** A coin: two bright bell tones a fourth apart. */
  function coin(time: number, note: number, pan: number) {
    const out = panner(pan, effects);
    out.connect(bus(0.4, reverbSend));
    tone(
      "square",
      time,
      0.07,
      hertz(note),
      hertz(note),
      filter("lowpass", 5000, 0.7, envelope(time, 0.07, 0.002, 0.07, out)),
    );
    tone("sine", time + 0.07, 0.5, hertz(note + 5), hertz(note + 5), envelope(time + 0.07, 0.16, 0.002, 0.5, out));
  }

  function sparkle(time: number, from: number, count: number, level = 0.08) {
    for (let index = 0; index < count; index += 1) {
      marimba(time + index * 0.045, scale(from + index) + 12, level, index % 2 === 0 ? -0.4 : 0.4, 0.3);
    }
  }

  function blip(time: number, from: number, to: number, level = 0.1) {
    tone("sine", time, 0.05, from, to, envelope(time, level, 0.002, 0.05, effects));
  }

  function tick(time: number) {
    noise(time, 0.012, filter("bandpass", 4200, 3, envelope(time, 0.12, 0.001, 0.012, effects)));
  }

  /** A message sent: two quick notes up. */
  function send(time: number) {
    bloop(time, 81, 0.16, 0.3);
    bloop(time + 0.06, 88, 0.12, 0.3);
  }

  // The hello: the fall, the landing, the words, the blink and the hop.
  fall(CUE.drop, CUE.land - CUE.drop);
  boing(CUE.land, 520, 170, 0.26);
  kick(CUE.land, 0.7);
  marimba(CUE.meet, 65, 0.2);
  marimba(CUE.meet, 72, 0.12);
  bloop(CUE.meet, 72);
  marimba(CUE.name, 69, 0.2);
  marimba(CUE.name, 77, 0.12);
  bloop(CUE.name, 77, 0.24);
  sparkle(CUE.name + 0.05, 4, 6);
  blip(CUE.blink, 1900, 1300);
  boing(at(4), 260, 720, 0.18);

  // The groove.
  for (let time = GROOVE.start; time < GROOVE.end - 0.01; time += BEAT) {
    const beat = Math.round(time / BEAT);
    const bar = barAt(time);
    kick(time, beat % 4 === 0 ? 0.85 : 0.7);
    if (beat % 2 === 1) snap(time);
    shaker(time + BEAT / 2);
    shaker(time + BEAT / 4, 0.03);
    bass(time, bar.root + 12, 0.18, 0.45);
    bass(time + BEAT / 2, bar.root + 24, 0.12, 0.3);
    // Up the chord and back, one note per eighth.
    const step = (beat * 2) % 4;
    const notes = [bar.chord[0], bar.chord[1], bar.chord[2], bar.chord[1]];
    marimba(time, (notes[step] ?? 65) + 12, 0.09, -0.3, 0.25);
    marimba(time + BEAT / 2, (notes[step + 1] ?? 65) + 12, 0.07, 0.3, 0.25);
  }

  // The wipes, the titles, the cards, and the window.
  for (const wipe of WIPES) whoosh(wipe - 0.15, 0.6);
  for (const [index, time] of [CUE.teamTitle, CUE.teamTitle + BEAT].entries()) bloop(time, scale(2 + index * 2));
  for (const [index, time] of CUE.cards.entries()) {
    bloop(time, scale(3 + index * 2), 0.24, (index - 1.5) * 0.3);
    marimba(time, scale(3 + index * 2), 0.1, (index - 1.5) * 0.3);
  }
  whoosh(CUE.window - 0.05, 0.4, 0.14);
  for (const [index, time] of CUE.chatTitle.entries()) bloop(time, scale(1 + index * 2), 0.18);

  // The chat: typing, then each message.
  for (const time of [CUE.request, ...CUE.messages]) {
    if (time !== CUE.request) for (let step = 0; step < 5; step += 1) tick(time - 0.38 + step * 0.07 + next() * 0.02);
    send(time);
  }
  kick(CUE.shipped, 0.9);
  tone("sine", CUE.shipped, 0.3, 220, 90, envelope(CUE.shipped, 0.4, 0.002, 0.3, effects));
  snap(CUE.shipped + 0.02, 0.45);
  sparkle(CUE.shipped + 0.05, 2, 8, 0.1);

  // The models.
  bloop(CUE.modelsTitle, scale(4));
  bloop(CUE.modelsLine, scale(6), 0.14);
  for (const [index, time] of CUE.coins.entries()) coin(time, 84 + ([0, 2, 4, 7][index] ?? 0), (index - 1.5) * 0.4);

  // The end card.
  fall(CUE.logo, 0.45);
  boing(CUE.logo + 0.45, 480, 160, 0.26);
  kick(CUE.logo + 0.45, 0.9);
  pad(CUE.logo + 0.45, PASTEL_DURATION, OUTRO_CHORD);
  sparkle(CUE.logo + 0.5, 0, 10, 0.09);
  bloop(CUE.tagline, scale(4));
  bloop(CUE.tagline + BEAT, scale(6));
  bloop(CUE.url, scale(8), 0.24);
  marimba(CUE.url, 77, 0.14);
  marimba(CUE.url, 84, 0.1);
  for (const [index, time] of CUE.peek.entries()) bloop(time, scale(3 + index * 2), 0.16, (index - 1.5) * 0.5);
  boing(at(29.5), 260, 720, 0.14);
  blip(CUE.wink, 1500, 2300, 0.12);
  for (let time = CUE.logo + 0.45 + BEAT; time < PASTEL_DURATION - 1.2; time += BEAT) {
    const step = Math.round(time / BEAT) % 4;
    marimba(time, (OUTRO_CHORD[2 + step] ?? 69) + 12, 0.05, step % 2 === 0 ? -0.3 : 0.3, 0.3);
  }

  const rendered = await context.startRendering();
  normalize(rendered);
  return rendered;
}
