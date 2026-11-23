import * as SecureStore from "expo-secure-store";
import { create } from "zustand";
import { writesInOrder } from "@/shared/lib/writes-in-order";

const key = "openbot.mobile.chatSwipe.v1";

const CHAT_SWIPE_ACTIONS = ["question", "threads", "browser", "off"] as const;
export type ChatSwipeAction = (typeof CHAT_SWIPE_ACTIONS)[number];

export const useChatSwipePreference = create<{ action: ChatSwipeAction; ready: boolean }>(() => ({
  action: "question",
  ready: false,
}));

export async function loadChatSwipePreference(): Promise<void> {
  if (useChatSwipePreference.getState().ready) return;
  try {
    const stored = await SecureStore.getItemAsync(key);
    const action = CHAT_SWIPE_ACTIONS.find((candidate) => candidate === stored);
    if (action && !useChatSwipePreference.getState().ready) useChatSwipePreference.setState({ action });
  } finally {
    useChatSwipePreference.setState({ ready: true });
  }
}

const write = writesInOrder(key);

export function saveChatSwipePreference(action: ChatSwipeAction): Promise<void> {
  useChatSwipePreference.setState({ action, ready: true });
  return write(() => action);
}

const pullKey = "openbot.mobile.chatPullInfo.v1";

export const useChatPullPreference = create<{ enabled: boolean; ready: boolean }>(() => ({
  enabled: true,
  ready: false,
}));

export async function loadChatPullPreference(): Promise<void> {
  if (useChatPullPreference.getState().ready) return;
  try {
    const stored = await SecureStore.getItemAsync(pullKey);
    if ((stored === "on" || stored === "off") && !useChatPullPreference.getState().ready)
      useChatPullPreference.setState({ enabled: stored === "on" });
  } finally {
    useChatPullPreference.setState({ ready: true });
  }
}

const writePull = writesInOrder(pullKey);

export function saveChatPullPreference(enabled: boolean): Promise<void> {
  useChatPullPreference.setState({ enabled, ready: true });
  return writePull(() => (enabled ? "on" : "off"));
}
