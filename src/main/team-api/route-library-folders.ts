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

const NOT_FOUND: ReadonlySet<LibraryFolderRefusalReason> = new Set(["unknown-agent", "unknown-folder", "unknown-file"]);

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

export async function routeLibraryFolders(
  context: TeamApiRequestContext,
  libraryFolders: TeamApiLibraryFolders | undefined,
  hiddenAgentIds: ReadonlySet<string>,
  agentIds: () => ReadonlySet<string>,
): Promise<RouteOutcome> {
  const { method, url, capabilities, member, request, json } = context;
  if (method !== "POST" || !Object.values(LIBRARY_FOLDERS_ROUTES).some((path) => path === url.pathname))
    return "unmatched";
  if (!libraryFolders || !capabilities.has(LIBRARY_FOLDERS_CAPABILITY))
    throw new HttpError(400, sourceText("error.team.libraryFoldersUnsupported"));
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
    if (error instanceof LibraryFolderChangeRefused)
      throw new HttpError(NOT_FOUND.has(error.reason) ? 404 : 400, error.message);
    throw error;
  }
}
