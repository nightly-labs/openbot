import * as SecureStore from "expo-secure-store";
import { create } from "zustand";
import { MOBILE_CHAT_ORDERS, type MobileChatOrder } from "@/features/workspace/model/sidebar-layout";
import { writesInOrder } from "@/shared/lib/writes-in-order";

const key = "openbot.mobile.chatOrder.v1";

export const useChatOrderPreference = create<{ order: MobileChatOrder | null; ready: boolean }>(() => ({
  order: null,
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

const write = writesInOrder(key);

export function saveChatOrderPreference(order: MobileChatOrder): Promise<void> {
  useChatOrderPreference.setState({ order, ready: true });
  return write(() => order);
}
