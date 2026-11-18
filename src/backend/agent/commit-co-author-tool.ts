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

/** Where the user changes the setting, for an agent that tells the user. */
const SETTING_PLACE = "Server settings > Agent defaults > Git commits > Credit OpenBot in commits";

/** Saves the `commitCoAuthor` agent default, as Server settings > Agent defaults does, and gives it to every agent. */
export type SetCommitCoAuthor = (enabled: boolean) => Effect.Effect<unknown, { readonly cause: unknown }>;

export interface SetCommitCoAuthorToolOptions {
  /** The `commitCoAuthor` agent default now. */
  current(): boolean;
  set: SetCommitCoAuthor;
  /** Whether a person's message in the agent's own chat, or a thread they opened, started the turn. */
  requestedByPerson: boolean;
  /** Waits for the owner's answer to a card with this text. */
  approve(reason: string): Effect.Effect<ToolApprovalDecision, ToolOperationFailed>;
}

/**
 * `set_commit_co_author`: turns the OpenBot co-author trailer of agent commits off or on (#7579). The
 * setting applies to every agent of this OpenBot, also on a server that other members use, so only the
 * owner approves it, and only for a person's request.
 */
export const handleSetCommitCoAuthorTool = Effect.fn("SetCommitCoAuthorTool.handle")(
  function* (
    params: DynamicToolCallParams,
    options: SetCommitCoAuthorToolOptions,
  ): Effect.fn.Return<OpenBotToolResponse, ToolOperationFailed> {
    const { enabled } = setCommitCoAuthorToolSchema.parse(params.arguments, { reportInput: true });
    if (options.current() === enabled) return openBotToolResult({ status: "unchanged", enabled });
    // A routine, a channel task, an external chat, another agent or a web page must not change a
    // setting of every agent.
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
