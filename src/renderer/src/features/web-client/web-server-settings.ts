import type {
  AvatarImageInput,
  InviteSummary,
  ServerAppearance,
  ServerSummary,
  TeamInviteSummary,
  TeamPresenceMember,
  TeamPresenceSnapshot,
  UpdateTeamMemberInput,
} from "@openbot/contracts/ipc";
import { runTeamEffect } from "@openbot/team-client";
import {
  rotateHostKey as rotateHostKeyRequest,
  setHostAppearance,
  updateHostIdentity,
} from "@openbot/team-client/team-admin-requests";
import { currentText } from "@openbot/ui/text";
import { Effect } from "effect";
import { createEffect, createStore, untrack } from "solid-js";
import { serverCanAdminister, serverRoleCanAdminister, serverRotatesHostKey } from "../servers/server-capabilities";
import type { WebAdminRuntime } from "./web-runtime";

interface WebServerSettingsState {
  open: boolean;
  members: TeamPresenceMember[];
  invites: TeamInviteSummary[];
  loading: boolean;
  error: string | null;
}

/**
 * The settings dialog of the connected host, as the desktop `server-settings.tsx` shows it for a
 * remote server. The web connects to one host at a time, so the dialog is for that host only.
 *
 * Every mutation ends in a new read rather than a patch of the lists: the account service and the
 * host are the authority, and a failed write must not leave a row that they did not accept.
 */

export function createWebServerSettings(options: {
  server: () => ServerSummary | undefined;
  admin: () => WebAdminRuntime | undefined;
  presence: () => TeamPresenceSnapshot | null;
  refreshHosts: () => Promise<void>;
  /** Shows a plush look on the server before the host confirms it. */
  setAppearance: (hostId: string, appearance: ServerAppearance | null) => void;
}) {
  const [state, setState] = createStore<WebServerSettingsState>({
    open: false,
    members: [],
    invites: [],
    loading: false,
    error: null,
  });
  /** Bumped by every open and refresh, so a slower earlier load cannot paint over a newer one. */
  let request = 0;
  let restoreTarget: HTMLElement | null = null;

  function requireAdmin(): { server: ServerSummary; admin: WebAdminRuntime } {
    const server = options.server();
    const admin = options.admin();
    if (!server || !admin || server.state !== "online")
      throw new Error(currentText().t("webClient.error.connectServerFirst"));
    return { server, admin };
  }

  // Typing updates do not read the account service again. Membership and online changes are enough
  // to show an accepted invitation.
  let previousPresence = "";
  createEffect(
    () => (state.open ? options.presence() : null),
    (presence) => {
      if (!presence) return;
      const signature = untrack(() =>
        JSON.stringify(presence.members.map((member) => [member.id, member.role, member.disabled, member.online])),
      );
      if (signature === previousPresence) return;
      previousPresence = signature;
      void untrack(refresh);
    },
  );

  // A member change revokes every session on the host, this one too. Load again after it reconnects.
  let previousState: ServerSummary["state"] | undefined;
  createEffect(
    () => (state.open ? options.server()?.state : undefined),
    (serverState) => {
      const reconnected = serverState === "online" && previousState !== undefined && previousState !== "online";
      previousState = serverState;
      if (reconnected) void untrack(refresh);
    },
  );

  async function refresh(): Promise<void> {
    const current = ++request;
    setState((draft) => {
      draft.loading = true;
      draft.error = null;
    });
    try {
      const { server, admin } = requireAdmin();
      const canManage = serverRoleCanAdminister(server);
      const [presence, members, invites] = await Promise.all([
        admin.team.getPresence(),
        canManage ? admin.team.listMembers() : Promise.resolve(null),
        canManage ? admin.team.listInvites() : Promise.resolve([]),
      ]);
      if (current !== request) return;
      const presenceById = new Map(presence.members.map((member) => [member.id, member]));
      setState((draft) => {
        draft.members = (members ?? presence.members).map((member) => ({
          ...member,
          online: presenceById.get(member.id)?.online ?? false,
          typingAgentId: presenceById.get(member.id)?.typingAgentId ?? null,
        }));
        draft.invites = invites;
      });
    } catch (error) {
      if (current === request)
        setState((draft) => {
          draft.error = currentText().errorMessage(error, currentText().t("server.settings.loadFailed"));
        });
    } finally {
      if (current === request)
        setState((draft) => {
          draft.loading = false;
        });
    }
  }

  function open(trigger: HTMLElement | null): void {
    request += 1;
    restoreTarget = trigger;
    previousPresence = "";
    setState((draft) => {
      draft.open = true;
      draft.members = [];
      draft.invites = [];
      draft.error = null;
    });
    void refresh();
  }

  function setOpen(value: boolean): void {
    setState((draft) => {
      draft.open = value;
    });
  }

  async function saveIdentity(input: { serverName: string; logo?: AvatarImageInput | null }): Promise<void> {
    const { server, admin } = requireAdmin();
    if (!serverCanAdminister(server, "host-admin-v1"))
      throw new Error(currentText().t("server.settings.identityLocalOnly"));
    await runTeamEffect(updateHostIdentity(admin.request, input).pipe(Effect.mapError((error) => error.cause)));
    await options.refreshHosts();
    await refresh();
  }

  /**
   * Sets the plush look through `host-appearance-v1`. The look shows at the click, and a failure
   * puts the previous one back; the host's `host-appearance` event then confirms it.
   */
  async function saveAppearance(appearance: ServerAppearance | null): Promise<void> {
    const { server, admin } = requireAdmin();
    if (!serverCanAdminister(server, "host-appearance-v1"))
      throw new Error(currentText().t("error.team.hostIdentityUnsupported"));
    const previous = server.appearance ?? null;
    options.setAppearance(server.id, appearance);
    try {
      await runTeamEffect(setHostAppearance(admin.request, appearance).pipe(Effect.mapError((error) => error.cause)));
    } catch (error) {
      options.setAppearance(server.id, previous);
      throw error;
    }
  }

  /**
   * Changes the server key through `host-key-rotation-v1`, which only the owner may use. As on the
   * desktop, the server list is read again, because only its signed handover makes the new key trusted.
   */
  async function rotateHostKey(): Promise<void> {
    const { server, admin } = requireAdmin();
    if (!serverRotatesHostKey(server)) throw new Error(currentText().t("server.settings.hostKeyOwnerOnly"));
    await runTeamEffect(rotateHostKeyRequest(admin.request).pipe(Effect.mapError((error) => error.cause)));
    await options.refreshHosts();
  }

  async function mutateTeam<T>(mutate: (admin: WebAdminRuntime) => Promise<T>): Promise<T> {
    const result = await mutate(requireAdmin().admin);
    await refresh();
    return result;
  }

  return {
    state,
    restoreTarget: () => restoreTarget,
    open,
    setOpen,
    refresh,
    saveIdentity,
    saveAppearance,
    rotateHostKey,
    createInvite: (input: { role: "admin" | "member"; email?: string; permanent?: boolean }): Promise<InviteSummary> =>
      mutateTeam((admin) => admin.team.createInvite(input)),
    updateMember: async (input: UpdateTeamMemberInput): Promise<void> => {
      await mutateTeam((admin) => admin.team.updateMember(input));
    },
    removeMember: (memberId: string): Promise<void> => mutateTeam((admin) => admin.team.removeMember(memberId)),
    revokeInvite: (inviteId: string): Promise<void> => mutateTeam((admin) => admin.team.revokeInvite(inviteId)),
  };
}
