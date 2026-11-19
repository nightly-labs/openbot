import type { AgentEvent, ClientAgentSummary } from "@openbot/contracts/ipc";
import { teammateTurnCompleted } from "@openbot/team-client/agent-notifications";
import { TASK_SOUND_CHOICES, type TaskSoundChoice } from "@openbot/ui/features/settings/app-settings";
import { play, unlock } from "cuelume";

const TASK_SOUND_STORAGE_KEY = "openbot:task-sound";
const COMPLETION_SOUND_STORAGE_KEY = "openbot:completion-sound-enabled";
const COMPLETION_SOUND_DURATION_SECONDS = 0.22;

let completionAudioContext: AudioContext | undefined;

type NotificationAgent = Pick<ClientAgentSummary, "id" | "notifications">;
type PreferenceStorage = Pick<Storage, "getItem">;

let unsavedPreference: TaskSoundChoice | undefined;

export function readTaskSound(storage?: PreferenceStorage): TaskSoundChoice {
  if (unsavedPreference !== undefined) return unsavedPreference;
  try {
    const source = storage ?? window.localStorage;
    if (source.getItem(COMPLETION_SOUND_STORAGE_KEY) === "false") return "off";
    const saved = source.getItem(TASK_SOUND_STORAGE_KEY);
    return TASK_SOUND_CHOICES.find((choice) => choice === saved && choice !== "off") ?? "classic";
  } catch {
    return "classic";
  }
}

export function setTaskSound(choice: TaskSoundChoice, storage?: Pick<Storage, "setItem">): void {
  try {
    const target = storage ?? window.localStorage;
    target.setItem(COMPLETION_SOUND_STORAGE_KEY, String(choice !== "off"));
    target.setItem(TASK_SOUND_STORAGE_KEY, choice);
    unsavedPreference = undefined;
  } catch {
    unsavedPreference = choice;
  }
}

function shouldPlayCompletionSound(event: AgentEvent, agents: NotificationAgent[]): boolean {
  if (event.type !== "turn-completed" || event.status !== "completed" || event.quiet || event.continues) return false;
  if (teammateTurnCompleted(event)) return false;
  return agents.some((agent) => agent.id === event.agentId && agent.notifications);
}

export function playCompletionSoundForAgentEvent(
  event: AgentEvent,
  agents: NotificationAgent[],
  storage?: PreferenceStorage,
): void {
  if (shouldPlayCompletionSound(event, agents)) playSoundChoice(readTaskSound(storage));
}

export function playSoundChoice(choice: TaskSoundChoice): void {
  if (choice === "classic") void playClassicTone();
  else if (choice !== "off") play("success", { theme: choice, force: true });
}

export function unlockCompletionSound(): void {
  const choice = readTaskSound();
  if (choice !== "off" && choice !== "classic") void unlock();
  try {
    completionAudioContext ??= new AudioContext();
    if (completionAudioContext.state !== "running") void completionAudioContext.resume().catch(() => undefined);
  } catch {
    completionAudioContext = undefined;
  }
}

let preparing = false;

export function prepareCompletionSound(): void {
  if (completionAudioContext || preparing || readTaskSound() !== "classic") return;
  preparing = true;
  requestIdleCallback(() => {
    preparing = false;
    try {
      completionAudioContext ??= new AudioContext();
    } catch {
      completionAudioContext = undefined;
    }
  });
}

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
