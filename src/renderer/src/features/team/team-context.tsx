import type { TeamPresenceSnapshot } from "@openbot/contracts/ipc";
import { createMemo, createSignal, flush, onSettled } from "solid-js";
import { EMPTY_TEAM_PRESENCE } from "../../app-defaults";
import { createSimpleContext } from "../../simple-context";
import { useAuth } from "../account/account-context";
import { useServers } from "../servers/servers-context";
import { currentReaderMember } from "./reader-identity";
import { teamPort } from "./team-port";

/**
 * Who else is on the active workspace, and which of them is the signed-in user.
 *
 * Cloud identity matches by email or username; additional local servers use
 * their password owner instead, regardless of cloud sign-in.
 *
 * The snapshot itself is per server, but the read that seeds it is one of the
 * eight the workspace bootstrap and `selectServer` both run, so the *load* stays
 * with whoever owns that sequence and only the state lives here. That is why
 * `setTeamPresence` is exported: the server switch clears it and the bootstrap
 * fills it. Both callers disappear once the per-server scope owns its own init.
 *
 * `activeDirectMember` is deliberately not here. It reads the selected member,
 * and selection sits under this domain.
 */
const Presence = createSimpleContext({
  name: "Presence",
  init: () => {
    const { centralAuth } = useAuth();
    const { activeServer } = useServers();
    const [teamPresence, setTeamPresence] = createSignal<TeamPresenceSnapshot>(EMPTY_TEAM_PRESENCE);

    const currentTeamMember = createMemo(() => {
      const state = centralAuth();
      return currentReaderMember(
        teamPresence().members,
        activeServer(),
        state.status === "signed_in" ? state.user.email : null,
      );
    });

    const directPeople = createMemo(() => {
      const currentMemberId = currentTeamMember()?.id;
      if (!currentMemberId) return [];
      return teamPresence().members.filter((member) => member.id !== currentMemberId && !member.disabled);
    });

    onSettled(() => teamPort().servers.onPresence((snapshot) => flush(() => setTeamPresence(snapshot))));

    return { teamPresence, setTeamPresence, currentTeamMember, directPeople };
  },
});

export const PresenceProvider = Presence.provider;
export const usePresence = Presence.use;
