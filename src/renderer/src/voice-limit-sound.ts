import { appSoundContext } from "./completion-sound";

/**
 * The cues of the voice recording limit, made with Web Audio like the task completion sound. They
 * play whatever the sound settings say: the user is speaking, and may not look at the screen.
 * `unlockCompletionSound` starts their audio context from the click that starts a recording.
 */

/** Two short high pips: the recording stops soon. */
export function playVoiceLimitWarning(): void {
  void playTones([
    { frequency: 880, at: 0, duration: 0.09, volume: 0.08 },
    { frequency: 880, at: 0.16, duration: 0.09, volume: 0.08 },
  ]);
}

/** A falling two-note chime, unlike the completion sweep: the recording stopped at the limit. */
export function playVoiceLimitStop(): void {
  void playTones([
    { frequency: 784, at: 0, duration: 0.18, volume: 0.14 },
    { frequency: 523, at: 0.16, duration: 0.32, volume: 0.14 },
  ]);
}

async function playTones(
  tones: ReadonlyArray<{ frequency: number; at: number; duration: number; volume: number }>,
): Promise<void> {
  try {
    const context = await appSoundContext();
    const startedAt = context.currentTime;
    for (const tone of tones) {
      const start = startedAt + tone.at;
      const oscillator = context.createOscillator();
      const gain = context.createGain();
      oscillator.type = "sine";
      oscillator.frequency.setValueAtTime(tone.frequency, start);
      gain.gain.setValueAtTime(0.0001, start);
      gain.gain.exponentialRampToValueAtTime(tone.volume, start + 0.01);
      gain.gain.exponentialRampToValueAtTime(0.0001, start + tone.duration);
      oscillator.connect(gain);
      gain.connect(context.destination);
      oscillator.addEventListener(
        "ended",
        () => {
          oscillator.disconnect();
          gain.disconnect();
        },
        { once: true },
      );
      oscillator.start(start);
      oscillator.stop(start + tone.duration);
    }
  } catch {
    // A cue that cannot play is not worth an error: the countdown still shows.
  }
}
