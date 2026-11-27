import { File, Paths } from "expo-file-system";
import { supportLog, supportLogValue } from "@/features/support/model/support-log";
import { isAndroid } from "@/shared/lib/platform";
import { type BubbleAgent, type ChatBubblePreference, resolvedBubbleAgents } from "./chat-bubble-preference";

const CONFIG_FILE = "chat-bubble.json";

let writtenConfig: string | null = null;

export function writeChatBubbleConfig(preference: ChatBubblePreference, agents: readonly BubbleAgent[]): void {
  if (!isAndroid) return;
  const text = JSON.stringify({
    version: 1,
    enabled: preference.enabled,
    agents: resolvedBubbleAgents(preference, agents),
  });
  if (text === writtenConfig) return;
  try {
    new File(Paths.document, CONFIG_FILE).writeSync(text);
    writtenConfig = text;
  } catch (error) {
    supportLog.add("warn", "app", `Chat bubble settings not saved: ${supportLogValue(error)}`);
  }
}

export function resetChatBubbleConfig(): void {
  writtenConfig = null;
  if (!isAndroid) return;
  try {
    const file = new File(Paths.document, CONFIG_FILE);
    if (file.exists) file.delete();
  } catch (error) {
    supportLog.add("warn", "app", `Chat bubble settings not removed: ${supportLogValue(error)}`);
  }
}
