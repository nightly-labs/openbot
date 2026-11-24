import { isDynamicRecord, isString } from "@openbot/contracts/runtime-values";
import { useEffect } from "react";
import { useMobileWorkspaceReader } from "@/features/workspace/context/workspace-store";
import { ConnectionUnavailableError } from "@/features/workspace/model/connection-waits";
import type { MobileWorkspaceContextValue } from "@/features/workspace/model/workspace-types";
import { handleShortcutSends, type ShortcutSendAnswer, type ShortcutSendRequest } from "./shortcuts-native";

function refusedByHost(error: unknown): boolean {
  return isDynamicRecord(error) && isString(error.reference) && error.reference.startsWith("http/");
}

async function sendShortcutMessage(
  workspace: MobileWorkspaceContextValue,
  { serverId, agentId, text, clientMessageId }: ShortcutSendRequest,
): Promise<ShortcutSendAnswer> {
  if (!workspace.agents.some((agent) => agent.serverId === serverId && agent.id === agentId)) return "declined";
  try {
    await workspace.sendMessage(
      agentId,
      text,
      [],
      null,
      serverId,
      workspace.canRetryMessage(serverId) ? clientMessageId : undefined,
    );
    return "sent";
  } catch (error) {
    return error instanceof ConnectionUnavailableError || refusedByHost(error) ? "failed" : "unconfirmed";
  }
}

export function ShortcutSendHandler(): null {
  const readWorkspace = useMobileWorkspaceReader();
  useEffect(() => handleShortcutSends((request) => sendShortcutMessage(readWorkspace(), request)), [readWorkspace]);
  return null;
}
