import type { AgentEvent, AgentSummary } from "@openbot/contracts/ipc";

const COMPLETION_SOUND_STORAGE_KEY = "openbot:completion-sound-enabled";
const COMPLETION_SOUND_DURATION_SECONDS = 0.22;

let completionAudioContext: AudioContext | undefined;

type NotificationAgent = Pick<AgentSummary, "id" | "notifications">;
type PreferenceStorage = Pick<Storage, "getItem">;

/** The choice for this page after the browser did not save it. It wins over an older saved value. */
let unsavedPreference: boolean | undefined;

/**
 * The sound is on unless the user turned it off; it played before the switch was saved. Reading
 * `window.localStorage` throws when the browser blocks storage, so it is read inside the guard.
 */
export function isCompletionSoundEnabled(storage?: PreferenceStorage): boolean {
  if (unsavedPreference !== undefined) return unsavedPreference;
  try {
    return (storage ?? window.localStorage).getItem(COMPLETION_SOUND_STORAGE_KEY) !== "false";
  } catch {
    return true;
  }
}

export function setCompletionSoundEnabled(enabled: boolean, storage?: Pick<Storage, "setItem">): void {
  try {
    (storage ?? window.localStorage).setItem(COMPLETION_SOUND_STORAGE_KEY, String(enabled));
    unsavedPreference = undefined;
  } catch {
    // Blocked or full storage keeps the switch for this page only.
    unsavedPreference = enabled;
  }
}

export function shouldPlayCompletionSound(
  event: AgentEvent,
  agents: NotificationAgent[],
  storage?: PreferenceStorage,
): boolean {
  // A quiet routine run posted nothing, so it has no reply to announce.
  if (event.type !== "turn-completed" || event.status !== "completed" || event.quiet) return false;
  if (!isCompletionSoundEnabled(storage)) return false;
  return agents.some((agent) => agent.id === event.agentId && agent.notifications);
}

export function playCompletionSoundForAgentEvent(
  event: AgentEvent,
  agents: NotificationAgent[],
  storage?: PreferenceStorage,
): void {
  if (!shouldPlayCompletionSound(event, agents, storage)) return;
  void playCompletionSound();
}

/**
 * Starts the audio context from a user action. Safari starts a context only from one, a turn can end
 * long after the last action, and iOS can interrupt a running context.
 */
export function unlockCompletionSound(): void {
  try {
    completionAudioContext ??= new AudioContext();
    if (completionAudioContext.state !== "running") void completionAudioContext.resume().catch(() => undefined);
  } catch {
    completionAudioContext = undefined;
  }
}

async function playCompletionSound(): Promise<void> {
  try {
    completionAudioContext ??= new AudioContext();
    const context = completionAudioContext;
    if (context.state === "suspended") await context.resume();

    const startedAt = context.currentTime;
    const oscillator = context.createOscillator();
    const gain = context.createGain();

    oscillator.type = "sine";
    oscillator.frequency.setValueAtTime(420, startedAt);
    oscillator.frequency.exponentialRampToValueAtTime(160, startedAt + 0.18);
    gain.gain.setValueAtTime(0.0001, startedAt);
    gain.gain.exponentialRampToValueAtTime(0.16, startedAt + 0.008);
    gain.gain.exponentialRampToValueAtTime(0.0001, startedAt + COMPLETION_SOUND_DURATION_SECONDS);

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
    oscillator.start(startedAt);
    oscillator.stop(startedAt + COMPLETION_SOUND_DURATION_SECONDS);
  } catch {
    completionAudioContext = undefined;
  }
}
