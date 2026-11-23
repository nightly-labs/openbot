import type { ClientSideConnection, ContentBlock, InitializeResponse } from "@agentclientprotocol/sdk";
import { sourceText } from "@openbot/i18n/source";
import { Effect } from "effect";
import { getString, isRecord } from "./protocol";
import { providerCall, providerFailure } from "./provider-client-effects";

export function acpSessionSteers(initialization: InitializeResponse): boolean {
  const steering = isRecord(initialization._meta) ? initialization._meta.steering : null;
  return isRecord(steering) && steering.supported === true;
}

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
