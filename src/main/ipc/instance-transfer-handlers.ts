// Instance transfer for a server: this computer's own, or a joined server with `instance-transfer-v1`.
// A joined server that also has `instance-transfer-chunks-v1` moves the file in parts, so it can be
// larger than 100 MB. Main opens both file dialogs and moves the file, so the renderer never names a
// path, and only main can reveal the saved file.
//
// `copy` joins the two: it exports agents from one server to a temporary file and imports that file
// at another, with the same routes, so a host needs no new route.

import { mkdtemp, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import { basename, join } from "node:path";
import {
  AGENT_IMPORT_LIMITS,
  type ApplyInstanceTransferInput,
  type CopyInstanceAgentsInput,
  decodeRemoteInstanceTransferResult,
  decodeRemoteInstanceTransferSummary,
  type ExportInstanceInput,
  type InstanceExportResult,
  type InstanceTransferPreview,
  type InstanceTransferResult,
  LOCAL_SERVER_ID,
  parseApplyInstanceTransferInput,
  parseCopyInstanceAgentsInput,
  parseExportInstanceInput,
  resolveRemoteInstanceTransferResult,
} from "@openbot/contracts/ipc";
import { TEAM_API_ROUTES } from "@openbot/contracts/team-api-routes";
import { INSTANCE_TRANSFER_CHUNKS_CAPABILITY } from "@openbot/contracts/team-protocol/instance-transfer-chunks-v1";
import {
  INSTANCE_TRANSFER_FULL_COPY_CAPABILITY,
  INSTANCE_TRANSFER_FULL_COPY_ROUTES,
} from "@openbot/contracts/team-protocol/instance-transfer-full-copy-v1";
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
import { agentRequest } from "./agent-inputs";
import { handler, type IpcGroupHandlers, payloadHandler } from "./define-ipc-group";
import { routeToServer } from "./route-to-server";
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
      const fullCopy = remoteServers.supportsCapability(serverId, INSTANCE_TRANSFER_FULL_COPY_CAPABILITY);
      const { warnings } = await runCauseEffect(
        downloadTransferInParts(remoteServers, serverId, input, path, fullCopy),
      );
      lastExport = path;
      return { saved: true, fileName: basename(path), warnings };
    }
    // `instance-transfer-v1` carries no chat history, channel messages or server preferences.
    const { agentIds, includeFiles, includeSettings } = input;
    const v1 = { agentIds, includeFiles, includeSettings };
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
    return stageRemoteFile(serverId, path);
  };

  /** Sends the file at `path` to the host. The size check comes before the read. */
  const stageRemoteFile = async (serverId: string, path: string): Promise<InstanceTransferPreview> => {
    if (inParts(serverId)) return runCauseEffect(uploadTransferInParts(remoteServers, serverId, path));
    const info = await stat(path);
    if (!info.isFile() || info.size === 0) throw new Error(sourceText("error.import.chooseZip"));
    if (info.size > INSTANCE_TRANSFER_REMOTE_BYTES) throw new Error(sourceText("error.import.transferRemoteTooLarge"));
    return runCauseEffect(remoteServers.stageInstanceTransfer(serverId, new Uint8Array(await readFile(path))));
  };

  const applyRemote = async (input: ApplyInstanceTransferInput, serverId: string) => {
    requireRemote(serverId);
    const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
    // Only `instance-transfer-full-copy-v1` replaces the server preferences; the v1 apply never does.
    const fullCopy = remoteServers.supportsCapability(serverId, INSTANCE_TRANSFER_FULL_COPY_CAPABILITY);
    const { token, keys, includeSettings } = input;
    const result = await runCauseEffect(
      remoteServers.request(
        serverId,
        fullCopy ? INSTANCE_TRANSFER_FULL_COPY_ROUTES.apply : INSTANCE_TRANSFER_ROUTES.apply,
        decodeRemoteInstanceTransferResult,
        {
          method: "POST",
          body: fullCopy
            ? {
                token,
                keys,
                includeSettings,
                includeServerPreferences: input.includeServerPreferences === true,
                timezone,
              }
            : { token, keys, includeSettings, timezone },
          timeoutMs: AGENT_IMPORT_UPLOAD_TIMEOUT_MS,
        },
      ),
    );
    return resolveRemoteInstanceTransferResult(
      result,
      await runCauseEffect(remoteServers.request(serverId, TEAM_API_ROUTES.agents.all, decodeAgentSummaries)),
    );
  };

  /** Writes the source server's agents to `path`, with their files and without chats or settings. Returns its warnings. */
  const exportTo = async (serverId: string, agentIds: string[], path: string): Promise<string[]> => {
    const input: ExportInstanceInput = { agentIds, includeFiles: true, includeSettings: false };
    if (serverId === LOCAL_SERVER_ID) {
      const prepared = await runCauseEffect(instanceTransfer.prepareExport(input));
      return (await runCauseEffect(prepared.write(path))).warnings;
    }
    requireRemote(serverId);
    if (inParts(serverId))
      return (await runCauseEffect(downloadTransferInParts(remoteServers, serverId, input, path))).warnings;
    // `instance-transfer-v1` sends the file with no warnings.
    await writeFile(path, await runCauseEffect(remoteServers.downloadInstanceTransfer(serverId, input)));
    return [];
  };

  /** Reads the file at the destination server and returns its token. */
  const stageAt = (serverId: string, path: string) =>
    routeToServer(serverId, {
      // The local stage reads the file again at apply, so the file stays until `copy` ends.
      local: () => runCauseEffect(instanceTransfer.stage(path)),
      remote: (target) => {
        requireRemote(target);
        return stageRemoteFile(target, path);
      },
    });

  const copy = async (
    { fromServerId, agentIds }: CopyInstanceAgentsInput,
    serverId: string,
  ): Promise<InstanceTransferResult> => {
    if (fromServerId === serverId) throw new Error("Invalid copy request: the servers are the same.");
    const directory = await mkdtemp(join(app.getPath("temp"), "openbot-copy-"));
    try {
      const path = join(directory, "agents.zip");
      const exportWarnings = await exportTo(fromServerId, agentIds, path);
      const preview = await stageAt(serverId, path);
      const input: ApplyInstanceTransferInput = {
        token: preview.token,
        keys: preview.agents.map((agent) => agent.key),
        includeSettings: false,
      };
      // The apply releases the token and the staged file, also when it fails.
      const result = await routeToServer(serverId, {
        local: () => runCauseEffect(instanceTransfer.apply(input)),
        remote: (target) => applyRemote(input, target),
      });
      // The export and the stage can drop files and agents. Show why, as a file export and import do.
      const warnings = [...new Set([...exportWarnings, ...preview.warnings, ...result.warnings])];
      return { ...result, warnings: warnings.slice(0, AGENT_IMPORT_LIMITS.warnings) };
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
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
      // The destination is the server scope; the source is in the payload. Both can be joined servers.
      copy: payloadHandler(agentRequest(parseCopyInstanceAgentsInput), ({ serverId, payload }) =>
        copy(payload, serverId),
      ),
    },
  };
}
