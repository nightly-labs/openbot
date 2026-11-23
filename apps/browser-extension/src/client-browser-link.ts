import { isDynamicRecord } from "@openbot/contracts/runtime-values";
import {
  CLIENT_BROWSER_CAPABILITY,
  CLIENT_BROWSER_EVENT,
  CLIENT_BROWSER_ROUTES,
  type ClientBrowserAnswer,
  type ClientBrowserCommandEvent,
  type ClientBrowserPresence,
  decodeClientBrowserAnswer,
  decodeClientBrowserPresence,
} from "@openbot/contracts/team-protocol/client-browser-v1";
import type { RemoteTeamEvent } from "@openbot/team-client/remote-peer";
import type { TeamApiRequest } from "@openbot/team-client/team-api-requests";
import { currentText } from "@openbot/ui/text";
import { BROWSER_CHANGED_MESSAGE, BROWSER_PRESENCE_MESSAGE, BROWSER_RUN_MESSAGE } from "./client-browser-messages";
import { savePresenceAck } from "./extension-storage";

const HEARTBEAT_MS = 30_000;
const PRESENCE_GAP_MS = 5_000;
const REPEAT_PRESENCE_MS = 25_000;

export interface ClientBrowserLink {
  handleEvent: (event: RemoteTeamEvent) => void;
  refresh: () => void;
  dispose: () => void;
}

export function createClientBrowserLink(options: {
  request: TeamApiRequest;
  capabilities: readonly string[];
  onPresence?: (presence: ClientBrowserPresence) => void;
}): ClientBrowserLink {
  const supported = options.capabilities.includes(CLIENT_BROWSER_CAPABILITY);
  let disposed = false;
  let shared = false;
  let lastPosted = "";
  let lastPostedAt = 0;
  let trailing: ReturnType<typeof setTimeout> | undefined;
  let sending: Promise<void> = Promise.resolve();

  async function syncNow(): Promise<void> {
    const presence = decodeClientBrowserPresence(await chrome.runtime.sendMessage({ kind: BROWSER_PRESENCE_MESSAGE }));
    if (disposed) return;
    options.onPresence?.(presence);
    if (!supported || (!presence.sharing && !shared)) return;
    const body = { sharing: presence.sharing, tabs: presence.tabs.map((tab) => ({ ...tab })) };
    const text = JSON.stringify(body);
    const since = Date.now() - lastPostedAt;
    if (text === lastPosted && since < REPEAT_PRESENCE_MS) return;
    if (since < PRESENCE_GAP_MS && presence.sharing === shared) {
      clearTimeout(trailing);
      trailing = setTimeout(sync, PRESENCE_GAP_MS - since);
      return;
    }
    await options.request("POST", CLIENT_BROWSER_ROUTES.presence, () => undefined, body);
    lastPosted = text;
    lastPostedAt = Date.now();
    shared = presence.sharing;
    await savePresenceAck({ sharing: presence.sharing, tabs: presence.tabs.length, at: Date.now() });
  }

  function sync(): void {
    sending = sending.then(syncNow).catch(() => undefined);
  }

  async function run(event: ClientBrowserCommandEvent): Promise<void> {
    const { t } = currentText();
    let answer: ClientBrowserAnswer;
    try {
      answer = decodeClientBrowserAnswer(
        await chrome.runtime.sendMessage({
          kind: BROWSER_RUN_MESSAGE,
          event,
          labels: {
            title: t("extension.browser.notification.title", { agent: event.agentName }),
            body: t("extension.browser.notification.body"),
            working: t("extension.browser.overlay.working", { agent: event.agentName }),
          },
        }),
      );
      if (answer.id !== event.id) throw new Error("Another command.");
    } catch {
      answer = { id: event.id, ok: false, code: "failed", error: "The extension could not run the command." };
    }
    await options.request("POST", CLIENT_BROWSER_ROUTES.result, () => undefined, answer).catch(() => undefined);
  }

  const changed = (message: unknown) => {
    if (isDynamicRecord(message) && message.kind === BROWSER_CHANGED_MESSAGE) sync();
    return undefined;
  };
  chrome.runtime.onMessage.addListener(changed);
  const heartbeat = setInterval(sync, HEARTBEAT_MS);
  sync();

  return {
    handleEvent(event) {
      if (!supported || disposed || event.type !== CLIENT_BROWSER_EVENT) return;
      void run(event);
    },
    refresh() {
      lastPosted = "";
      lastPostedAt = 0;
      sync();
    },
    dispose() {
      disposed = true;
      clearInterval(heartbeat);
      clearTimeout(trailing);
      chrome.runtime.onMessage.removeListener(changed);
    },
  };
}
