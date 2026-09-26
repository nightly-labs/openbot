import { isDeleteSharedTableInput } from "@openbot/contracts/ipc";
import { SHARED_TABLES_CAPABILITY, SHARED_TABLES_ROUTES } from "@openbot/contracts/team-protocol/shared-tables-v1";
import { sourceText } from "@openbot/i18n/source";
import type { TeamApiAdmin } from "./dependencies";
import { HttpError } from "./http-error";
import type { RouteOutcome, TeamApiRequestContext } from "./request-context";
import { readJson, requireAdmin } from "./request-helpers";

/**
 * The tables the agents on this computer share, listed and deleted from a joined server. No row
 * crosses the wire. Frozen by `shared-tables-v1`.
 */
export async function routeSharedTables(
  context: TeamApiRequestContext,
  admin: TeamApiAdmin | undefined,
): Promise<RouteOutcome> {
  const { method, url, capabilities, member, request, json } = context;
  const list = method === "POST" && url.pathname === SHARED_TABLES_ROUTES.list;
  const remove = method === "POST" && url.pathname === SHARED_TABLES_ROUTES.delete;
  if (!list && !remove) return "unmatched";
  const tables = admin?.sharedTables;
  if (!tables || !capabilities.has(SHARED_TABLES_CAPABILITY))
    throw new HttpError(400, sourceText("error.team.sharedDataUnsupported"));
  requireAdmin(member);
  const body = await readJson(request);
  if (list) return json(200, await tables.listTables());
  if (!isDeleteSharedTableInput(body)) throw new HttpError(400, "Invalid table deletion request.");
  try {
    await tables.deleteTable({ name: body.name });
  } catch (error) {
    // A missing table or an unavailable database is a sentence for the admin, not a host fault.
    if (error instanceof Error) throw new HttpError(409, error.message);
    throw error;
  }
  return json(200, {});
}
