// Attachments, and the shared and workspace files an agent can open or preview.
// Every path here crosses to the local filesystem, so the parsers are the boundary.

import { createHash, randomUUID } from "node:crypto";
import { chmod, copyFile, mkdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import { basename, extname, join } from "node:path";
import {
  assertSupportedAttachmentName,
  attachmentFileExtension,
  IMAGE_ATTACHMENT_EXTENSIONS,
  MEDIA_ATTACHMENT_EXTENSIONS,
  supportedAttachmentExtensions,
} from "@openbot/contracts/attachment-files";
import { ATTACHMENT_LIMITS, INPUT_LIMITS } from "@openbot/contracts/input-limits";
import {
  type DownloadAttachmentsInput,
  decodeWorkspaceDirectory,
  type FileAction,
  type ImportAttachmentsInput,
  LOCAL_SERVER_ID,
  type OpenAttachmentInput,
} from "@openbot/contracts/ipc";
import { TEAM_API_ROUTES } from "@openbot/contracts/team-api-routes";
import {
  TEAM_EML_ATTACHMENTS_CAPABILITY,
  TEAM_MEDIA_ATTACHMENTS_CAPABILITY,
} from "@openbot/contracts/team-protocol/current";
import {
  WORKSPACE_DIRECTORY_CAPABILITY,
  WORKSPACE_DIRECTORY_ROUTES,
} from "@openbot/contracts/team-protocol/workspace-directory-v1";
import type { AppTranslate } from "@openbot/i18n";
import { sourceText } from "@openbot/i18n/source";
import { Effect, Schema } from "effect";
import { app, type BrowserWindow, dialog, type OpenDialogOptions, shell } from "electron";
import { type Zippable, zip } from "fflate";
import type { AgentService } from "../../backend/agent-service";
import { causeHelpers, runCauseEffect } from "../../backend/effect-boundary";
import type { MailboxStore } from "../../backend/mailbox-store";
import { filePreviewFromBytes, localFilePreview, mimeTypeForName } from "../file-preview";
import { decodeVoid } from "../remote-host-decoding";
import type { RemoteServerManager } from "../remote-server-manager";
import { remoteCall, remoteDecode } from "../remote-service-effects";
import {
  agentRequest,
  parseAttachmentId,
  parseChooseAttachments,
  parseDownloadAttachments,
  parseImportAttachments,
  parseOpenAttachment,
  parseOpenSharedFile,
  parseOpenWorkspaceFile,
} from "./agent-inputs";
import { type IpcGroupHandlers, payloadHandler } from "./define-ipc-group";
import { routeToServer } from "./route-to-server";
import { scopedHandler } from "./scoped-handler";

export interface AttachmentIpcDependencies {
  service: Pick<
    AgentService,
    | "prepareAttachments"
    | "prepareImportedAttachments"
    | "discardDraftAttachment"
    | "resolveSharedFile"
    | "resolveLocalWorkspaceFile"
    | "listLocalWorkspaceDirectory"
  >;
  mailbox: Pick<MailboxStore, "resolveAttachment">;
  remoteServers: Pick<
    RemoteServerManager,
    | "supportsCapability"
    | "request"
    | "downloadAttachment"
    | "downloadSharedFile"
    | "downloadWorkspaceFile"
    | "uploadAttachment"
  >;
  getMainWindow: () => BrowserWindow | null;
  translate: AppTranslate;
}

export function attachmentIpcHandlers({
  service,
  mailbox,
  remoteServers,
  getMainWindow,
  translate,
}: AttachmentIpcDependencies): Pick<IpcGroupHandlers, "agentAttachments" | "attachmentImports"> {
  // Reveal and save act on the file itself; only "open" depends on where the file is.
  async function deliverLocalFile(
    path: string,
    name: string,
    action: FileAction | undefined,
    open: () => Promise<void>,
  ) {
    if (action === "reveal") {
      shell.showItemInFolder(path);
      return;
    }
    if (action === "download") {
      const filePath = await chooseSavePath(getMainWindow(), translate, basename(name) || basename(path));
      if (filePath) await copyFile(path, filePath);
      return;
    }
    await open();
  }

  async function deliverRemoteFile(
    directory: string,
    cacheKey: string,
    downloaded: { name: string; bytes: Uint8Array },
    action: FileAction | undefined,
  ) {
    if (action === "download") {
      const filePath = await chooseSavePath(getMainWindow(), translate, basename(downloaded.name) || "file");
      if (filePath) await writeFile(filePath, downloaded.bytes, { mode: 0o600 });
      return;
    }
    const cached = await cacheRemoteFile(directory, cacheKey, downloaded);
    if (action === "reveal") shell.showItemInFolder(cached);
    else await openPath(cached);
  }

  return {
    attachmentImports: {
      importAttachments: scopedHandler(parseImportAttachments, {
        local: (parsed) => runCauseEffect(service.prepareImportedAttachments(parsed.paths, parsed.data)),
        remote: (parsed, serverId) => runCauseEffect(uploadRemoteImports(remoteServers, serverId, parsed)),
      }),
    },
    agentAttachments: {
      chooseAttachments: payloadHandler(agentRequest(parseChooseAttachments), async (parsed) => {
        const mainWindow = getMainWindow();
        const {
          serverId,
          payload: { filter },
        } = parsed;
        const supportsEml =
          serverId === LOCAL_SERVER_ID || remoteServers.supportsCapability(serverId, TEAM_EML_ATTACHMENTS_CAPABILITY);
        const supportsMedia =
          serverId === LOCAL_SERVER_ID || remoteServers.supportsCapability(serverId, TEAM_MEDIA_ATTACHMENTS_CAPABILITY);
        const options: OpenDialogOptions = {
          properties: ["openFile", "multiSelections"],
          filters:
            filter === "images"
              ? [{ name: translate("dialog.filter.images"), extensions: [...IMAGE_ATTACHMENT_EXTENSIONS] }]
              : [
                  {
                    name: translate("dialog.filter.supportedFiles"),
                    extensions: supportedAttachmentExtensions({ eml: supportsEml, media: supportsMedia }),
                  },
                ],
        };
        const result = mainWindow
          ? await dialog.showOpenDialog(mainWindow, options)
          : await dialog.showOpenDialog(options);
        if (result.canceled) return [];
        return routeToServer(serverId, {
          local: () => runCauseEffect(service.prepareAttachments(result.filePaths)),
          remote: (target) => runCauseEffect(uploadRemotePaths(remoteServers, target, result.filePaths)),
        });
      }),
      discardDraftAttachment: scopedHandler(parseAttachmentId, {
        local: (attachmentId) => runCauseEffect(service.discardDraftAttachment(attachmentId)),
        remote: (attachmentId, serverId) =>
          runCauseEffect(
            remoteServers.request(serverId, TEAM_API_ROUTES.attachment(attachmentId), decodeVoid, { method: "DELETE" }),
          ),
      }),
      downloadAttachments: payloadHandler(agentRequest(parseDownloadAttachments), async (scoped) => {
        const parsed = scoped.payload;
        await runCauseEffect(
          saveAttachmentArchive(
            parsed,
            () => archiveIO(() => chooseSavePath(getMainWindow(), translate, "attachments.zip")),
            // `routeToServer` answers a Promise, and this port takes an Effect, so the branch is written out.
            (item) =>
              scoped.serverId === LOCAL_SERVER_ID
                ? Effect.gen(function* () {
                    const attachment = yield* mailbox
                      .resolveAttachment(item.id)
                      .pipe(Effect.mapError(({ cause }) => new AttachmentArchiveFailed({ cause })));
                    if (!attachment) return yield* archiveFailure(sourceText("error.attachment.notFound"));
                    if ((yield* archiveIO(() => stat(attachment.path))).size > ATTACHMENT_LIMITS.fileBytes)
                      return yield* archiveFailure(sourceText("error.attachment.fileTooLarge"));
                    return yield* archiveIO(() => readFile(attachment.path));
                  })
                : remoteServers.downloadAttachment(item.id, scoped.serverId).pipe(
                    Effect.map((downloaded) => downloaded.bytes),
                    Effect.mapError(({ cause }) => new AttachmentArchiveFailed({ cause })),
                  ),
          ),
        );
      }),
      openAttachment: payloadHandler(agentRequest(parseOpenAttachment), (scoped) =>
        openAttachmentForServer({ mailbox, remoteServers, getMainWindow, translate }, scoped.serverId, scoped.payload),
      ),
      openSharedFile: scopedHandler(parseOpenSharedFile, {
        local: async (parsed) => {
          const sharedFile = await runCauseEffect(service.resolveSharedFile(parsed.path));
          await deliverLocalFile(sharedFile.path, sharedFile.name, parsed.action, () => openPath(sharedFile.path));
        },
        remote: async (parsed, serverId) => {
          const downloaded = await runCauseEffect(remoteServers.downloadSharedFile(parsed.path, serverId));
          await deliverRemoteFile("remote-shared-files", `${serverId}:${parsed.path}`, downloaded, parsed.action);
        },
      }),
      openWorkspaceFile: scopedHandler(parseOpenWorkspaceFile, {
        local: async (parsed) => {
          const workspaceFile = await runCauseEffect(service.resolveLocalWorkspaceFile(parsed.agentId, parsed.path));
          // A file outside the workspace can be anything on the computer, including a program, so it is
          // shown in the file manager rather than run.
          await deliverLocalFile(workspaceFile.path, workspaceFile.name, parsed.action, async () => {
            if (workspaceFile.insideWorkspace) await openPath(workspaceFile.path);
            else shell.showItemInFolder(workspaceFile.path);
          });
        },
        remote: async (parsed, serverId) => {
          const downloaded = await runCauseEffect(
            remoteServers.downloadWorkspaceFile(parsed.agentId, parsed.path, serverId),
          );
          const key = `${serverId}:${parsed.agentId}:${parsed.path}`;
          await deliverRemoteFile("remote-workspace-files", key, downloaded, parsed.action);
        },
      }),
      listWorkspaceDirectory: scopedHandler(parseOpenWorkspaceFile, {
        local: (parsed) => runCauseEffect(service.listLocalWorkspaceDirectory(parsed.agentId, parsed.path)),
        remote: (parsed, serverId) => {
          if (!remoteServers.supportsCapability(serverId, WORKSPACE_DIRECTORY_CAPABILITY))
            throw new Error(sourceText("error.team.workspaceDirectoryUnsupported"));
          return runCauseEffect(
            remoteServers.request(serverId, WORKSPACE_DIRECTORY_ROUTES.list, decodeWorkspaceDirectory, {
              method: "POST",
              body: { agentId: parsed.agentId, path: parsed.path },
            }),
          );
        },
      }),
      previewSharedFile: scopedHandler(parseOpenSharedFile, {
        local: async (parsed) => {
          const sharedFile = await runCauseEffect(service.resolveSharedFile(parsed.path));
          return runCauseEffect(localFilePreview(sharedFile.path, sharedFile.name, sharedFile.size));
        },
        remote: async (parsed, serverId) => {
          const downloaded = await runCauseEffect(remoteServers.downloadSharedFile(parsed.path, serverId));
          return filePreviewFromBytes(downloaded.name, downloaded.bytes);
        },
      }),
      previewWorkspaceFile: scopedHandler(parseOpenWorkspaceFile, {
        local: async (parsed) => {
          const workspaceFile = await runCauseEffect(service.resolveLocalWorkspaceFile(parsed.agentId, parsed.path));
          return runCauseEffect(localFilePreview(workspaceFile.path, workspaceFile.name, workspaceFile.size));
        },
        remote: async (parsed, serverId) => {
          const downloaded = await runCauseEffect(
            remoteServers.downloadWorkspaceFile(parsed.agentId, parsed.path, serverId),
          );
          return filePreviewFromBytes(downloaded.name, downloaded.bytes);
        },
      }),
    },
  };
}

export type OpenAttachmentDependencies = Pick<AttachmentIpcDependencies, "getMainWindow" | "translate"> & {
  mailbox: Pick<MailboxStore, "resolveAttachment">;
  remoteServers: Pick<RemoteServerManager, "downloadAttachment">;
};

/**
 * Opens, reveals or saves one sent or generated file of the local host or a joined server. The
 * chat and the storage surfaces both reach a file by its attachment id, so they share this.
 */
export function openAttachmentForServer(
  { mailbox, remoteServers, getMainWindow, translate }: OpenAttachmentDependencies,
  serverId: string,
  input: OpenAttachmentInput,
): Promise<void> {
  return routeToServer<void>(serverId, {
    local: async () => {
      const attachment = await runCauseEffect(mailbox.resolveAttachment(input.attachmentId));
      if (!attachment) throw new Error(sourceText("error.attachment.unavailable"));
      if (input.action === "download") {
        const safeId = basename(input.attachmentId).replace(/[^a-z0-9_-]/gi, "-") || "attachment";
        const suggestedName = basename(attachment.name) || `attachment-${safeId}`;
        const filePath = await chooseSavePath(getMainWindow(), translate, suggestedName);
        if (!filePath) return;
        await copyFile(attachment.path, filePath);
        return;
      }
      if (input.action === "reveal") {
        shell.showItemInFolder(attachment.path);
        return;
      }
      await openPath(attachment.path);
    },
    remote: async (target) => {
      const downloaded = await runCauseEffect(remoteServers.downloadAttachment(input.attachmentId, target));
      const suggestedName = basename(downloaded.name) || `attachment-${input.attachmentId}`;
      if (input.action === "download") {
        const filePath = await chooseSavePath(getMainWindow(), translate, suggestedName);
        if (!filePath) return;
        await writeFile(filePath, downloaded.bytes, { mode: 0o600 });
        return;
      }
      const cached = await cacheRemoteFile("remote-attachments", `${target}:${input.attachmentId}`, {
        name: suggestedName,
        bytes: downloaded.bytes,
      });
      if (input.action === "reveal") shell.showItemInFolder(cached);
      else await openPath(cached);
    },
  });
}

// A remote file has to land on disk before the OS can open it. Owner-only, under a per-server and
// per-path digest so two servers sharing a file name cannot overwrite each other.
async function cacheRemoteFile(
  directory: string,
  cacheKeyInput: string,
  downloaded: { name: string; bytes: Uint8Array },
): Promise<string> {
  const cacheRoot = join(app.getPath("userData"), directory);
  await mkdir(cacheRoot, { recursive: true, mode: 0o700 });
  const cacheKey = createHash("sha256").update(cacheKeyInput).digest("hex");
  const target = join(cacheRoot, `${cacheKey}-${basename(downloaded.name)}`);
  await writeFile(target, downloaded.bytes, { mode: 0o600 });
  await chmod(target, 0o600);
  return target;
}

// `shell.openPath` reports failure by resolving with the message rather than rejecting.
async function openPath(path: string): Promise<void> {
  const error = await shell.openPath(path);
  if (error) throw new Error(error);
}

// Returns the chosen path, or undefined when the user cancelled.
async function chooseSavePath(
  mainWindow: BrowserWindow | null,
  translate: AppTranslate,
  suggestedName: string,
): Promise<string | undefined> {
  const extension = extname(suggestedName).slice(1).toLowerCase();
  const options: Electron.SaveDialogOptions = {
    defaultPath: join(app.getPath("downloads"), suggestedName),
    filters: [{ name: translate("dialog.filter.attachment"), extensions: extension ? [extension] : ["*"] }],
    showsTagField: false,
  };
  const result =
    mainWindow && !mainWindow.isDestroyed()
      ? await dialog.showSaveDialog(mainWindow, options)
      : await dialog.showSaveDialog(options);
  return result.canceled ? undefined : result.filePath || undefined;
}

const uploadRemotePaths = Effect.fn("AttachmentIpc.uploadRemotePaths")(function* (
  remoteServers: AttachmentIpcDependencies["remoteServers"],
  serverId: string,
  paths: string[],
) {
  yield* remoteDecode(() => {
    if (paths.length > INPUT_LIMITS.attachments) {
      throw new Error(sourceText("error.attachment.tooMany", { limit: INPUT_LIMITS.attachments }));
    }
    assertRemoteAttachmentSupport(
      remoteServers,
      serverId,
      paths.map((path) => basename(path)),
    );
    for (const path of paths) assertSupportedAttachmentName(basename(path));
  });
  const files = yield* Effect.forEach(
    paths,
    (path) =>
      remoteCall(() => readFile(path)).pipe(
        Effect.map((bytes) => ({
          name: basename(path),
          mimeType: mimeTypeForName(path),
          bytes: new Uint8Array(bytes),
        })),
      ),
    { concurrency: "unbounded" },
  );
  return yield* uploadRemoteFiles(remoteServers, serverId, files);
});

const uploadRemoteImports = Effect.fn("AttachmentIpc.uploadRemoteImports")(function* (
  remoteServers: AttachmentIpcDependencies["remoteServers"],
  serverId: string,
  input: ImportAttachmentsInput,
) {
  yield* remoteDecode(() => {
    if (input.paths.length + input.data.length > INPUT_LIMITS.attachments) {
      throw new Error(sourceText("error.attachment.tooMany", { limit: INPUT_LIMITS.attachments }));
    }
    assertRemoteAttachmentSupport(remoteServers, serverId, [
      ...input.paths.map((path) => basename(path)),
      ...input.data.map((item) => basename(item.name)),
    ]);
  });
  const pathFiles = yield* Effect.forEach(
    input.paths,
    (path) =>
      remoteCall(() => readFile(path)).pipe(
        Effect.map((bytes) => ({
          name: basename(path),
          mimeType: mimeTypeForName(path),
          bytes: new Uint8Array(bytes),
        })),
      ),
    { concurrency: "unbounded" },
  );
  const files = [
    ...pathFiles,
    ...input.data.map((item) => ({
      name: basename(item.name),
      mimeType: item.mimeType,
      bytes: item.bytes,
    })),
  ];
  return yield* uploadRemoteFiles(remoteServers, serverId, files);
});

/** Checks the names and sizes, then uploads every file at once, as one import. */
function uploadRemoteFiles(
  remoteServers: AttachmentIpcDependencies["remoteServers"],
  serverId: string,
  files: { name: string; mimeType: string; bytes: Uint8Array }[],
) {
  return remoteDecode(() => {
    for (const file of files) assertSupportedAttachmentName(file.name);
    if (files.some((file) => file.bytes.byteLength > ATTACHMENT_LIMITS.fileBytes)) {
      throw new Error(sourceText("error.attachment.fileTooLarge"));
    }
    if (files.reduce((sum, file) => sum + file.bytes.byteLength, 0) > ATTACHMENT_LIMITS.totalBytes) {
      throw new Error(sourceText("error.attachment.totalTooLarge"));
    }
  }).pipe(
    Effect.andThen(
      Effect.forEach(files, (file) => remoteServers.uploadAttachment(file.name, file.mimeType, file.bytes, serverId), {
        concurrency: "unbounded",
      }),
    ),
  );
}

function assertRemoteAttachmentSupport(
  remoteServers: AttachmentIpcDependencies["remoteServers"],
  serverId: string,
  names: readonly string[],
): void {
  if (
    names.some((name) =>
      MEDIA_ATTACHMENT_EXTENSIONS.some((extension) => extension === attachmentFileExtension(name)),
    ) &&
    !remoteServers.supportsCapability(serverId, TEAM_MEDIA_ATTACHMENTS_CAPABILITY)
  ) {
    throw new Error(sourceText("error.attachment.mediaUnsupported"));
  }
  if (!names.some((name) => attachmentFileExtension(name) === "eml")) return;
  if (remoteServers.supportsCapability(serverId, TEAM_EML_ATTACHMENTS_CAPABILITY)) return;
  throw new Error(sourceText("error.attachment.emlUnsupported"));
}

/** A ZIP download that failed. The cause is the error the renderer reads. */
export class AttachmentArchiveFailed extends Schema.TaggedError<AttachmentArchiveFailed>()("AttachmentArchiveFailed", {
  cause: Schema.Defect(),
}) {}

const { io: archiveIO } = causeHelpers(AttachmentArchiveFailed);

function archiveFailure(message: string): Effect.Effect<never, AttachmentArchiveFailed> {
  return Effect.fail(new AttachmentArchiveFailed({ cause: new Error(message) }));
}

// Names are archive labels only; file access always uses a managed attachment ID.
export const saveAttachmentArchive = Effect.fn("Attachments.saveArchive")(function* (
  input: DownloadAttachmentsInput,
  chooseDestination: () => Effect.Effect<string | undefined, AttachmentArchiveFailed>,
  readAttachment: (
    item: DownloadAttachmentsInput["attachments"][number],
  ) => Effect.Effect<Uint8Array, AttachmentArchiveFailed>,
) {
  const destination = yield* chooseDestination();
  if (!destination) return;
  const files: Zippable = {};
  const usedNames = new Set<string>();
  let totalBytes = 0;
  for (const item of input.attachments) {
    const bytes = yield* readAttachment(item);
    totalBytes += bytes.byteLength;
    if (bytes.byteLength > ATTACHMENT_LIMITS.fileBytes)
      return yield* archiveFailure(sourceText("error.attachment.fileTooLarge"));
    if (totalBytes > ATTACHMENT_LIMITS.totalBytes)
      return yield* archiveFailure(sourceText("error.attachment.totalTooLarge"));
    const safeName =
      item.name
        .replaceAll("\\", "/")
        .split("/")
        .at(-1)
        ?.replace(/[<>:"|?*\p{Cc}]/gu, "-")
        .replace(/[. ]+$/g, "") || "attachment";
    const extension = extname(safeName);
    const stem = safeName.slice(0, safeName.length - extension.length);
    let name = safeName;
    let suffix = 2;
    while (usedNames.has(name.toLowerCase()) || name === "__proto__") {
      name = `${stem} (${suffix++})${extension}`;
    }
    usedNames.add(name.toLowerCase());
    // A prefix prevents numeric filenames from being reordered by object enumeration.
    files[`./${name}`] = bytes;
  }
  const archive = yield* Effect.callback<Uint8Array, AttachmentArchiveFailed>((resume) => {
    zip(files, { level: 6 }, (error, data) =>
      resume(error ? Effect.fail(new AttachmentArchiveFailed({ cause: error })) : Effect.succeed(data)),
    );
  });
  const temporary = `${destination}.${randomUUID()}.tmp`;
  yield* archiveIO(() => writeFile(temporary, archive, { mode: 0o600, flag: "wx" })).pipe(
    Effect.andThen(archiveIO(() => rename(temporary, destination))),
    Effect.ensuring(Effect.promise(() => rm(temporary, { force: true }))),
  );
});
