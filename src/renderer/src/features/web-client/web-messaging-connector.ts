// The Slack, Discord and Telegram connections of the joined server in the browser client
// (`connectors-v1`). The host opens no page; this browser opens the platform's page that the host
// names. A Slack or Discord install returns to a page of this origin, which gives the sealed grant
// back to this tab (`@openbot/contracts/web-messaging-install`). This tab sends it on to the host.

import { type ConnectorMessagingPlatform, messagingPage } from "@openbot/contracts/ipc";
import {
  decodeWebMessagingInstallGrant,
  decodeWebMessagingInstallMark,
  encodeWebMessagingInstallMark,
  WEB_MESSAGING_INSTALL_CHANNEL,
  WEB_MESSAGING_INSTALL_KEY_PREFIX,
  WEB_MESSAGING_INSTALL_TTL_MS,
  type WebMessagingInstallPlatform,
  webMessagingInstallKey,
  webMessagingInstallReceipt,
} from "@openbot/contracts/web-messaging-install";
import { sourceText } from "@openbot/i18n/source";
import { runTeamEffect } from "@openbot/team-client";
import {
  discordAccess,
  discordRoles,
  type MessagingConnectorPage,
  messagingConnectorAddOrchestrator,
  messagingConnectorComplete,
  messagingConnectorConnect,
  messagingConnectorDisconnect,
  messagingConnectorOverview,
  messagingConnectorReconnect,
  messagingConnectorSetEnabled,
  setDiscordAccess,
  type TeamAdminRequestError,
} from "@openbot/team-client/team-admin-requests";
import type { TeamApiRequest } from "@openbot/team-client/team-api-requests";
import { classifyFailure } from "@openbot/telemetry";
import { currentText } from "@openbot/ui/text";
import { Effect } from "effect";
import { actionToast } from "../../action-toast";
import type { HostMessagingApi } from "../connectors/host-messaging-port";

/** Local storage that is not available holds no mark, and the return page opens `openbot://`. */
function withStorage(action: (storage: Storage) => void): boolean {
  try {
    action(localStorage);
    return true;
  } catch {
    return false;
  }
}

/**
 * `request` throws for a server that is not connected. `discordAccessSupported` says whether the host has
 * `discord-access-v1`. Call `dispose` when the client closes.
 */
export function webHostMessaging(
  request: (serverId: string) => TeamApiRequest,
  discordAccessSupported: () => boolean,
): {
  api: HostMessagingApi;
  dispose: () => void;
} {
  /** The installs that this tab opened, by nonce: the server that waits for each grant. */
  const pending = new Map<string, { platform: WebMessagingInstallPlatform; serverId: string; expiresAt: number }>();
  let channel: BroadcastChannel | null = null;

  /** `request` can throw, so it runs inside the Effect and a failure rejects the promise. */
  const run = <T>(serverId: string, call: (target: TeamApiRequest) => Effect.Effect<T, TeamAdminRequestError>) =>
    runTeamEffect(Effect.suspend(() => call(request(serverId))).pipe(Effect.mapError((error) => error.cause)));

  /** An older host does not offer `discord-access-v1`: the page then asks to update it. */
  const access = <T>(serverId: string, call: (target: TeamApiRequest) => Effect.Effect<T, TeamAdminRequestError>) =>
    discordAccessSupported()
      ? run(serverId, call)
      : Promise.reject(new Error(sourceText("error.team.discordAccessUnsupported")));

  const forget = (nonce: string) => {
    pending.delete(nonce);
    withStorage((storage) => storage.removeItem(webMessagingInstallKey(nonce)));
  };
  /** Removes the installs and the marks that the host no longer waits for, including other tabs' old ones. */
  const prune = (now: number) => {
    for (const [nonce, install] of pending) if (install.expiresAt <= now) pending.delete(nonce);
    withStorage((storage) => {
      for (const key of Object.keys(storage))
        if (
          key.startsWith(WEB_MESSAGING_INSTALL_KEY_PREFIX) &&
          !decodeWebMessagingInstallMark(storage.getItem(key), now)
        )
          storage.removeItem(key);
    });
  };
  const receive = (event: MessageEvent) => {
    const install = decodeWebMessagingInstallGrant(event.data);
    const waiting = install ? pending.get(install.nonce) : undefined;
    if (!install || waiting?.platform !== install.platform) return;
    // When this tab no longer reaches that server, it sends no answer, and the return page says to start again.
    let target: TeamApiRequest;
    try {
      target = request(waiting.serverId);
    } catch {
      return;
    }
    forget(install.nonce);
    // The answer tells the return page that this tab took the grant.
    channel?.postMessage(webMessagingInstallReceipt(install.nonce));
    // The Connectors page reads the connections again by itself and shows a completed install.
    void runTeamEffect(messagingConnectorComplete(target, install).pipe(Effect.mapError((error) => error.cause))).catch(
      (error: unknown) => {
        const { t, errorMessage } = currentText();
        const title = t(`connector.${install.platform}.actionFailed`);
        actionToast.error(title, {
          description: errorMessage(error, title),
          report: { operation: "other", source: "action", cause_code: classifyFailure(error) },
        });
      },
    );
  };
  const remember = (platform: WebMessagingInstallPlatform, nonce: string, serverId: string) => {
    const now = Date.now();
    prune(now);
    if (
      !withStorage((storage) =>
        storage.setItem(webMessagingInstallKey(nonce), encodeWebMessagingInstallMark(platform, now)),
      )
    )
      return;
    pending.set(nonce, { platform, serverId, expiresAt: now + WEB_MESSAGING_INSTALL_TTL_MS });
    if (channel) return;
    channel = new BroadcastChannel(WEB_MESSAGING_INSTALL_CHANNEL);
    channel.onmessage = receive;
  };

  /**
   * A browser blocks a page that the user's click did not open, and the page is known only when the
   * host answers. So the tab opens empty at the click, with no await before it, and goes to the page after.
   */
  const withTab = async (
    serverId: string,
    platform: ConnectorMessagingPlatform,
    open: (target: TeamApiRequest) => Effect.Effect<MessagingConnectorPage, TeamAdminRequestError>,
  ) => {
    const tab = window.open("about:blank", "_blank");
    if (!tab) throw new Error(currentText().t("browser.popupBlocked.title"));
    tab.opener = null;
    try {
      const page = await run(serverId, open);
      const address = messagingPage(platform, page.url);
      if (page.url !== null && !address) throw new Error(sourceText("error.team.connectorPageRefused"));
      if (address && platform !== "telegram" && page.nonce !== null) remember(platform, page.nonce, serverId);
      if (address) tab.location.href = address;
      else tab.close();
    } catch (error) {
      tab.close();
      throw error;
    }
  };

  return {
    api: {
      hostOverview: (input, serverId) => run(serverId, (target) => messagingConnectorOverview(target, input)),
      hostConnect: (input, serverId) =>
        withTab(serverId, input.platform, (target) => messagingConnectorConnect(target, input)),
      hostDisconnect: (input, serverId) => run(serverId, (target) => messagingConnectorDisconnect(target, input)),
      // A Discord server that removed the bot installs it again, so the host can answer a page.
      hostReconnect: (input, serverId) =>
        withTab(serverId, input.platform, (target) => messagingConnectorReconnect(target, input)),
      hostSetEnabled: (input, serverId) => run(serverId, (target) => messagingConnectorSetEnabled(target, input)),
      hostAddOrchestrator: (input, serverId) =>
        run(serverId, (target) => messagingConnectorAddOrchestrator(target, input)),
      hostGetDiscordAccess: (input, serverId) => access(serverId, (target) => discordAccess(target, input)),
      hostListDiscordRoles: (input, serverId) => access(serverId, (target) => discordRoles(target, input)),
      hostSetDiscordAccess: (input, serverId) => access(serverId, (target) => setDiscordAccess(target, input)),
    },
    dispose: () => {
      for (const nonce of [...pending.keys()]) forget(nonce);
      channel?.close();
      channel = null;
    },
  };
}
