import { createSignal } from "solid-js";
import { z } from "zod";

/** The agent chat that the main window opens when the app starts. No value opens the last chat. */
const STARTUP_AGENT_CHAT_STORAGE_KEY = "openbot:startup-agent-chat:v1";

export interface StartupAgentChat {
  serverId: string;
  agentId: string;
}

const startupAgentChatSchema = z.object({ serverId: z.string().min(1), agentId: z.string().min(1) }).nullable();

let unsavedPreference: StartupAgentChat | null | undefined;

export function readStartupAgentChat(): StartupAgentChat | null {
  if (unsavedPreference !== undefined) return unsavedPreference;
  try {
    const parsed = startupAgentChatSchema.safeParse(
      JSON.parse(window.localStorage.getItem(STARTUP_AGENT_CHAT_STORAGE_KEY) ?? "null"),
    );
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

function writeStartupAgentChat(chat: StartupAgentChat | null): void {
  try {
    if (chat) window.localStorage.setItem(STARTUP_AGENT_CHAT_STORAGE_KEY, JSON.stringify(chat));
    else window.localStorage.removeItem(STARTUP_AGENT_CHAT_STORAGE_KEY);
    unsavedPreference = undefined;
  } catch {
    unsavedPreference = chat;
  }
}

const [startupAgentChat, setStartupAgentChatSignal] = createSignal(readStartupAgentChat());

function readStorageIntoSignal(event: StorageEvent): void {
  if (event.key !== null && event.key !== STARTUP_AGENT_CHAT_STORAGE_KEY) return;
  setStartupAgentChatSignal(readStartupAgentChat());
}

if (typeof window !== "undefined") {
  window.addEventListener("storage", readStorageIntoSignal);
  import.meta.hot?.dispose(() => {
    window.removeEventListener("storage", readStorageIntoSignal);
  });
}

export function useStartupAgentChat(): () => StartupAgentChat | null {
  return startupAgentChat;
}

export function setStartupAgentChat(chat: StartupAgentChat | null): void {
  writeStartupAgentChat(chat);
  setStartupAgentChatSignal(chat);
}

/**
 * The chat that this launch still has to open. The value is read one time per page, so a later
 * server switch or a change to the setting does not open a chat. It is kept at module level because
 * the switch to the chat's server disposes the scope that started the switch.
 */
let launchTarget: StartupAgentChat | null | undefined;

export function pendingStartupAgentChat(): StartupAgentChat | null {
  if (launchTarget === undefined) launchTarget = readStartupAgentChat();
  return launchTarget;
}

export function finishStartupAgentChat(): void {
  launchTarget = null;
}
