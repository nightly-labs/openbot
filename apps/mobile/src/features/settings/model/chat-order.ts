import * as SecureStore from "expo-secure-store";
import { create } from "zustand";
import { MOBILE_CHAT_ORDERS, type MobileChatOrder } from "@/features/workspace/model/sidebar-layout";

const key = "openbot.mobile.chatOrder.v1";

export const useChatOrderPreference = create<{ order: MobileChatOrder; ready: boolean }>(() => ({
  order: "unread-group",
  ready: false,
}));

export async function loadChatOrderPreference(): Promise<void> {
  if (useChatOrderPreference.getState().ready) return;
  try {
    const stored = await SecureStore.getItemAsync(key);
    const order = MOBILE_CHAT_ORDERS.find((candidate) => candidate === stored);
    if (order && !useChatOrderPreference.getState().ready) useChatOrderPreference.setState({ order });
  } finally {
    useChatOrderPreference.setState({ ready: true });
  }
}

let writes: Promise<void> = Promise.resolve();

export function saveChatOrderPreference(order: MobileChatOrder): Promise<void> {
  useChatOrderPreference.setState({ order, ready: true });
  const write = writes.then(() => SecureStore.setItemAsync(key, order));
  writes = write.catch(() => undefined);
  return write;
}
