import type { AgentEvent, ClientAgentSummary, ServerNotificationLevel } from "@openbot/contracts/ipc";
import type { AppTranslate } from "@openbot/i18n";
import {
  type AgentNotificationChannel,
  notificationForAgentEvent,
  notificationRequestKey,
} from "@openbot/team-client/agent-notifications";
import type { ChannelNotificationContent } from "@openbot/team-client/channel-notifications";

const PERMISSION_ASKED_KEY = "openbot.web.notification-permission-asked";
/** The tab of this browser that has focus. The tab that speaks for a host is often in the background. */
const FOCUSED_TAB_KEY = "openbot.web.focused-tab";
const TAB_ID = crypto.randomUUID();

/**
 * Asks the browser for notification permission. The browser shows its prompt only from a user action.
 * Without `again`, this browser asks once; a menu choice for notifications asks again while the browser
 * has no answer.
 */
export function requestWebNotificationPermission(again = false): void {
  if (typeof Notification === "undefined" || Notification.permission !== "default") return;
  // A send that a queue releases later is no user action. The browser would ignore the request.
  if (navigator.userActivation && !navigator.userActivation.isActive) return;
  try {
    if (!again && window.localStorage.getItem(PERMISSION_ASKED_KEY)) return;
    window.localStorage.setItem(PERMISSION_ASKED_KEY, "1");
  } catch {
    // Without storage, the browser's own answer still stops a second prompt.
  }
  try {
    // Older Safari answers through a callback and returns no promise.
    void Promise.resolve(Notification.requestPermission()).catch(() => undefined);
  } catch {
    // A refused request must not stop the send that asked for it.
  }
}

/** A tab that crashed cannot remove its record, so a record ends unless its focused tab renews it. */
const FOCUS_RECORD_MS = 60_000;

/** The focused tab and the end of its record, or null. */
function readFocusRecord(): { tabId: string; until: number } | null {
  try {
    const [tabId, until] = (window.localStorage.getItem(FOCUSED_TAB_KEY) ?? "").split(" ");
    const end = Number(until);
    return tabId && Number.isFinite(end) ? { tabId, until: end } : null;
  } catch {
    return null;
  }
}

/** Keeps the record of the focused tab current, so that no tab of this browser notifies while one has focus. */
export function watchWebTabFocus(): () => void {
  let renewal: ReturnType<typeof setInterval> | undefined;
  const mark = () => {
    try {
      window.localStorage.setItem(FOCUSED_TAB_KEY, `${TAB_ID} ${Date.now() + FOCUS_RECORD_MS}`);
    } catch {
      // Without storage, each tab knows only its own focus.
    }
  };
  const focus = () => {
    clearInterval(renewal);
    mark();
    renewal = setInterval(mark, FOCUS_RECORD_MS / 2);
  };
  const blur = () => {
    clearInterval(renewal);
    renewal = undefined;
    try {
      if (readFocusRecord()?.tabId === TAB_ID) window.localStorage.removeItem(FOCUSED_TAB_KEY);
    } catch {
      // As above.
    }
  };
  if (document.hasFocus()) focus();
  window.addEventListener("focus", focus);
  window.addEventListener("blur", blur);
  window.addEventListener("pagehide", blur);
  return () => {
    window.removeEventListener("focus", focus);
    window.removeEventListener("blur", blur);
    window.removeEventListener("pagehide", blur);
    blur();
  };
}

function browserFocused(): boolean {
  if (document.hasFocus()) return true;
  const record = readFocusRecord();
  return Boolean(record && record.until > Date.now());
}

/** The shown notifications that wait for an answer, by request, as on desktop. */
const requestNotifications = new Map<string, Notification>();
/** As many as the desktop keeps. */
const REQUEST_NOTIFICATION_LIMIT = 50;

/** Closes the notification of a request that was answered or cancelled, on any device. */
export function withdrawWebAgentNotification(hostId: string, event: AgentEvent): void {
  if (event.type !== "agent-input-resolved" && event.type !== "browser-takeover-resolved") return;
  const key = notificationRequestKey(hostId, event);
  const notification = key && requestNotifications.get(key);
  if (!key || !notification) return;
  requestNotifications.delete(key);
  notification.close();
}

/**
 * Shows a host's agent event as a browser notification while no tab of the app has focus, as the
 * desktop does while its window does not have focus. One tab speaks for each host, so no tag is needed.
 */
export function showWebAgentNotification(options: {
  hostId: string;
  event: AgentEvent;
  agents: ClientAgentSummary[];
  level: ServerNotificationLevel;
  translate: AppTranslate;
  /** The channel whose thread the event came from, or null. */
  channel: AgentNotificationChannel | null;
  onOpen(agentId: string, channelId: string | undefined): void;
}): void {
  if (typeof Notification === "undefined" || Notification.permission !== "granted" || browserFocused()) return;
  const content = notificationForAgentEvent(
    options.event,
    options.agents,
    options.translate,
    options.level,
    null,
    options.channel,
  );
  if (!content) return;
  const key = notificationRequestKey(options.hostId, options.event);
  try {
    const notification = new Notification(content.title, { body: content.body });
    if (key) {
      // A provider can use a request id again. The newest notification replaces the one before it.
      requestNotifications.get(key)?.close();
      requestNotifications.set(key, notification);
      // A lost connection can drop the answer of a request, so the oldest entries go.
      for (const oldest of requestNotifications.keys()) {
        if (requestNotifications.size <= REQUEST_NOTIFICATION_LIMIT) break;
        requestNotifications.delete(oldest);
      }
      notification.addEventListener("close", () => {
        if (requestNotifications.get(key) === notification) requestNotifications.delete(key);
      });
    }
    notification.addEventListener("click", () => {
      window.focus();
      notification.close();
      options.onOpen(content.agentId, content.channelId);
    });
  } catch {
    // Some mobile browsers show notifications only from a service worker.
  }
}

/** The shown reply notification of each channel, by host. A newer reply in the channel replaces it. */
const channelNotifications = new Map<string, Notification>();

/** Shows channel replies as browser notifications while no tab of the app has focus, as the desktop does. */
export function showWebChannelNotifications(options: {
  hostId: string;
  replies: readonly ChannelNotificationContent[];
  onOpen(channelId: string): void;
}): void {
  if (typeof Notification === "undefined" || Notification.permission !== "granted" || browserFocused()) return;
  for (const reply of options.replies) {
    const key = `${options.hostId}\n${reply.channelId}`;
    try {
      const notification = new Notification(reply.title, { body: reply.body });
      channelNotifications.get(key)?.close();
      channelNotifications.set(key, notification);
      notification.addEventListener("close", () => {
        if (channelNotifications.get(key) === notification) channelNotifications.delete(key);
      });
      notification.addEventListener("click", () => {
        window.focus();
        notification.close();
        options.onOpen(reply.channelId);
      });
    } catch {
      // As above.
    }
  }
}
