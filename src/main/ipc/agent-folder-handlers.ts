// The folders a local agent can change besides its workspace and the shared folder. Only the local
// service answers: the Team API does not carry them, so a joined server's agent has none here.

import { realpath, stat } from "node:fs/promises";
import { dirname, join, parse, resolve } from "node:path";
import {
  AGENT_FOLDER_LIMIT,
  type AgentExclusionChange,
  type AgentFolderChange,
  type AgentFolderList,
  type AgentSummary,
  agentExclusionCoverage,
  agentFolderCoverage,
  folderInside,
  parseAgentFolderInput,
  parseChooseAgentFolderInput,
} from "@openbot/contracts/ipc";
import type { AppTranslate } from "@openbot/i18n";
import { type BrowserWindow, dialog, type OpenDialogOptions } from "electron";
import type { AgentService } from "../../backend/agent-service";
import { runCauseEffect } from "../../backend/effect-boundary";
import { parseAgentId } from "./agent-inputs";
import { type IpcGroupHandlers, payloadHandler } from "./define-ipc-group";

export interface AgentFolderIpcDependencies {
  service: AgentService;
  /** The app's own data, with `openbot.db`. */
  userDataPath: string;
  getMainWindow: () => BrowserWindow | null;
  translate: AppTranslate;
}

async function isDirectory(path: string): Promise<boolean> {
  return (await stat(path).catch(() => null))?.isDirectory() === true;
}

/** The real path, so a sandbox profile and the coverage checks compare the same text. */
async function realFolder(path: string): Promise<string> {
  return realpath(path).catch(() => resolve(path));
}

export function agentFolderIpcHandlers({
  service,
  userDataPath,
  getMainWindow,
  translate,
}: AgentFolderIpcDependencies): Pick<IpcGroupHandlers, "agentFolders"> {
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

  /** A second press on + while the picker is open does not open another one. */
  let picking = false;

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

  /** Adds `picked`, or puts it in the place of `replace`. */
  function add(agentId: string, picked: string, replace?: string): Promise<AgentFolderChange> {
    return oneAtATime(agentId, () => addNow(agentId, picked, replace));
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

  /** Excludes `picked`, a folder in the workspace, the shared folder or an added folder. */
  function exclude(agentId: string, picked: string): Promise<AgentExclusionChange> {
    return oneAtATime(agentId, async () => {
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
    });
  }

  return {
    agentFolders: {
      listAgentFolders: payloadHandler(parseAgentId, (agentId) => list(requireAgent(agentId))),
      chooseAgentFolder: payloadHandler(parseChooseAgentFolderInput, async ({ agentId, replace }) => {
        const agent = requireAgent(agentId);
        const parent = getMainWindow();
        const options: OpenDialogOptions = {
          title: translate("dialog.chooseAgentFolder", { agent: agent.name }),
          properties: ["openDirectory", "createDirectory"],
          ...(replace === undefined ? {} : { defaultPath: join(replace, "..") }),
        };
        if (picking) return { outcome: "cancelled", list: await list(agent) };
        picking = true;
        const result = await (parent ? dialog.showOpenDialog(parent, options) : dialog.showOpenDialog(options)).finally(
          () => {
            picking = false;
          },
        );
        const picked = result.canceled ? undefined : result.filePaths[0];
        if (picked === undefined) return { outcome: "cancelled", list: await list(agent) };
        return add(agentId, picked, replace);
      }),
      addAgentFolder: payloadHandler(parseAgentFolderInput, ({ agentId, path }) => add(agentId, path)),
      chooseAgentExclusion: payloadHandler(parseAgentId, async (agentId): Promise<AgentExclusionChange> => {
        const agent = requireAgent(agentId);
        const parent = getMainWindow();
        // The picker opens in the first added folder, else in the workspace.
        const options: OpenDialogOptions = {
          title: translate("dialog.chooseAgentExclusion", { agent: agent.name }),
          properties: ["openDirectory"],
          defaultPath: agent.additionalFolders?.[0] ?? agent.workspacePath,
        };
        if (picking) return { outcome: "cancelled", list: await list(agent) };
        picking = true;
        const result = await (parent ? dialog.showOpenDialog(parent, options) : dialog.showOpenDialog(options)).finally(
          () => {
            picking = false;
          },
        );
        const picked = result.canceled ? undefined : result.filePaths[0];
        if (picked === undefined) return { outcome: "cancelled", list: await list(agent) };
        return exclude(agentId, picked);
      }),
      addAgentExclusion: payloadHandler(parseAgentFolderInput, ({ agentId, path }) => exclude(agentId, path)),
      removeAgentExclusion: payloadHandler(parseAgentFolderInput, ({ agentId, path }) =>
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
      ),
      removeAgentFolder: payloadHandler(parseAgentFolderInput, ({ agentId, path }) =>
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
      ),
    },
  };
}
