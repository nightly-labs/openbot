import type { AgentEvent, ClientAgentSummary, ServerNotificationLevel } from "@openbot/contracts/ipc";
import type { AppTranslate } from "@openbot/i18n";
import {
  type AgentNotificationChannel,
  notificationForAgentEvent,
  notificationRequestKey,
} from "@openbot/team-client/agent-notifications";
import type { ChannelNotificationContent } from "@openbot/team-client/channel-notifications";

const PERMISSION_ASKED_KEY = "openbot.web.notification-permission-asked";
const FOCUSED_TAB_KEY = "openbot.web.focused-tab";
const TAB_ID = crypto.randomUUID();

export function requestWebNotificationPermission(again = false): void {
  if (typeof Notification === "undefined" || Notification.permission !== "default") return;
  if (navigator.userActivation && !navigator.userActivation.isActive) return;
  try {
    if (!again && window.localStorage.getItem(PERMISSION_ASKED_KEY)) return;
    window.localStorage.setItem(PERMISSION_ASKED_KEY, "1");
  } catch {}
  try {
    void Promise.resolve(Notification.requestPermission()).catch(() => undefined);
  } catch {}
}

const FOCUS_RECORD_MS = 60_000;

function readFocusRecord(): { tabId: string; until: number } | null {
  try {
    const [tabId, until] = (window.localStorage.getItem(FOCUSED_TAB_KEY) ?? "").split(" ");
    const end = Number(until);
    return tabId && Number.isFinite(end) ? { tabId, until: end } : null;
  } catch {
    return null;
  }
}

export function watchWebTabFocus(): () => void {
  let renewal: ReturnType<typeof setInterval> | undefined;
  const mark = () => {
    try {
      window.localStorage.setItem(FOCUSED_TAB_KEY, `${TAB_ID} ${Date.now() + FOCUS_RECORD_MS}`);
    } catch {}
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
    } catch {}
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

export type WebNotificationChat = { agentId: string } | { channelId: string };

const chatNotifications = new Map<string, Set<Notification>>();

function chatKey(hostId: string, chat: WebNotificationChat): string {
  return "channelId" in chat ? `${hostId}\nchannel:${chat.channelId}` : `${hostId}\nagent:${chat.agentId}`;
}

function trackChatNotification(hostId: string, chat: WebNotificationChat, notification: Notification): void {
  const key = chatKey(hostId, chat);
  const shown = chatNotifications.get(key) ?? new Set<Notification>();
  chatNotifications.set(key, shown);
  shown.add(notification);
  for (const oldest of shown) {
    if (shown.size <= REQUEST_NOTIFICATION_LIMIT) break;
    shown.delete(oldest);
  }
  notification.addEventListener("close", () => {
    shown.delete(notification);
    if (shown.size === 0 && chatNotifications.get(key) === shown) chatNotifications.delete(key);
  });
}

export function closeWebChatNotifications(hostId: string, chat: WebNotificationChat): void {
  const key = chatKey(hostId, chat);
  const shown = chatNotifications.get(key);
  if (!shown) return;
  chatNotifications.delete(key);
  for (const notification of shown) notification.close();
}

const requestNotifications = new Map<string, Notification>();
const REQUEST_NOTIFICATION_LIMIT = 50;

export function withdrawWebAgentNotification(hostId: string, event: AgentEvent): void {
  if (event.type !== "agent-input-resolved" && event.type !== "browser-takeover-resolved") return;
  const key = notificationRequestKey(hostId, event);
  const notification = key && requestNotifications.get(key);
  if (!key || !notification) return;
  requestNotifications.delete(key);
  notification.close();
}

export function showWebAgentNotification(options: {
  hostId: string;
  event: AgentEvent;
  agents: ClientAgentSummary[];
  level: ServerNotificationLevel;
  translate: AppTranslate;
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
      requestNotifications.get(key)?.close();
      requestNotifications.set(key, notification);
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
    const ownThreadId = options.agents.find((agent) => agent.id === content.agentId)?.threadId ?? null;
    if (content.channelId) trackChatNotification(options.hostId, { channelId: content.channelId }, notification);
    else if (ownThreadId === null || ownThreadId === content.threadId)
      trackChatNotification(options.hostId, { agentId: content.agentId }, notification);
  } catch {}
}

const channelNotifications = new Map<string, Notification>();

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
      trackChatNotification(options.hostId, { channelId: reply.channelId }, notification);
    } catch {}
  }
}
