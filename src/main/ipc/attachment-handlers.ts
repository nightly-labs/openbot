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
  type FilePreview,
  type ImportAttachmentsInput,
  LOCAL_SERVER_ID,
} from "@openbot/contracts/ipc";
import { TEAM_API_ROUTES } from "@openbot/contracts/team-api-routes";
import {
  TEAM_EML_ATTACHMENTS_CAPABILITY,
  TEAM_MEDIA_ATTACHMENTS_CAPABILITY,
} from "@openbot/contracts/team-protocol/current";
import { app, type BrowserWindow, dialog, type OpenDialogOptions, shell } from "electron";
import { type Zippable, zip } from "fflate";
import type { AgentService } from "../../backend/agent-service";
import type { MailboxStore } from "../../backend/mailbox-store";
import { filePreviewFromBytes, localFilePreview, mimeTypeForName } from "../file-preview";
import { decodeVoid } from "../remote-host-decoding";
import type { RemoteServerManager } from "../remote-server-manager";
import {
  parseAgentRequest,
  parseChooseAttachments,
  parseDownloadAttachments,
  parseImportAttachments,
  parseOpenAttachment,
  parseOpenSharedFile,
  parseOpenWorkspaceFile,
} from "./agent-inputs";
import { type IpcGroupHandlers, payloadHandler } from "./define-ipc-group";
import { routeToServer } from "./route-to-server";
import { requireString } from "./validation";

export interface AttachmentIpcDependencies {
  service: Pick<
    AgentService,
    | "prepareAttachments"
    | "prepareImportedAttachments"
    | "discardDraftAttachment"
    | "resolveSharedFile"
    | "resolveWorkspaceFile"
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
}

export function attachmentIpcHandlers({
  service,
  mailbox,
  remoteServers,
  getMainWindow,
}: AttachmentIpcDependencies): Pick<IpcGroupHandlers, "agentAttachments"> {
  return {
    agentAttachments: {
      chooseAttachments: payloadHandler(parseAgentRequest, async (parsed) => {
        const mainWindow = getMainWindow();
        const { serverId, payload } = parsed;
        const { filter } = parseChooseAttachments(payload);
        const supportsEml =
          serverId === LOCAL_SERVER_ID || remoteServers.supportsCapability(serverId, TEAM_EML_ATTACHMENTS_CAPABILITY);
        const supportsMedia =
          serverId === LOCAL_SERVER_ID || remoteServers.supportsCapability(serverId, TEAM_MEDIA_ATTACHMENTS_CAPABILITY);
        const options: OpenDialogOptions = {
          properties: ["openFile", "multiSelections"],
          filters:
            filter === "images"
              ? [{ name: "Images", extensions: [...IMAGE_ATTACHMENT_EXTENSIONS] }]
              : [
                  {
                    name: "Supported files",
                    extensions: supportedAttachmentExtensions({ eml: supportsEml, media: supportsMedia }),
                  },
                ],
        };
        const result = mainWindow
          ? await dialog.showOpenDialog(mainWindow, options)
          : await dialog.showOpenDialog(options);
        if (result.canceled) return [];
        return routeToServer(serverId, {
          local: () => service.prepareAttachments(result.filePaths),
          remote: (target) => uploadRemotePaths(remoteServers, target, result.filePaths),
        });
      }),
      importAttachments: payloadHandler(parseAgentRequest, (scoped) => {
        const parsed = parseImportAttachments(scoped.payload);
        return routeToServer(scoped.serverId, {
          local: () => service.prepareImportedAttachments(parsed.paths, parsed.data),
          remote: (serverId) => uploadRemoteImports(remoteServers, serverId, parsed),
        });
      }),
      discardDraftAttachment: payloadHandler(parseAgentRequest, (scoped) => {
        const attachmentId = requireString(scoped.payload, "attachmentId");
        return routeToServer(scoped.serverId, {
          local: () => service.discardDraftAttachment(attachmentId),
          remote: (serverId) =>
            remoteServers.request(serverId, TEAM_API_ROUTES.attachment(attachmentId), decodeVoid, { method: "DELETE" }),
        });
      }),
      downloadAttachments: payloadHandler(parseAgentRequest, async (scoped) => {
        const parsed = parseDownloadAttachments(scoped.payload);
        await saveAttachmentArchive(
          parsed,
          () => chooseSavePath(getMainWindow(), "attachments.zip"),
          (item) =>
            routeToServer(scoped.serverId, {
              local: async () => {
                const attachment = await mailbox.resolveAttachment(item.id);
                if (!attachment) throw new Error("Attachment was not found.");
                if ((await stat(attachment.path)).size > ATTACHMENT_LIMITS.fileBytes)
                  throw new Error("A file exceeds the 100 MB limit.");
                return readFile(attachment.path);
              },
              remote: async (serverId) => (await remoteServers.downloadAttachment(item.id, serverId)).bytes,
            }),
        );
      }),
      openAttachment: payloadHandler(parseAgentRequest, (scoped) => {
        const parsed = parseOpenAttachment(scoped.payload);
        return routeToServer<void>(scoped.serverId, {
          local: async () => {
            const attachment = await mailbox.resolveAttachment(parsed.attachmentId);
            if (!attachment) throw new Error("Attachment was not found.");
            if (parsed.action === "download") {
              const safeId = basename(parsed.attachmentId).replace(/[^a-z0-9_-]/gi, "-") || "attachment";
              const suggestedName = basename(attachment.name) || `attachment-${safeId}`;
              const filePath = await chooseSavePath(getMainWindow(), suggestedName);
              if (!filePath) return;
              await copyFile(attachment.path, filePath);
              return;
            }
            if (parsed.action === "reveal") {
              shell.showItemInFolder(attachment.path);
              return;
            }
            await openPath(attachment.path);
          },
          remote: async (serverId) => {
            const downloaded = await remoteServers.downloadAttachment(parsed.attachmentId, serverId);
            const suggestedName = basename(downloaded.name) || `attachment-${parsed.attachmentId}`;
            if (parsed.action === "download") {
              const filePath = await chooseSavePath(getMainWindow(), suggestedName);
              if (!filePath) return;
              await writeFile(filePath, downloaded.bytes, { mode: 0o600 });
              return;
            }
            const cacheRoot = join(app.getPath("userData"), "remote-attachments");
            await mkdir(cacheRoot, { recursive: true });
            const target = join(cacheRoot, `${parsed.attachmentId}-${suggestedName}`);
            await writeFile(target, downloaded.bytes, { mode: 0o600 });
            if (parsed.action === "reveal") shell.showItemInFolder(target);
            else await openPath(target);
          },
        });
      }),
      openSharedFile: payloadHandler(parseAgentRequest, (scoped) => {
        const parsed = parseOpenSharedFile(scoped.payload);
        return routeToServer<void>(scoped.serverId, {
          local: async () => {
            const sharedFile = await service.resolveSharedFile(parsed.path);
            await openPath(sharedFile.path);
          },
          remote: async (serverId) => {
            const downloaded = await remoteServers.downloadSharedFile(parsed.path, serverId);
            const target = await cacheRemoteFile("remote-shared-files", `${serverId}:${parsed.path}`, downloaded);
            await openPath(target);
          },
        });
      }),
      openWorkspaceFile: payloadHandler(parseAgentRequest, (scoped) => {
        const parsed = parseOpenWorkspaceFile(scoped.payload);
        return routeToServer<void>(scoped.serverId, {
          local: async () => {
            const workspaceFile = await service.resolveWorkspaceFile(parsed.agentId, parsed.path);
            await openPath(workspaceFile.path);
          },
          remote: async (serverId) => {
            const downloaded = await remoteServers.downloadWorkspaceFile(parsed.agentId, parsed.path, serverId);
            const key = `${serverId}:${parsed.agentId}:${parsed.path}`;
            const target = await cacheRemoteFile("remote-workspace-files", key, downloaded);
            await openPath(target);
          },
        });
      }),
      previewSharedFile: payloadHandler(parseAgentRequest, (scoped): Promise<FilePreview> => {
        const parsed = parseOpenSharedFile(scoped.payload);
        return routeToServer(scoped.serverId, {
          local: async () => {
            const sharedFile = await service.resolveSharedFile(parsed.path);
            return localFilePreview(sharedFile.path, sharedFile.name, sharedFile.size);
          },
          remote: async (serverId) => {
            const downloaded = await remoteServers.downloadSharedFile(parsed.path, serverId);
            return filePreviewFromBytes(downloaded.name, downloaded.bytes);
          },
        });
      }),
      previewWorkspaceFile: payloadHandler(parseAgentRequest, (scoped): Promise<FilePreview> => {
        const parsed = parseOpenWorkspaceFile(scoped.payload);
        return routeToServer(scoped.serverId, {
          local: async () => {
            const workspaceFile = await service.resolveWorkspaceFile(parsed.agentId, parsed.path);
            return localFilePreview(workspaceFile.path, workspaceFile.name, workspaceFile.size);
          },
          remote: async (serverId) => {
            const downloaded = await remoteServers.downloadWorkspaceFile(parsed.agentId, parsed.path, serverId);
            return filePreviewFromBytes(downloaded.name, downloaded.bytes);
          },
        });
      }),
    },
  };
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
async function chooseSavePath(mainWindow: BrowserWindow | null, suggestedName: string): Promise<string | undefined> {
  const extension = extname(suggestedName).slice(1).toLowerCase();
  const options: Electron.SaveDialogOptions = {
    defaultPath: join(app.getPath("downloads"), suggestedName),
    filters: [{ name: "Attachment", extensions: extension ? [extension] : ["*"] }],
    showsTagField: false,
  };
  const result =
    mainWindow && !mainWindow.isDestroyed()
      ? await dialog.showSaveDialog(mainWindow, options)
      : await dialog.showSaveDialog(options);
  return result.canceled ? undefined : result.filePath || undefined;
}

async function uploadRemotePaths(
  remoteServers: AttachmentIpcDependencies["remoteServers"],
  serverId: string,
  paths: string[],
) {
  if (paths.length > INPUT_LIMITS.attachments) {
    throw new Error(`Choose at most ${INPUT_LIMITS.attachments} files.`);
  }
  assertRemoteAttachmentSupport(
    remoteServers,
    serverId,
    paths.map((path) => basename(path)),
  );
  for (const path of paths) assertSupportedAttachmentName(basename(path));
  const files = await Promise.all(
    paths.map(async (path) => ({
      name: basename(path),
      bytes: new Uint8Array(await readFile(path)),
    })),
  );
  const total = files.reduce((sum, file) => sum + file.bytes.byteLength, 0);
  if (files.some((file) => file.bytes.byteLength > ATTACHMENT_LIMITS.fileBytes)) {
    throw new Error("A file exceeds the 100 MB limit.");
  }
  if (total > ATTACHMENT_LIMITS.totalBytes) {
    throw new Error("Attachments exceed the 250 MB total limit.");
  }
  return Promise.all(
    files.map((file) => remoteServers.uploadAttachment(file.name, mimeTypeForName(file.name), file.bytes, serverId)),
  );
}

async function uploadRemoteImports(
  remoteServers: AttachmentIpcDependencies["remoteServers"],
  serverId: string,
  input: ImportAttachmentsInput,
) {
  if (input.paths.length + input.data.length > INPUT_LIMITS.attachments) {
    throw new Error(`Choose at most ${INPUT_LIMITS.attachments} files.`);
  }
  assertRemoteAttachmentSupport(remoteServers, serverId, [
    ...input.paths.map((path) => basename(path)),
    ...input.data.map((item) => basename(item.name)),
  ]);
  const pathFiles = await Promise.all(
    input.paths.map(async (path) => ({
      name: basename(path),
      mimeType: mimeTypeForName(path),
      bytes: new Uint8Array(await readFile(path)),
    })),
  );
  const files = [
    ...pathFiles,
    ...input.data.map((item) => ({
      name: basename(item.name),
      mimeType: item.mimeType,
      bytes: item.bytes,
    })),
  ];
  for (const file of files) assertSupportedAttachmentName(file.name);
  if (files.some((file) => file.bytes.byteLength > ATTACHMENT_LIMITS.fileBytes)) {
    throw new Error("A file exceeds the 100 MB limit.");
  }
  if (files.reduce((sum, file) => sum + file.bytes.byteLength, 0) > ATTACHMENT_LIMITS.totalBytes) {
    throw new Error("Attachments exceed the 250 MB total limit.");
  }
  return Promise.all(
    files.map((file) => remoteServers.uploadAttachment(file.name, file.mimeType, file.bytes, serverId)),
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
    throw new Error("This server does not support MP3 or MOV attachments. Update OpenBot on the host and retry.");
  }
  if (!names.some((name) => attachmentFileExtension(name) === "eml")) return;
  if (remoteServers.supportsCapability(serverId, TEAM_EML_ATTACHMENTS_CAPABILITY)) return;
  throw new Error("This server does not support EML attachments. Update OpenBot on the host and retry.");
}

// Names are archive labels only; file access always uses a managed attachment ID.
export async function saveAttachmentArchive(
  input: DownloadAttachmentsInput,
  chooseDestination: () => Promise<string | undefined>,
  readAttachment: (item: DownloadAttachmentsInput["attachments"][number]) => Promise<Uint8Array>,
): Promise<void> {
  const destination = await chooseDestination();
  if (!destination) return;
  const files: Zippable = {};
  const usedNames = new Set<string>();
  let totalBytes = 0;
  for (const item of input.attachments) {
    const bytes = await readAttachment(item);
    totalBytes += bytes.byteLength;
    if (bytes.byteLength > ATTACHMENT_LIMITS.fileBytes) throw new Error("A file exceeds the 100 MB limit.");
    if (totalBytes > ATTACHMENT_LIMITS.totalBytes) throw new Error("Attachments exceed the 250 MB total limit.");
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
  const archive = await new Promise<Uint8Array>((resolve, reject) => {
    zip(files, { level: 6 }, (error, data) => (error ? reject(error) : resolve(data)));
  });
  const temporary = `${destination}.${randomUUID()}.tmp`;
  try {
    await writeFile(temporary, archive, { mode: 0o600, flag: "wx" });
    await rename(temporary, destination);
  } finally {
    await rm(temporary, { force: true });
  }
}
