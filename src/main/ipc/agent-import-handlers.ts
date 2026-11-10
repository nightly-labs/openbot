import { Effect } from "effect";
// Agent import into the local host, or into a joined server with `agent-import-v2` (in parts) or
// `agent-import-v1`. The file dialog opens here, so the renderer never names a path. For a joined
// server, main reads the file and sends it. A joined server reads its own Hermes folder with
// `hermes-import-v1`.

import { copyFile, readFile, stat } from "node:fs/promises";
import { join } from "node:path";
import {
  type AgentImportPreview,
  type ApplyAgentImportInput,
  decodeRemoteAgentImportResult,
  parseAgentImportSkillSource,
  parseApplyAgentImportInput,
  parseApplyHermesImportInput,
  resolveRemoteAgentImportResult,
} from "@openbot/contracts/ipc";
import { TEAM_API_ROUTES } from "@openbot/contracts/team-api-routes";
import {
  AGENT_IMPORT_CAPABILITY,
  AGENT_IMPORT_ROUTES,
  AGENT_IMPORT_UPLOAD_BYTES,
} from "@openbot/contracts/team-protocol/agent-import-v1";
import { AGENT_IMPORT_V2_CAPABILITY } from "@openbot/contracts/team-protocol/agent-import-v2";
import {
  decodeHermesImportReadResponse,
  HERMES_IMPORT_CAPABILITY,
  HERMES_IMPORT_ROUTES,
} from "@openbot/contracts/team-protocol/hermes-import-v1";
import type { AppTranslate } from "@openbot/i18n";
import { sourceText } from "@openbot/i18n/source";
import { app, type BrowserWindow, dialog, type OpenDialogOptions, type SaveDialogOptions } from "electron";
import { runCauseEffect } from "../../backend/effect-boundary";
import type { AgentImportService } from "../agent-import-service";
import { hermesRoot, profileRoot } from "../hermes-import-reader";
import type { HermesImportService } from "../hermes-import-service";
import { decodeAgentSummaries } from "../remote-agent-decoding";
import { AGENT_IMPORT_UPLOAD_TIMEOUT_MS, type RemoteServerManager } from "../remote-server-manager";
import { handler, type IpcGroupHandlers, payloadHandler } from "./define-ipc-group";
import { scopedHandler, scopedQueryHandler } from "./scoped-handler";
import { stringPayload } from "./validation";

export interface AgentImportIpcDependencies {
  agentImport: AgentImportService;
  hermesImport: HermesImportService;
  remoteServers: Pick<
    RemoteServerManager,
    "supportsCapability" | "request" | "stageAgentImport" | "stageAgentImportInParts"
  >;
  getMainWindow: () => BrowserWindow | null;
  translate: AppTranslate;
  /** The folder of the export skills a user adds to Grok Bot or Hermes by hand: `<source>/SKILL.md`. */
  exportSkillDirectory: string;
}

export function agentImportIpcHandlers({
  agentImport,
  hermesImport,
  remoteServers,
  getMainWindow,
  translate,
  exportSkillDirectory,
}: AgentImportIpcDependencies): Pick<IpcGroupHandlers, "agentImport"> {
  const chooseExport = async (): Promise<string | null> => {
    const mainWindow = getMainWindow();
    const options: OpenDialogOptions = {
      title: translate("dialog.chooseAgentExport"),
      properties: ["openFile"],
      filters: [{ name: translate("dialog.filter.agentExports"), extensions: ["zip"] }],
    };
    const result = mainWindow ? await dialog.showOpenDialog(mainWindow, options) : await dialog.showOpenDialog(options);
    return result.canceled || !result.filePaths[0] ? null : result.filePaths[0];
  };

  // Hermes keeps its profiles in a folder, so the user names the folder and main reads it.
  const chooseHermesFolder = async (): Promise<string | null> => {
    const mainWindow = getMainWindow();
    const options: OpenDialogOptions = {
      title: translate("dialog.chooseHermesFolder"),
      defaultPath: hermesRoot(),
      properties: ["openDirectory", "showHiddenFiles"],
    };
    const result = mainWindow ? await dialog.showOpenDialog(mainWindow, options) : await dialog.showOpenDialog(options);
    return result.canceled || !result.filePaths[0] ? null : result.filePaths[0];
  };

  const requireRemoteImport = (serverId: string) => {
    if (!remoteServers.supportsCapability(serverId, AGENT_IMPORT_CAPABILITY))
      throw new Error(sourceText("error.team.agentImportUnsupported"));
  };

  const requireRemoteHermes = (serverId: string) => {
    if (!remoteServers.supportsCapability(serverId, HERMES_IMPORT_CAPABILITY))
      throw new Error(sourceText("error.team.hermesImportUnsupported"));
  };

  const stageRemote = async (serverId: string): Promise<AgentImportPreview | null> => {
    requireRemoteImport(serverId);
    const path = await chooseExport();
    if (!path) return null;
    const info = await stat(path);
    if (!info.isFile() || info.size === 0) throw new Error(sourceText("error.import.chooseZip"));
    if (remoteServers.supportsCapability(serverId, AGENT_IMPORT_V2_CAPABILITY))
      return runCauseEffect(remoteServers.stageAgentImportInParts(serverId, path, info.size));
    if (info.size > AGENT_IMPORT_UPLOAD_BYTES) throw new Error(sourceText("error.import.remoteZipTooLargeOldHost"));
    return runCauseEffect(remoteServers.stageAgentImport(serverId, new Uint8Array(await readFile(path))));
  };

  const applyRemote = async (input: ApplyAgentImportInput, serverId: string) => {
    requireRemoteImport(serverId);
    const result = await runCauseEffect(
      remoteServers.request(serverId, AGENT_IMPORT_ROUTES.apply, decodeRemoteAgentImportResult, {
        method: "POST",
        body: { ...input, timezone: Intl.DateTimeFormat().resolvedOptions().timeZone },
        timeoutMs: AGENT_IMPORT_UPLOAD_TIMEOUT_MS,
      }),
    );
    return resolveRemoteAgentImportResult(
      result,
      await runCauseEffect(remoteServers.request(serverId, TEAM_API_ROUTES.agents.all, decodeAgentSummaries)),
    );
  };

  return {
    agentImport: {
      choose: scopedQueryHandler({
        local: async () => {
          const path = await chooseExport();
          return path ? runCauseEffect(agentImport.stage(path)) : null;
        },
        remote: stageRemote,
      }),
      apply: scopedHandler(parseApplyAgentImportInput, {
        local: (input) => runCauseEffect(agentImport.apply(input)),
        remote: applyRemote,
      }),
      discard: scopedHandler(stringPayload("token"), {
        local: (token) => Effect.runPromise(agentImport.discard(token)),
        remote: async (token, serverId) => {
          requireRemoteImport(serverId);
          await runCauseEffect(
            remoteServers.request(serverId, AGENT_IMPORT_ROUTES.discard, () => undefined, {
              method: "POST",
              body: { token },
            }),
          );
        },
      }),
      readSkill: payloadHandler(parseAgentImportSkillSource, (source) =>
        readFile(join(exportSkillDirectory, source, "SKILL.md"), "utf8"),
      ),
      saveSkill: payloadHandler(parseAgentImportSkillSource, async (source) => {
        const mainWindow = getMainWindow();
        const options: SaveDialogOptions = {
          title: translate("dialog.saveExportSkill"),
          defaultPath: join(app.getPath("downloads"), "SKILL.md"),
          filters: [{ name: "Markdown", extensions: ["md"] }],
        };
        const result = mainWindow
          ? await dialog.showSaveDialog(mainWindow, options)
          : await dialog.showSaveDialog(options);
        if (result.canceled || !result.filePath) return { saved: false };
        await copyFile(join(exportSkillDirectory, source, "SKILL.md"), result.filePath);
        return { saved: true };
      }),
      readHermes: scopedQueryHandler({
        local: () => runCauseEffect(hermesImport.stage(hermesRoot())),
        // The server reads its own Hermes folder.
        remote: async (serverId) => {
          requireRemoteHermes(serverId);
          return runCauseEffect(
            remoteServers.request(serverId, HERMES_IMPORT_ROUTES.read, decodeHermesImportReadResponse, {
              method: "POST",
              body: {},
            }),
          );
        },
      }),
      // Local only: the folder dialog shows the files of this computer, and a joined server cannot read
      // them. On a joined server, Hermes on this computer comes with an export file instead.
      chooseHermes: handler(async () => {
        const folder = await chooseHermesFolder();
        if (!folder) return null;
        const preview = await runCauseEffect(hermesImport.stage(profileRoot(folder)));
        if (!preview) throw new Error(sourceText("error.import.hermesNoProfiles"));
        return preview;
      }),
      applyHermes: scopedHandler(parseApplyHermesImportInput, {
        local: (input) => runCauseEffect(hermesImport.apply(input)),
        remote: async (input, serverId) => {
          requireRemoteHermes(serverId);
          const result = await runCauseEffect(
            remoteServers.request(serverId, HERMES_IMPORT_ROUTES.apply, decodeRemoteAgentImportResult, {
              method: "POST",
              body: input,
              timeoutMs: AGENT_IMPORT_UPLOAD_TIMEOUT_MS,
            }),
          );
          return resolveRemoteAgentImportResult(
            result,
            await runCauseEffect(remoteServers.request(serverId, TEAM_API_ROUTES.agents.all, decodeAgentSummaries)),
          );
        },
      }),
      discardHermes: scopedHandler(stringPayload("token"), {
        local: (token) => Effect.runPromise(hermesImport.discard(token)),
        remote: async (token, serverId) => {
          requireRemoteHermes(serverId);
          await runCauseEffect(
            remoteServers.request(serverId, HERMES_IMPORT_ROUTES.discard, () => undefined, {
              method: "POST",
              body: { token },
            }),
          );
        },
      }),
    },
  };
}
