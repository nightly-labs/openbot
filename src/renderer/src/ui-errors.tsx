import type { AgentMessage } from "@openbot/ui/data";
import { currentText } from "@openbot/ui/text";
import { errorReference } from "@openbot/user-errors";
import { createSignal } from "solid-js";
import { formatMessageTime } from "./app-message-projection";
import { agentConversationKey } from "./features/conversation/conversation-keys";
import { createSimpleContext } from "./simple-context";

export function isConnectionDrop(error: unknown): boolean {
  return errorReference(error) === "http/503/remote_disconnected";
}

const UiErrors = createSimpleContext({
  name: "UI errors",
  init: () => {
    const [uiErrors, setUiErrors] = createSignal<Record<string, AgentMessage[]>>({});

    function appendUiError(agentId: string, error: unknown, status: string, serverId: string): void {
      const { t, errorMessage } = currentText();
      const body = errorMessage(error, t("app.error.actionFailed"));
      const errorKey = agentConversationKey(serverId, agentId);
      setUiErrors((current) => ({
        ...current,
        [errorKey]: [
          ...(current[errorKey] ?? []).filter((entry) => entry.status !== status || entry.body !== body),
          {
            id: `ui-${Date.now()}-${Math.random()}`,
            author: "agent",
            body,
            time: formatMessageTime(new Date().toISOString()),
            kind: "error",
            status,
          },
        ],
      }));
    }

    function clearUiErrors(status: string, errorKey?: string): void {
      setUiErrors((current) => {
        let next = current;
        for (const [key, errors] of Object.entries(current)) {
          if ((errorKey !== undefined && key !== errorKey) || !errors.some((entry) => entry.status === status))
            continue;
          next = { ...next, [key]: errors.filter((entry) => entry.status !== status) };
        }
        return next;
      });
    }

    return { uiErrors, setUiErrors, appendUiError, clearUiErrors };
  },
});

export const UiErrorsProvider = UiErrors.provider;
export const useUiErrors = UiErrors.use;
