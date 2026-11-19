import { VOICE_AUDIO_LIMITS } from "@openbot/contracts/ipc";
import { currentText } from "@openbot/ui/text";

export function appendVoiceTranscript(draft: string, transcript: string): string {
  const text = transcript.trim();
  if (!text) return draft;
  if (!draft || /\s$/u.test(draft)) return `${draft}${text}`;
  return `${draft} ${text}`;
}

export async function recordingToWav(recording: Blob): Promise<Uint8Array> {
  return encodePcmWav(await recordingToSamples(recording), VOICE_AUDIO_LIMITS.sampleRate);
}

export async function recordingToSamples(recording: Blob): Promise<Float32Array> {
  const context = new AudioContext();
  try {
    const decoded = await context.decodeAudioData(await recording.arrayBuffer());
    const mono = mixToMono(decoded);
    const resampled = resample(mono, decoded.sampleRate, VOICE_AUDIO_LIMITS.sampleRate);
    if (resampled.length > VOICE_AUDIO_LIMITS.sampleRate * VOICE_AUDIO_LIMITS.maximumSeconds) {
      throw new Error(currentText().t("app.voice.tooLong"));
    }
    return resampled;
  } finally {
    await context.close();
  }
}

function encodePcmWav(samples: Float32Array, sampleRate: number): Uint8Array {
  const output = new Uint8Array(44 + samples.length * 2);
  const view = new DataView(output.buffer);
  writeAscii(output, 0, "RIFF");
  view.setUint32(4, output.byteLength - 8, true);
  writeAscii(output, 8, "WAVE");
  writeAscii(output, 12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  writeAscii(output, 36, "data");
  view.setUint32(40, samples.length * 2, true);
  output.set(encodePcm16(samples), 44);
  return output;
}

export function encodePcm16(samples: Float32Array): Uint8Array {
  const output = new Uint8Array(samples.length * 2);
  const view = new DataView(output.buffer);
  for (let index = 0; index < samples.length; index += 1) {
    const sample = Math.max(-1, Math.min(1, samples[index] ?? 0));
    view.setInt16(index * 2, sample < 0 ? sample * 0x8000 : sample * 0x7fff, true);
  }
  return output;
}

function mixToMono(audio: AudioBuffer): Float32Array {
  const mono = new Float32Array(audio.length);
  for (let channel = 0; channel < audio.numberOfChannels; channel += 1) {
    const input = audio.getChannelData(channel);
    for (let index = 0; index < input.length; index += 1)
      mono[index] = (mono[index] ?? 0) + (input[index] ?? 0) / audio.numberOfChannels;
  }
  return mono;
}

function resample(input: Float32Array, sourceRate: number, targetRate: number): Float32Array {
  if (sourceRate === targetRate) return input;
  const output = new Float32Array(Math.floor((input.length * targetRate) / sourceRate));
  const ratio = sourceRate / targetRate;
  for (let index = 0; index < output.length; index += 1) {
    const position = index * ratio;
    const lower = Math.floor(position);
    const upper = Math.min(lower + 1, input.length - 1);
    const fraction = position - lower;
    output[index] = (input[lower] ?? 0) * (1 - fraction) + (input[upper] ?? 0) * fraction;
  }
  return output;
}

function writeAscii(output: Uint8Array, offset: number, value: string): void {
  for (let index = 0; index < value.length; index += 1) output[offset + index] = value.charCodeAt(index);
}
