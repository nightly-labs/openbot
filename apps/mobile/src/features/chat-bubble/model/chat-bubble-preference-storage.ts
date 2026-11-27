import * as SecureStore from "expo-secure-store";
import {
  agentBubbleKey,
  CHAT_BUBBLE_STORAGE_KEY,
  type ChatBubblePreference,
  chatBubblePreferenceText,
  decodeChatBubblePreference,
  useChatBubblePreference,
} from "./chat-bubble-preference";

export async function loadChatBubblePreference(): Promise<void> {
  if (useChatBubblePreference.getState().ready) return;
  const stored = decodeChatBubblePreference(await SecureStore.getItemAsync(CHAT_BUBBLE_STORAGE_KEY));
  if (useChatBubblePreference.getState().ready) return;
  useChatBubblePreference.setState({ ...stored, ready: true });
}

export async function saveChatBubblePreference(change: Partial<ChatBubblePreference>): Promise<void> {
  await save((stored) => ({ ...stored, ...change }));
}

export async function saveAgentBubbleOverride(
  serverId: string,
  agentId: string,
  enabled: boolean | null,
): Promise<void> {
  await save((stored) => {
    const agents = { ...stored.agents };
    const key = agentBubbleKey(serverId, agentId);
    if (enabled === null) delete agents[key];
    else agents[key] = enabled;
    return { ...stored, agents };
  });
}

async function save(change: (stored: ChatBubblePreference) => ChatBubblePreference): Promise<void> {
  const state = useChatBubblePreference.getState();
  if (!state.ready || state.saving) return;
  const next = change(state);
  useChatBubblePreference.setState({ ...next, saving: true });
  try {
    await SecureStore.setItemAsync(CHAT_BUBBLE_STORAGE_KEY, chatBubblePreferenceText(next));
  } finally {
    useChatBubblePreference.setState({ saving: false });
  }
}
