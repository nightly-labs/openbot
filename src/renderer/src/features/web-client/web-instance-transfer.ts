import {
  type ClientAgentSummary,
  INSTANCE_TRANSFER_LIMITS,
  resolveRemoteInstanceTransferResult,
} from "@openbot/contracts/ipc";
import { INSTANCE_TRANSFER_REMOTE_BYTES } from "@openbot/contracts/team-protocol/instance-transfer-v1";
import { runTeamEffect } from "@openbot/team-client";
import { base64ToBytes } from "@openbot/team-client/base64";
import {
  applyInstanceTransfer,
  applyInstanceTransferFullCopy,
  beginInstanceTransferFullCopy,
  discardInstanceTransfer,
  downloadInstanceTransfer,
  finishInstanceTransferExport,
  loadInstanceTransferSummary,
  readInstanceTransferExportPart,
  sha256Hex,
  stageInstanceTransfer,
  stageInstanceTransferInParts,
  type TeamApiRequest,
} from "@openbot/team-client/team-api-requests";
import { currentText } from "@openbot/ui/text";
import { Effect } from "effect";
import type { ServerTransferCalls } from "../servers/server-transfer-store";
import { readBase64 } from "./web-agent-import";
import { chooseFiles } from "./web-channels-runtime";

/**
 * Server settings > Transfer in the browser client, with `instance-transfer-v1` of the connected host.
 * The export downloads to the browser's download folder, so there is no folder to show. The import
 * sends a file that the user chooses in the browser. A host with `instance-transfer-full-copy-v1`
 * sends the export in parts, with each part of the file chosen, so it can be larger than one request.
 */
export function createWebInstanceTransferCalls(options: {
  /** The admin requests of the connected host. */
  request: (serverId: string) => TeamApiRequest;
  /** The same requests, with a response of up to one transfer file. */
  download: (serverId: string) => TeamApiRequest;
  listAgents: () => Promise<ClientAgentSummary[]>;
  saveFile: (file: { name: string; base64: string } | { name: string; blob: Blob }) => void;
  /** The host serves `instance-transfer-full-copy-v1` and `instance-transfer-chunks-v1`. */
  fullCopy: (serverId: string) => boolean;
  /** The host serves `instance-transfer-chunks-v1`: a file goes to it in parts. */
  sendsParts: (serverId: string) => boolean;
}): ServerTransferCalls {
  return {
    summary: (serverId) =>
      runTeamEffect(
        loadInstanceTransferSummary(options.request(serverId)).pipe(Effect.mapError((error) => error.cause)),
      ),
    async export(input, serverId) {
      if (options.fullCopy(serverId)) return exportInParts(options, input, serverId);
      const file = await runTeamEffect(
        downloadInstanceTransfer(options.download(serverId), input).pipe(Effect.mapError((error) => error.cause)),
      );
      // The desktop save dialog proposes the same name.
      const fileName = `openbot-transfer-${new Date().toISOString().slice(0, 10)}.zip`;
      options.saveFile({ name: fileName, base64: file.base64 });
      return { saved: true, fileName, warnings: [] };
    },
    async choose(serverId) {
      // The host is checked before the chooser opens, and nothing is awaited before it.
      const request = options.request(serverId);
      const [file] = await chooseFiles({ multiple: false, accept: ".zip,application/zip" });
      if (!file) return null;
      if (file.size === 0) throw new Error(currentText().t("error.import.chooseZip"));
      // In parts, as the Grok Bot import sends them: up to the limit of a transfer file on the host.
      if (options.sendsParts(serverId)) {
        if (file.size > INSTANCE_TRANSFER_LIMITS.archiveBytes)
          throw new Error(currentText().t("error.import.transferTooLarge"));
        return runTeamEffect(
          stageInstanceTransferInParts(request, {
            name: file.name,
            size: file.size,
            readBytes: async (offset, length) =>
              new Uint8Array(await file.slice(offset, offset + length).arrayBuffer()),
          }).pipe(Effect.mapError((error) => error.cause)),
        );
      }
      if (file.size > INSTANCE_TRANSFER_REMOTE_BYTES)
        throw new Error(currentText().t("error.import.transferRemoteTooLarge"));
      return runTeamEffect(
        stageInstanceTransfer(request, {
          name: file.name,
          mimeType: "application/zip",
          base64: await readBase64(file),
        }).pipe(Effect.mapError((error) => error.cause)),
      );
    },
    async apply(input, serverId) {
      const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
      const request = options.request(serverId);
      const result = await runTeamEffect(
        (options.fullCopy(serverId)
          ? applyInstanceTransferFullCopy(request, input, timezone)
          : applyInstanceTransfer(request, input, timezone)
        ).pipe(Effect.mapError((error) => error.cause)),
      );
      return resolveRemoteInstanceTransferResult(result, await options.listAgents());
    },
    discard: (token, serverId) =>
      runTeamEffect(
        discardInstanceTransfer(options.request(serverId), token).pipe(Effect.mapError((error) => error.cause)),
      ),
  };
}

async function exportInParts(
  options: Parameters<typeof createWebInstanceTransferCalls>[0],
  input: Parameters<ServerTransferCalls["export"]>[0],
  serverId: string,
) {
  const request = options.request(serverId);
  const file = await runTeamEffect(
    beginInstanceTransferFullCopy(request, input).pipe(Effect.mapError((error) => error.cause)),
  );
  try {
    // Each part becomes a Blob at once, so the browser can keep it out of the page's memory.
    const parts: Blob[] = [];
    for (const [index, expected] of file.chunks.entries()) {
      const part = await runTeamEffect(
        readInstanceTransferExportPart(options.download(serverId), { exportId: file.exportId, index }).pipe(
          Effect.mapError((error) => error.cause),
        ),
      );
      const bytes = base64ToBytes(part.base64);
      const length = Math.min(file.chunkBytes, file.size - index * file.chunkBytes);
      // Each part is checked against the SHA-256 that the host named for it.
      if (bytes.length !== length || sha256Hex(bytes) !== expected)
        throw new Error(currentText().t("error.import.transferPartInvalid"));
      parts.push(new Blob([bytes]));
    }
    const fileName = `openbot-transfer-${new Date().toISOString().slice(0, 10)}.zip`;
    options.saveFile({ name: fileName, blob: new Blob(parts, { type: "application/zip" }) });
    return { saved: true, fileName, warnings: file.warnings };
  } finally {
    await runTeamEffect(finishInstanceTransferExport(request, file.exportId)).catch(() => undefined);
  }
}
