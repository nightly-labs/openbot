import * as SecureStore from "expo-secure-store";
import { create } from "zustand";
import { MOBILE_CHAT_ORDERS, type MobileChatOrder } from "@/features/workspace/model/sidebar-layout";

const key = "openbot.mobile.chatOrder.v1";

/**
 * How the chat list orders its chats. Each phone keeps its own choice: it is not synced to the host
 * or to the other devices. The default is the desktop default.
 */
export const useChatOrderPreference = create<{ order: MobileChatOrder; ready: boolean }>(() => ({
  order: "unread-group",
  ready: false,
}));

export async function loadChatOrderPreference(): Promise<void> {
  if (useChatOrderPreference.getState().ready) return;
  try {
    const stored = await SecureStore.getItemAsync(key);
    const order = MOBILE_CHAT_ORDERS.find((candidate) => candidate === stored);
    // A second startup read must not overwrite a change made in the menu.
    if (order && !useChatOrderPreference.getState().ready) useChatOrderPreference.setState({ order });
  } finally {
    useChatOrderPreference.setState({ ready: true });
  }
}

/** The writes run one after the other, so the last choice is the one that stays. */
let writes: Promise<void> = Promise.resolve();

export function saveChatOrderPreference(order: MobileChatOrder): Promise<void> {
  // Apply immediately, also when storage fails: the list then keeps the choice until the app restarts.
  useChatOrderPreference.setState({ order, ready: true });
  const write = writes.then(() => SecureStore.setItemAsync(key, order));
  writes = write.catch(() => undefined);
  return write;
}
