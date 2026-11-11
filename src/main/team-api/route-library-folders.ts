import {
  canAdministerServer,
  type LibraryFolderRefusalReason,
  type LibraryFoldersSnapshot,
  parseLibraryFolderAction,
} from "@openbot/contracts/ipc";
import {
  LIBRARY_FOLDERS_CAPABILITY,
  LIBRARY_FOLDERS_ROUTES,
} from "@openbot/contracts/team-protocol/library-folders-v1";
import { sourceText } from "@openbot/i18n/source";
import { runCauseEffect } from "../../backend/effect-boundary";
import { LibraryFolderChangeRefused } from "../../backend/library-folders-store";
import type { LibraryFolderActionAgents } from "../library-folders-service";
import type { TeamApiLibraryFolders } from "./dependencies";
import { HttpError } from "./http-error";
import type { RouteOutcome, TeamApiRequestContext } from "./request-context";
import { readJson, requireAgentLevel } from "./request-helpers";

/** A refusal for something that the host does not have. Each other refusal is a request that the rules do not permit. */
const NOT_FOUND: ReadonlySet<LibraryFolderRefusalReason> = new Set(["unknown-agent", "unknown-folder", "unknown-file"]);

/**
 * The snapshot with no folder of a hidden agent and no file that is in one. `livingAgentIds` is null
 * for an owner or an admin. As in `storage-v1`, a member also gets no folder of an agent that the host
 * no longer has: a file id is enough to download the file.
 */
function visibleLibraryFolders(
  snapshot: LibraryFoldersSnapshot,
  hiddenAgentIds: ReadonlySet<string>,
  livingAgentIds: ReadonlySet<string> | null,
): LibraryFoldersSnapshot {
  if (hiddenAgentIds.size === 0 && livingAgentIds === null) return snapshot;
  const folders = snapshot.folders.filter(
    (folder) => !hiddenAgentIds.has(folder.agentId) && (livingAgentIds === null || livingAgentIds.has(folder.agentId)),
  );
  const shown = new Set(folders.map((folder) => folder.id));
  return {
    revision: snapshot.revision,
    folders,
    placement: Object.fromEntries(Object.entries(snapshot.placement).filter(([, folderId]) => shown.has(folderId))),
  };
}

/**
 * A member changes the folders of an agent only with `chat` access to it: `view` access only reads
 * them. A hidden agent, a folder of one or a file of one answers 404, as for an agent that the host
 * does not have. A file of a deleted agent cannot go into a folder, and answers as a file that is gone.
 */
function requireFolderAccess(
  context: TeamApiRequestContext,
  { agentIds, orphanFile }: LibraryFolderActionAgents,
  hiddenAgentIds: ReadonlySet<string>,
): void {
  if ([...agentIds].some((agentId) => hiddenAgentIds.has(agentId)))
    throw new HttpError(404, sourceText("error.team.agentNotFound"));
  if (orphanFile) throw new HttpError(404, sourceText("error.backend.fileGone"));
  for (const agentId of agentIds) requireAgentLevel(context, agentId, "chat");
}

/**
 * `library-folders-v1`: the folders of the Library. A member reads the folders of each agent that they
 * can see, and changes the folders of each agent that they can chat with. A folder change moves,
 * copies and deletes no file. A member gets no folder of an agent that they cannot see and no file
 * that is in one.
 */
export async function routeLibraryFolders(
  context: TeamApiRequestContext,
  libraryFolders: TeamApiLibraryFolders | undefined,
  hiddenAgentIds: ReadonlySet<string>,
  /** The agents that the host has. A member gets no folder of a deleted agent. */
  agentIds: () => ReadonlySet<string>,
): Promise<RouteOutcome> {
  const { method, url, capabilities, member, request, json } = context;
  if (method !== "POST" || !Object.values(LIBRARY_FOLDERS_ROUTES).some((path) => path === url.pathname))
    return "unmatched";
  if (!libraryFolders || !capabilities.has(LIBRARY_FOLDERS_CAPABILITY))
    throw new HttpError(400, sourceText("error.team.libraryFoldersUnsupported"));
  // `readJson` has already run the body through the library-folders-v1 codec.
  const body = await readJson(request);
  const visible = (snapshot: LibraryFoldersSnapshot) =>
    visibleLibraryFolders(snapshot, hiddenAgentIds, canAdministerServer(member.role) ? null : agentIds());
  if (url.pathname === LIBRARY_FOLDERS_ROUTES.read) return json(200, visible(libraryFolders.snapshot()));
  const action = parseLibraryFolderAction(body);
  try {
    const snapshot = await runCauseEffect(
      libraryFolders.change(action, (agents) => requireFolderAccess(context, agents, hiddenAgentIds)),
    );
    return json(200, visible(snapshot));
  } catch (error) {
    // A refusal is the fault of the request, and its message is for the person who made the change.
    if (error instanceof LibraryFolderChangeRefused)
      throw new HttpError(NOT_FOUND.has(error.reason) ? 404 : 400, error.message);
    throw error;
  }
}
