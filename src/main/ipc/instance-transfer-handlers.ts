// Instance transfer for a server: this computer's own, or a joined server with `instance-transfer-v1`.
// A joined server that also has `instance-transfer-chunks-v1` moves the file in parts, so it can be
// larger than 100 MB. Main opens both file dialogs and moves the file, so the renderer never names a
// path, and only main can reveal the saved file.

import { readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import { basename, join } from "node:path";
import {
  type ApplyInstanceTransferInput,
  decodeRemoteInstanceTransferResult,
  decodeRemoteInstanceTransferSummary,
  type ExportInstanceInput,
  type InstanceExportResult,
  type InstanceTransferPreview,
  parseApplyInstanceTransferInput,
  parseExportInstanceInput,
  resolveRemoteInstanceTransferResult,
} from "@openbot/contracts/ipc";
import { TEAM_API_ROUTES } from "@openbot/contracts/team-api-routes";
import { INSTANCE_TRANSFER_CHUNKS_CAPABILITY } from "@openbot/contracts/team-protocol/instance-transfer-chunks-v1";
import {
  INSTANCE_TRANSFER_CAPABILITY,
  INSTANCE_TRANSFER_REMOTE_BYTES,
  INSTANCE_TRANSFER_ROUTES,
} from "@openbot/contracts/team-protocol/instance-transfer-v1";
import type { AppTranslate } from "@openbot/i18n";
import { sourceText } from "@openbot/i18n/source";
import { Effect } from "effect";
import { app, type BrowserWindow, dialog, type OpenDialogOptions, type SaveDialogOptions, shell } from "electron";
import { runCauseEffect } from "../../backend/effect-boundary";
import type { InstanceTransferService } from "../instance-transfer-service";
import { decodeAgentSummaries } from "../remote-agent-decoding";
import { downloadTransferInParts, uploadTransferInParts } from "../remote-instance-transfer-chunks";
import { AGENT_IMPORT_UPLOAD_TIMEOUT_MS, type RemoteServerManager } from "../remote-server-manager";
import { handler, type IpcGroupHandlers } from "./define-ipc-group";
import { scopedHandler, scopedQueryHandler } from "./scoped-handler";
import { stringPayload } from "./validation";

export interface InstanceTransferIpcDependencies {
  instanceTransfer: InstanceTransferService;
  remoteServers: Pick<
    RemoteServerManager,
    | "supportsCapability"
    | "request"
    | "stageInstanceTransfer"
    | "downloadInstanceTransfer"
    | "sendInstanceTransferPart"
    | "readInstanceTransferPart"
  >;
  getMainWindow: () => BrowserWindow | null;
  translate: AppTranslate;
}

export function instanceTransferIpcHandlers({
  instanceTransfer,
  remoteServers,
  getMainWindow,
  translate,
}: InstanceTransferIpcDependencies): Pick<IpcGroupHandlers, "instanceTransfer"> {
  const filters = [{ name: translate("dialog.filter.transfer"), extensions: ["zip"] }];
  /** The file this computer saved last, for "Show the file". */
  let lastExport: string | null = null;

  const chooseDestination = async (): Promise<string | null> => {
    const mainWindow = getMainWindow();
    const date = new Date().toISOString().slice(0, 10);
    const options: SaveDialogOptions = {
      title: translate("dialog.saveTransfer"),
      defaultPath: join(app.getPath("downloads"), `openbot-transfer-${date}.zip`),
      filters,
      showsTagField: false,
    };
    const result = mainWindow ? await dialog.showSaveDialog(mainWindow, options) : await dialog.showSaveDialog(options);
    return result.canceled || !result.filePath ? null : result.filePath;
  };

  const chooseFile = async (): Promise<string | null> => {
    const mainWindow = getMainWindow();
    const options: OpenDialogOptions = {
      title: translate("dialog.chooseTransfer"),
      properties: ["openFile"],
      filters,
    };
    const result = mainWindow ? await dialog.showOpenDialog(mainWindow, options) : await dialog.showOpenDialog(options);
    return result.canceled || !result.filePaths[0] ? null : result.filePaths[0];
  };

  const requireRemote = (serverId: string) => {
    if (!remoteServers.supportsCapability(serverId, INSTANCE_TRANSFER_CAPABILITY))
      throw new Error(sourceText("error.team.instanceTransferUnsupported"));
  };

  const exportLocal = async (input: ExportInstanceInput): Promise<InstanceExportResult> => {
    // An export over the file limits fails here, before the user chooses where to save it.
    const prepared = await runCauseEffect(instanceTransfer.prepareExport(input));
    const path = await chooseDestination();
    if (!path) return { saved: false, fileName: null, warnings: [] };
    const result = await runCauseEffect(prepared.write(path));
    lastExport = path;
    return result;
  };

  const inParts = (serverId: string) => remoteServers.supportsCapability(serverId, INSTANCE_TRANSFER_CHUNKS_CAPABILITY);

  const exportRemote = async (input: ExportInstanceInput, serverId: string): Promise<InstanceExportResult> => {
    requireRemote(serverId);
    const path = await chooseDestination();
    if (!path) return { saved: false, fileName: null, warnings: [] };
    if (inParts(serverId)) {
      const { warnings } = await runCauseEffect(downloadTransferInParts(remoteServers, serverId, input, path));
      lastExport = path;
      return { saved: true, fileName: basename(path), warnings };
    }
    // `instance-transfer-v1` carries no chat history.
    const { includeHistory: _history, ...v1 } = input;
    const bytes = await runCauseEffect(remoteServers.downloadInstanceTransfer(serverId, v1));
    // The file appears only when it is complete, as a local export does.
    const part = `${path}.part`;
    try {
      await writeFile(part, bytes);
      await rename(part, path);
    } catch (error) {
      await rm(part, { force: true });
      throw error;
    }
    lastExport = path;
    return { saved: true, fileName: basename(path), warnings: [] };
  };

  const stageRemote = async (serverId: string): Promise<InstanceTransferPreview | null> => {
    requireRemote(serverId);
    const path = await chooseFile();
    if (!path) return null;
    if (inParts(serverId)) return runCauseEffect(uploadTransferInParts(remoteServers, serverId, path));
    const info = await stat(path);
    if (!info.isFile() || info.size === 0) throw new Error(sourceText("error.import.chooseZip"));
    if (info.size > INSTANCE_TRANSFER_REMOTE_BYTES) throw new Error(sourceText("error.import.transferRemoteTooLarge"));
    return runCauseEffect(remoteServers.stageInstanceTransfer(serverId, new Uint8Array(await readFile(path))));
  };

  const applyRemote = async (input: ApplyInstanceTransferInput, serverId: string) => {
    requireRemote(serverId);
    const result = await runCauseEffect(
      remoteServers.request(serverId, INSTANCE_TRANSFER_ROUTES.apply, decodeRemoteInstanceTransferResult, {
        method: "POST",
        body: { ...input, timezone: Intl.DateTimeFormat().resolvedOptions().timeZone },
        timeoutMs: AGENT_IMPORT_UPLOAD_TIMEOUT_MS,
      }),
    );
    return resolveRemoteInstanceTransferResult(
      result,
      await runCauseEffect(remoteServers.request(serverId, TEAM_API_ROUTES.agents.all, decodeAgentSummaries)),
    );
  };

  return {
    instanceTransfer: {
      summary: scopedQueryHandler({
        local: () => runCauseEffect(instanceTransfer.summary()),
        remote: async (serverId) => {
          requireRemote(serverId);
          return runCauseEffect(
            remoteServers.request(serverId, INSTANCE_TRANSFER_ROUTES.summary, decodeRemoteInstanceTransferSummary, {
              method: "POST",
              body: {},
            }),
          );
        },
      }),
      export: scopedHandler(parseExportInstanceInput, { local: exportLocal, remote: exportRemote }),
      showExport: handler(() => {
        if (lastExport) shell.showItemInFolder(lastExport);
      }),
      choose: scopedQueryHandler({
        local: async () => {
          const path = await chooseFile();
          return path ? runCauseEffect(instanceTransfer.stage(path)) : null;
        },
        remote: stageRemote,
      }),
      apply: scopedHandler(parseApplyInstanceTransferInput, {
        local: (input) => runCauseEffect(instanceTransfer.apply(input)),
        remote: applyRemote,
      }),
      discard: scopedHandler(stringPayload("token"), {
        local: (token) => Effect.runPromise(instanceTransfer.discard(token)),
        remote: async (token, serverId) => {
          requireRemote(serverId);
          await runCauseEffect(
            remoteServers.request(serverId, INSTANCE_TRANSFER_ROUTES.discard, () => undefined, {
              method: "POST",
              body: { token },
            }),
          );
        },
      }),
    },
  };
}
