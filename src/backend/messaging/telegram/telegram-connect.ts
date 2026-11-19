import type { ConnectTelegramChatInput } from "@openbot/contracts/ipc";
import type { Effect } from "effect";
import type { MessagingOperationFailed } from "../messaging-service";

export interface TelegramAppPort {
  createLink(): Effect.Effect<{ botUsername: string; code: string }, MessagingOperationFailed>;
  unlink(chatId: string): Effect.Effect<void, MessagingOperationFailed>;
  openExternal(url: string): Promise<void>;
}

export function telegramLinkUrl(botUsername: string, code: string, place: ConnectTelegramChatInput["place"]): string {
  const url = new URL(`https://t.me/${encodeURIComponent(botUsername)}`);
  url.searchParams.set(place === "group" ? "startgroup" : "start", code);
  return url.toString();
}
