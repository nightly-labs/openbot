import { isConversationSnapshot } from "../ipc-conversations";
import { isDynamicRecord } from "../runtime-values";
import { AGENT_TASKS_ROUTES } from "./agent-tasks-v1";
import type { OptionalTeamEvent } from "./optional-events";
import { withConversationUiBlocks } from "./ui-blocks-v1";
import type { TeamProtocolV2Json } from "./webrtc-framing";

export const AGENT_TASK_UI_BLOCKS_CAPABILITY = "agent-task-ui-blocks-v1";

export function withAgentTaskUiBlocks(
  path: string,
  projected: TeamProtocolV2Json,
  source: unknown,
): TeamProtocolV2Json {
  return new URL(path, "http://openbot.invalid").pathname === AGENT_TASKS_ROUTES.read
    ? withConversationUiBlocks(projected, source)
    : projected;
}

export function withAgentTaskEventUiBlocks(event: OptionalTeamEvent, source: unknown): OptionalTeamEvent {
  if (event.type !== "agent-task-conversation" || !isDynamicRecord(source)) return event;
  const projected: TeamProtocolV2Json = JSON.parse(JSON.stringify(event.snapshot));
  const snapshot = withConversationUiBlocks(projected, source.snapshot);
  if (!isConversationSnapshot(snapshot)) throw new Error("Invalid agent task conversation event.");
  return { ...event, snapshot };
}
