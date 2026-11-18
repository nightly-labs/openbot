import * as SecureStore from "expo-secure-store";
import { create } from "zustand";

const key = "openbot.mobile.chatSwipe.v1";

/**
 * What a swipe away from Back opens in an agent's chat: its side question, its threads, its browser, or
 * nothing ("off"). The pull past the latest message opens the agent's info. A stored choice that is
 * not here gets the default. An older app reads a stored "question" as no choice, and uses its default.
 */
const CHAT_SWIPE_ACTIONS = ["question", "threads", "browser", "off"] as const;
export type ChatSwipeAction = (typeof CHAT_SWIPE_ACTIONS)[number];

/**
 * The swipe of an agent's chat. Each phone keeps its own choice: it is not synced to the host or to
 * the other devices. The default is the side question.
 */
export const useChatSwipePreference = create<{ action: ChatSwipeAction; ready: boolean }>(() => ({
  action: "question",
  ready: false,
}));

export async function loadChatSwipePreference(): Promise<void> {
  if (useChatSwipePreference.getState().ready) return;
  try {
    const stored = await SecureStore.getItemAsync(key);
    const action = CHAT_SWIPE_ACTIONS.find((candidate) => candidate === stored);
    // A second startup read must not overwrite a change made in Settings.
    if (action && !useChatSwipePreference.getState().ready) useChatSwipePreference.setState({ action });
  } finally {
    useChatSwipePreference.setState({ ready: true });
  }
}

/** The writes run one after the other, so the last choice is the one that stays. */
let writes: Promise<void> = Promise.resolve();

export function saveChatSwipePreference(action: ChatSwipeAction): Promise<void> {
  // Apply immediately, also when storage fails: the chat then keeps the choice until the app restarts.
  useChatSwipePreference.setState({ action, ready: true });
  const write = writes.then(() => SecureStore.setItemAsync(key, action));
  writes = write.catch(() => undefined);
  return write;
}

const pullKey = "openbot.mobile.chatPullInfo.v1";

/**
 * Whether a pull past the latest message of a chat opens its info: the agent's info in an agent's
 * chat or thread, and the channel's info in a channel. Each phone keeps its own choice. On by default.
 */
export const useChatPullPreference = create<{ enabled: boolean; ready: boolean }>(() => ({
  enabled: true,
  ready: false,
}));

export async function loadChatPullPreference(): Promise<void> {
  if (useChatPullPreference.getState().ready) return;
  try {
    const stored = await SecureStore.getItemAsync(pullKey);
    // A second startup read must not overwrite a change made in Settings.
    if ((stored === "on" || stored === "off") && !useChatPullPreference.getState().ready)
      useChatPullPreference.setState({ enabled: stored === "on" });
  } finally {
    useChatPullPreference.setState({ ready: true });
  }
}

let pullWrites: Promise<void> = Promise.resolve();

export function saveChatPullPreference(enabled: boolean): Promise<void> {
  useChatPullPreference.setState({ enabled, ready: true });
  const write = pullWrites.then(() => SecureStore.setItemAsync(pullKey, enabled ? "on" : "off"));
  pullWrites = write.catch(() => undefined);
  return write;
}
