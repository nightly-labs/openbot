import type { ClientSideConnection, ContentBlock, InitializeResponse } from "@agentclientprotocol/sdk";
import { sourceText } from "@openbot/i18n/source";
import { Effect } from "effect";
import { getString, isRecord } from "./protocol";
import { providerCall, providerFailure } from "./provider-client-effects";

/**
 * Whether this ACP agent has the `_session/steering` request. An agent reports it in the `_meta` of
 * `initialize`. OpenCode 2.2.6 does not have it; a later release reports it (anomalyco/opencode#53042,
 * #8231). A custom agent can report it too (#4977); an agent that does not report it gets no request.
 */
export function acpSessionSteers(initialization: InitializeResponse): boolean {
  const steering = isRecord(initialization._meta) ? initialization._meta.steering : null;
  return isRecord(steering) && steering.supported === true;
}

/**
 * `_session/steering` puts a message in the running turn, and the agent reads it after its current
 * tool call or model step. The blocks are those of a `session/prompt`. The agent answers
 * `promptRequired` when the session runs no turn: it did not keep the message, which then waits in
 * the queue. Each other answer means that the agent kept it, so the message must not go a second time.
 */
export const steerAcpSession = Effect.fn("Acp.steerSession")(function* (
  connection: ClientSideConnection,
  message: { sessionId: string; blocks: ContentBlock[] },
) {
  const answer = yield* providerCall(() =>
    connection.extMethod("_session/steering", { sessionId: message.sessionId, prompt: message.blocks }),
  );
  if (getString(answer, "outcome") === "promptRequired")
    return yield* providerFailure(new Error(sourceText("error.backend.steerTurnChanged")));
});
