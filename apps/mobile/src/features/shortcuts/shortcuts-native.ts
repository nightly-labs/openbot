import { isDynamicRecord, isString } from "@openbot/contracts/runtime-values";
import { type NativeModule, requireOptionalNativeModule } from "expo";
import { pendingNavigation } from "@/shared/lib/pending-navigation";
import type { ShortcutOpenTarget } from "./model/shortcut-target";

export type ShortcutSendAnswer = "sent" | "failed" | "unconfirmed" | "declined";

export interface ShortcutSendRequest {
  serverId: string;
  agentId: string;
  text: string;
  clientMessageId: string;
}

declare class ShortcutsModule extends NativeModule<{
  onShortcutOpen: (event: { payload: string }) => void;
  onShortcutSend: (event: { id: string; payload: string }) => void;
}> {
  readonly supported: boolean;
  listenForSends(listening: boolean): void;
  answerSend(id: string, outcome: ShortcutSendAnswer): void;
}

const native = requireOptionalNativeModule<ShortcutsModule>("OpenBotShortcuts");

export const shortcutsSupported = native?.supported === true;

function decodeOpenTarget(payload: string): ShortcutOpenTarget | null {
  let value: unknown;
  try {
    value = JSON.parse(payload);
  } catch {
    return null;
  }
  if (!isDynamicRecord(value)) return null;
  if (value.screen === "chat" && isString(value.agentId)) {
    const draft =
      isString(value.serverId) && isString(value.text) && value.text
        ? { serverId: value.serverId, text: value.text }
        : null;
    return { screen: "chat", agentId: value.agentId, draft };
  }
  return { screen: value.screen === "settings" ? "settings" : "home" };
}

function decodeSendRequest(payload: string): ShortcutSendRequest | null {
  let value: unknown;
  try {
    value = JSON.parse(payload);
  } catch {
    return null;
  }
  if (!isDynamicRecord(value)) return null;
  const { serverId, agentId, text, clientMessageId } = value;
  if (!isString(serverId) || !isString(agentId) || !isString(text) || !isString(clientMessageId)) return null;
  return { serverId, agentId, text, clientMessageId };
}

let listening = false;
const opener = pendingNavigation<ShortcutOpenTarget>();

export function installShortcuts(): void {
  if (listening || !native) return;
  listening = true;
  native.addListener("onShortcutOpen", ({ payload }) => opener.receive(decodeOpenTarget(payload)));
}

export function setShortcutNavigator(open: (target: ShortcutOpenTarget) => void): () => void {
  return opener.setNavigator(open);
}

export function resetShortcuts(): void {
  opener.reset();
}

export function handleShortcutSends(send: (request: ShortcutSendRequest) => Promise<ShortcutSendAnswer>): () => void {
  if (!native) return () => undefined;
  const module = native;
  const subscription = module.addListener("onShortcutSend", ({ id, payload }) => {
    const request = decodeSendRequest(payload);
    const answer = request
      ? send(request).catch((): "unconfirmed" => "unconfirmed")
      : Promise.resolve<ShortcutSendAnswer>("declined");
    void answer.then((outcome) => module.answerSend(id, outcome));
  });
  module.listenForSends(true);
  return () => {
    module.listenForSends(false);
    subscription.remove();
  };
}
