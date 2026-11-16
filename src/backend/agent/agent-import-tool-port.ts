import type { AgentImportPreview, AgentImportResult, ApplyAgentImportInput } from "@openbot/contracts/ipc";
import type { Effect } from "effect";
import type { ToolOperationFailed } from "./tool-operation";

/** The official agent import that the UI uses: stage, apply and discard a Grok Bot or Hermes zip. */
export interface AgentImportToolPort {
  stage(path: string): Effect.Effect<AgentImportPreview, ToolOperationFailed>;
  apply(input: ApplyAgentImportInput): Effect.Effect<AgentImportResult, ToolOperationFailed>;
  discard(token: string): Effect.Effect<void, ToolOperationFailed>;
  /** The staged export for an approval card, or null when the token is gone. */
  stagedSummary(
    token: string,
    keys: readonly string[],
    channelKeys: readonly string[],
  ): Effect.Effect<
    { sourceApp: string; agents: Array<{ key: string; name: string }>; channels: Array<{ key: string; name: string }> },
    ToolOperationFailed
  >;
}
