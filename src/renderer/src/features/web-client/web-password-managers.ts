// The password managers of the joined server in the browser client (`password-managers-v1`). The host
// runs the sign-in and opens no page; this browser opens the sign-in page that the host names. An access
// key or an extra password goes to the host once, in the connect request; no answer carries them.

import type { PasswordManagerId, PasswordManagerStatus } from "@openbot/contracts/ipc";
import { runTeamEffect } from "@openbot/team-client";
import {
  connectPasswordManager,
  listPasswordManagers,
  passwordManagerRequest,
  type TeamAdminRequestError,
} from "@openbot/team-client/team-admin-requests";
import type { TeamApiRequest } from "@openbot/team-client/team-api-requests";
import { Effect } from "effect";
import { type PasswordManagerPort, polledPasswordManagerPort } from "../connectors/password-manager-port";

/**
 * The sites whose sign-in page this browser opens, by manager. Another address does not open. 1Password
 * and Bitwarden connect through their own pages, with no sign-in page from the host.
 */
const SIGN_IN_HOSTS: Readonly<Record<PasswordManagerId, readonly string[]>> = {
  onepassword: [],
  bitwarden: [],
  protonpass: ["proton.me"],
};

/** The sign-in page of `status`, when it is an https page of the manager's own site. */
function signInPage(status: PasswordManagerStatus | undefined): string | null {
  const url = status?.signInUrl ? URL.parse(status.signInUrl) : null;
  if (!status || url?.protocol !== "https:" || url.port !== "" || url.username || url.password) return null;
  const host = url.hostname;
  const known = SIGN_IN_HOSTS[status.manager].some((site) => host === site || host.endsWith(`.${site}`));
  return known ? url.toString() : null;
}

/** `request` throws when no server is connected. */
export function webPasswordManagersPort(request: () => TeamApiRequest): PasswordManagerPort {
  /** The last status of each manager, with its sign-in page. */
  const last = new Map<PasswordManagerId, PasswordManagerStatus>();
  /**
   * A browser blocks a page that the user's click did not open, and the sign-in page is known only
   * after the host starts the sign-in. So Connect opens an empty tab at the click, and the tab goes to
   * the sign-in page when a status names it.
   */
  const tabs = new Map<PasswordManagerId, Window>();
  const run = <T>(effect: (request: TeamApiRequest) => Effect.Effect<T, TeamAdminRequestError>) =>
    runTeamEffect(Effect.suspend(() => effect(request())).pipe(Effect.mapError((error) => error.cause)));
  const closeTab = (manager: PasswordManagerId) => {
    tabs.get(manager)?.close();
    tabs.delete(manager);
  };
  const seen = (status: PasswordManagerStatus) => {
    last.set(status.manager, status);
    const tab = tabs.get(status.manager);
    if (!tab) return status;
    const page = signInPage(status);
    if (tab.closed) tabs.delete(status.manager);
    else if (page) {
      tab.location.href = page;
      tabs.delete(status.manager);
    } else if (status.state !== "signing-in") closeTab(status.manager);
    return status;
  };
  // The polled reads go through `list`, so each status that names the sign-in page reaches `seen`.
  return polledPasswordManagerPort({
    list: async () => {
      const statuses = await run(listPasswordManagers);
      for (const status of statuses) seen(status);
      return statuses;
    },
    connect: async (input) => {
      if (input.method.kind === "browser") {
        closeTab(input.manager);
        const tab = window.open("about:blank", "_blank");
        if (tab) {
          tab.opener = null;
          tabs.set(input.manager, tab);
        }
      }
      try {
        return seen(await run((target) => connectPasswordManager(target, input)));
      } catch (error) {
        closeTab(input.manager);
        throw error;
      }
    },
    cancel: async (manager) => {
      closeTab(manager);
      return seen(await run((target) => passwordManagerRequest(target, "cancel", manager)));
    },
    disconnect: async (manager) => seen(await run((target) => passwordManagerRequest(target, "disconnect", manager))),
    openSignIn: async (manager) => {
      const page = signInPage(last.get(manager));
      if (!page) return;
      const tab = tabs.get(manager);
      tabs.delete(manager);
      if (tab && !tab.closed) tab.location.href = page;
      else window.open(page, "_blank", "noopener,noreferrer");
    },
  });
}
