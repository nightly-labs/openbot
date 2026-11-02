import { isConversationSnapshot } from "../ipc-conversations";
import { isDynamicRecord } from "../runtime-values";
import { AGENT_TASKS_ROUTES } from "./agent-tasks-v1";
import type { OptionalTeamEvent } from "./optional-events";
import { withConversationUiBlocks } from "./ui-blocks-v1";
import type { TeamProtocolV2Json } from "./v2";

/**
 * Frozen optional agent-task-ui-blocks-v1 contract: the interactive block of an `ask_ui` question
 * prompt in a task conversation, so that a client shows a side-thread question as its form. It adds
 * `uiBlock`, as ui-blocks-v1 sends it on an agent page, with the same normalization and wire budget,
 * beside the frozen keys of a message in:
 *
 * - the response of `POST /v1/agent-tasks/read`;
 * - the `snapshot` of an `agent-task-conversation` event.
 *
 * The host adds it only for a client that advertises this capability and agent-tasks-v1, so the wire
 * of every released client stays as it was. Such a client reads the message as its fallback: a
 * question prompt that it answers through the released prompt route. A host without the capability
 * never sends `uiBlock`, so a client accepts it whenever it is present. A present block that
 * `normalizeConversationUiBlock` refuses fails closed. Widening any of it needs a second capability
 * string.
 */
export const AGENT_TASK_UI_BLOCKS_CAPABILITY = "agent-task-ui-blocks-v1";

/** `projected`, the agent-tasks-v1 response of `path`, with the blocks of `source` on a task read. */
export function withAgentTaskUiBlocks(
  path: string,
  projected: TeamProtocolV2Json,
  source: unknown,
): TeamProtocolV2Json {
  return new URL(path, "http://openbot.invalid").pathname === AGENT_TASKS_ROUTES.read
    ? withConversationUiBlocks(projected, source)
    : projected;
}

/** `event`, as agent-tasks-v1 decodes it, with the blocks of the task conversation in `source`. */
export function withAgentTaskEventUiBlocks(event: OptionalTeamEvent, source: unknown): OptionalTeamEvent {
  if (event.type !== "agent-task-conversation" || !isDynamicRecord(source)) return event;
  const projected: TeamProtocolV2Json = JSON.parse(JSON.stringify(event.snapshot));
  const snapshot = withConversationUiBlocks(projected, source.snapshot);
  if (!isConversationSnapshot(snapshot)) throw new Error("Invalid agent task conversation event.");
  return { ...event, snapshot };
}
