import type { AgentEvent, AgentSummary, ServerNotificationLevel } from "@openbot/contracts/ipc";
import type { AppTranslate } from "@openbot/i18n";
import { notificationForAgentEvent } from "@openbot/team-client/agent-notifications";

const PERMISSION_ASKED_KEY = "openbot.web.notification-permission-asked";

/**
 * Asks the browser for notification permission. The browser shows its prompt only from a user action.
 * Without `again`, this browser asks once; a menu choice for notifications asks again while the browser
 * has no answer.
 */
export function requestWebNotificationPermission(again = false): void {
  if (typeof Notification === "undefined" || Notification.permission !== "default") return;
  try {
    if (!again && window.localStorage.getItem(PERMISSION_ASKED_KEY)) return;
    window.localStorage.setItem(PERMISSION_ASKED_KEY, "1");
  } catch {
    // Without storage, the browser's own answer still stops a second prompt.
  }
  void Notification.requestPermission().catch(() => undefined);
}

/**
 * Shows a host's agent event as a browser notification while the page does not have focus, as the
 * desktop does while its window does not have focus. One notification is kept for each conversation.
 */
export function showWebAgentNotification(options: {
  hostId: string;
  event: AgentEvent;
  agents: AgentSummary[];
  level: ServerNotificationLevel;
  translate: AppTranslate;
  onOpen(agentId: string): void;
}): void {
  if (typeof Notification === "undefined" || Notification.permission !== "granted" || document.hasFocus()) return;
  const content = notificationForAgentEvent(options.event, options.agents, options.translate, options.level);
  if (!content) return;
  try {
    const notification = new Notification(content.title, {
      body: content.body,
      tag: `${options.hostId}:${content.threadId}`,
    });
    notification.addEventListener("click", () => {
      window.focus();
      notification.close();
      options.onOpen(content.agentId);
    });
  } catch {
    // Some mobile browsers show notifications only from a service worker.
  }
}
