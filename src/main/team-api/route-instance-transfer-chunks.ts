import { parseExportInstanceInput } from "@openbot/contracts/ipc";
import {
  INSTANCE_TRANSFER_CHUNKS_CAPABILITY,
  INSTANCE_TRANSFER_CHUNKS_ROUTES,
} from "@openbot/contracts/team-protocol/instance-transfer-chunks-v1";
import {
  INSTANCE_TRANSFER_FULL_COPY_CAPABILITY,
  INSTANCE_TRANSFER_FULL_COPY_ROUTES,
} from "@openbot/contracts/team-protocol/instance-transfer-full-copy-v1";
import { sourceText } from "@openbot/i18n/source";
import { runCauseEffect } from "../../backend/effect-boundary";
import type { TeamApiInstanceTransfer } from "./dependencies";
import { HttpError } from "./http-error";
import type { RouteOutcome, TeamApiRequestContext } from "./request-context";
import { readBinary, readJson, requireAdmin, stringField } from "./request-helpers";
import { answer } from "./route-agent-import";
import { sendFile } from "./route-files";

const ROUTES: ReadonlySet<string> = new Set([
  ...Object.values(INSTANCE_TRANSFER_CHUNKS_ROUTES),
  ...Object.values(INSTANCE_TRANSFER_FULL_COPY_ROUTES),
]);

function queryIndex(value: string | null): number {
  if (value === null || !/^\d{1,4}$/u.test(value)) throw new HttpError(400, "index is required.");
  return Number(value);
}

function querySha256(value: string | null): string {
  if (value === null || !/^[0-9a-f]{64}$/u.test(value)) throw new HttpError(400, "sha256 is required.");
  return value;
}

/**
 * An OpenBot transfer file to or from the host in parts, so it can be larger than one WebRTC file
 * transfer. Only an owner or an admin, as for `instance-transfer-v1`, and each id is the caller's
 * own. The token that finish answers goes to `instance-transfer-v1` apply and discard. Frozen by
 * `instance-transfer-chunks-v1`, and its export start with each part chosen by
 * `instance-transfer-full-copy-v1`.
 */
export async function routeInstanceTransferChunks(
  context: TeamApiRequestContext,
  instanceTransfer: TeamApiInstanceTransfer | undefined,
): Promise<RouteOutcome> {
  const { method, url, capabilities, member, request, response, json } = context;
  if (method !== "POST" || !ROUTES.has(url.pathname)) return "unmatched";
  if (!instanceTransfer || !capabilities.has(INSTANCE_TRANSFER_CHUNKS_CAPABILITY))
    throw new HttpError(400, sourceText("error.team.instanceTransferUnsupported"));
  if (
    url.pathname === INSTANCE_TRANSFER_FULL_COPY_ROUTES.exportBegin &&
    !capabilities.has(INSTANCE_TRANSFER_FULL_COPY_CAPABILITY)
  )
    throw new HttpError(400, sourceText("error.team.instanceTransferUnsupported"));
  requireAdmin(member);
  const { chunks } = instanceTransfer;

  switch (url.pathname) {
    case INSTANCE_TRANSFER_CHUNKS_ROUTES.uploadBegin: {
      // `readJson` has already run the body through the wire codec.
      const body = await readJson(request);
      const size = typeof body.size === "number" ? body.size : 0;
      const sha256 = stringField(body, "sha256", false, 64);
      return json(200, await answer(() => runCauseEffect(chunks.beginUpload({ size, sha256 }, member.id)), 400));
    }
    case INSTANCE_TRANSFER_CHUNKS_ROUTES.uploadChunk: {
      const uploadId = url.searchParams.get("uploadId");
      if (!uploadId || uploadId.length > 128) throw new HttpError(400, "uploadId is required.");
      const input = {
        uploadId,
        index: queryIndex(url.searchParams.get("index")),
        sha256: querySha256(url.searchParams.get("sha256")),
      };
      const read = (limit: number) =>
        readBinary(request, limit).catch((error: unknown) => {
          if (error instanceof HttpError && error.status === 413)
            throw new HttpError(413, sourceText("error.import.transferPartInvalid"));
          throw error;
        });
      return json(200, await answer(() => runCauseEffect(chunks.writePart(input, read, member.id)), 400));
    }
    case INSTANCE_TRANSFER_CHUNKS_ROUTES.uploadFinish: {
      const uploadId = stringField(await readJson(request), "uploadId");
      return json(200, await answer(() => runCauseEffect(chunks.finishUpload(uploadId, member.id)), 400));
    }
    case INSTANCE_TRANSFER_CHUNKS_ROUTES.uploadAbort:
      await runCauseEffect(chunks.abortUpload(stringField(await readJson(request), "uploadId"), member.id));
      return json(200, {});
    // `instance-transfer-full-copy-v1` takes every part as a field of its own; its codec has checked them.
    case INSTANCE_TRANSFER_FULL_COPY_ROUTES.exportBegin:
    case INSTANCE_TRANSFER_CHUNKS_ROUTES.exportBegin: {
      let input: ReturnType<typeof parseExportInstanceInput>;
      try {
        input = parseExportInstanceInput(await readJson(request));
      } catch (error) {
        throw new HttpError(400, error instanceof Error ? error.message : "Invalid export.");
      }
      return json(200, await answer(() => runCauseEffect(chunks.beginExport(input, member.id)), 400));
    }
    case INSTANCE_TRANSFER_CHUNKS_ROUTES.exportChunk: {
      const body = await readJson(request);
      const exportId = stringField(body, "exportId");
      const index = typeof body.index === "number" ? body.index : -1;
      const part = await answer(() => runCauseEffect(chunks.exportPart(exportId, index, member.id)), 400);
      return sendFile(
        response,
        part.path,
        null,
        (size) => ({
          "Content-Type": "application/octet-stream",
          "Content-Length": String(size),
          "Content-Disposition": `attachment; filename*=UTF-8''openbot-transfer-${index}.part`,
          "X-Content-Type-Options": "nosniff",
        }),
        { start: part.start, length: part.length },
      );
    }
    case INSTANCE_TRANSFER_CHUNKS_ROUTES.exportDone:
      await runCauseEffect(chunks.finishExport(stringField(await readJson(request), "exportId"), member.id));
      return json(200, {});
  }
  return "unmatched";
}
