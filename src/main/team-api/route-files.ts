// Bytes leaving the machine: draft attachments, shared files and workspace files.
//
// These four routes are the only ones that write a body themselves instead of going through
// `json`, so they are also the only ones that must return `"handled"` explicitly - a bare `return`
// here would read as `"unmatched"` and let the router answer 404 over a response it had already
// finished.
//
// None of them scopes anything to the caller: any authenticated member may fetch any attachment id
// or any path. The containment check that makes that safe - the path being inside the shared or
// workspace directory - lives in `AgentService`, so what is enforced here is the size ceiling and
// the length limits, and it must stay enforced here because this is the only caller that reads a
// path off the wire.
//
// A download goes from disk to the socket in stream chunks, so ten parallel 100 MB downloads do not
// hold 1 GB in main. An upload must be in memory, because `prepareImportedAttachments` takes bytes,
// so `attachmentUploads` lets only a small number of them read a body at the same time.

import { open } from "node:fs/promises";
import type { OutgoingHttpHeaders, ServerResponse } from "node:http";
import { basename } from "node:path";
import { pipeline } from "node:stream/promises";
import { ATTACHMENT_LIMITS, INPUT_LIMITS } from "@openbot/contracts/input-limits";
import { TEAM_API_ROUTES } from "@openbot/contracts/team-api-routes";
import { sourceText } from "@openbot/i18n/source";
import type { TeamApiAgents, TeamApiMailbox } from "./dependencies";
import { HttpError } from "./http-error";
import type { RouteOutcome, TeamApiRequestContext } from "./request-context";
import { pathIdentifier, readBinary } from "./request-helpers";

// Each upload holds its body, up to 100 MB, until the attachment is on disk. Two at a time keep that
// below 200 MB on a 4 GB hosted server. A third upload waits for a slot; it does not fail.
const ATTACHMENT_UPLOAD_SLOTS = 2;

class UploadSlots {
  readonly #waiting: Array<() => void> = [];
  #free: number;

  constructor(count: number) {
    this.#free = count;
  }

  async use<T>(run: () => Promise<T>): Promise<T> {
    if (this.#free > 0) this.#free -= 1;
    else await new Promise<void>((resolve) => this.#waiting.push(resolve));
    try {
      return await run();
    } finally {
      // The slot goes directly to the next upload, so a new upload cannot take it first.
      const next = this.#waiting.shift();
      if (next) next();
      else this.#free += 1;
    }
  }
}

const attachmentUploads = new UploadSlots(ATTACHMENT_UPLOAD_SLOTS);

export interface FileRouteDependencies {
  agents: Pick<
    TeamApiAgents,
    "prepareImportedAttachments" | "discardDraftAttachment" | "resolveSharedFile" | "resolveWorkspaceFile"
  >;
  mailbox: TeamApiMailbox;
}

export async function routeFiles(
  context: TeamApiRequestContext,
  { agents, mailbox }: FileRouteDependencies,
): Promise<RouteOutcome> {
  const { method, url, request, response, json, empty } = context;

  if (method === "POST" && url.pathname === TEAM_API_ROUTES.attachments) {
    const name = url.searchParams.get("name")?.trim();
    const mimeType = url.searchParams.get("mime") ?? "application/octet-stream";
    if (!name || basename(name) !== name || name.length > INPUT_LIMITS.attachmentName) {
      throw new HttpError(400, sourceText("error.team.attachmentNameRequired"));
    }
    if (mimeType.length > INPUT_LIMITS.mimeType) {
      throw new HttpError(400, "The attachment MIME type is too long.");
    }
    const [attachment] = await attachmentUploads.use(async () => {
      const bytes = await readBinary(request, ATTACHMENT_LIMITS.fileBytes);
      return agents.prepareImportedAttachments([], [{ name, mimeType, bytes }]);
    });
    if (!attachment) throw new Error("The attachment was not prepared.");
    return json(201, attachment);
  }
  const attachmentMatch = url.pathname.match(/^\/v1\/attachments\/([^/]+)$/);
  if (attachmentMatch) {
    const attachmentId = pathIdentifier(attachmentMatch[1], "attachmentId");
    if (method === "DELETE") {
      await agents.discardDraftAttachment(attachmentId);
      return empty(204);
    }
    if (method === "GET") {
      const attachment = await mailbox.resolveAttachment(attachmentId);
      if (!attachment) throw new HttpError(404, sourceText("error.team.attachmentNotFound"));
      return sendFile(response, attachment.path, null, (size) => ({
        "Content-Type": attachment.mimeType || "application/octet-stream",
        "Content-Length": String(size),
        "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(basename(attachment.path))}`,
      }));
    }
  }
  if (method === "GET" && url.pathname === TEAM_API_ROUTES.sharedFiles) {
    const sharedPath = url.searchParams.get("path");
    if (!sharedPath || sharedPath.length > INPUT_LIMITS.path) {
      throw new HttpError(400, "A valid shared file path is required.");
    }
    const sharedFile = await agents.resolveSharedFile(sharedPath);
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
    // The released URL spells this `botId`; only the local name follows the rename.
    const agentId = url.searchParams.get("botId");
    const workspacePath = url.searchParams.get("path");
    if (!agentId || agentId.length > INPUT_LIMITS.identifier) {
      throw new HttpError(400, "A valid agent id is required.");
    }
    if (!workspacePath || workspacePath.length > INPUT_LIMITS.path) {
      throw new HttpError(400, "A valid workspace file path is required.");
    }
    const workspaceFile = await agents.resolveWorkspaceFile(agentId, workspacePath);
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

/**
 * Streams one file with the same head and bytes that a whole-file read gave. The size comes from the
 * open file, not from the path, so `Content-Length` agrees with the bytes that are sent. The size
 * limit is checked again on the open file, because the file can grow after the route checked it.
 *
 * Before the head is written, an error goes to the dispatcher as before. After the head, the only
 * thing left to do is to close the socket: a client that closes the download is not an error.
 */
async function sendFile(
  response: ServerResponse,
  path: string,
  tooLarge: string | null,
  headers: (size: number) => OutgoingHttpHeaders,
): Promise<"handled"> {
  const file = await open(path, "r");
  let size: number;
  let head: OutgoingHttpHeaders;
  try {
    const metadata = await file.stat();
    if (!metadata.isFile()) throw new Error("The requested path is not a file.");
    if (tooLarge !== null && metadata.size > ATTACHMENT_LIMITS.fileBytes) throw new HttpError(413, tooLarge);
    size = metadata.size;
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
  const stream = file.createReadStream({ start: 0, end: size - 1 });
  try {
    await pipeline(stream, response);
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ERR_STREAM_PREMATURE_CLOSE") return "handled";
    throw error;
  }
  // A file that became shorter after `stat` cannot fill its `Content-Length`. Closing the socket
  // makes the client see an incomplete download, not wait for bytes that never come.
  if (stream.bytesRead !== size) response.destroy();
  return "handled";
}
