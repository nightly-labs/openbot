import { OPENBOT_COMMIT_TRAILER } from "@openbot/contracts/ipc";
import { sourceText } from "@openbot/i18n/source";
import { Effect } from "effect";
import { z } from "zod";
import type { DynamicToolCallParams } from "../protocol";
import type { ToolApprovalDecision } from "./attention-registry";
import { type OpenBotToolResponse, openBotToolFailure, openBotToolResult } from "./routine-tools";
import { ToolOperationFailed, toToolOperationFailed } from "./tool-operation";

export const setCommitCoAuthorToolSchema = z.strictObject({
  enabled: z.boolean(),
});

const SETTING_PLACE = "Server settings > Agent defaults > Git commits > Credit OpenBot in commits";

export type SetCommitCoAuthor = (enabled: boolean) => Effect.Effect<unknown, { readonly cause: unknown }>;

export interface SetCommitCoAuthorToolOptions {
  current(): boolean;
  set: SetCommitCoAuthor;
  requestedByPerson: boolean;
  approve(reason: string): Effect.Effect<ToolApprovalDecision, ToolOperationFailed>;
}

export const handleSetCommitCoAuthorTool = Effect.fn("SetCommitCoAuthorTool.handle")(
  function* (
    params: DynamicToolCallParams,
    options: SetCommitCoAuthorToolOptions,
  ): Effect.fn.Return<OpenBotToolResponse, ToolOperationFailed> {
    const { enabled } = setCommitCoAuthorToolSchema.parse(params.arguments, { reportInput: true });
    if (options.current() === enabled) return openBotToolResult({ status: "unchanged", enabled });
    if (!options.requestedByPerson)
      return openBotToolFailure(
        `Only a message from the owner of this OpenBot, in your chat or a thread they opened, can change this setting. When a person asked for it, tell them that the owner can change it in ${SETTING_PLACE}.`,
      );
    const decision = yield* options.approve(
      sourceText(enabled ? "status.agent.commitCoAuthorOn" : "status.agent.commitCoAuthorOff"),
    );
    if (decision === "cancel")
      return openBotToolResult({
        status: "cancelled",
        next: "Nobody answered the card, so the setting did not change.",
      });
    if (decision !== "accept")
      return openBotToolResult({
        status: "declined",
        next: "The user selected Deny, so the setting did not change. Do not ask again for this request.",
      });
    yield* options.set(enabled).pipe(toToolOperationFailed);
    return openBotToolResult({
      status: "changed",
      enabled,
      next: enabled
        ? `Agents add the trailer to the commits that they make from their next turn. The user can change it in ${SETTING_PLACE}.`
        : `Agents no longer add the trailer. Do not add it in this turn either: "${OPENBOT_COMMIT_TRAILER}". The commits made before keep it; change them only when the user asks. The user can change it in ${SETTING_PLACE}.`,
    });
  },
  Effect.catchDefect((cause) => Effect.fail(new ToolOperationFailed({ cause }))),
);
