import type { ChangeMarkerActions } from "@openbot/ui/features/conversation/ChatActionMarker";
import { createMemo } from "solid-js";
import { serverCanAdminister } from "../servers/server-capabilities";
import { agentInstructionsCalls } from "./agent-folders-port";
import type { ConversationProps } from "./conversation-types";
import { agentSkillsMode } from "./installed-skills-source";

export function createChangeMarkerActions(
  props: Pick<ConversationProps, "server" | "runtime">,
  channel: boolean,
  open: { skill: (skill: { skillId: string }) => void; instructions: (agentId: string) => void },
): ChangeMarkerActions {
  const localInstructions = agentInstructionsCalls();
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
