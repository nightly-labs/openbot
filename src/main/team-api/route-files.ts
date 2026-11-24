import { open } from "node:fs/promises";
import type { OutgoingHttpHeaders, ServerResponse } from "node:http";
import { basename } from "node:path";
import { pipeline } from "node:stream/promises";
import { ATTACHMENT_LIMITS, INPUT_LIMITS } from "@openbot/contracts/input-limits";
import { canAdministerServer } from "@openbot/contracts/ipc";
import { TEAM_API_ROUTES, WORKSPACE_FILE_EXACT_PATH_QUERY } from "@openbot/contracts/team-api-routes";
import { sourceText } from "@openbot/i18n/source";
import { Deferred, Effect } from "effect";
import { runCauseEffect } from "../../backend/effect-boundary";
import { remoteCall } from "../remote-service-effects";
import type { TeamApiAgents, TeamApiAttachmentPreviews, TeamApiMailbox } from "./dependencies";
import { HttpError } from "./http-error";
import type { RouteOutcome, TeamApiRequestContext } from "./request-context";
import { pathIdentifier, readBinary } from "./request-helpers";
import { rethrowWorkspacePathError } from "./route-workspace-directory";

const ATTACHMENT_UPLOAD_SLOTS = 2;

class UploadSlots {
  readonly #waiting: Deferred.Deferred<void>[] = [];
  #free: number;

  constructor(count: number) {
    this.#free = count;
  }

  use<A, E>(run: Effect.Effect<A, E>): Effect.Effect<A, E> {
    return Effect.acquireUseRelease(
      this.#take(),
      () => run,
      () => Effect.sync(() => this.#release()),
    );
  }

  #take(): Effect.Effect<void> {
    return Effect.suspend(() => {
      if (this.#free > 0) {
        this.#free -= 1;
        return Effect.void;
      }
      const slot = Deferred.makeUnsafe<void>();
      this.#waiting.push(slot);
      return Deferred.await(slot);
    });
  }

  #release(): void {
    const next = this.#waiting.shift();
    if (next) Deferred.doneUnsafe(next, Effect.void);
    else this.#free += 1;
  }
}

const attachmentUploads = new UploadSlots(ATTACHMENT_UPLOAD_SLOTS);

export interface FileRouteDependencies {
  agents: Pick<
    TeamApiAgents,
    | "prepareImportedAttachments"
    | "discardDraftAttachment"
    | "resolveSharedFile"
    | "resolveWorkspaceFile"
    | "resolveLocalWorkspaceFile"
  >;
  mailbox: TeamApiMailbox;
  attachmentPreviews?: TeamApiAttachmentPreviews | undefined;
}

export async function routeFiles(
  context: TeamApiRequestContext,
  { agents, mailbox, attachmentPreviews }: FileRouteDependencies,
): Promise<RouteOutcome> {
  const { method, url, request, response, member, json, empty } = context;

  if (method === "POST" && url.pathname === TEAM_API_ROUTES.attachments) {
    const name = url.searchParams.get("name")?.trim();
    const mimeType = url.searchParams.get("mime") ?? "application/octet-stream";
    if (!name || basename(name) !== name || name.length > INPUT_LIMITS.attachmentName) {
      throw new HttpError(400, sourceText("error.team.attachmentNameRequired"));
    }
    if (mimeType.length > INPUT_LIMITS.mimeType) {
      throw new HttpError(400, "The attachment MIME type is too long.");
    }
    const [attachment] = await runCauseEffect(
      attachmentUploads.use(
        Effect.gen(function* () {
          const bytes = yield* remoteCall(() => readBinary(request, ATTACHMENT_LIMITS.fileBytes));
          return yield* agents.prepareImportedAttachments([], [{ name, mimeType, bytes }]);
        }),
      ),
    );
    if (!attachment) throw new Error("The attachment was not prepared.");
    return json(201, attachment);
  }
  const attachmentMatch = url.pathname.match(/^\/v1\/attachments\/([^/]+)$/);
  if (attachmentMatch) {
    const attachmentId = pathIdentifier(attachmentMatch[1], "attachmentId");
    if (method === "DELETE") {
      await runCauseEffect(agents.discardDraftAttachment(attachmentId));
      return empty(204);
    }
    if (method === "GET") {
      const attachment = await runCauseEffect(mailbox.resolveAttachment(attachmentId));
      if (!attachment) throw new HttpError(404, sourceText("error.team.attachmentNotFound"));
      return sendFile(response, attachment.path, null, (size) => ({
        "Content-Type": attachment.mimeType || "application/octet-stream",
        "Content-Length": String(size),
        "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(basename(attachment.path))}`,
      }));
    }
  }
  const previewMatch = url.pathname.match(/^\/v1\/attachments\/([^/]+)\/preview$/);
  if (previewMatch && method === "GET" && attachmentPreviews) {
    const attachmentId = pathIdentifier(previewMatch[1], "attachmentId");
    const attachment = await runCauseEffect(mailbox.resolveAttachment(attachmentId));
    if (!attachment) throw new HttpError(404, sourceText("error.team.attachmentNotFound"));
    if (!attachment.mimeType.startsWith("image/")) throw new HttpError(415, "The attachment is not an image.");
    const preview = await runCauseEffect(
      attachmentPreviews.file(attachmentId, { path: attachment.path, mimeType: attachment.mimeType }),
    );
    if (!preview) throw new HttpError(415, "The attachment has no preview.");
    return sendFile(response, preview.path, null, (size) => ({
      "Content-Type": preview.mimeType,
      "Content-Length": String(size),
      "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(basename(preview.path))}`,
      "X-Content-Type-Options": "nosniff",
    }));
  }
  if (method === "GET" && url.pathname === TEAM_API_ROUTES.sharedFiles) {
    const sharedPath = url.searchParams.get("path");
    if (!sharedPath || sharedPath.length > INPUT_LIMITS.path) {
      throw new HttpError(400, "A valid shared file path is required.");
    }
    const sharedFile = await runCauseEffect(agents.resolveSharedFile(sharedPath));
    if (sharedFile.size > ATTACHMENT_LIMITS.fileBytes) {
      throw new HttpError(413, sourceText("error.team.sharedFileTooLarge"));
    }
    return sendFile(response, sharedFile.path, sourceText("error.team.sharedFileTooLarge"), (size) => ({
      "Content-Type": "application/octet-stream",
      "Content-Length": String(size),
      "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(sharedFile.name)}`,
      "X-Content-Type-Options": "nosniff",
    }));
  }
  if (method === "GET" && url.pathname === TEAM_API_ROUTES.workspaceFiles) {
    const agentId = url.searchParams.get("botId");
    const workspacePath = url.searchParams.get("path");
    if (!agentId || agentId.length > INPUT_LIMITS.identifier) {
      throw new HttpError(400, "A valid agent id is required.");
    }
    if (!workspacePath || workspacePath.length > INPUT_LIMITS.path) {
      throw new HttpError(400, "A valid workspace file path is required.");
    }
    const exactPath = url.searchParams.get(WORKSPACE_FILE_EXACT_PATH_QUERY) === "1";
    const workspaceFile = await runCauseEffect(
      canAdministerServer(member.role)
        ? agents.resolveLocalWorkspaceFile(agentId, workspacePath, { exactPath })
        : agents.resolveWorkspaceFile(agentId, workspacePath),
    ).catch(rethrowWorkspacePathError);
    if (workspaceFile.size > ATTACHMENT_LIMITS.fileBytes) {
      throw new HttpError(413, sourceText("error.team.workspaceFileTooLarge"));
    }
    return sendFile(response, workspaceFile.path, sourceText("error.team.workspaceFileTooLarge"), (size) => ({
      "Content-Type": "application/octet-stream",
      "Content-Length": String(size),
      "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(workspaceFile.name)}`,
      "X-Content-Type-Options": "nosniff",
    }));
  }

  return "unmatched";
}

export async function sendFile(
  response: ServerResponse,
  path: string,
  tooLarge: string | null,
  headers: (size: number) => OutgoingHttpHeaders,
  range: { start: number; length: number } | null = null,
): Promise<"handled"> {
  const file = await open(path, "r");
  const start = range?.start ?? 0;
  let size: number;
  let head: OutgoingHttpHeaders;
  try {
    const metadata = await file.stat();
    if (!metadata.isFile()) throw new Error("The requested path is not a file.");
    if (tooLarge !== null && metadata.size > ATTACHMENT_LIMITS.fileBytes) throw new HttpError(413, tooLarge);
    size = range ? Math.max(0, Math.min(range.length, metadata.size - start)) : metadata.size;
    head = headers(size);
  } catch (error) {
    await file.close();
    throw error;
  }
  response.writeHead(200, head);
  if (size === 0) {
    await file.close();
    response.end();
    return "handled";
  }
  const stream = file.createReadStream({ start, end: start + size - 1 });
  try {
    await pipeline(stream, response, { end: false });
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ERR_STREAM_PREMATURE_CLOSE") return "handled";
    throw error;
  }
  if (stream.bytesRead !== size) response.destroy();
  else response.end();
  return "handled";
}
