import { readFile, stat } from "node:fs/promises";
import {
  encodeWorkflowFile,
  type WorkflowDetail,
  type WorkflowFileHostExport,
  type WorkflowFileSourceAsset,
  workflowFileHostExport,
  workflowFileNeeds,
} from "@openbot/contracts/ipc";
import { redactSecrets } from "@openbot/logging";
import { Effect } from "effect";

export interface WorkflowFileAttachment {
  path: string;
  mimeType: string;
  name: string;
}

export interface WorkflowFileExportDependencies {
  agents: () => readonly { id: string; name: string; title: string }[];
  channelName: (channelId: string) => string | null;
  attachment: (fileId: string) => Effect.Effect<WorkflowFileAttachment | null>;
  timezone: () => string;
  appVersion: string;
}

export interface WorkflowFileExporter {
  readonly source: (detail: WorkflowDetail) => Effect.Effect<WorkflowFileHostExport>;
  readonly bytes: (fileId: string) => Effect.Effect<Uint8Array | null>;
}

const hasSecret = (text: string) => redactSecrets(text) !== text;

export function createWorkflowFileExporter(dependencies: WorkflowFileExportDependencies): WorkflowFileExporter {
  const asset = (fileId: string) =>
    dependencies.attachment(fileId).pipe(
      Effect.flatMap((file) =>
        file
          ? Effect.tryPromise(() => stat(file.path)).pipe(
              Effect.map(
                (info): WorkflowFileSourceAsset => ({ name: file.name, type: file.mimeType, size: info.size }),
              ),
              Effect.orElseSucceed(() => null),
            )
          : Effect.succeed(null),
      ),
    );
  return {
    source: Effect.fn("WorkflowFileExport.source")(function* (detail: WorkflowDetail) {
      const needs = workflowFileNeeds(detail.graph);
      const agents = new Map(
        dependencies
          .agents()
          .filter((agent) => needs.agents.includes(agent.id))
          .map((agent) => [agent.id, { name: agent.name, ...(agent.title ? { title: agent.title } : {}) }]),
      );
      const channels = new Map<string, { name: string }>();
      for (const channelId of needs.channels) {
        const name = dependencies.channelName(channelId);
        if (name) channels.set(channelId, { name });
      }
      const assets = new Map<string, WorkflowFileSourceAsset>();
      for (const fileId of needs.files) {
        const found = yield* asset(fileId);
        if (found) assets.set(fileId, found);
      }
      return workflowFileHostExport(
        encodeWorkflowFile({
          title: detail.summary.title,
          graph: detail.graph,
          appVersion: dependencies.appVersion,
          timezone: dependencies.timezone(),
          agents,
          channels,
          assets,
          hasSecret,
        }),
      );
    }),
    bytes: Effect.fn("WorkflowFileExport.bytes")(function* (fileId: string) {
      const file = yield* dependencies.attachment(fileId);
      if (!file) return null;
      return yield* Effect.tryPromise(() => readFile(file.path)).pipe(
        Effect.map((buffer) => new Uint8Array(buffer)),
        Effect.orElseSucceed(() => null),
      );
    }),
  };
}
