import {
  parseClearStorageInput,
  parseDeleteStoredFileInput,
  parseGetStorageUsageInput,
  STORAGE_CAPABILITY,
} from "@openbot/contracts/ipc";
import { STORAGE_ROUTES } from "@openbot/contracts/team-protocol/storage-v1";
import { StorageNotFoundError } from "../../backend/storage-usage";
import type { TeamApiStorage } from "./dependencies";
import { HttpError } from "./http-error";
import type { RouteOutcome, TeamApiRequestContext } from "./request-context";
import { readJson, requireAdmin } from "./request-helpers";

/**
 * The disk use of the machine that runs this host, read from a joined server.
 *
 * Every member can read it: the answer carries sizes, chat titles and the names of files sent in
 * chats, never a path. Deleting a file and clearing caches or logs change the host, so only an
 * owner or an admin can. Both were decided deliberately and are frozen by `storage-v1`; changing
 * either needs a second capability string.
 */
export async function routeStorage(
  context: TeamApiRequestContext,
  storage: TeamApiStorage | undefined,
): Promise<RouteOutcome> {
  const { method, url, capabilities, member, request, json } = context;
  const usage = method === "POST" && url.pathname === STORAGE_ROUTES.usage;
  const deleteFile = method === "POST" && url.pathname === STORAGE_ROUTES.deleteFile;
  const clear = method === "POST" && url.pathname === STORAGE_ROUTES.clear;
  if (!usage && !deleteFile && !clear) return "unmatched";
  if (!storage || !capabilities.has(STORAGE_CAPABILITY))
    throw new HttpError(400, "Storage is not supported by this connection.");
  if (!usage) requireAdmin(member);
  // `readJson` has already run the body through the storage wire codec.
  const body = await readJson(request);
  try {
    if (usage) return json(200, await storage.usage(parseGetStorageUsageInput(body)));
    if (deleteFile) await storage.deleteFile(parseDeleteStoredFileInput(body).fileId);
    else await storage.clear(parseClearStorageInput(body).category);
  } catch (error) {
    if (error instanceof StorageNotFoundError) throw new HttpError(404, error.message);
    throw error;
  }
  return json(200, {});
}
