import type { AgentEvent, ClientAgentSummary } from "@openbot/contracts/ipc";
import { TASK_SOUND_CHOICES, type TaskSoundChoice } from "@openbot/ui/features/settings/app-settings";
import { play, unlock } from "cuelume";

const TASK_SOUND_STORAGE_KEY = "openbot:task-sound";
/** The on/off switch from before the sound choice. It is still written, so an older version keeps the choice. */
const COMPLETION_SOUND_STORAGE_KEY = "openbot:completion-sound-enabled";
const COMPLETION_SOUND_DURATION_SECONDS = 0.22;

let completionAudioContext: AudioContext | undefined;

type NotificationAgent = Pick<ClientAgentSummary, "id" | "notifications">;
type PreferenceStorage = Pick<Storage, "getItem">;

/** The choice for this page after the browser did not save it. It wins over an older saved value. */
let unsavedPreference: TaskSoundChoice | undefined;

/**
 * The classic tone plays unless the user chose another sound. A switch turned off before the choice,
 * or in an older version, is "off". Reading `window.localStorage` throws when the browser blocks
 * storage, so it is read inside the guard.
 */
export function readTaskSound(storage?: PreferenceStorage): TaskSoundChoice {
  if (unsavedPreference !== undefined) return unsavedPreference;
  try {
    const source = storage ?? window.localStorage;
    if (source.getItem(COMPLETION_SOUND_STORAGE_KEY) === "false") return "off";
    const saved = source.getItem(TASK_SOUND_STORAGE_KEY);
    // A saved "off" with the switch on means that an older version turned the sound on again.
    return TASK_SOUND_CHOICES.find((choice) => choice === saved && choice !== "off") ?? "classic";
  } catch {
    return "classic";
  }
}

export function setTaskSound(choice: TaskSoundChoice, storage?: Pick<Storage, "setItem">): void {
  try {
    const target = storage ?? window.localStorage;
    // The switch goes first: when only it is saved, "off" still reads as off.
    target.setItem(COMPLETION_SOUND_STORAGE_KEY, String(choice !== "off"));
    target.setItem(TASK_SOUND_STORAGE_KEY, choice);
    unsavedPreference = undefined;
  } catch {
    // Blocked or full storage keeps the choice for this page only.
    unsavedPreference = choice;
  }
}

function shouldPlayCompletionSound(event: AgentEvent, agents: NotificationAgent[]): boolean {
  // A quiet routine run posted nothing, so it has no reply to announce. A turn that continues its
  // plan is not the end of the request.
  if (event.type !== "turn-completed" || event.status !== "completed" || event.quiet || event.continues) return false;
  return agents.some((agent) => agent.id === event.agentId && agent.notifications);
}

export function playCompletionSoundForAgentEvent(
  event: AgentEvent,
  agents: NotificationAgent[],
  storage?: PreferenceStorage,
): void {
  if (shouldPlayCompletionSound(event, agents)) playSoundChoice(readTaskSound(storage));
}

/**
 * Plays a task sound, or previews a sound from a sound menu. A theme plays its success cue while
 * the action sounds are off, because the task sound is a separate choice.
 */
export function playSoundChoice(choice: TaskSoundChoice): void {
  if (choice === "classic") void playClassicTone();
  else if (choice !== "off") play("success", { theme: choice, force: true });
}

/**
 * Starts the audio contexts from a user action. Safari starts a context only from one, a turn can end
 * long after the last action, and iOS can interrupt a running context. The app context also plays
 * the voice limit cues, so it starts for each choice.
 */
export function unlockCompletionSound(): void {
  // A theme plays on the cuelume context.
  const choice = readTaskSound();
  if (choice !== "off" && choice !== "classic") void unlock();
  try {
    completionAudioContext ??= new AudioContext();
    if (completionAudioContext.state !== "running") void completionAudioContext.resume().catch(() => undefined);
  } catch {
    completionAudioContext = undefined;
  }
}

/** The one audio context of the app sounds, so that each sound does not keep its own output open. */
export async function appSoundContext(): Promise<AudioContext> {
  try {
    completionAudioContext ??= new AudioContext();
    if (completionAudioContext.state === "suspended") await completionAudioContext.resume();
    return completionAudioContext;
  } catch (error) {
    completionAudioContext = undefined;
    throw error;
  }
}

async function playClassicTone(): Promise<void> {
  try {
    const context = await appSoundContext();

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
