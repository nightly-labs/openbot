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

/** The server ends a presence after 75 s with none; the contract asks for one every 30 s. */
const HEARTBEAT_MS = 30_000;

export interface ClientBrowserLink {
  /** Takes the server's events; runs each `client-browser-command`. */
  handleEvent: (event: RemoteTeamEvent) => void;
  /** Sends the presence again, as after a reconnection. */
  refresh: () => void;
  dispose: () => void;
}

/**
 * The tabs that the user shares, on one server connection: the side panel's, or the offscreen page's.
 * It sends the presence when it changes and every 30 s, passes each command to the worker, and posts the
 * worker's answer. A server without `client-browser-v1` gets nothing; `onPresence` still reports the
 * worker's state, for the panel.
 */
export function createClientBrowserLink(options: {
  request: TeamApiRequest;
  capabilities: readonly string[];
  onPresence?: (presence: ClientBrowserPresence) => void;
}): ClientBrowserLink {
  const supported = options.capabilities.includes(CLIENT_BROWSER_CAPABILITY);
  let disposed = false;
  /** Whether this connection told the server that the user shares, so that a stop reaches it. */
  let shared = false;
  let sending: Promise<void> = Promise.resolve();

  async function syncNow(): Promise<void> {
    const presence = decodeClientBrowserPresence(await chrome.runtime.sendMessage({ kind: BROWSER_PRESENCE_MESSAGE }));
    if (disposed) return;
    options.onPresence?.(presence);
    if (!supported || (!presence.sharing && !shared)) return;
    await options.request("POST", CLIENT_BROWSER_ROUTES.presence, () => undefined, {
      sharing: presence.sharing,
      tabs: presence.tabs.map((tab) => ({ ...tab })),
    });
    shared = presence.sharing;
    await savePresenceAck({ sharing: presence.sharing, tabs: presence.tabs.length, at: Date.now() });
  }

  function sync(): void {
    // One at a time, so a stop never overtakes the presence before it.
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
      // The texts of an answer go to the agent, as the host's tool texts do: English.
      answer = { id: event.id, ok: false, code: "failed", error: "The extension could not run the command." };
    }
    // A late answer gets 404 from the server, which changes nothing.
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
    refresh: sync,
    dispose() {
      disposed = true;
      clearInterval(heartbeat);
      chrome.runtime.onMessage.removeListener(changed);
    },
  };
}
