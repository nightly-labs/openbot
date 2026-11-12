import { type ClientAgentSummary, resolveRemoteInstanceTransferResult } from "@openbot/contracts/ipc";
import { INSTANCE_TRANSFER_REMOTE_BYTES } from "@openbot/contracts/team-protocol/instance-transfer-v1";
import { runTeamEffect } from "@openbot/team-client";
import {
  applyInstanceTransfer,
  discardInstanceTransfer,
  downloadInstanceTransfer,
  loadInstanceTransferSummary,
  stageInstanceTransfer,
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
 * sends a file that the user chooses in the browser.
 */
export function createWebInstanceTransferCalls(options: {
  /** The admin requests of the connected host. */
  request: (serverId: string) => TeamApiRequest;
  /** The same requests, with a response of up to one transfer file. */
  download: (serverId: string) => TeamApiRequest;
  listAgents: () => Promise<ClientAgentSummary[]>;
  saveFile: (file: { name: string; base64: string }) => void;
}): ServerTransferCalls {
  return {
    summary: (serverId) =>
      runTeamEffect(
        loadInstanceTransferSummary(options.request(serverId)).pipe(Effect.mapError((error) => error.cause)),
      ),
    async export(input, serverId) {
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
      const result = await runTeamEffect(
        applyInstanceTransfer(options.request(serverId), input, timezone).pipe(Effect.mapError((error) => error.cause)),
      );
      return resolveRemoteInstanceTransferResult(result, await options.listAgents());
    },
    discard: (token, serverId) =>
      runTeamEffect(
        discardInstanceTransfer(options.request(serverId), token).pipe(Effect.mapError((error) => error.cause)),
      ),
  };
}
