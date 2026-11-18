import type { ChangeMarkerActions } from "@openbot/ui/features/conversation/ChatActionMarker";
import { createMemo } from "solid-js";
import { serverCanAdminister } from "../servers/server-capabilities";
import { agentInstructionsCalls } from "./agent-folders-port";
import type { ConversationProps } from "./conversation-types";
import { agentSkillsMode } from "./installed-skills-source";

/**
 * Open on a skill line, and View and Undo on an instruction change line. The agent's chat and its
 * threads use the same actions, so a line opens in a thread as it does in the chat.
 */
export function createChangeMarkerActions(
  props: Pick<ConversationProps, "server" | "runtime">,
  channel: boolean,
  open: { skill: (skill: { skillId: string }) => void; instructions: (agentId: string) => void },
): ChangeMarkerActions {
  const localInstructions = agentInstructionsCalls();
  /**
   * The server whose instruction file View and Undo read on a change line: a joined server only for an
   * owner or admin, through `agent-instructions-v1`. The calls follow the server id, so a new summary
   * of the same server keeps an open view. The web client gets the calls from its runtime, which gives
   * them only for such a host and user.
   */
  const webInstructionsApi = createMemo(() => props.runtime?.agentInstructions);
  const instructionsServerId = createMemo(() => {
    if (props.runtime) return webInstructionsApi() ? props.server?.id : undefined;
    return props.server?.kind === "remote" && serverCanAdminister(props.server, "agent-instructions-v1")
      ? props.server.id
      : undefined;
  });
  const instructions = createMemo(() => {
    if (!props.runtime && props.server?.kind === "local") return localInstructions;
    const serverId = instructionsServerId();
    return serverId === undefined ? undefined : agentInstructionsCalls(serverId, webInstructionsApi());
  });
  return {
    get onOpenSkill() {
      return agentSkillsMode(props.server, props.runtime) === "hidden" ? undefined : open.skill;
    },
    get instructions() {
      return instructions();
    },
    get onOpenInstructions() {
      return channel || !instructions() ? undefined : open.instructions;
    },
  };
}
