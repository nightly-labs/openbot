import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import {
  fillWorkflowFileExport,
  parseWorkflowFolderAction,
  WORKFLOW_MEDIA_CATALOG_MAX,
  type WorkflowFileHostExport,
  type WorkflowFileSaveResult,
  type WorkflowMediaCatalog,
  type WorkflowMediaCredits,
  type WorkflowMediaProviders,
} from "@openbot/contracts/ipc";
import {
  WORKFLOW_FOLDERS_CAPABILITY,
  WORKFLOW_FOLDERS_ROUTES,
} from "@openbot/contracts/team-protocol/workflow-folders-v1";
import { decodeWorkflowSpotInput, type WorkflowSpotInput } from "@openbot/contracts/team-protocol/workflow-presence-v1";
import {
  WORKFLOWS_CREDIT_MEDIA_UNAVAILABLE_CAPABILITY,
  WORKFLOWS_CREDIT_MEDIA_UNAVAILABLE_ROUTES,
} from "@openbot/contracts/team-protocol/workflows-credit-media-unavailable-v1";
import {
  WORKFLOWS_CREDIT_MEDIA_CAPABILITY,
  WORKFLOWS_CREDIT_MEDIA_ROUTES,
} from "@openbot/contracts/team-protocol/workflows-credit-media-v1";
import {
  WORKFLOWS_GITHUB_CAPABILITY,
  WORKFLOWS_GITHUB_ROUTES,
} from "@openbot/contracts/team-protocol/workflows-github-v1";
import {
  WORKFLOWS_HIGGSFIELD_CAPABILITY,
  WORKFLOWS_HIGGSFIELD_ROUTES,
} from "@openbot/contracts/team-protocol/workflows-higgsfield-v1";
import {
  WORKFLOWS_MEDIA_CATALOG_CAPABILITY,
  WORKFLOWS_MEDIA_CATALOG_ROUTES,
} from "@openbot/contracts/team-protocol/workflows-media-catalog-v1";
import {
  WORKFLOWS_MEDIA_CATALOG_V2_CAPABILITY,
  WORKFLOWS_MEDIA_CATALOG_V2_ROUTES,
} from "@openbot/contracts/team-protocol/workflows-media-catalog-v2";
import {
  WORKFLOWS_MEDIA_SERVICE_ACCOUNT_CAPABILITY,
  WORKFLOWS_MEDIA_SERVICE_ACCOUNT_ROUTES,
} from "@openbot/contracts/team-protocol/workflows-media-service-account-v1";
import {
  WORKFLOWS_MEDIA_CAPABILITY,
  WORKFLOWS_MEDIA_ROUTES,
} from "@openbot/contracts/team-protocol/workflows-media-v1";
import {
  WORKFLOWS_PAUSE_CAPABILITY,
  WORKFLOWS_PAUSE_ROUTES,
} from "@openbot/contracts/team-protocol/workflows-pause-v1";
import {
  WORKFLOWS_PORTABLE_CAPABILITY,
  WORKFLOWS_PORTABLE_ROUTES,
} from "@openbot/contracts/team-protocol/workflows-portable-v1";
import {
  WORKFLOWS_STEP_SETTINGS_CAPABILITY,
  WORKFLOWS_STEP_SETTINGS_ROUTES,
} from "@openbot/contracts/team-protocol/workflows-step-settings-v1";
import {
  WORKFLOWS_SUNRA_CAPABILITY,
  WORKFLOWS_SUNRA_ROUTES,
} from "@openbot/contracts/team-protocol/workflows-sunra-v1";
import { WORKFLOWS_CAPABILITY, WORKFLOWS_ROUTES } from "@openbot/contracts/team-protocol/workflows-v1";
import type { AppTranslate } from "@openbot/i18n";
import { sourceText } from "@openbot/i18n/source";
import {
  decodeRemoteCreditMediaCredits,
  decodeRemoteHiggsfieldCredits,
  decodeRemoteHiggsfieldProviders,
  decodeRemoteMediaServiceAccounts,
  decodeRemoteMediaServiceCredits,
  decodeRemoteWorkflowDetail,
  decodeRemoteWorkflowFileExport,
  decodeRemoteWorkflowGitHubCatalog,
  decodeRemoteWorkflowGitHubHistory,
  decodeRemoteWorkflowGitHubOptions,
  decodeRemoteWorkflowList,
  decodeRemoteWorkflowMediaCatalog,
  decodeRemoteWorkflowMediaCredits,
  decodeRemoteWorkflowMediaPrice,
  decodeRemoteWorkflowMediaProviders,
  decodeRemoteWorkflowMediaUnavailable,
  decodeRemoteWorkflowPicture,
  decodeRemoteWorkflowRunDetail,
  decodeRemoteWorkflowRunPage,
  decodeRemoteWorkflowSaveResult,
  decodeRemoteWorkflowSecret,
  decodeRemoteWorkflowStep,
  decodeRemoteWorkflowStepSettings,
  decodeRemoteWorkflowSummary,
  decodeRemoteWorkflowVersionGraph,
  decodeRemoteWorkflowVersions,
  workflowMediaCreditsOf,
  workflowMediaProvidersOf,
} from "@openbot/team-client/workflow-decoding";
import type { Effect } from "effect";
import { app, type BrowserWindow, dialog, type SaveDialogOptions, type WebContents } from "electron";
import { runCauseEffect } from "../../backend/effect-boundary";
import type { WorkflowsHandle } from "../../backend/workflows/workflows";
import type { WorkflowGitHubDirectory } from "../github-rest";
import type { HostEventsService } from "../host-events-service";
import { acceptEmpty, decodeWorkflowFoldersSnapshotFromHost, type ResponseDecoder } from "../remote-host-decoding";
import type { RemoteRequestInit } from "../remote-server-client";
import type { RemoteWorkflowError } from "../remote-service-effects";
import type { WorkflowFileExporter } from "../workflow-file-export";
import type { WorkflowFoldersService } from "../workflow-folders-service";
import { agentRequest } from "./agent-inputs";
import { eventPayloadHandler, type IpcGroupHandlers } from "./define-ipc-group";
import { routeToServer } from "./route-to-server";
import { scopedHandler, scopedQueryHandler } from "./scoped-handler";
import {
  parseCreateWorkflow,
  parseDecideWorkflowStep,
  parseRenameWorkflow,
  parseRetryWorkflowStep,
  parseRunWorkflowStep,
  parseSaveWorkflowGraph,
  parseSetWorkflowPaused,
  parseStartWorkflowRun,
  parseWorkflowDraftId,
  parseWorkflowGitHubLastEvent,
  parseWorkflowGitHubRepository,
  parseWorkflowId,
  parseWorkflowMediaPrice,
  parseWorkflowRunId,
  parseWorkflowRuns,
  parseWorkflowStepId,
  parseWorkflowTrigger,
  parseWorkflowVersion,
} from "./workflow-inputs";

interface WorkflowRemoteServers {
  supportsCapability(
    serverId: string,
    capability:
      | typeof WORKFLOWS_CAPABILITY
      | typeof WORKFLOWS_GITHUB_CAPABILITY
      | typeof WORKFLOWS_MEDIA_CAPABILITY
      | typeof WORKFLOWS_SUNRA_CAPABILITY
      | typeof WORKFLOWS_HIGGSFIELD_CAPABILITY
      | typeof WORKFLOWS_MEDIA_CATALOG_CAPABILITY
      | typeof WORKFLOWS_MEDIA_CATALOG_V2_CAPABILITY
      | typeof WORKFLOWS_CREDIT_MEDIA_CAPABILITY
      | typeof WORKFLOWS_CREDIT_MEDIA_UNAVAILABLE_CAPABILITY
      | typeof WORKFLOWS_MEDIA_SERVICE_ACCOUNT_CAPABILITY
      | typeof WORKFLOWS_STEP_SETTINGS_CAPABILITY
      | typeof WORKFLOWS_PAUSE_CAPABILITY
      | typeof WORKFLOWS_PORTABLE_CAPABILITY
      | typeof WORKFLOW_FOLDERS_CAPABILITY,
  ): boolean;
  request<T>(
    serverId: string,
    path: string,
    decoder: ResponseDecoder<T>,
    init?: RemoteRequestInit,
  ): Effect.Effect<T, RemoteWorkflowError>;
  downloadAttachment(attachmentId: string, serverId: string): Effect.Effect<{ bytes: Uint8Array }, RemoteWorkflowError>;
  setWorkflowSpot(serverId: string, input: WorkflowSpotInput): Effect.Effect<void>;
}

interface WorkflowSpotHost {
  setWorkflowSpot(input: WorkflowSpotInput): void;
}

interface WorkflowIpcDependencies {
  workflows: WorkflowsHandle;
  host: WorkflowSpotHost;
  events: Pick<HostEventsService, "rotateWorkflowSecret">;
  github: WorkflowGitHubDirectory;
  workflowFolders: Pick<WorkflowFoldersService, "read" | "change">;
  remoteServers: WorkflowRemoteServers;
  workflowFiles: WorkflowFileExporter;
  getMainWindow: () => BrowserWindow | null;
  translate: AppTranslate;
}

export function workflowIpcHandlers({
  workflows,
  host,
  events,
  github,
  workflowFolders,
  remoteServers,
  workflowFiles,
  getMainWindow,
  translate,
}: WorkflowIpcDependencies): Pick<IpcGroupHandlers, "workflows"> {
  const spotWindows = workflowSpotWindows((serverId, input) =>
    routeToServer(serverId, {
      local: () => host.setWorkflowSpot(input),
      remote: (target) => runCauseEffect(remoteServers.setWorkflowSpot(target, input)),
    }),
  );
  function remote<T>(serverId: string, path: string, decoder: ResponseDecoder<T>, body: unknown): Promise<T> {
    if (!remoteServers.supportsCapability(serverId, WORKFLOWS_CAPABILITY))
      throw new Error(sourceText("error.workflow.serverTooOld"));
    return runCauseEffect(remoteServers.request(serverId, path, decoder, { method: "POST", body }));
  }
  function remoteGitHub<T>(serverId: string, path: string, decoder: ResponseDecoder<T>, body: unknown): Promise<T> {
    if (!remoteServers.supportsCapability(serverId, WORKFLOWS_GITHUB_CAPABILITY))
      throw new Error(sourceText("error.workflow.serverTooOld"));
    return remote(serverId, path, decoder, body);
  }
  function remoteFolders(serverId: string, path: string, body: unknown) {
    if (!remoteServers.supportsCapability(serverId, WORKFLOW_FOLDERS_CAPABILITY))
      throw new Error(sourceText("error.team.workflowFoldersUnsupported"));
    return remote(serverId, path, decodeWorkflowFoldersSnapshotFromHost, body);
  }
  async function chooseExportPath(name: string): Promise<string | null> {
    const mainWindow = getMainWindow();
    const options: SaveDialogOptions = {
      title: translate("dialog.saveWorkflow"),
      defaultPath: join(app.getPath("downloads"), name),
      filters: [{ name: translate("dialog.filter.workflow"), extensions: ["json"] }],
      showsTagField: false,
    };
    const result = mainWindow ? await dialog.showSaveDialog(mainWindow, options) : await dialog.showSaveDialog(options);
    return result.canceled || !result.filePath ? null : result.filePath;
  }
  async function saveExport(
    source: WorkflowFileHostExport,
    bytes: (fileId: string) => Promise<Uint8Array | null>,
  ): Promise<WorkflowFileSaveResult> {
    const filled = await fillWorkflowFileExport(source, bytes);
    if (!filled.ok) return { saved: false, problem: filled.problem };
    const path = await chooseExportPath(filled.name);
    if (!path) return { saved: false, problem: null };
    await writeFile(path, filled.text, "utf8");
    return { saved: true, problem: null };
  }
  return {
    workflows: {
      list: scopedQueryHandler({
        local: () => runCauseEffect(workflows.list()),
        remote: (serverId) => remote(serverId, WORKFLOWS_ROUTES.list, decodeRemoteWorkflowList, {}),
      }),
      get: scopedHandler(parseWorkflowId, {
        local: (id) => runCauseEffect(workflows.get(id)),
        remote: (workflowId, serverId) =>
          remote(serverId, WORKFLOWS_ROUTES.get, decodeRemoteWorkflowDetail, { workflowId }),
      }),
      create: scopedHandler(parseCreateWorkflow, {
        local: (input) => runCauseEffect(workflows.create(input)),
        remote: ({ paused, ...input }, serverId) =>
          remote(serverId, WORKFLOWS_ROUTES.create, decodeRemoteWorkflowDetail, {
            ...input,
            ...(paused && remoteServers.supportsCapability(serverId, WORKFLOWS_PAUSE_CAPABILITY) ? { paused } : {}),
          }),
      }),
      rename: scopedHandler(parseRenameWorkflow, {
        local: (input) => runCauseEffect(workflows.rename(input)),
        remote: (input, serverId) => remote(serverId, WORKFLOWS_ROUTES.rename, decodeRemoteWorkflowSummary, input),
      }),
      setPaused: scopedHandler(parseSetWorkflowPaused, {
        local: (input) => runCauseEffect(workflows.setPaused(input)),
        remote: (input, serverId) => {
          if (!remoteServers.supportsCapability(serverId, WORKFLOWS_PAUSE_CAPABILITY))
            throw new Error(sourceText("error.workflow.serverTooOld"));
          return remote(serverId, WORKFLOWS_PAUSE_ROUTES.pause, decodeRemoteWorkflowSummary, input);
        },
      }),
      exportFile: scopedHandler(parseWorkflowId, {
        local: async (workflowId) => {
          const detail = await runCauseEffect(workflows.get(workflowId));
          return saveExport(await runCauseEffect(workflowFiles.source(detail)), (fileId) =>
            runCauseEffect(workflowFiles.bytes(fileId)),
          );
        },
        remote: async (workflowId, serverId) => {
          if (!remoteServers.supportsCapability(serverId, WORKFLOWS_PORTABLE_CAPABILITY))
            throw new Error(sourceText("error.workflow.serverTooOld"));
          const source = await remote(serverId, WORKFLOWS_PORTABLE_ROUTES.export, decodeRemoteWorkflowFileExport, {
            workflowId,
          });
          return saveExport(source, (fileId) =>
            runCauseEffect(remoteServers.downloadAttachment(fileId, serverId)).then(
              (file) => file.bytes,
              () => null,
            ),
          );
        },
      }),
      delete: scopedHandler(parseWorkflowId, {
        local: (id) => runCauseEffect(workflows.remove(id)),
        remote: (workflowId, serverId) => remote(serverId, WORKFLOWS_ROUTES.delete, acceptEmpty, { workflowId }),
      }),
      saveGraph: scopedHandler(parseSaveWorkflowGraph, {
        local: (input) => runCauseEffect(workflows.saveGraph(input)),
        remote: (input, serverId) =>
          remote(serverId, WORKFLOWS_ROUTES.saveGraph, decodeRemoteWorkflowSaveResult, input),
      }),
      versions: scopedHandler(parseWorkflowId, {
        local: (id) => runCauseEffect(workflows.versions(id)),
        remote: (workflowId, serverId) =>
          remote(serverId, WORKFLOWS_ROUTES.versions, decodeRemoteWorkflowVersions, { workflowId }),
      }),
      versionGraph: scopedHandler(parseWorkflowVersion, {
        local: (input) => runCauseEffect(workflows.versionGraph(input)),
        remote: (input, serverId) =>
          remote(serverId, WORKFLOWS_ROUTES.versionGraph, decodeRemoteWorkflowVersionGraph, input),
      }),
      restoreVersion: scopedHandler(parseWorkflowVersion, {
        local: (input) => runCauseEffect(workflows.restoreVersion(input)),
        remote: (input, serverId) =>
          remote(serverId, WORKFLOWS_ROUTES.restoreVersion, decodeRemoteWorkflowDetail, input),
      }),
      startRun: scopedHandler(parseStartWorkflowRun, {
        local: (input) => runCauseEffect(workflows.startRun(input)),
        remote: (input, serverId) => remote(serverId, WORKFLOWS_ROUTES.startRun, decodeRemoteWorkflowRunDetail, input),
      }),
      runStep: scopedHandler(parseRunWorkflowStep, {
        local: (input) => runCauseEffect(workflows.runStep(input)),
        remote: (input, serverId) => remote(serverId, WORKFLOWS_ROUTES.runStep, decodeRemoteWorkflowStep, input),
      }),
      stopStep: scopedHandler(parseWorkflowStepId, {
        local: (id) => runCauseEffect(workflows.stopStep(id)),
        remote: (stepId, serverId) => remote(serverId, WORKFLOWS_ROUTES.stopStep, acceptEmpty, { stepId }),
      }),
      stopRun: scopedHandler(parseWorkflowRunId, {
        local: (id) => runCauseEffect(workflows.stopRun(id)),
        remote: (runId, serverId) => remote(serverId, WORKFLOWS_ROUTES.stopRun, acceptEmpty, { runId }),
      }),
      retryStep: scopedHandler(parseRetryWorkflowStep, {
        local: (input) => runCauseEffect(workflows.retryStep(input)),
        remote: (input, serverId) => remote(serverId, WORKFLOWS_ROUTES.retryStep, decodeRemoteWorkflowStep, input),
      }),
      decide: scopedHandler(parseDecideWorkflowStep, {
        local: (input) => runCauseEffect(workflows.decide(input)),
        remote: (input, serverId) => remote(serverId, WORKFLOWS_ROUTES.decide, acceptEmpty, input),
      }),
      runs: scopedHandler(parseWorkflowRuns, {
        local: (input) => runCauseEffect(workflows.runs(input)),
        remote: (input, serverId) => remote(serverId, WORKFLOWS_ROUTES.runs, decodeRemoteWorkflowRunPage, input),
      }),
      run: scopedHandler(parseWorkflowRunId, {
        local: (id) => runCauseEffect(workflows.run(id)),
        remote: (runId, serverId) => remote(serverId, WORKFLOWS_ROUTES.run, decodeRemoteWorkflowRunDetail, { runId }),
      }),
      stepSettings: scopedHandler(parseWorkflowStepId, {
        local: (stepId) => runCauseEffect(workflows.stepSettings(stepId)),
        remote: (stepId, serverId) => {
          if (!remoteServers.supportsCapability(serverId, WORKFLOWS_STEP_SETTINGS_CAPABILITY))
            throw new Error(sourceText("error.workflow.serverTooOld"));
          return remote(serverId, WORKFLOWS_STEP_SETTINGS_ROUTES.read, decodeRemoteWorkflowStepSettings, { stepId });
        },
      }),
      rotateWebhookSecret: scopedHandler(parseWorkflowTrigger, {
        local: (input) => runCauseEffect(events.rotateWorkflowSecret(input)),
        remote: (input, serverId) =>
          remote(serverId, WORKFLOWS_ROUTES.rotateWebhookSecret, decodeRemoteWorkflowSecret, input),
      }),
      githubCatalog: scopedQueryHandler({
        local: () => runCauseEffect(github.catalog()),
        remote: (serverId) =>
          remoteGitHub(serverId, WORKFLOWS_GITHUB_ROUTES.catalog, decodeRemoteWorkflowGitHubCatalog, {}),
      }),
      githubOptions: scopedHandler(parseWorkflowGitHubRepository, {
        local: (input) => runCauseEffect(github.options(input.repository)),
        remote: (input, serverId) =>
          remoteGitHub(serverId, WORKFLOWS_GITHUB_ROUTES.options, decodeRemoteWorkflowGitHubOptions, input),
      }),
      githubHistory: scopedHandler(parseWorkflowId, {
        local: (id) => runCauseEffect(workflows.githubHistory(id)),
        remote: (workflowId, serverId) =>
          remoteGitHub(serverId, WORKFLOWS_GITHUB_ROUTES.history, decodeRemoteWorkflowGitHubHistory, { workflowId }),
      }),
      githubRunLastEvent: scopedHandler(parseWorkflowGitHubLastEvent, {
        local: (input) => runCauseEffect(workflows.githubLastEvent(input)),
        remote: (input, serverId) =>
          remoteGitHub(serverId, WORKFLOWS_GITHUB_ROUTES.runLastEvent, decodeRemoteWorkflowRunDetail, input),
      }),
      keepPicture: scopedHandler(parseWorkflowDraftId, {
        local: (draftId) => runCauseEffect(workflows.keepPicture(draftId)),
        remote: (draftId, serverId) => {
          if (!remoteServers.supportsCapability(serverId, WORKFLOWS_MEDIA_CAPABILITY))
            throw new Error(sourceText("error.workflow.serverTooOld"));
          return remote(serverId, WORKFLOWS_MEDIA_ROUTES.keepPicture, decodeRemoteWorkflowPicture, { draftId });
        },
      }),
      mediaProviders: scopedQueryHandler({
        local: () => workflows.mediaProviders(),
        remote: async (serverId) => ({
          ...(await serviceProviders(serverId)),
          ...(creditMedia(serverId) ? { openbot: true } : {}),
        }),
      }),
      mediaCredits: scopedQueryHandler({
        local: () => runCauseEffect(workflows.mediaCredits()),
        remote: async (serverId) => {
          const [services, credit] = await Promise.all([
            serviceCredits(serverId),
            creditMedia(serverId)
              ? remote(serverId, WORKFLOWS_CREDIT_MEDIA_ROUTES.credits, decodeRemoteCreditMediaCredits, {})
              : {},
          ]);
          return { ...services, ...credit };
        },
      }),
      mediaCatalog: scopedQueryHandler({
        local: () => runCauseEffect(workflows.mediaCatalog()),
        remote: async (serverId) => {
          const [credit, services, unavailable] = await Promise.all([
            creditMedia(serverId)
              ? remote(serverId, WORKFLOWS_CREDIT_MEDIA_ROUTES.catalog, decodeRemoteWorkflowMediaCatalog, {})
              : { models: [] },
            serviceCatalog(serverId),
            remoteServers.supportsCapability(serverId, WORKFLOWS_CREDIT_MEDIA_UNAVAILABLE_CAPABILITY)
              ? remote(
                  serverId,
                  WORKFLOWS_CREDIT_MEDIA_UNAVAILABLE_ROUTES.list,
                  decodeRemoteWorkflowMediaUnavailable,
                  {},
                ).catch(() => [])
              : [],
          ]);
          return {
            models: [...credit.models, ...services.models].slice(0, WORKFLOW_MEDIA_CATALOG_MAX),
            ...(unavailable.length > 0 ? { unavailable } : {}),
          };
        },
      }),
      mediaPrice: scopedHandler(parseWorkflowMediaPrice, {
        local: (input) => runCauseEffect(workflows.mediaPrice(input)),
        remote: (input, serverId) =>
          remoteServers.supportsCapability(serverId, WORKFLOWS_MEDIA_CATALOG_V2_CAPABILITY)
            ? remote(serverId, WORKFLOWS_MEDIA_CATALOG_V2_ROUTES.price, decodeRemoteWorkflowMediaPrice, input)
            : remoteServers.supportsCapability(serverId, WORKFLOWS_MEDIA_CATALOG_CAPABILITY)
              ? remote(serverId, WORKFLOWS_MEDIA_CATALOG_ROUTES.price, decodeRemoteWorkflowMediaPrice, input)
              : Promise.resolve({ credits: null }),
      }),
      folders: scopedQueryHandler({
        local: () => runCauseEffect(workflowFolders.read()),
        remote: (serverId) => remoteFolders(serverId, WORKFLOW_FOLDERS_ROUTES.read, {}),
      }),
      folderAction: scopedHandler(parseWorkflowFolderAction, {
        local: (action) => runCauseEffect(workflowFolders.change(action)),
        remote: (action, serverId) => remoteFolders(serverId, WORKFLOW_FOLDERS_ROUTES.actions, action),
      }),
      setSpot: eventPayloadHandler(agentRequest(decodeWorkflowSpotInput), (event, { serverId, payload }) =>
        spotWindows.set(event.sender, serverId, payload),
      ),
    },
  };

  function creditMedia(serverId: string) {
    return remoteServers.supportsCapability(serverId, WORKFLOWS_CREDIT_MEDIA_CAPABILITY);
  }

  async function serviceProviders(serverId: string): Promise<WorkflowMediaProviders> {
    if (remoteServers.supportsCapability(serverId, WORKFLOWS_MEDIA_SERVICE_ACCOUNT_CAPABILITY)) {
      const accounts = await remote(
        serverId,
        WORKFLOWS_MEDIA_SERVICE_ACCOUNT_ROUTES.accounts,
        decodeRemoteMediaServiceAccounts,
        {},
      );
      return workflowMediaProvidersOf(accounts);
    }
    const [sunra, higgsfield] = await Promise.all([
      remoteServers.supportsCapability(serverId, WORKFLOWS_SUNRA_CAPABILITY)
        ? remote(serverId, WORKFLOWS_SUNRA_ROUTES.providers, decodeRemoteWorkflowMediaProviders, {})
        : { sunra: false },
      remoteServers.supportsCapability(serverId, WORKFLOWS_HIGGSFIELD_CAPABILITY)
        ? remote(serverId, WORKFLOWS_HIGGSFIELD_ROUTES.providers, decodeRemoteHiggsfieldProviders, {})
        : { higgsfield: false },
    ]);
    return { ...sunra, ...higgsfield, accounts: null };
  }

  async function serviceCredits(serverId: string): Promise<WorkflowMediaCredits> {
    if (remoteServers.supportsCapability(serverId, WORKFLOWS_MEDIA_SERVICE_ACCOUNT_CAPABILITY)) {
      const accounts = await remote(
        serverId,
        WORKFLOWS_MEDIA_SERVICE_ACCOUNT_ROUTES.credits,
        decodeRemoteMediaServiceCredits,
        {},
      );
      return workflowMediaCreditsOf(accounts);
    }
    const [sunra, higgsfield] = await Promise.all([
      remoteServers.supportsCapability(serverId, WORKFLOWS_SUNRA_CAPABILITY)
        ? remote(serverId, WORKFLOWS_SUNRA_ROUTES.credits, decodeRemoteWorkflowMediaCredits, {})
        : { sunra: null },
      remoteServers.supportsCapability(serverId, WORKFLOWS_HIGGSFIELD_CAPABILITY)
        ? remote(serverId, WORKFLOWS_HIGGSFIELD_ROUTES.credits, decodeRemoteHiggsfieldCredits, {})
        : { higgsfield: null },
    ]);
    return { ...sunra, ...higgsfield, accounts: null };
  }

  function serviceCatalog(serverId: string): Promise<WorkflowMediaCatalog> {
    if (remoteServers.supportsCapability(serverId, WORKFLOWS_MEDIA_CATALOG_V2_CAPABILITY))
      return remote(serverId, WORKFLOWS_MEDIA_CATALOG_V2_ROUTES.catalog, decodeRemoteWorkflowMediaCatalog, {});
    if (remoteServers.supportsCapability(serverId, WORKFLOWS_MEDIA_CATALOG_CAPABILITY))
      return remote(serverId, WORKFLOWS_MEDIA_CATALOG_ROUTES.catalog, decodeRemoteWorkflowMediaCatalog, {});
    return Promise.resolve({ models: [] });
  }
}

interface WindowSpot {
  readonly input: WorkflowSpotInput;
  readonly order: number;
}

const LEAVE_WORKFLOW_SPOT: WorkflowSpotInput = { workflowId: null, at: null, selected: null };

function workflowSpotWindows(send: (serverId: string, input: WorkflowSpotInput) => Promise<void>) {
  const servers = new Map<string, Map<number, WindowSpot>>();
  const watched = new WeakSet<WebContents>();
  let order = 0;
  const newest = (spots: ReadonlyMap<number, WindowSpot>): number | null => {
    let winner: number | null = null;
    let winnerOrder = -1;
    for (const [windowId, spot] of spots)
      if (spot.order > winnerOrder) {
        winner = windowId;
        winnerOrder = spot.order;
      }
    return winner;
  };
  const remove = (serverId: string, windowId: number): Promise<void> => {
    const spots = servers.get(serverId) ?? new Map<number, WindowSpot>();
    const before = newest(spots);
    spots.delete(windowId);
    if (spots.size === 0) servers.delete(serverId);
    const after = newest(spots);
    if (after !== null && before !== windowId) return Promise.resolve();
    return send(serverId, (after === null ? undefined : spots.get(after)?.input) ?? LEAVE_WORKFLOW_SPOT);
  };
  const watch = (owner: WebContents) => {
    if (watched.has(owner)) return;
    watched.add(owner);
    const windowId = owner.id;
    owner.once("destroyed", () => {
      for (const serverId of [...servers.keys()])
        if (servers.get(serverId)?.has(windowId)) void remove(serverId, windowId).catch(() => undefined);
    });
  };
  return {
    set(owner: WebContents, serverId: string, input: WorkflowSpotInput): Promise<void> {
      watch(owner);
      if (input.workflowId === null) return remove(serverId, owner.id);
      const spots = servers.get(serverId) ?? new Map<number, WindowSpot>();
      servers.set(serverId, spots);
      const known = spots.get(owner.id);
      spots.set(owner.id, { input, order: known && sameSpotInput(known.input, input) ? known.order : ++order });
      return newest(spots) === owner.id ? send(serverId, input) : Promise.resolve();
    },
  };
}

function sameSpotInput(current: WorkflowSpotInput, next: WorkflowSpotInput): boolean {
  return (
    current.workflowId === next.workflowId &&
    current.selected === next.selected &&
    current.at?.x === next.at?.x &&
    current.at?.y === next.at?.y
  );
}
