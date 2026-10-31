// The folders a local agent can change besides its workspace and the shared folder, and the folders in
// them that it must not change. The desktop settings (`agentFolders` IPC) and an owner or admin on
// another device (`agent-folders-v1`) change them through the same checks.

import { readdir, realpath, stat } from "node:fs/promises";
import { homedir, userInfo } from "node:os";
import { dirname, join, parse, resolve } from "node:path";
import {
  AGENT_FOLDER_BROWSE_LIMIT,
  AGENT_FOLDER_LIMIT,
  AGENT_FOLDER_VOLUME_LIMIT,
  type AgentExclusionChange,
  type AgentFolderBrowse,
  type AgentFolderBrowseEntry,
  type AgentFolderChange,
  type AgentFolderList,
  type AgentSummary,
  agentExclusionCoverage,
  agentFolderCoverage,
  folderInside,
} from "@openbot/contracts/ipc";
import type { AgentService } from "../backend/agent-service";
import { runCauseEffect } from "../backend/effect-boundary";

export interface AgentFoldersDependencies {
  service: Pick<AgentService, "listAgents" | "updateAgent" | "sharedRoot">;
  /** The app's own data, with `openbot.db`. */
  userDataPath: string;
}

async function isDirectory(path: string): Promise<boolean> {
  return (await stat(path).catch(() => null))?.isDirectory() === true;
}

/** The real path, so a sandbox profile and the coverage checks compare the same text. */
async function realFolder(path: string): Promise<string> {
  return realpath(path).catch(() => resolve(path));
}

/** The folders in `folder` that are folders or links to folders, without hidden ones. Null when unreadable. */
async function subfolders(folder: string): Promise<string[] | null> {
  const items = await readdir(folder, { withFileTypes: true }).catch(() => null);
  if (!items) return null;
  const names: string[] = [];
  for (const item of items) {
    if (item.name.startsWith(".")) continue;
    // A link to a folder is a folder for the picker too.
    if (item.isDirectory() || (item.isSymbolicLink() && (await isDirectory(join(folder, item.name)))))
      names.push(item.name);
  }
  return names.sort((first, second) => first.localeCompare(second, undefined, { sensitivity: "base", numeric: true }));
}

function userName(): string {
  try {
    return userInfo().username;
  } catch {
    return "";
  }
}

/**
 * The disks of this computer, with the start disk first: the drive letters on Windows, `/Volumes` on
 * macOS, and the root with the usual mount folders on Linux.
 */
async function volumes(): Promise<AgentFolderBrowseEntry[]> {
  let found: AgentFolderBrowseEntry[];
  if (process.platform === "win32") {
    const letters = Array.from({ length: 26 }, (_, index) => `${String.fromCharCode(65 + index)}:`);
    const present = await Promise.all(letters.map((letter) => isDirectory(`${letter}\\`)));
    found = letters.filter((_, index) => present[index]).map((letter) => ({ name: letter, path: `${letter}\\` }));
  } else {
    const user = userName();
    const holders =
      process.platform === "darwin"
        ? ["/Volumes"]
        : [...(user ? [`/media/${user}`, `/run/media/${user}`] : []), "/media", "/mnt"];
    const listed = await Promise.all(
      holders.map(async (holder) =>
        ((await subfolders(holder)) ?? []).map((name) => ({ name, path: join(holder, name) })),
      ),
    );
    // `/media/<user>` holds disks; it is not one.
    found = [{ name: "/", path: "/" }, ...listed.flat().filter((volume) => !holders.includes(volume.path))];
  }
  // Real paths, and each disk once. On macOS the start disk is also a link to the root in
  // `/Volumes`; the root takes the name of that link.
  const seen = new Map<string, AgentFolderBrowseEntry>();
  for (const volume of found) {
    const path = await realFolder(volume.path);
    const known = seen.get(path);
    if (!known || known.name === "/") seen.set(path, { name: volume.name, path });
  }
  return [...seen.values()].slice(0, AGENT_FOLDER_VOLUME_LIMIT);
}

export function createAgentFolders({ service, userDataPath }: AgentFoldersDependencies) {
  // Each change reads the list, checks the disk, then saves the whole list. One change at a time for
  // each agent, so an Undo during a remove does not save over it.
  const pending = new Map<string, Promise<unknown>>();
  function oneAtATime<T>(agentId: string, change: () => Promise<T>): Promise<T> {
    const result = (pending.get(agentId) ?? Promise.resolve()).then(change);
    const settled = result.catch(() => undefined);
    pending.set(agentId, settled);
    void settled.then(() => {
      if (pending.get(agentId) === settled) pending.delete(agentId);
    });
    return result;
  }

  function requireAgent(agentId: string): AgentSummary {
    const agent = service.listAgents().find((candidate) => candidate.id === agentId);
    if (!agent) throw new Error("Unknown agent.");
    return agent;
  }

  async function list(agent: AgentSummary): Promise<AgentFolderList> {
    const folders = agent.additionalFolders ?? [];
    const [found, workspace, shared] = await Promise.all([
      Promise.all(folders.map(isDirectory)),
      realFolder(agent.workspacePath),
      realFolder(service.sharedRoot),
    ]);
    // Real paths, so a covered folder flashes the row that the coverage check named.
    return {
      workspace,
      shared,
      folders: folders.map((path, index) => ({ path, found: found[index] === true })),
      excluded: agent.excludedFolders ?? [],
    };
  }

  async function save(agent: AgentSummary, folders: string[]): Promise<AgentFolderList> {
    return list(await runCauseEffect(service.updateAgent({ agentId: agent.id, additionalFolders: folders })));
  }

  async function saveExcluded(agent: AgentSummary, excluded: string[]): Promise<AgentFolderList> {
    return list(await runCauseEffect(service.updateAgent({ agentId: agent.id, excludedFolders: excluded })));
  }

  /**
   * A folder in or around OpenBot's own data or the OpenBot folder, or one that holds this agent's
   * workspace or the shared folder. The OpenBot folder holds the workspaces of the other agents; the
   * home folder and a disk root hold it too.
   */
  async function isProtected(path: string, roots: readonly string[]): Promise<boolean> {
    // The shared folder is in the OpenBot folder, beside the agent workspaces.
    const [openbot, userData] = await Promise.all([realFolder(dirname(service.sharedRoot)), realFolder(userDataPath)]);
    return (
      parse(path).root === path ||
      folderInside(userData, path) ||
      folderInside(openbot, path) ||
      [openbot, userData, ...roots].some((root) => folderInside(path, root))
    );
  }

  async function addNow(agentId: string, picked: string, replace?: string): Promise<AgentFolderChange> {
    const agent = requireAgent(agentId);
    const current = agent.additionalFolders ?? [];
    const others = current.filter((folder) => folder !== replace);
    if (!(await isDirectory(picked)))
      return { outcome: "refused", path: picked, refusal: "missing", list: await list(agent) };
    const path = await realFolder(picked);
    const [workspace, shared] = await Promise.all([realFolder(agent.workspacePath), realFolder(service.sharedRoot)]);
    const coverage = agentFolderCoverage(path, { workspace, shared, folders: others });
    if (coverage) return { outcome: "covered", path, coverage, list: await list(agent) };
    if (await isProtected(path, [workspace, shared]))
      return { outcome: "refused", path, refusal: "protected", list: await list(agent) };
    // A folder that holds folders already added takes their place.
    const kept = others.filter((folder) => !folderInside(path, folder));
    if (kept.length >= AGENT_FOLDER_LIMIT)
      return { outcome: "refused", path, refusal: "limit", list: await list(agent) };
    const replacing = replace !== undefined && current.includes(replace);
    const next = replacing
      ? current.flatMap((folder) => (folder === replace ? [path] : kept.includes(folder) ? [folder] : []))
      : [...kept, path];
    const saved = await save(agent, next);
    if (replacing) return { outcome: "replaced", path, list: saved };
    return { outcome: "added", path, replaced: others.filter((folder) => !kept.includes(folder)), list: saved };
  }

  async function excludeNow(agentId: string, picked: string): Promise<AgentExclusionChange> {
    const agent = requireAgent(agentId);
    if (!(await isDirectory(picked)))
      return { outcome: "refused", path: picked, refusal: "missing", list: await list(agent) };
    const path = await realFolder(picked);
    const current = await list(agent);
    const roots = [current.workspace, current.shared, ...current.folders.map((folder) => folder.path)];
    if (roots.includes(path)) return { outcome: "refused", path, refusal: "root", list: current };
    if (!roots.some((root) => folderInside(root, path)))
      return { outcome: "refused", path, refusal: "outside", list: current };
    const folder = agentExclusionCoverage(path, current.excluded);
    if (folder) return { outcome: "covered", path, folder, list: current };
    // A folder that holds folders already excluded takes their place.
    const kept = current.excluded.filter((excluded) => !folderInside(path, excluded));
    if (kept.length >= AGENT_FOLDER_LIMIT) return { outcome: "refused", path, refusal: "limit", list: current };
    return {
      outcome: "excluded",
      path,
      replaced: current.excluded.filter((excluded) => !kept.includes(excluded)),
      list: await saveExcluded(agent, [...kept, path]),
    };
  }

  return {
    requireAgent,
    listAgents: () => service.listAgents(),
    list: (agentId: string) => list(requireAgent(agentId)),
    /** Adds `picked`, or puts it in the place of `replace`. */
    add: (agentId: string, picked: string, replace?: string) =>
      oneAtATime(agentId, () => addNow(agentId, picked, replace)),
    remove: (agentId: string, path: string) =>
      oneAtATime(agentId, async (): Promise<AgentFolderChange> => {
        const agent = requireAgent(agentId);
        const folders = agent.additionalFolders ?? [];
        if (!folders.includes(path)) return { outcome: "removed", path, list: await list(agent) };
        return {
          outcome: "removed",
          path,
          list: await save(
            agent,
            folders.filter((folder) => folder !== path),
          ),
        };
      }),
    /** Excludes `picked`, a folder in the workspace, the shared folder or an added folder. */
    exclude: (agentId: string, picked: string) => oneAtATime(agentId, () => excludeNow(agentId, picked)),
    include: (agentId: string, path: string) =>
      oneAtATime(agentId, async (): Promise<AgentExclusionChange> => {
        const agent = requireAgent(agentId);
        const excluded = agent.excludedFolders ?? [];
        if (!excluded.includes(path)) return { outcome: "included", path, list: await list(agent) };
        return {
          outcome: "included",
          path,
          list: await saveExcluded(
            agent,
            excluded.filter((folder) => folder !== path),
          ),
        };
      }),
    /**
     * The folders in `path`, or in the home folder, sorted by name, for a device that cannot open the
     * folder picker of this computer. Hidden folders stay out, as the picker hides them. Null when
     * the folder is not there or this computer does not let OpenBot read it.
     */
    async browse(path: string | null): Promise<AgentFolderBrowse | null> {
      const folder = await realFolder(path ?? homedir());
      const names = await subfolders(folder);
      if (!names) return null;
      const parent = dirname(folder);
      return {
        path: folder,
        parentPath: parent === folder ? null : parent,
        entries: names.slice(0, AGENT_FOLDER_BROWSE_LIMIT).map((name) => ({ name, path: join(folder, name) })),
        truncated: names.length > AGENT_FOLDER_BROWSE_LIMIT,
        home: await realFolder(homedir()),
        volumes: await volumes(),
      };
    },
  };
}

export type AgentFolders = ReturnType<typeof createAgentFolders>;
